import { fetchJson } from '../../util/http.js'

/**
 * Catálogo principal de música libre: Jamendo (requiere JAMENDO_CLIENT_ID, gratis).
 * @param {string} query
 * @param {{ limit?: number }} [options]
 */
export async function searchJamendo(query, options = {}) {
  const clientId = process.env.JAMENDO_CLIENT_ID
  if (!clientId) return []
  const { limit = 10 } = options
  const params = new URLSearchParams({
    client_id: clientId,
    format: 'json',
    limit: String(limit),
    search: query,
    audioformat: 'mp32',
    include: 'licenses+musicinfo',
    order: 'popularity_total',
  })
  const data = await fetchJson(`https://api.jamendo.com/v3.0/tracks/?${params}`, { timeoutMs: 20000 })
  return (data?.results ?? [])
    .filter((track) => track.audio)
    .map((track) => ({
      provider: 'jamendo',
      id: String(track.id),
      title: track.name,
      artist: track.artist_name,
      album: track.album_name,
      duration: Number(track.duration ?? 0),
      url: track.audiodownload || track.audio,
      previewUrl: track.audio,
      license: track.license_ccurl || 'Creative Commons',
      attribution: `${track.name} — ${track.artist_name} (Jamendo, ${track.license_ccurl || 'CC'})`,
      pageUrl: track.shareurl ?? '',
      genre: track.musicinfo?.tags?.genres?.join(', ') ?? query,
    }))
}
