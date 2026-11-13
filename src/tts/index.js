import path from 'node:path'
import { readFile, rename } from 'node:fs/promises'
import { ensureDir, exists, readJson, writeJson } from '../util/fsx.js'
import { ffmpeg, mediaDuration, run } from '../util/exec.js'
import { normalize, tokenizeWords } from '../util/text.js'
import { debug, info, ok, warn } from '../util/log.js'
import { resolveVoice } from './voices.js'
import { synthesizeEdge, readEdgeBoundariesFile } from './edge.js'
import { synthesizeAzure } from './azure.js'

/**
 * Sintetiza cada escena por separado y devuelve audio, duración y palabras con
 * tiempos reales. Sintetizar por escena hace que el montaje y los subtítulos
 * queden sincronizados sin estimaciones.
 *
 * @param {import('../script/index.js').Script} script
 * @param {import('../config.js').PipelineConfig} config
 * @param {ReturnType<import('../config.js').recipePaths>} paths
 * @param {{ voice?: string, preset?: string, force?: boolean }} [options]
 */
export async function synthesizeScenes(script, config, paths, options = {}) {
  const voice = resolveVoice(config, options)
  await ensureDir(paths.audio)

  const results = []
  for (const scene of script.scenes) {
    const base = path.join(paths.audio, scene.id)
    const mp3 = `${base}.mp3`
    const wav = `${base}.wav`
    const manifestFile = `${base}.json`

    if (!options.force && (await exists(manifestFile)) && (await exists(wav))) {
      const cached = await readJson(manifestFile)
      if (cached.voice === voice.voice && cached.preset === voice.preset && cached.text === scene.narration) {
        debug(`audio en caché: ${scene.id}`)
        // El audio no cambia, pero las palabras guardadas pueden venir de otra
        // versión del alineador: se recalculan desde los límites reales.
        const realigned = await realignFromBoundaries(cached, `${base}.boundaries.json`, scene.narration, manifestFile)
        results.push(realigned)
        continue
      }
    }

    const boundaries = voice.provider === 'azure'
      ? await synthesizeAzure({
        text: scene.narration,
        outFile: mp3,
        voice: voice.voice,
        rate: voice.rate,
        pitch: voice.pitch,
        volume: voice.volume,
      })
      : await synthesizeEdge({
        text: scene.narration,
        outFile: mp3,
        wordsFile: `${base}.boundaries.json`,
        voice: voice.voice,
        rate: voice.rate,
        pitch: voice.pitch,
        volume: voice.volume,
      })

    // Azure escribe WAV a 24 kHz; Edge escribe MP3. Unificamos a 48 kHz mono PCM
    // pasando siempre por un temporal para no leer y escribir el mismo archivo.
    const source = (await exists(wav)) ? wav : mp3
    const tempWav = `${base}.tmp.wav`
    await ffmpeg(['-i', source, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', tempWav])
    await rename(tempWav, wav)

    const duration = await mediaDuration(wav)
    const { words, ratio } = alignWords(scene.narration, boundaries, duration)
    if (ratio < 0.85) warn(`Alineación aproximada en «${scene.heading}» (${Math.round(ratio * 100)}% de palabras con tiempo propio).`)

    const manifest = {
      sceneId: scene.id,
      heading: scene.heading,
      text: scene.narration,
      audio: path.relative(paths.base, wav),
      duration,
      voice: voice.voice,
      preset: voice.preset,
      provider: voice.provider,
      words,
      alignmentRatio: ratio,
    }
    await writeJson(manifestFile, manifest)
    results.push(manifest)
    info(`${scene.id} · ${scene.heading} · ${duration.toFixed(1)} s`)
  }

  const total = results.reduce((sum, scene) => sum + scene.duration, 0)
  ok(`Audio listo: ${results.length} escenas, ${(total / 60).toFixed(2)} min de voz (${voice.label}).`)
  return { voice, scenes: results, totalDuration: total }
}

/**
 * Recalcula las palabras de una escena ya sintetizada usando sus límites guardados.
 * @param {any} cached manifiesto previo de la escena
 * @param {string} boundariesFile
 * @param {string} narration
 * @param {string} manifestFile
 */
async function realignFromBoundaries(cached, boundariesFile, narration, manifestFile) {
  if (!(await exists(boundariesFile)) || !Number.isFinite(cached.duration)) return cached
  const boundaries = await readEdgeBoundariesFile(boundariesFile)
  const { words, ratio } = alignWords(narration, boundaries, cached.duration)
  if (ratio < 0.85) warn(`Alineación aproximada en «${cached.heading}» (${Math.round(ratio * 100)}% de palabras con tiempo propio).`)
  const updated = { ...cached, words, alignmentRatio: ratio }
  await writeJson(manifestFile, updated)
  return updated
}

/**
 * Alinea las palabras de la narración con los límites de palabra del TTS.
 * @param {string} narration
 * @param {Array<{ text: string, start: number, end: number }>} boundaries
 * @param {number} duration
 * @returns {{ words: Array<{ text: string, start: number, end: number }>, ratio: number }}
 */
export function alignWords(narration, boundaries, duration) {
  const tokens = tokenizeWords(narration)
  if (tokens.length === 0) return { words: [], ratio: 1 }
  if (boundaries.length === 0) return { words: spread(tokens, duration), ratio: 0 }

  const expanded = expandBoundaries(boundaries)
  const tokenNorms = tokens.map((token) => normalize(token))
  const boundNorms = expanded.map((boundary) => normalize(boundary.text))
  const mapping = new Array(tokens.length).fill(-1)

  let tokenIndex = 0
  let boundIndex = 0
  while (tokenIndex < tokens.length && boundIndex < expanded.length) {
    const tokenNorm = tokenNorms[tokenIndex]
    const boundNorm = boundNorms[boundIndex]

    if (tokenNorm && tokenNorm === boundNorm) {
      mapping[tokenIndex] = boundIndex
      tokenIndex += 1
      boundIndex += 1
      continue
    }

    // Varios límites pueden componer una palabra (p. ej. "180" leído como
    // "ciento" + "ochenta", o un número escrito y otro pronunciado).
    let merged = boundNorm
    let extra = 0
    while (merged.length < tokenNorm.length && boundIndex + extra + 1 < expanded.length) {
      extra += 1
      merged += boundNorms[boundIndex + extra]
    }
    if (merged && (merged === tokenNorm || tokenNorm.startsWith(merged))) {
      mapping[tokenIndex] = boundIndex
      tokenIndex += 1
      boundIndex = boundIndex + extra + 1
      continue
    }

    // Desambiguación: un número escrito distinto o un rango («10-15») no debe
    // desalinear el resto de la escena, así que se busca coincidencia cercana.
    const WINDOW = 3
    let resynced = false
    for (let offset = 1; offset <= WINDOW && !resynced; offset += 1) {
      if (tokenNorms[tokenIndex + offset] === boundNorm) {
        tokenIndex += offset
        resynced = true
      } else if (boundNorms[boundIndex + offset] === tokenNorm) {
        boundIndex += offset
        resynced = true
      }
    }
    if (!resynced) boundIndex += 1
  }

  const matched = mapping.filter((value) => value >= 0).length
  const ratio = matched / tokens.length
  const words = tokens.map((token, index) => ({ text: token, start: Number.NaN, end: Number.NaN }))

  for (let index = 0; index < tokens.length; index += 1) {
    const bound = expanded[mapping[index]]
    if (!bound) continue
    words[index].start = bound.start
    words[index].end = Math.max(bound.end, bound.start + 0.05)
  }

  // Relleno proporcional para palabras sin límite propio.
  let cursor = 0
  while (cursor < words.length) {
    if (Number.isFinite(words[cursor].start)) {
      cursor += 1
      continue
    }
    let end = cursor
    while (end < words.length && !Number.isFinite(words[end].start)) end += 1
    const prevEnd = cursor > 0 ? words[cursor - 1].end : 0
    const nextStart = end < words.length ? words[end].start : Math.max(prevEnd + 0.2, duration)
    const span = Math.max(0.05, nextStart - prevEnd)
    const count = end - cursor
    for (let offset = 0; offset < count; offset += 1) {
      const start = prevEnd + (span / count) * offset
      words[cursor + offset].start = start
      words[cursor + offset].end = start + span / count
    }
    cursor = end
  }

  for (let index = 1; index < words.length; index += 1) {
    if (words[index].start < words[index - 1].start) words[index].start = words[index - 1].start
    if (words[index].end <= words[index].start) words[index].end = words[index].start + 0.08
  }
  if (words.length > 0) {
    const last = words[words.length - 1]
    if (last.end > duration) last.end = Math.max(last.start + 0.08, duration)
  }

  return { words, ratio }
}

/**
 * Divide los límites que agrupan varias palabras (p. ej. «unos 15 minutos») en
 * una entrada por palabra, repartiendo el tiempo según su longitud.
 * @param {Array<{ text: string, start: number, end: number }>} boundaries
 * @returns {Array<{ text: string, start: number, end: number }>}
 */
function expandBoundaries(boundaries) {
  const expanded = []
  for (const boundary of boundaries) {
    const parts = String(boundary.text).trim()
      .split(/\s+/)
      .flatMap((part) => part.split(/(?<=\d)\s*[-–—]\s*(?=\d)/))
      .filter(Boolean)
    if (parts.length <= 1) {
      expanded.push({ text: boundary.text, start: boundary.start, end: boundary.end })
      continue
    }
    const weights = parts.map((part) => Math.max(1, normalize(part).length))
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    const span = Math.max(0.05, boundary.end - boundary.start)
    let cursor = boundary.start
    for (let index = 0; index < parts.length; index += 1) {
      const share = index === parts.length - 1
        ? boundary.end - cursor
        : (span * weights[index]) / totalWeight
      expanded.push({ text: parts[index], start: cursor, end: cursor + Math.max(0.02, share) })
      cursor += share
    }
  }
  return expanded
}

/**
 * Reparto uniforme cuando el proveedor no ofrece tiempos.
 * @param {string[]} tokens
 * @param {number} duration
 */
function spread(tokens, duration) {
  const step = Math.max(0.12, duration / Math.max(1, tokens.length))
  return tokens.map((token, index) => ({ text: token, start: index * step, end: (index + 1) * step }))
}

/**
 * Sintetiza un texto suelto para previsualizar voz y tono.
 * @param {string} text
 * @param {import('../config.js').PipelineConfig} config
 * @param {{ voice?: string, preset?: string, outDir: string, play?: boolean }} options
 */
export async function previewVoice(text, config, options) {
  const voice = resolveVoice(config, options)
  await ensureDir(options.outDir)
  const base = path.join(options.outDir, `preview-${voice.voice}-${voice.preset}`)
  const mp3 = `${base}.mp3`
  const files = []

  const boundaries = voice.provider === 'azure'
    ? await synthesizeAzure({ text, outFile: mp3, voice: voice.voice, rate: voice.rate, pitch: voice.pitch, volume: voice.volume })
    : await synthesizeEdge({ text, outFile: mp3, wordsFile: `${base}.boundaries.json`, voice: voice.voice, rate: voice.rate, pitch: voice.pitch, volume: voice.volume })

  const wav = `${base}.wav`
  if (!(await exists(wav))) await ffmpeg(['-i', mp3, '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', wav])
  files.push(mp3, wav)

  const duration = await mediaDuration(wav)
  const { words } = alignWords(text, boundaries, duration)
  await writeJson(`${base}.json`, { voice, duration, words })

  if (options.play && process.platform === 'darwin') {
    await run('afplay', [wav], { allowFailure: true })
  }
  return { voice, files, duration, words, text }
}

/** @param {string} file */
export async function ensureWav(file) {
  const info_ = await readFile(file).catch(() => null)
  if (!info_) throw new Error(`Audio inexistente: ${file}`)
  return file
}
