import { fetchJson } from '../../util/http.js'

/**
 * Busca imágenes en Pexels (requiere PEXELS_API_KEY, gratuita).
 * @param {string} query
 * @param {{ limit?: number, apiKey?: string }} [options]
 */
export async function searchPexels(query, options = {}) {
  const apiKey = options.apiKey ?? process.env.PEXELS_API_KEY
  if (!apiKey) return []
  const { limit = 8 } = options
  const params = new URLSearchParams({ query, per_page: String(limit), orientation: 'landscape' })
  const data = await fetchJson(`https://api.pexels.com/v1/search?${params}`, {
    timeoutMs: 15000,
    headers: { authorization: apiKey },
  })
  return (data?.photos ?? []).map((photo) => ({
    provider: 'pexels',
    title: photo.alt ?? query,
    url: photo.src?.large2x ?? photo.src?.large,
    originalUrl: photo.url,
    width: photo.width,
    height: photo.height,
    license: 'Pexels License',
    author: photo.photographer ?? '',
    pageUrl: photo.url,
  }))
}
