/**
 * Línea de tiempo común para audio, imagen y subtítulos.
 */

/**
 * Calcula el inicio y la duración de cada escena en el vídeo final.
 * @param {import('../script/index.js').Script} script
 * @param {{ scenes: Array<{ sceneId: string, duration: number, words: Array<{ text: string, start: number, end: number }> }> }} tts
 * @param {import('../config.js').PipelineConfig} config
 */
export function buildTimeline(script, tts, config) {
  const leadIn = config.video.leadIn ?? 1.2
  const gap = config.video.sceneGap ?? 0.35
  const tailOut = config.video.tailOut ?? 2

  const fps = config.video.fps ?? 30
  let videoCursor = leadIn
  let audioCursor = leadIn
  const scenes = script.scenes.map((scene) => {
    const audio = tts.scenes.find((entry) => entry.sceneId === scene.id)
    if (!audio) throw new Error(`Falta el audio de la escena ${scene.id}`)
    // Duración de vídeo cuantizada a frames enteros (para edición)
    const videoDuration = Math.round((audio.duration + gap) * fps) / fps
    // Duración de audio exacta (para sincronía de subtítulos)
    const exactSceneDuration = audio.duration + gap
    const entry = {
      ...scene,
      start: videoCursor,
      duration: videoDuration,
      audioStart: audioCursor,
      audioDuration: audio.duration,
      words: audio.words.map((word) => ({
        text: word.text,
        start: word.start + audioCursor,
        end: word.end + audioCursor,
      })),
    }
    videoCursor += videoDuration
    audioCursor += exactSceneDuration
    return entry
  })

  return {
    scenes,
    leadIn,
    gap,
    tailOut,
    totalDuration: videoCursor + tailOut,
  }
}
