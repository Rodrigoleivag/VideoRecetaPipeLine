import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { exists, readJson } from './util/fsx.js'
import { slugify } from './util/text.js'

/** Raíz del proyecto (el directorio que contiene config/ y src/). */
export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Carga .env sin dependencias externas; no sobreescribe variables ya definidas.
 * @param {string} [root]
 */
export async function loadEnv(root = ROOT) {
  const file = path.join(root, '.env')
  if (!(await exists(file))) return
  const raw = await readFile(file, 'utf8')
  for (const line of raw.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!match) continue
    const [, key, rawValue] = match
    const value = rawValue.replace(/^["'](.*)["']$/s, '$1').trim()
    if (!process.env[key]) process.env[key] = value
  }
}

/**
 * Configuración efectiva del pipeline.
 * @param {string} [root]
 */
export async function loadConfig(root = ROOT) {
  const config = await readJson(path.join(root, 'config', 'pipeline.json'))
  config.voices = await readJson(path.join(root, 'config', 'voices.json'))
  config.ingredients = await readJson(path.join(root, 'config', 'ingredients.json'))
  return config
}

/**
 * Directorios de trabajo de una receta concreta.
 * @param {import('./config.js').PipelineConfig} config
 * @param {string} title
 */
export function recipePaths(config, title) {
  const slug = slugify(title)
  const base = path.join(ROOT, config.workspace, slug)
  return {
    slug,
    base,
    meta: path.join(base, 'recipe.json'),
    script: path.join(base, 'script.json'),
    scenes: path.join(base, 'scenes'),
    images: path.join(base, 'images'),
    audio: path.join(base, 'audio'),
    clips: path.join(base, 'clips'),
    music: path.join(base, 'music'),
    cache: path.join(base, 'cache'),
    musicChoice: path.join(base, 'music.json'),
    subtitles: path.join(base, 'subtitles.ass'),
    narration: path.join(base, 'narration.wav'),
    output: path.join(ROOT, config.output, `${slug}.mp4`),
  }
}

/** Ruta a un recurso del proyecto. @param {...string} parts */
export function projectPath(...parts) {
  return path.join(ROOT, ...parts)
}

/**
 * @typedef {object} PipelineConfig
 * @property {string} workspace
 * @property {string} output
 * @property {any} video
 * @property {any} subtitles
 * @property {any} voice
 * @property {any} script
 * @property {any} images
 * @property {any} music
 * @property {any} aiClips
 * @property {any} voices
 * @property {any} ingredients
 */
