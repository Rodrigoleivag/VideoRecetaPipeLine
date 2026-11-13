import path from 'node:path'
import { rename, writeFile } from 'node:fs/promises'
import { ensureDir, exists } from '../util/fsx.js'
import { ffmpeg } from '../util/exec.js'
import { debug, info } from '../util/log.js'

/**
 * Monta la narración completa insertando los silencios de la línea de tiempo.
 * @param {ReturnType<import('./timeline.js').buildTimeline>} timeline
 * @param {ReturnType<import('../config.js').recipePaths>} paths
 * @returns {Promise<string>}
 */
export async function buildNarration(timeline, paths) {
  await ensureDir(paths.audio)
  const silenceDir = path.join(paths.audio, 'silence')
  await ensureDir(silenceDir)

  const parts = []
  parts.push(await silence(silenceDir, timeline.leadIn))
  for (const scene of timeline.scenes) {
    parts.push(path.join(paths.base, scene.audioFile ?? path.join('audio', `${scene.id}.wav`)))
    parts.push(await silence(silenceDir, scene.duration - scene.audioDuration))
  }
  parts.push(await silence(silenceDir, timeline.tailOut))

  const missing = []
  for (const file of parts) if (!(await exists(file))) missing.push(file)
  if (missing.length > 0) throw new Error(`Faltan audios de escena: ${missing.join(', ')}`)

  const listFile = path.join(paths.audio, 'narration-list.txt')
  await writeFile(listFile, `${parts.map((file) => `file '${file}'`).join('\n')}\n`, 'utf8')
  await ffmpeg(['-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', paths.narration])
  return paths.narration
}

/** @param {string} dir @param {number} seconds */
async function silence(dir, seconds) {  const rounded = Math.max(0.05, Math.round(seconds * 1000) / 1000)
  const file = path.join(dir, `silence-${rounded.toFixed(3)}.wav`)
  if (await exists(file)) return file
  await ffmpeg(['-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=mono', '-t', rounded.toFixed(3), '-c:a', 'pcm_s16le', file])
  return file
}

/**
 * Sonoridad integrada (LUFS) de un archivo de audio, medida con loudnorm.
 * Devuelve null si la medición falla, para no bloquear el montaje.
 * @param {string} file
 * @returns {Promise<number|null>}
 */
async function integratedLufs(file) {
  const { stderr } = await ffmpeg([
    '-i', file,
    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json',
    '-f', 'null', '-',
  ], { allowFailure: true })
  const match = /"input_i"\s*:\s*"(-?\d+(?:\.\d+)?)"/.exec(stderr)
  const value = match ? Number(match[1]) : Number.NaN
  return Number.isFinite(value) && value < 0 ? value : null
}

/**
 * Compone el vídeo final: visuales + subtítulos quemados + voz + música con ducking.
 *
 * @param {ReturnType<import('./timeline.js').buildTimeline>} timeline
 * @param {ReturnType<import('../config.js').recipePaths>} paths
 * @param {import('../config.js').PipelineConfig} config
 * @param {{ visuals: string, narration: string, music?: string|null, title: string, font?: { family: string, dir: string|null } }} input
 * @returns {Promise<string>}
 */
export async function renderFinal(timeline, paths, config, input) {
  const total = round(timeline.totalDuration)
  const { width, height, fps, crf, preset } = config.video
  const music = input.music ?? null
  const hasMusic = Boolean(music && config.music.enabled)

  const filters = []
  if (config.subtitles.enabled) {
    const fontOption = input.font?.dir ? `:fontsdir='${input.font.dir}'` : ''
    filters.push(`[0:v]ass=subtitles.ass${fontOption}[v]`)
  } else {
    filters.push('[0:v]null[v]')
  }

  const audio = config.audio ?? {}
  const targetLufs = audio.targetLufs ?? -16
  const truePeak = audio.truePeakDb ?? -1.5
  const measured = await integratedLufs(input.narration)
  // Ganancia estática medida sobre la narración completa: conserva la dinámica
  // de la locución y evita el retardo de un loudnorm dinámico en el montaje.
  const gain = measured === null ? 0 : Math.max(-6, Math.min(12, targetLufs - measured))
  const limit = (10 ** (truePeak / 20)).toFixed(3)
  debug(`sonoridad narración ${measured?.toFixed(1) ?? '?'} LUFS → ganancia ${gain.toFixed(2)} dB`)

  const voiceChain = `[1:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
    `volume=${gain.toFixed(2)}dB,alimiter=limit=${limit}:attack=5:release=50:level=false:latency=true,` +
    `apad=whole_dur=${total},atrim=0:${total}`

  if (hasMusic) {
    const volume = config.music.volume ?? 0.16
    const fadeIn = Math.min(config.music.fadeIn ?? 2, total / 4)
    const fadeOut = Math.min(config.music.fadeOut ?? 3, total / 3)
    filters.push(`${voiceChain},asplit=2[voice][sc]`)
    filters.push(
      `[2:a]atrim=0:${total},asetpts=N/SR/TB,aformat=sample_fmts=fltp:channel_layouts=stereo,` +
      `volume=${volume},afade=t=in:st=0:d=${fadeIn},afade=t=out:st=${round(total - fadeOut)}:d=${fadeOut}[music]`,
    )
    const ducking = config.music.ducking ?? {}
    filters.push(
      `[music][sc]sidechaincompress=threshold=${ducking.threshold ?? 0.05}:ratio=${ducking.ratio ?? 12}:` +
      `attack=${ducking.attack ?? 20}:release=${ducking.release ?? 400}:makeup=1[duck]`,
    )
    filters.push('[voice][duck]amix=inputs=2:duration=first:normalize=0[aout]')
  } else {
    filters.push(`${voiceChain}[aout]`)
  }

  await ensureDir(path.dirname(paths.output))
  const args = [
    '-i', input.visuals,
    '-i', input.narration,
    ...(hasMusic ? ['-stream_loop', '-1', '-i', music] : []),
    '-filter_complex', filters.join(';'),
    '-map', '[v]',
    '-map', '[aout]',
    '-c:v', 'libx264',
    '-preset', preset,
    '-crf', String(crf),
    '-pix_fmt', 'yuv420p',
    '-color_range', 'tv',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-profile:v', 'high',
    '-level', '4.1',
    '-r', String(fps),
    '-c:a', 'aac',
    '-b:a', '192k',
    '-ar', '48000',
    '-ac', '2',
    '-movflags', '+faststart',
    '-metadata', `title=${input.title}`,
    '-metadata', 'comment=Música y créditos en la descripción del vídeo',
    '-s', `${width}x${height}`,
    paths.output,
  ]

  debug(`ffmpeg ${args.slice(0, 12).join(' ')} …`)
  await ffmpeg(args, { cwd: paths.base })
  info(`Vídeo final: ${paths.output}`)
  return paths.output
}

/** @param {number} value */
function round(value) {
  return Math.round(value * 1000) / 1000
}

/**
 * Renombra el resultado temporal al nombre definitivo.
 * @param {string} from @param {string} to
 */
export async function commitFile(from, to) {
  await rename(from, to)
  return to
}
