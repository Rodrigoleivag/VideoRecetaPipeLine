import path from 'node:path'
import { normalize } from '../util/text.js'
import { download } from '../util/http.js'
import { ensureDir, exists, hash, writeJson } from '../util/fsx.js'
import { ffmpeg } from '../util/exec.js'
import { debug, warn } from '../util/log.js'
import { searchCommons } from './providers/commons.js'
import { searchOpenverse } from './providers/openverse.js'
import { searchFoodish } from './providers/foodish.js'
import { searchPexels } from './providers/pexels.js'

const PROVIDERS = {
  commons: searchCommons,
  openverse: searchOpenverse,
  foodish: searchFoodish,
  pexels: searchPexels,
}

/**
 * URLs conocidas que devuelven imágenes irrelevantes para ingredientes culinarios.
 * Se bloquean para evitar macro, biología marina, arte, etc.
 * (Sin parámetros de query)
 */
const BLOCKLIST_URLS = new Set([
  // Nudibranch/fish eggs
  'https://upload.wikimedia.org/wikipedia/commons/b/bd/Acanthodoris_lutea_laying_eggs_1.jpg',
  // Sugar macro crystals
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/56/Sugar_2xmacro.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/d/db/Sugar_tweezers0.jpg',
  // Tea set, writing girl, etc. (arte, no comida)
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/5/57/WLA_vanda_English_Tea_Set_18th_century.jpg',
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c3/Al_Parker_-_Writing_Girl%2C_1948.jpg',
  // Nuevas imágenes problemáticas detectadas
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/6/64/Orange_Snow_Cream_Delight.jpg',
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/c/c6/Italy_from_the_Alps_to_Mount_Etna_%281877%29_%2814590647209%29.jpg',
  // Quemadores, laboratorio, equipo industrial - NO cocina casera
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/a/af/Portable_gas_stove_and_frying_pan.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/1/1e/What_to_do_for_Uncle_Sam%3B_a_first_book_of_citizenship_%281918%29_%2814761134816%29.jpg',
  'https://live.staticflickr.com/4095/4915859653_44eb401f57_b.jpg',
  'https://live.staticflickr.com/65535/50640509746_ce228686ae_b.jpg',
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/9/99/DoughnDolce_Beef_Sandwich.jpg',
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e4/Oil3.jpg',
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/3/38/Salt_bowl_and_spoon.jpg',
  'https://thumb.wikimedia.org/wikipedia/commons/thumb/8/8b/Black_Pepper_-_Piper_nigrum_-_Le_Jardin_du_Roi_-_01.jpg',
  'https://upload.wikimedia.org/wikipedia/commons/9/94/Marvelous_Unicron_Cake.png',
  'https://upload.wikimedia.org/wikipedia/commons/3/39/20171027-AMS-LSC-0148_%2826291959439%29.jpg',
])

const TECHNIQUE_QUERIES = [
  { when: /horno|hornea|gratin|asamos/i, query: 'oven baked dish' },
  { when: /sartén|salte|frie|freír|dorar|sofr/i, query: 'frying pan cooking' },
  { when: /batir|mezclar|remover|integrar|amasar/i, query: 'mixing bowl cooking' },
  { when: /servir|emplatar|presenta|decorar/i, query: 'plated food dish' },
  { when: /nevera|frío|enfr|reposo|refriger/i, query: 'food in kitchen' },
  { when: /cortar|picar|trocear|laminar/i, query: 'chopping vegetables knife' },
]

/**
 * Resuelve, descarga y normaliza las imágenes de cada escena.
 * Orden: fotos de la propia receta → repositorios libres → tarjeta generada.
 *
 * @param {import('../script/index.js').Script} script
 * @param {import('../config.js').PipelineConfig} config
 * @param {ReturnType<import('../config.js').recipePaths>} paths
 * @returns {Promise<{ scenes: Array<{ sceneId: string, images: Array<{ file: string, credit: any }> }>, credits: any[] }>}
 */
export async function resolveAssets(script, config, paths) {
  await ensureDir(paths.images)
  const rawDir = path.join(paths.cache, 'images')
  await ensureDir(rawDir)

  const credits = new Map()
  const scenes = []

  for (const scene of script.scenes) {
    const picked = []
    const limit = config.images.maxPerScene ?? 1

    for (const candidate of directCandidates(scene, script.recipe)) {
      if (picked.length >= limit) break
      const credit = await tryAsset(candidate.sourceUrl, candidate, scene, picked.length, config, rawDir, paths)
      if (credit) picked.push(credit)
    }

    if (picked.length === 0) {
      const queries = buildQueries(scene, script.recipe)
      const isIngredientScene = scene.kind === 'ingredient'
      const results = await searchFallbackImages(queries, config, isIngredientScene)
      for (const result of results.slice(0, 3)) {
        if (picked.length >= limit) break
        const credit = await tryAsset(result.url, result, scene, picked.length, config, rawDir, paths)
        if (credit) picked.push(credit)
      }
    }

    if (picked.length === 0) {
      const file = path.join(paths.images, `${scene.id}-placeholder.jpg`)
      await placeholderImage(scene.heading, file, config)
      warn(`Sin imagen para «${scene.heading}»; uso una tarjeta de texto.`)
      picked.push({
        file,
        credit: {
          provider: 'placeholder',
          license: 'generado por el pipeline',
          author: '',
          pageUrl: '',
          scene: scene.heading,
          sceneId: scene.id,
          file: path.relative(paths.base, file),
        },
      })
    }

    for (const item of picked) {
      const key = item.credit.sourceUrl ?? item.file
      if (!credits.has(key)) credits.set(key, { ...item.credit, usedIn: [scene.id] })
      else credits.get(key).usedIn.push(scene.id)
    }
    scenes.push({ sceneId: scene.id, images: picked })
  }

  const creditList = [...credits.values()]
  await writeJson(path.join(paths.images, 'credits.json'), creditList)
  await writeCreditsText(path.join(paths.base, 'creditos.txt'), creditList)
  return { scenes, credits: creditList }
}

/**
 * Intenta descargar y normalizar una imagen; devuelve el crédito si funciona.
 * @param {string} url
 * @param {any} meta
 * @param {import('../script/index.js').Scene} scene
 * @param {number} slot
 * @param {import('../config.js').PipelineConfig} config
 * @param {string} rawDir
 * @param {ReturnType<import('../config.js').recipePaths>} paths
 */
async function tryAsset(url, meta, scene, slot, config, rawDir, paths) {
  if (!url) return null
  // Bloquear URLs conocidas problemáticas (comparar path base)
  const baseUrl = url.split('?')[0]
  const blocked = [...BLOCKLIST_URLS].some((blockedUrl) => baseUrl.startsWith(blockedUrl))
  if (blocked) {
    debug(`imagen bloqueada (blocklist): ${url}`)
    return null
  }
  const raw = path.join(rawDir, `${hash(url)}.bin`)
  try {
    await download(url, raw, { timeoutMs: 60000 })
  } catch (error) {
    debug(`descarga fallida ${url.slice(0, 70)}: ${error.message}`)
    return null
  }
  const file = path.join(paths.images, `${scene.id}-${slot + 1}.jpg`)
  try {
    await normalizeImage(raw, file, config)
  } catch (error) {
    debug(`normalización fallida ${url.slice(0, 70)}: ${error.message}`)
    return null
  }
  debug(`imagen ${scene.id}: ${meta.provider ?? '?'} ${url.slice(0, 70)}`)
  return {
    file,
    credit: {
      provider: meta.provider ?? 'desconocido',
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

/**
 * Imágenes de la propia receta según las pistas de la escena.
 * @param {import('../script/index.js').Scene} scene
 * @param {import('../recipe/extract.js').RecipeDoc} recipe
 */
function directCandidates(scene, recipe) {
  const out = []
  for (const hint of scene.imageHints ?? []) {
    if (hint.type === 'hero' && recipe.hero?.url) out.push({ sourceUrl: recipe.hero.url, provider: 'receta', kind: 'portada' })
    if (hint.type === 'dish') {
      const url = recipe.photos?.dish?.url ?? recipe.hero?.url
      if (url) out.push({ sourceUrl: url, provider: 'receta', kind: 'emplatado' })
    }
    if (hint.type === 'ingredients_photo' && recipe.photos?.ingredients?.url) {
      out.push({ sourceUrl: recipe.photos.ingredients.url, provider: 'receta', kind: 'ingredientes' })
    }
    if (hint.type === 'ingredient') {
      const ingredient = recipe.ingredients[hint.index ?? 0]
      if (ingredient?.image) out.push({ sourceUrl: ingredient.image, provider: 'receta', kind: 'ingrediente' })
    }
    if (hint.type === 'step') {
      const step = recipe.steps[hint.index ?? 0]
      if (step?.image) out.push({ sourceUrl: step.image, provider: 'receta', kind: 'paso' })
    }
  }
  return out
}

/**
 * Consultas de respaldo, de la más específica a la más genérica.
 * @param {import('../script/index.js').Scene} scene
 * @param {import('../recipe/extract.js').RecipeDoc} recipe
 */
function buildQueries(scene, recipe) {
  const queries = []
  for (const hint of scene.imageHints ?? []) {
    if (hint.type === 'ingredient') {
      const ingredient = recipe.ingredients[hint.index ?? 0]
      if (ingredient) {
        const term = ingredient.searchTerm ?? ingredient.name
        // Consultas extra PRIMERO (más específicas, evitan macro/biológico)
        const extra = extraIngredientQueries(term)
        if (extra) queries.push(...extra)
        // Luego las consultas estándar
        queries.push(term)
        queries.push(`${term} ingredient`)
        queries.push(`${term} kitchen`)
        queries.push(`${term} cooking`)
      }
    }
    if (hint.type === 'step') {
      const step = recipe.steps[hint.index ?? 0]
      const technique = TECHNIQUE_QUERIES.find((entry) => entry.when.test(step?.text ?? ''))
      if (technique) queries.push(technique.query)
      queries.push(`${recipe.title} preparación`)
    }
    if (hint.type === 'hero' || hint.type === 'dish') {
      queries.push(`${recipe.title} receta`, 'plato terminado cocina')
    }
  }
  queries.push(...(scene.imageQueries ?? []))
  return [...new Set(queries.filter(Boolean))]
}

/**
 * Consultas adicionales específicas para ingredientes que suelen
 * devolver imágenes incorrectas (macro, biológicas, etc.)
 * @param {string} term
 */
function extraIngredientQueries(term) {
  const t = term.toLowerCase()
  if (/chicken egg|huevo|egg\b/.test(t)) {
    return [
      'chicken eggs in bowl kitchen',
      'eggs in bowl cooking',
      'hen eggs white brown',
      'breakfast eggs bowl',
    ]
  }
  if (/sugar|azúcar/.test(t)) {
    return [
      'white sugar in bowl spoon',
      'sugar bowl kitchen',
      'granulated sugar cooking',
      'baking sugar measurement',
      'sugar spoon white background',
      'sugar container kitchen',
    ]
  }
  if (/flour|harina/.test(t)) {
    return [
      'flour in bowl spoon',
      'flour sack kitchen',
      'baking flour measurement',
      'wheat flour cooking',
    ]
  }
  if (/salt|sal\b/.test(t)) {
    return [
      'salt in bowl spoon',
      'salt shaker kitchen',
      'cooking salt measurement',
      'sea salt crystals bowl',
    ]
  }
  if (/oil|aceite/.test(t)) {
    return [
      'olive oil bottle kitchen',
      'oil pouring spoon cooking',
      'vegetable oil bottle',
    ]
  }
  if (/lemon|limón/.test(t)) {
    return [
      'lemon whole kitchen',
      'lemon slices cooking',
      'fresh lemon fruit',
      'lemon yellow whole background',
      'citrus lemon kitchen',
      'lemon zest cooking',
    ]
  }
  return null
}

/**
 * Busca imágenes en los repositorios libres configurados hasta obtener resultados.
 * @param {string[]} queries
 * @param {import('../config.js').PipelineConfig} config
 * @param {boolean} [isIngredientScene]
 */
export async function searchFallbackImages(queries, config, isIngredientScene) {
  // Para ingredientes, priorizar foodish (específico de comida) sobre commons
  const providers = isIngredientScene
    ? ['foodish', 'commons', 'openverse', 'pexels']
    : config.images.providers ?? ['commons', 'openverse', 'foodish']
  for (const query of queries) {
    for (const name of providers) {
      const fn = PROVIDERS[name]
      if (!fn) continue
      try {
        const results = await fn(query, { minWidth: config.images.minWidth })
        if (results.length > 0) return rankResults(results, query, isIngredientScene)
      } catch (error) {
        debug(`proveedor ${name} falló para «${query}»: ${error.message}`)
      }
    }
  }
  return []
}

const NEGATIVE = /squirrel|bird|cat|dog|person|people|man |woman|hand|map|diagram|logo|sign|cartoon|drawing|illustration|museum|shop|store|screenshot|factory|industrial|plant|refinery|machinery|production|manufacturing|warehouse|silo|tank|pipeline|macro|microscopic|micrograph|crystal|crystals|molecular|biological|specimen|larva|embryo|spawn|zoology|marine|aquatic|fish eggs|roe|caviar|insect|nudibranch|slug|shell|anatomy|dissection|laboratory|lab|scientific|research|petri|microscope|magnified|close.?up|extreme.?close.?up|ultra.?close|burner|stove|portable.?stove|gas.?stove|bunsen|lab.?equipment|hot.?plate|electric.?stove|camping.?stove|outdoor.?stove|industrial.?kitchen|commercial.?kitchen|professional.?kitchen|restaurant.?kitchen|steel.?counter|stainless.?steel|clinical|sterile|laboratory|workshop|garage|warehouse/i

/**
 * Ordena los resultados por relevancia respecto a la consulta.
 * @param {any[]} results
 * @param {string} query
 */
const FOOD_POSITIVE = /bottle|botella|jar|frasco|kitchen|cocina|food|comida|ingredient|ingrediente|culinary|culinaria|table|mesa|wood|madera|rustic|rústico|pouring|vertiendo|drizzle|chorrito|olive oil|aceite de oliva|extra virgin|virgen extra|bottles|botellas|container|envase|glass|vidrio|golden|dorado|liquid|líquido|bowl|cuenco|taza|spoon|cuchara|scoop|measured|measured|spilled|spilling|sprinkled|sprinkling|cooking|baking|horno|stove|cocinando|preparing|preparando|meal|comida|dish|plato|recipe|receta|pantry|despensa|countertop|encimera|shelf|estante|bag|bolsa|sack|saco|package|paquete|wrapper|envoltorio|bagged|packaged|white|blanco|granulated|granulado|refined|refinado|crystals|cristales|fine|fino|coarse|grueso|raw|crudo|whole|entero|fresh|fresco|organic|orgánico|natural|natural|homemade|casero|traditional|tradicional/i

function rankResults(results, query, isIngredient = false) {
  const terms = normalize(query).split(' ').filter((term) => term.length > 2)
  return [...results]
    .map((result) => {
      const haystack = normalize(`${result.title} ${result.alt ?? ''}`)
      let score = 0
      for (const term of terms) {
        if (haystack.includes(term)) score += 3
        else if (haystack.includes(term.slice(0, 4))) score += 1
      }
      if (NEGATIVE.test(haystack)) score -= 25
      if (isIngredient && FOOD_POSITIVE.test(haystack)) score += 10
      if ((result.width ?? 0) >= 1200) score += 1
      return { result, score }
    })
    .sort((a, b) => b.score - a.score)
    .map((entry) => entry.result)
}

/**
 * Convierte la imagen descargada en JPEG 1920x1080 con recorte centrado.
 * @param {string} raw
 * @param {string} dest
 * @param {import('../config.js').PipelineConfig} config
 */
export async function normalizeImage(raw, dest, config) {
  const { width, height } = config.video
  await ffmpeg([
    '-i', raw,
    '-vf', `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},format=yuvj420p`,
    '-frames:v', '1',
    '-q:v', '2',
    dest,
  ])
  return dest
}

/**
 * Tarjeta de texto cuando no hay ninguna imagen disponible.
 * @param {string} text
 * @param {string} dest
 * @param {import('../config.js').PipelineConfig} config
 */
export async function placeholderImage(text, dest, config) {
  const { width, height } = config.video
  const safe = String(text).replace(/[\\':%]/g, ' ').slice(0, 40)
  await ffmpeg([
    '-f', 'lavfi',
    '-i', `color=c=0x111418:s=${width}x${height}:d=1`,
    '-vf', `drawtext=text='${safe}':fontcolor=0xFFFFFF:fontsize=72:x=(w-text_w)/2:y=(h-text_h)/2`,
    '-frames:v', '1',
    dest,
  ])
  return dest
}

/**
 * Archivo de créditos para la descripción del vídeo.
 * @param {string} file
 * @param {any[]} credits
 */
export async function writeCreditsText(file, credits) {
  const lines = ['Créditos de imágenes', '']
  for (const credit of credits) {
    if (credit.provider === 'receta' || credit.provider === 'placeholder') continue
    lines.push(`- ${credit.title || credit.provider}: ${credit.author || 'autor desconocido'} (${credit.license || 'licencia no indicada'})${credit.pageUrl ? ` ${credit.pageUrl}` : ''}`)
  }
  if (lines.length === 2) lines.push('Todas las imágenes proceden del artículo original de la receta.')
  await (await import('node:fs/promises')).writeFile(file, `${lines.join('\n')}\n`, 'utf8')
  return file
}

/**
 * Comprueba que un archivo de imagen es legible.
 * @param {string} file
 */
export async function assertImage(file) {
  if (!(await exists(file))) throw new Error(`Imagen inexistente: ${file}`)
  return file
}
