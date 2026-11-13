import path from 'node:path'
import { fetchText } from '../util/http.js'
import { download } from '../util/http.js'
import { ensureDir, exists, hash, isFile, writeJson } from '../util/fsx.js'
import { isoDurationToMinutes, normalize, stripAccents } from '../util/text.js'
import { extractArticleImages, hasType, parseJsonLd, resolveUrl, stripTags } from './html.js'
import { ROOT } from '../config.js'

/**
 * Descarga la página de la receta y la convierte en un documento estructurado.
 * @param {string} url
 * @param {{ refresh?: boolean }} [options]
 * @returns {Promise<RecipeDoc>}
 */
export async function extractRecipe(url, options = {}) {
  const html = await loadPage(url, options)
  const nodes = parseJsonLd(html)
  const node = nodes.find((entry) => hasType(entry, 'Recipe'))
  if (!node) throw new Error('La página no expone datos estructurados schema.org/Recipe; no se puede extraer la receta.')

  const pageImages = extractArticleImages(html, url)
  const title = stripTags(node.name ?? titleFromHtml(html) ?? 'Receta')
  const steps = collectSteps(node)
  if (steps.length === 0) throw new Error('La receta no incluye pasos de elaboración legibles.')

  const heroCandidates = toImageList(node.image).map((entry) => ({ ...entry, heading: 'portada', alt: entry.alt || title }))
  const hero = heroCandidates[0] ?? pageImages[0] ?? null

  const gallery = dedupe([...heroCandidates, ...pageImages])
  const roles = assignImageRoles(gallery, steps)

  const ingredients = toList(node.recipeIngredient).map((raw) => parseIngredient(stripTags(String(raw))))

  return {
    source: {
      url,
      site: siteName(html) ?? new URL(url).hostname.replace(/^www\./, ''),
      fetchedAt: new Date().toISOString(),
    },
    title,
    description: stripTags(node.description ?? ''),
    author: authorName(node.author),
    cuisine: Array.isArray(node.recipeCuisine) ? node.recipeCuisine.join(', ') : (node.recipeCuisine ?? ''),
    category: Array.isArray(node.recipeCategory) ? node.recipeCategory.join(', ') : (node.recipeCategory ?? ''),
    keywords: splitKeywords(node.keywords),
    times: {
      prep: isoDurationToMinutes(node.prepTime),
      cook: isoDurationToMinutes(node.cookTime),
      total: isoDurationToMinutes(node.totalTime) ?? sumKnown(isoDurationToMinutes(node.prepTime), isoDurationToMinutes(node.cookTime)),
    },
    servings: parseServings(node.recipeYield),
    hero,
    photos: roles,
    ingredients,
    steps: steps.map((step, index) => ({
      n: index + 1,
      text: step.text,
      image: step.image ? resolveUrl(url, step.image) : roles.stepImages[index]?.url ?? null,
    })),
    articleImages: pageImages,
  }
}

/** @param {string} url @param {{ refresh?: boolean }} options */
async function loadPage(url, options) {
  const cacheDir = path.join(ROOT, 'work', '_pages')
  const cacheFile = path.join(cacheDir, `${hash(url)}.html`)
  if (!options.refresh && (await exists(cacheFile))) return (await import('node:fs/promises')).readFile(cacheFile, 'utf8')
  const html = await fetchText(url, { timeoutMs: 45000 })
  if (html.length < 500) throw new Error(`La página devolvió muy poco contenido (${html.length} bytes).`)
  await ensureDir(cacheDir)
  await import('node:fs/promises').then(({ writeFile }) => writeFile(cacheFile, html, 'utf8'))
  return html
}

/** @param {any} value */
function toImageList(value) {
  const out = []
  const visit = (entry) => {
    if (!entry) return
    if (typeof entry === 'string') {
      out.push({ url: entry, alt: '' })
      return
    }
    if (Array.isArray(entry)) {
      entry.forEach(visit)
      return
    }
    if (typeof entry === 'object' && entry.url) out.push({ url: String(entry.url), alt: String(entry.caption ?? entry.name ?? '') })
  }
  visit(value)
  return out
}

/** @param {any} value */
function toList(value) {
  if (!value) return []
  return Array.isArray(value) ? value : [value]
}

/** @param {any} value */
function splitKeywords(value) {
  if (!value) return []
  const raw = Array.isArray(value) ? value.join(',') : String(value)
  return raw.split(/[,;]/).map((entry) => entry.trim()).filter(Boolean)
}

/** @param {any} value */
function parseServings(value) {
  if (value === undefined || value === null) return null
  const raw = Array.isArray(value) ? value[0] : value
  const number = Number.parseInt(String(raw).replace(/[^\d]/g, ''), 10)
  return Number.isFinite(number) && number > 0 ? number : null
}

/** @param {any} value */
function authorName(value) {
  if (!value) return ''
  const first = Array.isArray(value) ? value[0] : value
  if (typeof first === 'string') return first
  return stripTags(first?.name ?? '')
}

/** @param {number|null} a @param {number|null} b */
function sumKnown(a, b) {
  if (a === null && b === null) return null
  return (a ?? 0) + (b ?? 0)
}

/**
 * Aplana HowToStep / HowToSection en una lista de pasos.
 * @param {any} node
 * @returns {Array<{ text: string, image: string|null }>}
 */
function collectSteps(node) {
  const out = []
  const visit = (entry) => {
    if (!entry) return
    if (typeof entry === 'string') {
      out.push({ text: stripTags(entry), image: null })
      return
    }
    if (Array.isArray(entry)) {
      entry.forEach(visit)
      return
    }
    if (hasType(entry, 'HowToSection') && entry.itemListElement) {
      visit(entry.itemListElement)
      return
    }
    const text = stripTags(entry.text ?? entry.name ?? '')
    const images = toImageList(entry.image)
    if (text) out.push({ text, image: images[0]?.url ?? null })
  }
  visit(node.recipeInstructions)
  return out.filter((step) => step.text.length > 0)
}

/**
 * Asigna imágenes de la página a portada, ingredientes, pasos y cierre.
 * @param {Array<{ url: string, alt: string, heading: string }>} gallery
 * @param {Array<{ text: string, image?: string|null }>} steps
 * @returns {{ hero: any, ingredients: any|null, dish: any|null, stepImages: any[] }}
 */
function assignImageRoles(gallery, steps) {
  const hero = gallery[0] ?? null
  const pool = gallery.slice(1)
  const ingredientImage = pool.find((image) => /ingredient/i.test(`${image.alt} ${image.heading}`)) ?? null
  const dishImage = pool.find((image) => /listo|final|resultado|emplatado|servir|para comer/i.test(`${image.alt} ${image.heading}`)) ?? null

  const used = new Set([ingredientImage?.url, dishImage?.url].filter(Boolean))
  const candidates = pool.filter((image) => !used.has(image.url))
  const stepImages = []

  steps.forEach((step, index) => {
    const tokens = new Set(normalize(step.text).split(' ').filter((token) => token.length > 3))
    let best = null
    let bestScore = 0
    for (const image of candidates) {
      if (stepImages.some((picked) => picked?.url === image.url)) continue
      const words = new Set(normalize(`${image.alt} ${image.heading} ${fileStem(image.url)}`).split(' '))
      let score = 0
      for (const token of tokens) if (words.has(token)) score += 1
      if (score > bestScore) {
        best = image
        bestScore = score
      }
    }
    if (best && bestScore >= 1) stepImages[index] = best
  })

  return { hero, ingredients: ingredientImage, dish: dishImage, stepImages }
}

/** @param {string} url */
function fileStem(url) {
  const name = url.split('?')[0].split('/').pop() ?? ''
  return name.replace(/\.[a-z0-9]+$/i, '').replace(/[-_]+/g, ' ')
}

/** @param {Array<{ url: string }>} images */
function dedupe(images) {
  const seen = new Set()
  const out = []
  for (const image of images) {
    if (!image?.url) continue
    const key = image.url.split('?')[0]
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ ...image, url: image.url })
  }
  return out
}

/** @param {string} html */
function titleFromHtml(html) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)
  return match ? stripTags(match[1]) : null
}

/** @param {string} html */
function siteName(html) {
  const match = /<meta[^>]+property=["']og:site_name["'][^>]+content=["']([^"']+)["']/i.exec(html)
    ?? /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:site_name["']/i.exec(html)
  return match ? stripTags(match[1]) : null
}

/**
 * Separa cantidad, unidad y nombre de un ingrediente en texto libre.
 * @param {string} raw
 */
export function parseIngredient(raw) {
  const cleaned = raw.replace(/\s+/g, ' ').trim()
  const match = /^((?:\d+[.,/]?\d*)|½|¼|¾|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez)\s*(kilos?|kg|gramos?|g|mililitros?|ml|litros?|l|tazas?|cucharadas?|cucharaditas?|puñados?|ramitas?|dientes?|pizcas?|sobres?|latas?|unidades?)?\s*(?:de\s+)?(.+)$/i.exec(cleaned)
  if (!match) {
    return { raw, amount: '', unit: '', name: cleaned, note: '', image: null, searchTerm: cleaned }
  }
  const [, amount, unit, rest] = match
  const name = rest.replace(/\([^)]*\)/g, '').replace(/\s+,/g, ',').trim()
  return {
    raw,
    amount: amount ?? '',
    unit: unit ?? '',
    name: name || cleaned,
    note: '',
    image: null,
    searchTerm: name || cleaned,
  }
}

/**
 * Aplica el glosario de ingredientes (nota de sabor y término de búsqueda en inglés).
 * @param {RecipeDoc} recipe
 * @param {Array<{ match: string[], label: string, en: string, note: string }>} glossary
 */
export function applyGlossary(recipe, glossary) {
  const sorted = [...glossary].sort((a, b) => Math.max(...b.match.map((m) => m.length)) - Math.max(...a.match.map((m) => m.length)))
  for (const ingredient of recipe.ingredients) {
    const haystack = normalize(`${ingredient.name} ${ingredient.raw}`)
    const entry = sorted.find((candidate) => candidate.match.some((needle) => haystack.includes(normalize(needle))))
    if (entry) {
      ingredient.note = entry.note
      ingredient.label = entry.label
      ingredient.searchTerm = entry.en
    } else {
      ingredient.label = ingredient.name
      ingredient.searchTerm = stripAccents(ingredient.name)
    }
  }
  return recipe
}

/** Descarga el HTML de la receta en disco para inspección. @param {string} url */
export async function saveRawPage(url, dest) {
  return download(url, dest, { force: true })
}

/** @param {string} file */
export async function isCachedPage(file) {
  return isFile(file)
}

/**
 * @typedef {object} RecipeDoc
 * @property {{ url: string, site: string, fetchedAt: string }} source
 * @property {string} title
 * @property {string} description
 * @property {string} author
 * @property {string} cuisine
 * @property {string} category
 * @property {string[]} keywords
 * @property {{ prep: number|null, cook: number|null, total: number|null }} times
 * @property {number|null} servings
 * @property {{ url: string, alt: string }|null} hero
 * @property {{ hero: any, ingredients: any|null, dish: any|null, stepImages: any[] }} photos
 * @property {Array<{ raw: string, amount: string, unit: string, name: string, label?: string, note: string, image: string|null, searchTerm: string }>} ingredients
 * @property {Array<{ n: number, text: string, image: string|null }>} steps
 * @property {Array<{ url: string, alt: string, heading: string }>} articleImages
 */

/** Guarda el documento de receta. @param {RecipeDoc} recipe @param {string} file */
export async function saveRecipe(recipe, file) {
  return writeJson(file, recipe)
}
