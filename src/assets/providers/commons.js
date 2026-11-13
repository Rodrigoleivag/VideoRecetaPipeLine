import { fetchJson } from '../../util/http.js'

/**
 * Busca imágenes en Wikimedia Commons (sin clave).
 * @param {string} query
 * @param {{ limit?: number, minWidth?: number, timeoutMs?: number }} [options]
 */
export async function searchCommons(query, options = {}) {
  const { limit = 6, minWidth = 640, timeoutMs = 20000 } = options
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    generator: 'search',
    gsrsearch: `${query} filetype:bitmap`,
    gsrlimit: String(limit),
    gsrnamespace: '6',
    prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata',
    iiurlwidth: '1800',
  })
  const data = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params}`, { timeoutMs })
  const pages = Object.values(data?.query?.pages ?? {})
  return pages
    .map((page) => {
      const info = page.imageinfo?.[0]
      if (!info) return null
      if (!/^image\/(jpeg|png|webp)$/.test(info.mime ?? '')) return null
      if ((info.width ?? 0) < minWidth) return null
      const meta = info.extmetadata ?? {}
      return {
        provider: 'commons',
        title: page.title,
        url: info.thumburl ?? info.url,
        originalUrl: info.url,
        width: info.width,
        height: info.height,
        license: stripHtml(meta.LicenseShortName?.value ?? 'Wikimedia Commons'),
        author: stripHtml(meta.Artist?.value ?? ''),
        pageUrl: info.descriptionurl ?? '',
      }
    })
    .filter(Boolean)
}

/** @param {string} value */
function stripHtml(value) {
  return String(value).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
}
