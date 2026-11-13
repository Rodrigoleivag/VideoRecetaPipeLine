/**
 * Catálogo de voces y presets de tono.
 */

/**
 * @param {import('../config.js').PipelineConfig} config
 * @param {{ voice?: string, preset?: string }} [overrides]
 * @returns {{ voice: string, label: string, preset: string, rate: string, pitch: string, volume: string, provider: string }}
 */
export function resolveVoice(config, overrides = {}) {
  const catalog = config.voices.catalog
  const voiceId = overrides.voice ?? config.voice.voice
  const entry = catalog.find((item) => item.id === voiceId)
  if (!entry) {
    const available = catalog.map((item) => item.id).join(', ')
    throw new Error(`Voz desconocida «${voiceId}». Disponibles: ${available}`)
  }
  const presetName = overrides.preset ?? config.voice.preset ?? config.voices.defaultPreset
  const preset = config.voices.presets[presetName]
  if (!preset) {
    throw new Error(`Preset de tono desconocido «${presetName}». Disponibles: ${Object.keys(config.voices.presets).join(', ')}`)
  }
  if (!entry.presets.includes(presetName)) {
    throw new Error(`La voz ${entry.label} no admite el tono «${presetName}». Prueba con: ${entry.presets.join(', ')}`)
  }
  return {
    provider: config.voice.provider,
    voice: entry.id,
    label: `${entry.label} (${preset.label})`,
    preset: presetName,
    rate: config.voice.rate ?? preset.rate,
    pitch: config.voice.pitch ?? preset.pitch,
    volume: config.voice.volume ?? '+0%',
  }
}

/**
 * Lista de voces para mostrar por consola.
 * @param {import('../config.js').PipelineConfig} config
 */
export function listVoices(config) {
  return config.voices.catalog.map((entry) => ({
    id: entry.id,
    label: entry.label,
    gender: entry.gender,
    accent: entry.accent,
    description: entry.description,
    presets: entry.presets,
  }))
}

/**
 * Texto de muestra para previsualizar una voz.
 * @param {string} title
 */
export function previewText(title = 'la receta de hoy') {
  return `Hoy vamos a preparar ${title}. Quiero que salga perfecto, así que vamos a hacerlo paso a paso, sin prisas y con un par de trucos que marcan la diferencia. ¿Empezamos?`
}
