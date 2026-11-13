import { fetchJson } from '../../util/http.js'

/**
 * Busca imágenes con licencia libre en Openverse (sin clave).
 * El servicio puede tardar; si falla, el pipeline continúa con otros proveedores.
 * @param {string} query
 * @param {{ limit?: number }} [options]
 */
export async function searchOpenverse(query, options = {}) {
  const { limit = 8 } = options
  const params = new URLSearchParams({
    q: query,
    page_size: String(limit),
    license_type: 'all-cc',
    mature: 'false',
  })
  const data = await fetchJson(`https://api.openverse.org/v1/images/?${params}`, { timeoutMs: 9000, retries: 0 })
  return (data?.results ?? [])
    .filter((item) => item.url && (item.width ?? 0) >= 600)
    .map((item) => ({
      provider: 'openverse',
      title: item.title ?? '',
      url: item.url,
      originalUrl: item.url,
      width: item.width,
      height: item.height,
      license: `CC ${String(item.license ?? '').toUpperCase()} ${item.license_version ?? ''}`.trim(),
      author: item.creator ?? '',
      pageUrl: item.foreign_landing_url ?? '',
    }))
}
