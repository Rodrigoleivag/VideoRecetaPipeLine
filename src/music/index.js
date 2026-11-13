import path from 'node:path'
import { download } from '../util/http.js'
import { ensureDir, exists, writeJson } from '../util/fsx.js'
import { run } from '../util/exec.js'
import { info, ok, warn, debug } from '../util/log.js'
import { ask } from '../util/prompt.js'
import { searchJamendo } from './providers/jamendo.js'
import { searchArchive } from './providers/archive.js'
import { searchLocal } from './providers/local.js'
import { ROOT } from '../config.js'

/**
 * Clasifica una licencia según su idoneidad para un canal monetizado:
 * 0 dominio público, 1 CC BY o BY-SA, 2 CC con NC o ND, 3 desconocida.
 * @param {{ license?: string }} track
 * @returns {0|1|2|3}
 */
export function licenseRank(track) {
  const license = String(track.license ?? '').toLowerCase()
  if (!license) return 3
  if (/cc0|publicdomain|public domain|zero/.test(license)) return 0
  if (/by-nc|noncommercial|non-commercial|by-nd|-nd\//.test(license)) return 2
  if (/by-sa|creativecommons|cc by|by\//.test(license)) return 1
  return 3
}

/**
 * Reordena por licencia, conservando el orden de relevancia dentro de cada grupo.
 * @template {{ license?: string }} T
 * @param {T[]} tracks
 * @returns {T[]}
 */
export function rankByLicense(tracks) {
  return tracks
    .map((track, index) => ({ track, index, rank: licenseRank(track) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .map((entry) => entry.track)
}

/**
 * Deduce el ambiente musical de la receta y devuelve consultas ordenadas.
 * @param {import('../recipe/extract.js').RecipeDoc} recipe
 * @param {import('../config.js').PipelineConfig} config
 * @returns {Array<{ query: string, genre: string }>}
 */
export function moodQueries(recipe, config) {
  const haystack = [
    recipe.title,
    recipe.description,
    recipe.category,
    recipe.cuisine,
    ...(recipe.keywords ?? []),
    ...recipe.ingredients.map((ingredient) => `${ingredient.name} ${ingredient.label ?? ''}`),
  ].join(' ').toLowerCase()

  const matches = []
  for (const mood of config.music.moods ?? []) {
    if (mood.when.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      matches.push({ query: mood.query, genre: mood.genre })
    }
  }
  for (const genre of config.music.fallbackGenres ?? []) {
    matches.push({ query: genre, genre })
  }
  const seen = new Set()
  return matches.filter((entry) => {
    if (seen.has(entry.query)) return false
    seen.add(entry.query)
    return true
  })
}

/**
 * Busca candidatos en los catálogos configurados.
 * @param {import('../recipe/extract.js').RecipeDoc} recipe
 * @param {import('../config.js').PipelineConfig} config
 * @param {{ query?: string, limit?: number }} [options]
 */
export async function searchMusic(recipe, config, options = {}) {
  const queries = options.query
    ? [{ query: options.query, genre: options.query }]
    : moodQueries(recipe, config)
  const limit = options.limit ?? config.music.candidates ?? 8
  const candidates = []

  for (const { query, genre } of queries) {
    if (candidates.length >= limit) break
    const found = await searchProvider(query, config, limit - candidates.length)
    for (const track of found) candidates.push({ ...track, mood: genre })
    if (candidates.length === 0) debug(`sin resultados para «${query}»`)
  }

  if (candidates.length === 0 && config.music.provider === 'local') {
    const local = await searchLocal('', { dir: path.join(ROOT, 'music'), limit })
    candidates.push(...local)
  }
  return rankByLicense(candidates).slice(0, limit)
}

/** @param {string} query @param {import('../config.js').PipelineConfig} config @param {number} limit */
async function searchProvider(query, config, limit) {
  const order = [config.music.provider, 'jamendo', 'archive', 'local'].filter(Boolean)
  const tried = new Set()
  for (const provider of order) {
    if (tried.has(provider)) continue
    tried.add(provider)
    try {
      if (provider === 'jamendo') {
        const found = await searchJamendo(query, { limit })
        if (found.length > 0) return found
      }
      if (provider === 'archive') {
        const found = await searchArchive(query, { limit })
        if (found.length > 0) return found
      }
      if (provider === 'local') {
        const found = await searchLocal(query, { dir: path.join(ROOT, 'music'), limit })
        if (found.length > 0) return found
      }
    } catch (error) {
      debug(`proveedor de música ${provider} falló: ${error.message}`)
    }
  }
  return []
}

/**
 * Presenta los candidatos, permite escucharlos y elige uno.
 * @param {any[]} candidates
 * @param {ReturnType<import('../config.js').recipePaths>} paths
 * @param {import('../config.js').PipelineConfig} config
 * @param {{ choose?: number, pick?: boolean, query?: string }} [options]
 */
export async function chooseMusic(candidates, paths, config, options = {}) {
  if (candidates.length === 0) return null

  if (options.choose) {
    const index = Number(options.choose) - 1
    if (!candidates[index]) throw new Error(`No existe la pista ${options.choose}. Hay ${candidates.length}.`)
    return materialize(candidates[index], paths)
  }

  const chosen = await pickInteractive(candidates, paths, config)
  return chosen
}

/** @param {any[]} candidates @param {any} paths @param {import('../config.js').PipelineConfig} config */
async function pickInteractive(candidates, paths, config) {
  console.log('\n  Pistas libres encontradas (elige antes de montar el vídeo):')
  candidates.forEach((track, index) => {
    const duration = track.duration ? `${Math.floor(track.duration / 60)}:${String(Math.round(track.duration % 60)).padStart(2, '0')}` : '—'
    const license = licenseRank(track) >= 2 ? ' · ⚠ licencia con restricciones' : ''
    console.log(`  ${String(index + 1).padStart(2, '0')}. ${track.title} — ${track.artist} · ${duration} · ${track.mood ?? track.genre ?? ''} · ${track.provider}${license}`)
  })
  console.log('\n  Escribe el número para elegir, «p N» para escuchar, «enter» para la primera o «q» para salir.')

  let selected = 0
  while (true) {
    const answer = await ask('  Música > ')
    if (answer === '') {
      return materialize(candidates[selected], paths)
    }
    if (answer === 'q') return null
    const preview = /^p\s+(\d+)$/i.exec(answer)
    if (preview) {
      const track = candidates[Number(preview[1]) - 1]
      if (track) await previewTrack(track, paths)
      continue
    }
    const index = Number(answer)
    if (Number.isInteger(index) && candidates[index - 1]) {
      selected = index - 1
      return materialize(candidates[selected], paths)
    }
    warn('Opción no válida.')
  }
}

/** @param {any} track @param {any} paths */
export async function previewTrack(track, paths) {
  const dir = path.join(paths.cache, 'music-preview')
  await ensureDir(dir)
  const file = path.join(dir, `${track.provider}-${track.id}.mp3`.replace(/[^\w.\-/]/g, '_'))
  try {
    if (!(await exists(file))) await download(track.previewUrl ?? track.url, file, { timeoutMs: 90000 })
    await playAudio(file)
  } catch (error) {
    warn(`No se pudo reproducir la muestra: ${error.message}`)
  }
}

/** @param {string} file */
export async function playAudio(file) {
  if (process.platform === 'darwin') return run('afplay', [file], { allowFailure: true })
  return run('ffplay', ['-nodisp', '-autoexit', '-loglevel', 'error', file], { allowFailure: true })
}

/**
 * Descarga la pista elegida y guarda su atribución.
 * @param {any} track
 * @param {ReturnType<import('../config.js').recipePaths>} paths
 */
export async function materialize(track, paths) {
  await ensureDir(paths.music)
  const ext = path.extname(track.url).split('?')[0] || '.mp3'
  const file = path.join(paths.music, `track${ext}`)
  if (!(await exists(file))) await download(track.url, file, { timeoutMs: 180000 })
  const choice = {
    track,
    file: path.relative(paths.base, file),
    attribution: track.attribution,
    chosenAt: new Date().toISOString(),
  }
  await writeJson(paths.musicChoice, choice)
  ok(`Música elegida: ${track.title} — ${track.artist} (${track.license})`)
  if (licenseRank(track) >= 2) {
    warn('Licencia sin uso comercial permitido: YouTube puede reclamar el vídeo si monetizas. Jamendo (JAMENDO_CLIENT_ID) ofrece catálogo CC BY.')
  }
  info(`Atribución para la descripción: ${track.attribution}`)
  return choice
}

/**
 * Recupera la música ya elegida, si existe.
 * @param {ReturnType<import('../config.js').recipePaths>} paths
 */
export async function loadChosenMusic(paths) {
  if (!(await exists(paths.musicChoice))) return null
  const { readJson } = await import('../util/fsx.js')
  const choice = await readJson(paths.musicChoice)
  const file = path.join(paths.base, choice.file)
  if (!(await exists(file))) return null
  return { ...choice, absolute: file }
}
