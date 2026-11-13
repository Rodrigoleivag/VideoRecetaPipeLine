import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { fetchJson } from '../util/http.js'
import { download } from '../util/http.js'
import { ensureDir } from '../util/fsx.js'
import { ffmpeg, mediaDuration } from '../util/exec.js'
import { debug } from '../util/log.js'

/**
 * Adaptador de clips generados por IA.
 *
 * Contrato del proveedor HTTP: recibe un POST JSON
 *   { prompt, duration, imageUrl?, width, height, fps }
 * y responde { video_url } o { video_base64 }.
 *
 * El pipeline recorta y ajusta el clip a la duración exacta de la escena; si el
 * proveedor falla, se usa la animación Ken Burns como respaldo.
 *
 * @param {import('../script/index.js').Scene} scene
 * @param {string} image
 * @param {number} duration
 * @param {import('../config.js').PipelineConfig} config
 * @param {string} outFile
 * @returns {Promise<string|null>}
 */
export async function renderAiClip(scene, image, duration, config, outFile) {
  const settings = config.aiClips
  if (!settings?.enabled) return null
  if (settings.provider !== 'http') {
    debug(`proveedor de clips IA no soportado: ${settings.provider}`)
    return null
  }
  const apiKey = process.env[settings.apiKeyEnv ?? 'AI_VIDEO_API_KEY']
  if (!apiKey) {
    debug('clips IA activados sin clave; uso Ken Burns')
    return null
  }

  try {
    const payload = await fetchJson(settings.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: settings.model,
        prompt: scene.narration,
        duration,
        width: config.video.width,
        height: config.video.height,
        fps: config.video.fps,
      }),
      timeoutMs: 240000,
      retries: 0,
    })

    const temp = path.join(path.dirname(outFile), `${scene.id}-ai-source.mp4`)
    await ensureDir(path.dirname(outFile))
    if (payload.video_url) {
      await download(payload.video_url, temp, { timeoutMs: 300000, force: true })
    } else if (payload.video_base64) {
      await writeFile(temp, Buffer.from(payload.video_base64, 'base64'))
    } else {
      return null
    }

    const sourceDuration = await mediaDuration(temp).catch(() => 0)
    if (sourceDuration <= 0.2) return null

    await ffmpeg([
      '-i', temp,
      '-t', duration.toFixed(3),
      '-vf', `scale=${config.video.width}:${config.video.height}:force_original_aspect_ratio=increase,crop=${config.video.width}:${config.video.height},fps=${config.video.fps},tpad=stop_mode=clone:stop_duration=${Math.ceil(duration) + 1},format=yuv420p`,
      '-an',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '18',
      outFile,
    ])
    return outFile
  } catch (error) {
    debug(`clip IA no disponible: ${error.message}`)
    return null
  }
}
