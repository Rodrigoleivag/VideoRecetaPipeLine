import path from 'node:path'
import { readdir } from 'node:fs/promises'
import { exists } from '../../util/fsx.js'

/**
 * Catálogo local: cualquier audio que el usuario deje en la carpeta music/.
 * @param {string} query
 * @param {{ dir: string, limit?: number }} options
 */
export async function searchLocal(query, options) {
  const { dir, limit = 20 } = options
  if (!(await exists(dir))) return []
  const entries = await readdir(dir)
  const normalized = String(query).toLowerCase()
  return entries
    .filter((name) => /\.(mp3|wav|m4a|ogg|flac)$/i.test(name))
    .filter((name) => normalized.length === 0 || name.toLowerCase().includes(normalized) || true)
    .slice(0, limit)
    .map((name) => ({
      provider: 'local',
      id: name,
      title: path.basename(name, path.extname(name)),
      artist: 'Catálogo local',
      album: '',
      duration: 0,
      url: path.join(dir, name),
      previewUrl: path.join(dir, name),
      license: 'verificar antes de publicar',
      attribution: `${path.basename(name)} (catálogo local)`,
      pageUrl: '',
      genre: query,
    }))
}
