import path from 'node:path'
import { stat, writeFile } from 'node:fs/promises'
import { ensureDir, exists, readJson, writeJson } from '../util/fsx.js'
import { ffmpeg } from '../util/exec.js'
import { debug } from '../util/log.js'
import { renderAiClip } from '../ai/clips.js'

const MOTION_CYCLE = ['zoom-in', 'pan-right', 'zoom-out', 'pan-left']

/**
 * Genera el vídeo visual completo (sin audio ni subtítulos):
 * un clip por escena con efecto Ken Burns y unión por corte directo.
 *
 * @param {ReturnType<import('./timeline.js').buildTimeline>} timeline
 * @param {Array<{ sceneId: string, images: Array<{ file: string }> }>} assets
 * @param {import('../config.js').PipelineConfig} config
 * @param {ReturnType<import('../config.js').recipePaths>} paths
 * @returns {Promise<string>}
 */
export async function renderVisuals(timeline, assets, config, paths) {
  await ensureDir(paths.clips)
  const manifestFile = path.join(paths.clips, 'manifest.json')
  const manifest = (await exists(manifestFile)) ? await readJson(manifestFile) : {}
  const fps = config.video.fps
  const motions = config.video.motions?.length ? config.video.motions : MOTION_CYCLE
  const files = []

  for (const [index, scene] of timeline.scenes.entries()) {
    const entry = assets.find((item) => item.sceneId === scene.id)
    if (!entry || entry.images.length === 0) throw new Error(`La escena ${scene.id} no tiene imágenes.`)

    const aiFile = path.join(paths.clips, `${scene.id}-ai.mp4`)
    const aiSignature = await clipSignature(entry.images[0].file, scene.duration, 'ai', config)
    const aiCached = aiSignature === manifest[aiFile] && (await exists(aiFile))
    if (!aiCached) {
      const generated = await renderAiClip(scene, entry.images[0].file, scene.duration, config, aiFile)
      if (generated) manifest[aiFile] = aiSignature
      else delete manifest[aiFile]
      if (generated) {
        files.push(generated)
        debug(`clip IA ${scene.id} · ${scene.duration.toFixed(2)} s`)
        continue
      }
    } else {
      files.push(aiFile)
      continue
    }

    const parts = splitDuration(scene.duration, entry.images.length, fps)
    const sceneFiles = []
    for (const [slot, image] of entry.images.entries()) {
      const file = path.join(paths.clips, `${scene.id}-${slot + 1}.mp4`)
      const motion = motions[(index + slot) % motions.length]
      const signature = await clipSignature(image.file, parts[slot], motion, config)
      if (signature !== manifest[file] || !(await exists(file))) {
        await renderKenBurns(image.file, file, parts[slot], motion, config)
        manifest[file] = signature
        debug(`clip ${scene.id}/${slot + 1} · ${motion} · ${parts[slot].toFixed(2)} s`)
      }
      sceneFiles.push(file)
    }
    files.push(...sceneFiles)
  }
  await writeJson(manifestFile, manifest)

  const listFile = path.join(paths.clips, 'list.txt')
  await writeFile(listFile, `${files.map((file) => `file '${file.replace(/'/g, "'\\''")}'`).join('\n')}\n`, 'utf8')
  const visuals = path.join(paths.base, 'visuals.mp4')
  await ffmpeg([
    '-f', 'concat',
    '-safe', '0',
    '-i', listFile,
    '-c', 'copy',
    '-movflags', '+faststart',
    visuals,
  ])
  return visuals
}

/**
 * Firma del clip para reutilizarlo entre renders: cambia si cambian la imagen,
 * su duración exacta, el movimiento o el formato de salida.
 * @param {string} image
 * @param {number} duration
 * @param {string} motion
 * @param {import('../config.js').PipelineConfig} config
 */
async function clipSignature(image, duration, motion, config) {
  const info = await stat(image)
  const { width, height, fps } = config.video
  return [image, info.size, Math.round(info.mtimeMs), duration.toFixed(3), motion, `${width}x${height}`, fps].join('|')
}

/**
 * Reparte la duración de una escena entre sus imágenes, en frames exactos.
 * @param {number} duration
 * @param {number} count
 * @param {number} fps
 */
function splitDuration(duration, count, fps) {
  const totalFrames = Math.round(duration * fps)
  const base = Math.floor(totalFrames / count)
  const remainder = totalFrames - base * count
  return Array.from({ length: count }, (_, index) => (base + (index < remainder ? 1 : 0)) / fps)
}

/**
 * Clip de una imagen con movimiento lento (zoom o paneo) y duración exacta.
 *
 * @param {string} image
 * @param {string} out
 * @param {number} duration
 * @param {string} motion
 * @param {import('../config.js').PipelineConfig} config
 */
export async function renderKenBurns(image, out, duration, motion, config) {
  const { width, height, fps } = config.video
  const frames = Math.max(2, Math.round(duration * fps))
  const last = frames - 1
  const bigW = width * 2
  const bigH = height * 2

  const zoom = (expression) => ({
    z: expression,
    x: 'iw/2-(iw/zoom/2)',
    y: 'ih/2-(ih/zoom/2)',
  })

  let geometry
  if (motion === 'zoom-out') {
    geometry = zoom(`if(eq(on,0),1.10,max(1.10-0.10*on/${last},1.0))`)
  } else if (motion === 'pan-right') {
    geometry = { z: '1.10', x: `(iw-iw/zoom)*min(on/${last},1)`, y: 'ih/2-(ih/zoom/2)' }
  } else if (motion === 'pan-left') {
    geometry = { z: '1.10', x: `(iw-iw/zoom)*(1-min(on/${last},1))`, y: 'ih/2-(ih/zoom/2)' }
  } else {
    geometry = zoom(`if(eq(on,0),1.0,min(1.0+0.10*on/${last},1.10))`)
  }

  const filters = [
    `scale=${bigW}:${bigH}:force_original_aspect_ratio=increase`,
    `crop=${bigW}:${bigH}`,
    'setsar=1',
    `zoompan=z='${geometry.z}':x='${geometry.x}':y='${geometry.y}':d=1:s=${width}x${height}:fps=${fps}`,
    'setsar=1',
    'format=yuv420p',
  ].join(',')

  await ffmpeg([
    '-loop', '1',
    '-framerate', String(fps),
    '-t', duration.toFixed(3),
    '-i', image,
    '-vf', filters,
    '-frames:v', String(frames),
    '-r', String(fps),
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '18',
    '-pix_fmt', 'yuv420p',
    '-color_range', 'tv',
    '-colorspace', 'bt709',
    '-color_primaries', 'bt709',
    '-color_trc', 'bt709',
    '-x264-params', 'keyint=30:min-keyint=30:scenecut=0',
    '-an',
    out,
  ])
  return out
}
