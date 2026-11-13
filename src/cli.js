import path from 'node:path'
import { stat } from 'node:fs/promises'
import { loadConfig, loadEnv, recipePaths, ROOT } from './config.js'
import { applyGlossary, extractRecipe, saveRecipe } from './recipe/extract.js'
import { buildScript } from './script/index.js'
import { resolveAssets, searchFallbackImages, normalizeImage, placeholderImage, writeCreditsText } from './assets/index.js'
import { synthesizeScenes, previewVoice } from './tts/index.js'
import { listVoices, previewText, resolveVoice } from './tts/voices.js'
import { pythonExecutable } from './tts/edge.js'
import { buildAss } from './subs/ass.js'
import { buildTimeline } from './video/timeline.js'
import { renderVisuals } from './video/clips.js'
import { buildNarration, renderFinal } from './video/render.js'
import { chooseMusic, loadChosenMusic, searchMusic } from './music/index.js'
import { download } from './util/http.js'
import { hasCommand, mediaDuration, ffmpeg, run } from './util/exec.js'
import { ensureDir, exists, readJson, writeJson } from './util/fsx.js'
import * as log from './util/log.js'
import { slugify } from './util/text.js'

const HELP = `
  voicereceta — de una URL de receta a un vídeo de YouTube

  Uso:
    voicereceta run <url> [opciones]         Pipeline completo
    voicereceta extract <url>               Solo extracción de la receta
    voicereceta script <url|slug>           Genera el guion narrado
    voicereceta assets <slug>               Resuelve y descarga imágenes
    voicereceta narrate <slug>              Voz y subtítulos sincronizados
    voicereceta voice [list|preview]        Catálogo y prueba de voces
    voicereceta music <url|slug> [--pick]   Busca y elige música libre
    voicereceta render <slug>               Monta el vídeo final
    voicereceta fix-image <slug> <escena>   Corrige imagen de una escena (post-revisión)
    voicereceta seo-desc <slug>             Genera descripción SEO para YouTube
    voicereceta thumbnail <slug>            Genera miniatura (thumbnail) con título
    voicereceta doctor                      Comprueba el entorno

  Opciones habituales:
    --voice <id>          Voz del narrador (por defecto es-ES-AlvaroNeural)
    --preset <nombre>     Tono: estandar | grave | profundo | pausado | energico
    --tone <nombre>       Estilo del guion: cercano | divertido | elegante | directo
    --minutes <n>         Duración objetivo del guion (min, por defecto 4)
    --script <provider>   template | llm
    --music <consulta>    Fuerza una búsqueda de música (p. ej. "jazz lounge")
    --choose <n>          Elige la pista n de la lista sin preguntar
    --pick                Pregunta qué pista usar durante el montaje
    --no-music            Vídeo sin música
    --no-subs             Sin subtítulos
    --force               Rehace los pasos ya calculados
    --refresh             Vuelve a descargar la página de la receta
    --verbose             Detalle de depuración
    --query <texto>       Término de búsqueda para fix-image
    --url <url>           URL directa de imagen para fix-image
`

/**
 * Punto de entrada del CLI.
 * @param {string[]} argv
 */
export async function main(argv) {
  await loadEnv()
  const [command = 'help', ...rest] = argv
  if (['help', '--help', '-h'].includes(command)) {
    console.log(HELP)
    return
  }

  const config = await loadConfig()
  const args = parseArgs(rest)
  if (args.flags.verbose) process.env.VOICERECETA_VERBOSE = '1'

  switch (command) {
    case 'doctor':
      return doctor(config)
    case 'extract':
      return commandExtract(args, config)
    case 'script':
      return commandScript(args, config)
    case 'assets':
      return commandAssets(args, config)
    case 'narrate':
      return commandNarrate(args, config)
    case 'voice':
      return commandVoice(args, config)
    case 'music':
      return commandMusic(args, config)
    case 'render':
      return commandRender(args, config)
    case 'run':
      return commandRun(args, config)
    case 'fix-image':
      return commandFixImage(args, config)
    case 'seo-desc':
      return commandSeoDesc(args, config)
    case 'thumbnail':
      return commandThumbnail(args, config)
    default:
      console.log(HELP)
      throw new Error(`Comando desconocido: ${command}`)
  }
}

/* ------------------------------------------------------------------ */
/* Comandos                                                            */
/* ------------------------------------------------------------------ */

/** @param {ReturnType<parseArgs>} args @param {any} config */
async function commandRun(args, config) {
  const url = args.positional[0]
  if (!url) throw new Error('Indica la URL de la receta: voicereceta run <url>')

  const { recipe, paths } = await ensureRecipe(url, config, args.flags)
  const script = await ensureScript(recipe, paths, config, args.flags)
  const assets = await ensureAssets(script, paths, config, args.flags)
  const tts = await ensureTts(script, paths, config, args.flags)
  const timeline = await ensureSubtitles(timelineFor(script, tts, config), paths, config, args.flags)
  const music = await ensureMusic(recipe, script, paths, config, args.flags)
  const output = await renderAll(script, timeline, assets, paths, config, music, args.flags)
  printSummary(output, timeline, paths, music)
}

/** @param {ReturnType<parseArgs>} args @param {any} config */
async function commandExtract(args, config) {
  const url = args.positional[0]
  if (!url) throw new Error('Indica la URL de la receta.')
  const { recipe, paths } = await ensureRecipe(url, config, args.flags)
  log.info(`Título: ${recipe.title}`)
  log.info(`Fuente: ${recipe.source.site} · ${recipe.times.total ?? '?'} min · ${recipe.servings ?? '?'} raciones`)
  log.info(`Ingredientes: ${recipe.ingredients.length} · Pasos: ${recipe.steps.length} · Imágenes: ${recipe.articleImages.length}`)
  log.ok(`Guardado en ${path.relative(ROOT, paths.meta)}`)
}

/** @param {ReturnType<parseArgs>} args @param {any} config */
async function commandScript(args, config) {
  const { recipe, paths } = await loadRecipeTarget(args, config)
  const script = await ensureScript(recipe, paths, config, { ...args.flags, force: true })
  for (const scene of script.scenes) {
    log.info(`[${scene.kind}] ${scene.heading}: ${scene.narration.length} car.`)
  }
  log.ok(`${script.totalWords} palabras ≈ ${(script.estimatedSeconds / 60).toFixed(1)} min`)
}

/** @param {ReturnType<parseArgs>} args @param {any} config */
async function commandAssets(args, config) {
  const { recipe, paths } = await loadRecipeTarget(args, config)
  const script = await ensureScript(recipe, paths, config, args.flags)
  const assets = await ensureAssets(script, paths, config, { ...args.flags, force: true })
  log.ok(`${assets.scenes.reduce((sum, scene) => sum + scene.images.length, 0)} imágenes preparadas.`)
}

/** @param {ReturnType<parseArgs>} args @param {any} config */
async function commandVoice(args, config) {
  const action = args.positional[0] ?? 'list'
  if (action === 'list') {
    for (const voice of listVoices(config)) {
      console.log(`  ${voice.id.padEnd(24)} ${voice.gender.padEnd(7)} ${voice.accent.padEnd(22)} ${voice.description}`)
      console.log(`  ${''.padEnd(24)} tonos: ${voice.presets.join(', ')}`)
    }
    const final = resolveVoice(config, {})
    log.info(`Voz activa: ${final.voice} · tono ${final.preset} (${final.rate}, ${final.pitch})`)
    return
  }
  if (action === 'preview') {
    const text = args.flags.text ?? previewText(args.positional[1] ?? 'esta receta')
    log.stage('Muestra de voz')
    const result = await previewVoice(text, config, {
      voice: args.flags.voice,
      preset: args.flags.preset,
      outDir: path.join(ROOT, 'work', '_preview'),
      play: args.flags.play !== false,
    })
    log.ok(`${result.voice.label} · ${result.duration.toFixed(1)} s · ${path.relative(ROOT, result.files[1])}`)
    return
  }
  throw new Error(`Acción de voz desconocida: ${action}`)
}

/** @param {ReturnType<parseArgs>} args @param {any} config */
async function commandMusic(args, config) {
  const { recipe, paths } = await loadRecipeTarget(args, config)
  if (!args.flags.json) {
    await ensureScript(recipe, paths, config, args.flags)
    log.stage('Catálogo de música libre')
  }
  const candidates = await searchMusic(recipe, config, { query: args.flags.music, limit: config.music.candidates })
  if (args.flags.json) {
    console.log(JSON.stringify(candidates))
    return
  }
  if (candidates.length === 0) {
    log.warn('Sin resultados. Configura JAMENDO_CLIENT_ID o deja pistas en la carpeta music/.')
    return
  }
  if (args.flags['list-only']) {
    candidates.forEach((track, index) => {
      console.log(`  ${index + 1}. ${track.title} — ${track.artist} · ${track.license} · ${track.provider}`)
    })
    return
  }
  const choice = await chooseMusic(candidates, paths, config, {
    choose: args.flags.choose,
    pick: args.flags.pick ?? true,
    query: args.flags.music,
  })
  if (!choice) {
    log.warn('No se eligió ninguna pista.')
    return
  }
  log.info(`Ejecuta «voicereceta render ${paths.slug}» para montar el vídeo con esta música.`)
}

/** @param {ReturnType<parseArgs>} args @param {any} config */
async function commandRender(args, config) {
  const { recipe, paths } = await loadRecipeTarget(args, config)
  const script = await ensureScript(recipe, paths, config, args.flags)
  const assets = await ensureAssets(script, paths, config, args.flags)
  const tts = await ensureTts(script, paths, config, args.flags)
  const timeline = await ensureSubtitles(timelineFor(script, tts, config), paths, config, args.flags)
  const music = await ensureMusic(recipe, script, paths, config, args.flags)
  const output = await renderAll(script, timeline, assets, paths, config, music, args.flags)
  printSummary(output, timeline, paths, music)
}

/**
 * Rehace voz y subtítulos sin volver a montar el vídeo. Sirve para revisar la
 * sincronización palabra a palabra antes de un render largo.
 * @param {ReturnType<parseArgs>} args @param {any} config
 */
async function commandNarrate(args, config) {
  const { recipe, paths } = await loadRecipeTarget(args, config)
  const script = await ensureScript(recipe, paths, config, args.flags)
  const tts = await ensureTts(script, paths, config, args.flags)
  const timeline = await ensureSubtitles(timelineFor(script, tts, config), paths, config, args.flags)
  const weak = tts.scenes.filter((scene) => (scene.alignmentRatio ?? 1) < 0.85)
  if (weak.length > 0) {
    log.warn(`${weak.length} escenas con alineación parcial: ${weak.map((scene) => scene.sceneId).join(', ')}`)
  }
  const best = tts.scenes.reduce((value, scene) => Math.min(value, scene.alignmentRatio ?? 1), 1)
  log.ok(`Voz y subtítulos listos: ${(timeline.totalDuration / 60).toFixed(2)} min · alineación mínima ${Math.round(best * 100)}%`)
  log.info(`Subtítulos: ${path.relative(ROOT, paths.subtitles)}`)
  log.info(`Ejecuta «voicereceta render ${paths.slug}» para montar el vídeo.`)
}

/* ------------------------------------------------------------------ */
/* Etapas                                                             */
/* ------------------------------------------------------------------ */

/**
 * @param {string} url
 * @param {any} config
 * @param {Record<string, any>} flags
 */
async function ensureRecipe(url, config, flags) {
  log.stage('1/6 · Extrayendo la receta')
  const cachedTitle = await guessSlugFromUrl(url, config)
  if (!flags.refresh && cachedTitle) {
    const cachedPaths = recipePaths(config, cachedTitle)
    if (await exists(cachedPaths.meta)) {
      const recipe = await readJson(cachedPaths.meta)
      applyGlossary(recipe, config.ingredients)
      log.info(`Receta en caché: ${recipe.title}`)
      return { recipe, paths: cachedPaths }
    }
  }

  const recipe = await extractRecipe(url, { refresh: flags.refresh })
  applyGlossary(recipe, config.ingredients)
  const paths = recipePaths(config, recipe.title)
  await ensureDir(paths.base)
  await saveRecipe(recipe, paths.meta)
  await rememberSlug(url, recipe.title, config)
  log.ok(`${recipe.title} · ${recipe.ingredients.length} ingredientes · ${recipe.steps.length} pasos`)
  return { recipe, paths }
}

/** @param {string} url @param {any} config */
async function guessSlugFromUrl(url, config) {
  const indexFile = path.join(ROOT, config.workspace, '_index.json')
  if (!(await exists(indexFile))) return null
  const index = await readJson(indexFile).catch(() => ({}))
  return index[url] ?? null
}

/** @param {string} url @param {string} title @param {any} config */
async function rememberSlug(url, title, config) {
  const indexFile = path.join(ROOT, config.workspace, '_index.json')
  const index = (await exists(indexFile)) ? await readJson(indexFile).catch(() => ({})) : {}
  index[url] = title
  await ensureDir(path.dirname(indexFile))
  await writeJson(indexFile, index)
}

/**
 * @param {ReturnType<parseArgs>} args
 * @param {any} config
 */
async function loadRecipeTarget(args, config) {
  const target = args.positional[0] ?? args.flags.slug
  if (!target) throw new Error('Indica la URL de la receta o el slug del proyecto.')
  if (/^https?:\/\//i.test(target)) {
    const result = await ensureRecipe(target, config, args.flags)
    await rememberSlug(target, result.recipe.title, config)
    return result
  }
  const paths = recipePaths(config, target)
  if (!(await exists(paths.meta))) throw new Error(`No existe la receta «${target}» en ${path.relative(ROOT, paths.base)}`)
  return { recipe: await readJson(paths.meta), paths }
}

/**
 * @param {any} recipe
 * @param {any} paths
 * @param {any} config
 * @param {Record<string, any>} flags
 */
async function ensureScript(recipe, paths, config, flags) {
  if (!flags.force && (await exists(paths.script))) {
    const script = await readJson(paths.script)
    if (script?.scenes?.length) {
      log.stage('2/6 · Guion')
      log.info(`Guion en caché: ${script.totalWords} palabras ≈ ${(script.estimatedSeconds / 60).toFixed(1)} min`)
      return script
    }
  }
  log.stage('2/6 · Escribiendo el guion')
  const script = await buildScript(recipe, config, {
    provider: flags.script ?? config.script.provider,
    tone: flags.tone,
    targetMinutes: flags.minutes ? Number(flags.minutes) : undefined,
    allowFallback: true,
  })
  script.slug = paths.slug
  await writeJson(paths.script, script)
  log.ok(`${script.scenes.length} escenas · ${script.totalWords} palabras ≈ ${(script.estimatedSeconds / 60).toFixed(1)} min`)
  return script
}

/**
 * @param {any} script
 * @param {any} paths
 * @param {any} config
 * @param {Record<string, any>} flags
 */
async function ensureAssets(script, paths, config, flags) {
  const manifest = path.join(paths.images, 'manifest.json')
  if (!flags.force && (await exists(manifest))) {
    log.stage('3/6 · Imágenes')
    const data = await readJson(manifest)
    log.info(`Imágenes en caché: ${data.scenes.reduce((sum, scene) => sum + scene.images.length, 0)}`)
    return data
  }
  log.stage('3/6 · Buscando imágenes')
  const data = await resolveAssets(script, config, paths)
  await writeJson(manifest, data)
  log.ok(`Imágenes listas: ${data.scenes.reduce((sum, scene) => sum + scene.images.length, 0)}`)
  return data
}

/**
 * @param {any} script
 * @param {any} paths
 * @param {any} config
 * @param {Record<string, any>} flags
 */
async function ensureTts(script, paths, config, flags) {
  log.stage('4/6 · Narrando con voz')
  const result = await synthesizeScenes(script, config, paths, {
    voice: flags.voice,
    preset: flags.preset,
    force: flags.force,
  })
  return result
}

/**
 * @param {any} timeline
 * @param {any} paths
 * @param {any} config
 * @param {Record<string, any>} flags
 */
async function ensureSubtitles(timeline, paths, config, flags) {
  log.stage('5/6 · Generando subtítulos')
  config.subtitles.enabled = flags['no-subs'] ? false : config.subtitles.enabled
  const font = await resolveFont(config)
  const { content, captions, events } = buildAss(timeline, config, { fontFamily: font.family })
  await (await import('node:fs/promises')).writeFile(paths.subtitles, content, 'utf8')
  timeline.font = font
  log.ok(`${captions} bloques · ${events} eventos de palabra`)
  return timeline
}

/**
 * @param {any} recipe
 * @param {any} script
 * @param {any} paths
 * @param {any} config
 * @param {Record<string, any>} flags
 */
async function ensureMusic(recipe, script, paths, config, flags) {
  if (flags['no-music']) return null
  const existing = await loadChosenMusic(paths)
  if (existing && !flags.force) {
    log.stage('6/7 · Música')
    log.info(`Pista ya elegida: ${existing.track.title} — ${existing.track.artist}`)
    return existing
  }
  log.stage('6/7 · Música')
  const candidates = await searchMusic(recipe, config, { query: flags.music, limit: config.music.candidates })
  if (candidates.length === 0) {
    log.warn('No hay música disponible; el vídeo saldrá solo con voz.')
    return null
  }
  if (flags.pick) {
    return chooseMusic(candidates, paths, config, { choose: flags.choose, pick: true })
  }
  return chooseMusic(candidates, paths, config, { choose: flags.choose ?? 1 })
}

/**
 * @param {any} script
 * @param {any} timeline
 * @param {any} assets
 * @param {any} paths
 * @param {any} config
 * @param {any} music
 * @param {Record<string, any>} flags
 */
async function renderAll(script, timeline, assets, paths, config, music, flags) {
  log.stage('7/7 · Montando el vídeo')
  const visuals = await renderVisuals(timeline, assets.scenes, config, paths)
  const narration = await buildNarration(timeline, paths)
  const output = await renderFinal(timeline, paths, config, {
    visuals,
    narration,
    music: music?.absolute ?? null,
    title: script.title,
    font: timeline.font,
  })
  await writeDescription(script, paths, music)
  return output
}

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/** @param {any} script @param {any} tts @param {any} config */
function timelineFor(script, tts, config) {
  return buildTimeline(script, tts, config)
}

/** @param {any} config */
async function resolveFont(config) {
  const dir = path.join(ROOT, 'assets', 'fonts')
  const file = path.join(dir, 'Montserrat-SemiBold.ttf')
  if (await exists(file)) return { family: config.subtitles.font, dir }
  return { family: process.platform === 'darwin' ? 'Helvetica Neue' : 'DejaVu Sans', dir: null }
}

/**
 * Descripción lista para pegar en YouTube.
 * @param {any} script @param {any} paths @param {any} music
 */
async function writeDescription(script, paths, music) {
  const recipe = script.recipe
  const lines = [
    script.title,
    '',
    recipe.description || '',
    '',
    `Receta completa: ${recipe.source.url}`,
    recipe.times?.total ? `Tiempo total: ${recipe.times.total} minutos` : '',
    recipe.servings ? `Raciones: ${recipe.servings}` : '',
    '',
    'Ingredientes:',
    ...recipe.ingredients.map((ingredient) => `- ${ingredient.raw}`),
    '',
    'Música:',
    music?.attribution ? `- ${music.attribution}` : '- Sin música',
    '',
    'Créditos de imágenes: ver creditos.txt',
  ].filter((line) => line !== null)
  const file = path.join(paths.base, 'descripcion.txt')
  await (await import('node:fs/promises')).writeFile(file, `${lines.join('\n')}\n`, 'utf8')
  return file
}

/**
 * @param {string} output @param {any} timeline @param {any} paths @param {any} music
 */
async function printSummary(output, timeline, paths, music) {
  const stats = await stat(output)
  const duration = await mediaDuration(output).catch(() => timeline.totalDuration)
  console.log('')
  log.ok(`Vídeo terminado: ${output}`)
  console.log(`    Duración: ${Math.floor(duration / 60)}:${String(Math.round(duration % 60)).padStart(2, '0')} · ${(stats.size / 1024 / 1024).toFixed(1)} MB`)
  console.log(`    Proyecto: ${paths.base}`)
  console.log(`    Descripción: ${path.join(paths.base, 'descripcion.txt')}`)
  if (music) console.log(`    Música: ${music.track.title} — ${music.track.artist} (${music.track.license})`)
}

/* ------------------------------------------------------------------ */
/* Corrección post-revisión                                           */
/* ------------------------------------------------------------------ */

/**
 * Corrige la imagen de una escena específica.
 * Uso: voicereceta fix-image <slug> <escena> --query "término" | --url "url"
 * @param {ReturnType<parseArgs>} args @param {any} config
 */
async function commandFixImage(args, config) {
  const slug = args.positional[0]
  const sceneId = args.positional[1]
  if (!slug || !sceneId) {
    throw new Error('Uso: voicereceta fix-image <slug> <escena> [--query "término" | --url "url"]')
  }
  const paths = recipePaths(config, slug)
  if (!(await exists(paths.meta))) throw new Error(`Proyecto no encontrado: ${slug}`)

  const script = await readJson(paths.script)
  const scene = script.scenes.find((s) => s.id === sceneId)
  if (!scene) throw new Error(`Escena no encontrada: ${sceneId}. Escenas: ${script.scenes.map((s) => s.id).join(', ')}`)

  const query = args.flags.query
  const url = args.flags.url

  log.stage(`Corrigiendo imagen de ${sceneId} (${scene.heading})`)

  await ensureDir(paths.images)
  const rawDir = path.join(paths.cache, 'images')
  await ensureDir(rawDir)

  let credit = null
  if (url) {
    log.info(`Descargando imagen desde URL: ${url}`)
    credit = await tryFixAsset(url, { sourceUrl: url, provider: 'manual' }, scene, 0, config, rawDir, paths)
  } else if (query) {
    log.info(`Buscando con término: ${query}`)
    const results = await searchFallbackImages([query], config, scene.kind === 'ingredient')
    if (results.length === 0) throw new Error(`Sin resultados para: ${query}`)
    credit = await tryFixAsset(results[0].url, results[0], scene, 0, config, rawDir, paths)
  } else {
    throw new Error('Debes especificar --query "término" o --url "url"')
  }

  if (!credit) throw new Error('No se pudo obtener la imagen')

  // Actualizar manifest
  const manifestFile = path.join(paths.images, 'manifest.json')
  const manifest = await readJson(manifestFile)
  const sceneIndex = manifest.scenes.findIndex((s) => s.sceneId === sceneId)
  if (sceneIndex >= 0) {
    manifest.scenes[sceneIndex].images[0] = credit
    await writeJson(manifestFile, manifest)
  }

  // Actualizar créditos
  const creditsFile = path.join(paths.images, 'credits.json')
  const credits = await readJson(creditsFile)
  const oldCreditIndex = credits.findIndex((c) => c.sceneId === sceneId && c.provider !== 'receta' && c.provider !== 'placeholder')
  if (oldCreditIndex >= 0) credits.splice(oldCreditIndex, 1)
  credits.push({ ...credit.credit, usedIn: [sceneId] })
  await writeJson(creditsFile, credits)
  await writeCreditsText(path.join(paths.base, 'creditos.txt'), credits)

  log.ok(`Imagen de ${sceneId} actualizada. Ejecuta «voicereceta render ${slug}» para regenerar el vídeo.`)
}

/**
 * @param {string} url
 * @param {any} meta
 * @param {any} scene
 * @param {number} slot
 * @param {any} config
 * @param {string} rawDir
 * @param {any} paths
 */
async function tryFixAsset(url, meta, scene, slot, config, rawDir, paths) {
  const raw = path.join(rawDir, `${meta.provider ?? 'manual'}-${Date.now()}.bin`)
  try {
    await download(url, raw, { timeoutMs: 60000, force: true })
  } catch (error) {
    log.warn(`Descarga fallida: ${error.message}`)
    return null
  }
  const file = path.join(paths.images, `${scene.id}-${slot + 1}.jpg`)
  try {
    await normalizeImage(raw, file, config)
  } catch (error) {
    log.warn(`Normalización fallida: ${error.message}`)
    return null
  }
  return {
    file,
    credit: {
      provider: meta.provider ?? 'manual',
      kind: meta.kind ?? '',
      sourceUrl: url,
      pageUrl: meta.pageUrl ?? '',
      license: meta.license ?? '',
      author: meta.author ?? '',
      title: meta.title ?? '',
      scene: scene.heading,
      sceneId: scene.id,
      file: path.relative(paths.base, file),
    },
  }
}

/* ------------------------------------------------------------------ */
/* Descripción SEO para YouTube                                       */
/* ------------------------------------------------------------------ */

/**
 * Genera descripción optimizada para SEO de YouTube.
 * @param {ReturnType<parseArgs>} args @param {any} config
 */
async function commandSeoDesc(args, config) {
  const { recipe, paths } = await loadRecipeTarget(args, config)
  const script = await ensureScript(recipe, paths, config, args.flags)
  const music = await loadChosenMusic(paths)

  log.stage('Generando descripción SEO para YouTube')

  const description = buildSeoDescription(script, music, config, paths)
  const file = path.join(paths.base, 'descripcion_seo.txt')
  await (await import('node:fs/promises')).writeFile(file, description, 'utf8')

  log.ok(`Descripción SEO guardada en: ${path.relative(ROOT, file)}`)
  console.log('\n' + '='.repeat(60))
  console.log(description)
  console.log('='.repeat(60))
}

/**
 * @param {import('../script/index.js').Script} script
 * @param {any} music
 * @param {any} config
 * @param {any} paths
 */
function buildSeoDescription(script, music, config, paths) {
  const recipe = script.recipe
  const lines = []

  // Título optimizado (primeras 2 líneas son críticas para SEO)
  lines.push(`${recipe.title} | Receta Fácil y Casera`)
  lines.push('')

  // Descripción gancho con palabras clave (primeras 150 caracteres)
  const hook = `Aprende a hacer ${recipe.title.toLowerCase()} paso a paso. Receta casera, fácil y deliciosa en ${recipe.times.total ?? 'pocos'} minutos.`
  lines.push(hook)
  lines.push('')

  // Enlace a la receta original
  lines.push(`📋 Receta completa: ${recipe.source.url}`)
  lines.push('')

  // Timestamps para capítulos (SEO importante)
  lines.push('⏱️ CAPÍTULOS:')
  const timestamps = buildTimestamps(script)
  timestamps.forEach((ts) => lines.push(ts))
  lines.push('')

  // Ingredientes con formato lista
  lines.push('🛒 INGREDIENTES:')
  recipe.ingredients.forEach((ing) => {
    const amount = ing.amount ? `${ing.amount} ${ing.unit}`.trim() : ''
    lines.push(`• ${amount} ${ing.label ?? ing.name}`.trim())
  })
  lines.push('')

  // Información nutricional/tipo
  if (recipe.category) lines.push(`🍽️ Tipo: ${recipe.category}`)
  if (recipe.cuisine) lines.push(`🌍 Cocina: ${recipe.cuisine}`)
  if (recipe.times.total) lines.push(`⏱️ Tiempo total: ${recipe.times.total} min`)
  if (recipe.servings) lines.push(`👥 Raciones: ${recipe.servings}`)
  lines.push('')

  // Música y licencias
  lines.push('🎵 MÚSICA:')
  if (music?.track) {
    lines.push(`• ${music.track.title} — ${music.track.artist}`)
    lines.push(`• Licencia: ${music.track.license}`)
    if (music.track.pageUrl) lines.push(`• Fuente: ${music.track.pageUrl}`)
  } else {
    lines.push('• Sin música de fondo')
  }
  lines.push('')

  // Créditos de imágenes
  lines.push('📸 CRÉDITOS DE IMÁGENES:')
  lines.push('Ver archivo creditos.txt para atribución completa (CC BY-SA, CC BY, etc.)')
  lines.push('')

  // Llamada a la acción
  lines.push('👍 Si te gusta, dale a like y suscríbete para más recetas:')
  lines.push('🔔 Activa la campanita para no perderte ningún vídeo.')
  lines.push('')

  // Hashtags relevantes
  const tags = buildHashtags(recipe)
  lines.push(tags)

  return lines.join('\n')
}

/**
 * @param {import('../script/index.js').Script} script
 */
function buildTimestamps(script) {
  const timestamps = []
  let seconds = 0
  for (const scene of script.scenes) {
    const mins = Math.floor(seconds / 60)
    const secs = Math.round(seconds % 60)
    const time = `${mins}:${String(secs).padStart(2, '0')}`
    const label = scene.heading.replace(/^(Ingrediente|Paso) \d+.*/, (m) => m.split(' ').slice(0, 2).join(' '))
    timestamps.push(`${time} ${label}`)
    // Estimar duración de la escena (aprox 150 palabras/min)
    const sceneWords = scene.narration.split(/\s+/).length
    seconds += Math.round((sceneWords / 148) * 60) + 0.35
  }
  return timestamps
}

/**
 * @param {import('../recipe/extract.js').RecipeDoc} recipe
 */
function buildHashtags(recipe) {
  const tags = new Set()
  tags.add('#receta')
  tags.add('#cocinafacil')
  tags.add('#recetacasera')
  tags.add('#youtubefood')

  if (recipe.category) tags.add(`#${slugify(recipe.category)}`)
  if (recipe.cuisine) tags.add(`#${slugify(recipe.cuisine)}`)

  recipe.ingredients.slice(0, 3).forEach((ing) => {
    tags.add(`#${slugify(ing.label ?? ing.name)}`)
  })

  return Array.from(tags).slice(0, 15).join(' ')
}

/* ------------------------------------------------------------------ */
/* Miniatura (Thumbnail) para YouTube                                 */
/* ------------------------------------------------------------------ */

/**
 * Genera miniatura con título en ANTON con itálica artificial (shear),
 * blanca con contorno negro, centrada arriba o abajo (donde interrumpa
 * menos el plato). Usa Pillow vía script Python para shear transform.
 * @param {ReturnType<parseArgs>} args @param {any} config
 */
async function commandThumbnail(args, config) {
  const { recipe, paths } = await loadRecipeTarget(args, config)

  log.stage('Generando miniatura para YouTube')

  // Usar la imagen hero (primera que aparece después del título en la web)
  const heroUrl = recipe.hero?.url ?? recipe.photos?.hero?.url ?? recipe.photos?.ingredients?.url
  if (!heroUrl) throw new Error('No hay imagen de portada disponible para la miniatura')

  const thumbFile = path.join(paths.base, 'thumbnail.jpg')
  const rawFile = path.join(paths.cache, 'thumbnail-source.jpg')

  await ensureDir(paths.cache)
  await download(heroUrl, rawFile, { timeoutMs: 60000, force: true })

  // Generar miniatura 1280x720 usando script Python con ANTON + shear
  await generateThumbnailWithPython(rawFile, thumbFile, recipe.title)

  log.ok(`Miniatura generada: ${path.relative(ROOT, thumbFile)} (1280x720)`)
}

/**
 * @param {string} input
 * @param {string} output
 * @param {string} title
 */
async function generateThumbnailWithPython(input, output, title) {
  const fontDir = path.join(ROOT, 'assets', 'fonts')
  const antonFont = path.join(fontDir, 'Anton-Regular.ttf')
  const scriptPath = path.join(ROOT, 'scripts', 'make_thumbnail.py')

  const hasAnton = await exists(antonFont)
  if (!hasAnton) {
    log.warn('ANTON font not found, downloading...')
    await downloadFont('Anton', antonFont)
  }

  const python = await pythonExecutable()

  try {
    await run(python, [
      scriptPath,
      input,
      title,
      output,
      antonFont,
      ROOT,
    ], { timeoutMs: 60000 })
  } catch (error) {
    throw new Error(`Error generando miniatura con Python: ${error.message}`)
  }
}

/**
 * @param {string} fontName
 * @param {string} dest
 */
async function downloadFont(fontName, dest) {
  const urls = {
    Anton: 'https://github.com/google/fonts/raw/main/ofl/anton/Anton-Regular.ttf',
  }
  const url = urls[fontName]
  if (!url) return
  try {
    await ensureDir(path.dirname(dest))
    await download(url, dest, { timeoutMs: 30000, force: true })
    log.info(`Fuente ${fontName} descargada`)
  } catch (error) {
    log.warn(`No se pudo descargar ${fontName}: ${error.message}`)
  }
}

/** @param {string[]} argv */
function parseArgs(argv) {
  const positional = []
  const flags = {}
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    if (token.startsWith('--')) {
      const key = token.slice(2)
      const next = argv[index + 1]
      if (next === undefined || next.startsWith('--')) {
        flags[key] = true
      } else {
        flags[key] = next
        index += 1
      }
    } else {
      positional.push(token)
    }
  }
  return { positional, flags }
}

/* ------------------------------------------------------------------ */
/* Doctor                                                             */
/* ------------------------------------------------------------------ */

/** @param {any} config */
async function doctor(config) {
  log.stage('Entorno')
  const checks = []
  checks.push(['node', process.versions.node])
  checks.push(['ffmpeg', (await hasCommand('ffmpeg')) ? 'ok' : 'FALTA'])
  checks.push(['ffprobe', (await hasCommand('ffprobe')) ? 'ok' : 'FALTA'])
  checks.push(['python3', (await hasCommand('python3')) ? 'ok' : 'FALTA'])

  const edge = await import('./tts/edge.js').then((module) => module.checkEdgeTts())
  checks.push(['edge-tts', edge.ok ? edge.detail : 'FALTA (ejecuta ./setup.sh)'])

  const fonts = await exists(path.join(ROOT, 'assets', 'fonts', 'Montserrat-SemiBold.ttf'))
  checks.push(['fuente subtítulos', fonts ? 'Montserrat SemiBold' : 'respaldo del sistema'])

  for (const [name, value] of checks) {
    console.log(`  ${value.startsWith('FALTA') ? '✗' : '✓'} ${name.padEnd(20)} ${value}`)
  }

  log.stage('Claves opcionales')
  const keys = [
    ['DEEPSEEK_API_KEY', 'guion con LLM'],
    ['JAMENDO_CLIENT_ID', 'catálogo Jamendo'],
    ['PEXELS_API_KEY', 'imágenes Pexels'],
    ['AZURE_SPEECH_KEY', 'voz Azure'],
  ]
  for (const [variable, purpose] of keys) {
    console.log(`  ${process.env[variable] ? '✓' : '·'} ${variable.padEnd(20)} ${process.env[variable] ? 'configurada' : `no configurada (${purpose})`}`)
  }

  log.stage('Servicios')
  for (const [name, url] of [
    ['Wikimedia Commons', 'https://commons.wikimedia.org/w/api.php?action=query&format=json&meta=siteinfo'],
    ['Internet Archive', 'https://archive.org/advancedsearch.php?q=test&rows=1&output=json'],
    ['Jamendo', 'https://api.jamendo.com/v3.0/tracks/?client_id=test&format=json&limit=1'],
  ]) {
    try {
      await download(url, path.join(ROOT, 'work', '_doctor', `${name.replace(/\s+/g, '-')}.json`), { force: true, timeoutMs: 12000 })
      console.log(`  ✓ ${name}`)
    } catch (error) {
      console.log(`  ✗ ${name} (${error.message})`)
    }
  }

  log.stage('Configuración')
  const voice = resolveVoice(config, {})
  console.log(`  Voz: ${voice.voice} · tono ${voice.preset} · ${voice.rate} · ${voice.pitch}`)
  console.log(`  Vídeo: ${config.video.width}x${config.video.height} @ ${config.video.fps} fps`)
  console.log(`  Guion: ${config.script.provider} · ${config.script.targetMinutes} min objetivo`)
}

// Permite «node src/cli.js …» además del binario de bin/voicereceta.
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(`\n✗ ${error?.message ?? error}\n`)
    if (process.env.VOICERECETA_DEBUG) console.error(error)
    process.exitCode = 1
  })
}
