import { warn } from '../util/log.js'
import { wordCount } from '../util/text.js'
import { buildLlmScript } from './llm.js'
import { buildTemplateScript } from './template.js'

/**
 * Construye el guion con el proveedor configurado y cae al generador local si falla.
 * @param {import('../recipe/extract.js').RecipeDoc} recipe
 * @param {import('../config.js').PipelineConfig} config
 * @param {{ provider?: string, tone?: string, targetMinutes?: number, channel?: string, allowFallback?: boolean }} [options]
 * @returns {Promise<Script>}
 */
export async function buildScript(recipe, config, options = {}) {
  const provider = options.provider ?? config.script.provider ?? 'template'
  const allowFallback = options.allowFallback ?? config.script.allowFallback ?? true

  if (provider === 'llm') {
    try {
      const script = await buildLlmScript(recipe, config, options)
      annotate(script, config)
      return script
    } catch (error) {
      if (!allowFallback) throw error
      warn(`Guion con LLM no disponible (${error.message}). Uso el generador local.`)
    }
  }

  const script = buildTemplateScript(recipe, config, options)
  annotate(script, config)
  return script
}

/** @param {Script} script @param {import('../config.js').PipelineConfig} config */
function annotate(script, config) {
  script.provider = script.provider ?? (config.script.provider ?? 'template')
  script.totalWords = script.scenes.reduce((sum, scene) => sum + wordCount(scene.narration), 0)
  script.estimatedSeconds = script.estimatedSeconds ?? Math.round((script.totalWords / (config.script.wordsPerMinute ?? 148)) * 60)
  script.scenes = script.scenes.map((scene, index) => ({
    id: scene.id ?? `s${String(index + 1).padStart(2, '0')}`,
    ...scene,
  }))
}

/**
 * @typedef {object} Scene
 * @property {string} id
 * @property {'intro'|'ingredient'|'step'|'tips'|'outro'|'context'|'variation'} kind
 * @property {string} heading
 * @property {string} narration
 * @property {Array<{ type: 'hero'|'dish'|'ingredient'|'step', index?: number }>} imageHints
 * @property {string[]} imageQueries
 */

/**
 * @typedef {object} Script
 * @property {string} title
 * @property {import('../recipe/extract.js').RecipeDoc} recipe
 * @property {Scene[]} scenes
 * @property {string} [provider]
 * @property {number} [totalWords]
 * @property {number} [estimatedSeconds]
 */
