/** Extracción de HTML: entidades, JSON-LD y galería del artículo. */

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª',
  aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', ntilde: 'ñ', uuml: 'ü',
  Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Ntilde: 'Ñ', Uuml: 'Ü',
  laquo: '«', raquo: '»', hellip: '…', mdash: '—', ndash: '–', deg: '°', frac12: '½', frac14: '¼',
}

/** Decodifica entidades HTML habituales. @param {string} text */
export function decodeEntities(text) {
  return String(text).replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity) => {
    if (entity.startsWith('#x') || entity.startsWith('#X')) {
      return String.fromCodePoint(Number.parseInt(entity.slice(2), 16))
    }
    if (entity.startsWith('#')) return String.fromCodePoint(Number.parseInt(entity.slice(1), 10))
    return ENTITIES[entity] ?? whole
  })
}

/** Quita etiquetas y normaliza espacios. @param {string} html */
export function stripTags(html) {
  return decodeEntities(String(html).replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Extrae y parsea todos los bloques JSON-LD de la página.
 * @param {string} html
 * @returns {any[]}
 */
export function parseJsonLd(html) {
  const nodes = []
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = regex.exec(html)) !== null) {
    const raw = match[1].trim().replace(/^<!--/, '').replace(/-->$/, '')
    try {
      const parsed = JSON.parse(raw)
      collectNodes(parsed, nodes)
    } catch {
      // Un bloque JSON-LD roto no debe impedir leer el resto de la página.
    }
  }
  return nodes
}

/** @param {any} value @param {any[]} out */
function collectNodes(value, out) {
  if (!value) return
  if (Array.isArray(value)) {
    for (const item of value) collectNodes(item, out)
    return
  }
  if (typeof value !== 'object') return
  if (value['@graph']) collectNodes(value['@graph'], out)
  if (value['@type']) out.push(value)
}

/** @param {any} node @param {string} type */
export function hasType(node, type) {
  const value = node['@type']
  const types = Array.isArray(value) ? value : [value]
  return types.some((entry) => String(entry).toLowerCase() === type.toLowerCase())
}

const RELATED_MARKERS = [
  'te puede interesar', 'también te puede interesar', 'recetas relacionadas', 'recetas similares',
  'más recetas', 'comentarios', 'valora esta receta', 'publicidad', 'newsletter',
]

/** @param {string} base @param {string} href */
export function resolveUrl(base, href) {
  try {
    return new URL(href, base).toString()
  } catch {
    return null
  }
}

/**
 * Devuelve las imágenes del cuerpo del artículo en orden, con la sección a la que pertenecen.
 * @param {string} html
 * @param {string} baseUrl
 * @returns {Array<{ url: string, alt: string, heading: string, width: number|null, height: number|null }>}
 */
export function extractArticleImages(html, baseUrl) {
  const articleMatch = /<article[\s\S]*?<\/article>/i.exec(html)
  const mainMatch = /<main[\s\S]*?<\/main>/i.exec(html)
  const region = articleMatch?.[0] ?? mainMatch?.[0] ?? html
  const clean = region.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')

  const images = []
  const seen = new Set()
  let heading = ''
  let stopped = false

  const tokenRegex = /<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>|<img\b[^>]*>/gi
  let match
  while ((match = tokenRegex.exec(clean)) !== null && !stopped) {
    if (match[1] !== undefined) {
      const text = stripTags(match[1]).toLowerCase()
      if (RELATED_MARKERS.some((marker) => text.includes(marker))) {
        stopped = true
        break
      }
      heading = text
      continue
    }

    const tag = match[0]
    const rawSrc = attr(tag, 'data-src') ?? attr(tag, 'src') ?? firstSrcset(attr(tag, 'srcset'))
    if (!rawSrc || rawSrc.startsWith('data:')) continue
    if (/\.svg($|\?)/i.test(rawSrc)) continue
    const url = resolveUrl(baseUrl, rawSrc)
    if (!url) continue
    const key = url.split('?')[0]
    if (seen.has(key)) continue
    const alt = decodeEntities(attr(tag, 'alt') ?? '')
    const width = Number(attr(tag, 'width') ?? 0) || null
    const height = Number(attr(tag, 'height') ?? 0) || null
    if (isChromeImage(key, alt, width)) continue
    seen.add(key)
    images.push({ url, alt, heading, width, height })
  }
  return images
}

/** @param {string} key @param {string} alt @param {number|null} width */
function isChromeImage(key, alt, width) {
  const name = key.split('/').pop() ?? ''
  if (/logo|avatar|icon|sprite|placeholder|banner|silhouette/i.test(name)) return true
  if (/_400\.(jpe?g|webp|png)$/i.test(name)) return true
  if (/logo|avatar/i.test(alt)) return true
  if (width !== null && width > 0 && width < 200) return true
  return false
}

/** @param {string} tag @param {string} name */
function attr(tag, name) {
  const regex = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, 'i')
  const match = regex.exec(tag)
  return match ? decodeEntities(match[1]) : null
}

/** @param {string|null} srcset */
function firstSrcset(srcset) {
  if (!srcset) return null
  const first = srcset.split(',')[0]?.trim()
  return first ? first.split(/\s+/)[0] : null
}
