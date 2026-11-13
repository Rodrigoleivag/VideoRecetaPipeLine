/** Utilidades de texto compartidas por guion, subtítulos y búsquedas. */

/** @param {string} value */
export function stripAccents(value) {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

/** Normaliza a minúsculas sin acentos ni signos, para comparar y buscar. @param {string} value */
export function normalize(value) {
  return stripAccents(String(value))
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** @param {string} value */
export function slugify(value) {
  return normalize(value).replace(/\s+/g, '-').slice(0, 80) || 'receta'
}

/**
 * Divide el texto en palabras conservando la puntuación final de cada una.
 * @param {string} text
 * @returns {string[]}
 */
export function tokenizeWords(text) {
  return String(text).match(/[\p{L}\p{N}]+(?:['’][\p{L}]+)*[.,;:!?…"')\]]*/gu) ?? []
}

/**
 * Divide en frases razonables para trocear subtítulos.
 * @param {string} text
 * @returns {string[]}
 */
export function splitSentences(text) {
  return String(text)
    .split(/(?<=[.!?…])\s+/u)
    .map((part) => part.trim())
    .filter(Boolean)
}

/** Escapa texto para un evento ASS. @param {string} text */
export function escapeAss(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/\{/g, '(').replace(/\}/g, ')').replace(/\r?\n/g, ' ')
}

/**
 * Formatea segundos como tiempo ASS (H:MM:SS.cc).
 * @param {number} seconds
 */
export function assTime(seconds) {
  const clamped = Math.max(0, seconds)
  const totalCs = Math.round(clamped * 100)
  const cs = totalCs % 100
  const totalSeconds = (totalCs - cs) / 100
  const s = totalSeconds % 60
  const totalMinutes = (totalSeconds - s) / 60
  const m = totalMinutes % 60
  const h = (totalMinutes - m) / 60
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`
}

/** @param {string} text @param {number} max */
export function truncate(text, max) {
  const value = String(text)
  return value.length <= max ? value : `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

/** Primera letra en mayúscula. @param {string} text */
export function capitalize(text) {
  const value = String(text)
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/** Convierte una duración ISO 8601 (PT15M) a minutos. @param {string|undefined} value */
export function isoDurationToMinutes(value) {
  if (!value) return null
  const match = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(value)
  if (!match) return null
  const [, d, h, m, s] = match
  const minutes = Number(d ?? 0) * 1440 + Number(h ?? 0) * 60 + Number(m ?? 0) + Number(s ?? 0) / 60
  return Math.round(minutes)
}

/** Cuenta palabras de un texto. @param {string} text */
export function wordCount(text) {
  return tokenizeWords(text).length
}

/**
 * Elige un elemento de forma determinista a partir de una semilla.
 * @template T
 * @param {T[]} items
 * @param {string} seed
 * @returns {T}
 */
export function pickBySeed(items, seed) {
  let hash = 0
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return items[hash % items.length]
}
