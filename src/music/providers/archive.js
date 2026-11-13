import { fetchJson } from '../../util/http.js'

/**
 * Catálogo libre sin clave: Internet Archive (colecciones con licencia Creative Commons).
 * La primera pasada descarta licencias NC/ND para que el vídeo se pueda
 * monetizar; solo si faltan resultados se abre a todo el catálogo CC.
 * @param {string} query
 * @param {{ limit?: number }} [options]
 */
export async function searchArchive(query, options = {}) {
  const { limit = 8 } = options
  const base = [
    'mediatype:(audio)',
    `(title:("${query}") OR subject:("${query}") OR description:("${query}"))`,
  ].join(' AND ')
  const commercial = `${base} AND licenseurl:*creativecommons* AND NOT licenseurl:*nc* AND NOT licenseurl:*nd*`
  const anyLicense = `${base} AND licenseurl:*creativecommons*`

  const seen = new Set()
  const tracks = []
  for (const lucene of [commercial, anyLicense]) {
    if (tracks.length >= limit) break
    const docs = await fetchDocs(lucene, limit - tracks.length)
    for (const doc of docs) {
      if (seen.has(doc.identifier)) continue
      seen.add(doc.identifier)
      tracks.push(doc)
    }
  }

  const resolved = await Promise.all(tracks.map((doc) => toTrack(doc, query).catch(() => null)))
  return resolved.filter((track) => track !== null).slice(0, limit)
}

/**
 * @param {string} lucene
 * @param {number} rows
 * @returns {Promise<any[]>}
 */
async function fetchDocs(lucene, rows) {
  const params = new URLSearchParams({
    q: lucene,
    fl: 'identifier,title,creator,licenseurl,downloads',
    rows: String(Math.max(1, rows)),
    page: '1',
    output: 'json',
    sort: 'downloads desc',
  })
  const data = await fetchJson(`https://archive.org/advancedsearch.php?${params}`, { timeoutMs: 20000 })
  return data?.response?.docs ?? []
}

/**
 * @param {any} doc
 * @param {string} query
 */
async function toTrack(doc, query) {
  const meta = await fetchJson(`https://archive.org/metadata/${encodeURIComponent(doc.identifier)}`, { timeoutMs: 15000 })
  const files = (meta?.files ?? []).filter((file) => /\.(mp3|ogg|m4a)$/i.test(file.name ?? ''))
  // Los ítems sin MP3 utilizable no entran en la lista, aunque el documento exista.
  if (files.length === 0) return null
  const chosen = files.find((file) => /VBR MP3/i.test(file.format ?? '')) ?? files[0]
  return {
    provider: 'archive',
    id: doc.identifier,
    title: clean(doc.title) || chosen.name,
    artist: clean(Array.isArray(doc.creator) ? doc.creator[0] : doc.creator) || 'Internet Archive',
    album: clean(meta?.metadata?.title) ?? '',
    duration: parseDuration(chosen.length),
    url: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURI(chosen.name)}`,
    previewUrl: `https://archive.org/download/${encodeURIComponent(doc.identifier)}/${encodeURI(chosen.name)}`,
    license: clean(doc.licenseurl) || 'Creative Commons',
    attribution: `${clean(doc.title) || chosen.name} — ${clean(Array.isArray(doc.creator) ? doc.creator[0] : doc.creator) || 'Internet Archive'} (Internet Archive, ${clean(doc.licenseurl) || 'CC'})`,
    pageUrl: `https://archive.org/details/${doc.identifier}`,
    genre: query,
  }
}

/** @param {string} value */
function clean(value) {
  return String(value ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
}

/** @param {string|number|undefined} value */
function parseDuration(value) {
  if (!value) return 0
  const raw = String(value)
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw)
  const parts = raw.split(':').map(Number)
  if (parts.some((part) => Number.isNaN(part))) return 0
  return parts.reduce((total, part) => total * 60 + part, 0)
}
