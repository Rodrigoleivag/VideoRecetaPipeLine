import { wordCount } from '../util/text.js'

/**
 * Genera el guion con un LLM compatible con la API de OpenAI (DeepSeek por defecto).
 * @param {import('../recipe/extract.js').RecipeDoc} recipe
 * @param {import('../config.js').PipelineConfig} config
 * @param {{ tone?: string, targetMinutes?: number, channel?: string }} [options]
 * @returns {Promise<import('./index.js').Script>}
 */
export async function buildLlmScript(recipe, config, options = {}) {
  const settings = config.script.llm
  const apiKey = process.env[settings.apiKeyEnv]
  if (!apiKey) throw new Error(`Falta ${settings.apiKeyEnv} para generar el guion con LLM.`)

  const tone = options.tone ?? config.script.tone ?? 'cercano'
  const targetMinutes = options.targetMinutes ?? config.script.targetMinutes ?? 4
  const wordsPerMinute = config.script.wordsPerMinute ?? 148
  const targetWords = Math.round(targetMinutes * wordsPerMinute)

  const prompt = buildPrompt(recipe, { tone, targetWords, channel: options.channel })

  const response = await fetch(`${settings.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: settings.model,
      temperature: settings.temperature ?? 0.8,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
    signal: AbortSignal.timeout(settings.timeoutMs ?? 150000),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`El LLM respondió ${response.status}: ${detail.slice(0, 300)}`)
  }

  const payload = await response.json()
  const content = payload?.choices?.[0]?.message?.content
  if (!content) throw new Error('El LLM devolvió una respuesta vacía.')

  const parsed = parseJson(content)
  const scenes = normalizeScenes(parsed.scenes)
  if (scenes.length < 3) throw new Error('El LLM devolvió muy pocas escenas.')

  const script = { title: parsed.title?.trim() || recipe.title, recipe, scenes }
  script.estimatedSeconds = Math.round((scenes.reduce((sum, scene) => sum + wordCount(scene.narration), 0) / wordsPerMinute) * 60)
  return script
}

const SYSTEM_PROMPT = [
  'Eres guionista de un canal de YouTube de recetas de cocina en español de España.',
  'Escribes narración para locutor en off: frases cortas, ritmo ágil, vocabulario concreto y sensorial.',
  'No inventas cantidades, temperaturas ni tiempos que no aparezcan en la receta.',
  'No usas markdown, ni emojis, ni acotaciones técnicas, ni menciones a la inteligencia artificial.',
  'Respondes únicamente con el objeto JSON solicitado.',
].join(' ')

/**
 * @param {import('../recipe/extract.js').RecipeDoc} recipe
 * @param {{ tone: string, targetWords: number, channel?: string }} context
 */
function buildPrompt(recipe, { tone, targetWords, channel }) {
  const ingredients = recipe.ingredients.map((ingredient, index) => `${index + 1}. ${ingredient.raw}`).join('\n')
  const steps = recipe.steps.map((step, index) => `${index + 1}. ${step.text}`).join('\n')
  const time = recipe.times?.total ? `${recipe.times.total} minutos en total` : 'tiempo no indicado'

  return `Escribe el guion completo de un vídeo de ${Math.round(targetWords / 148 * 60 / 60 * 10) / 10} minutos aproximadamente (${targetWords} palabras, admite ±10%).

RECETA
Título: ${recipe.title}
Descripción original: ${recipe.description || '(sin descripción)'}
Tiempo: ${time}
Comensales: ${recipe.servings ?? 'no indicado'}
Categoría: ${recipe.category || 'no indicada'}
Cocina: ${recipe.cuisine || 'no indicada'}

INGREDIENTES
${ingredients}

PASOS
${steps}

TONO: ${tone === 'divertido' ? 'con humor ligero, sin chistes forzados' : tone === 'elegante' ? 'sobrio y sensorial, estilo revista gastronómica' : tone === 'directo' ? 'muy directo, sin adornos' : 'cercano, como si cocinaras con un amigo'}
${channel ? `CANAL: ${channel}. Menciona el canal en el cierre y pide suscripción de forma natural.` : 'En el cierre pide like y suscripción de forma natural.'}

ESTRUCTURA OBLIGATORIA (una escena por bloque)
1. kind "intro": gancho de 3-4 frases que dé hambre y explique por qué esta receta merece la pena.
2. Una escena kind "ingredient" por cada ingrediente, con el campo "index" (1-based) del ingrediente. Explica qué aporta y un detalle práctico.
3. Una escena kind "step" por cada paso, con el campo "index" (1-based) del paso. Describe el gesto, el punto de cocción y cómo saber que está bien.
4. kind "tips": dos o tres trucos que marquen la diferencia.
5. kind "outro": cierre con llamada a la acción.

REGLAS DE ESCRITURA
- Español de España, segunda persona del singular.
- Entre 18 y 45 palabras por escena de ingrediente; entre 45 y 80 por escena de paso.
- Nada de "en este vídeo vamos a ver". Entra directamente.
- Sin repetir la misma fórmula de apertura en escenas consecutivas.

FORMATO DE RESPUESTA (JSON estricto)
{"title":"título del vídeo","scenes":[{"kind":"intro","heading":"Introducción","narration":"..."},{"kind":"ingredient","index":1,"heading":"Ingrediente 1","narration":"..."}]}`
}

/** @param {string} text */
function parseJson(text) {
  const trimmed = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
  try {
    return JSON.parse(trimmed)
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) return JSON.parse(trimmed.slice(start, end + 1))
    throw new Error('El LLM no devolvió JSON válido.')
  }
}

const KINDS = new Set(['intro', 'ingredient', 'step', 'tips', 'outro', 'context', 'variation'])

/** @param {any[]} scenes */
function normalizeScenes(scenes) {
  if (!Array.isArray(scenes)) throw new Error('El LLM no devolvió una lista de escenas.')
  return scenes
    .filter((scene) => scene && typeof scene.narration === 'string' && scene.narration.trim().length > 10)
    .map((scene, index) => {
      const kind = KINDS.has(scene.kind) ? scene.kind : 'context'
      const imageHints = []
      if (kind === 'intro') imageHints.push({ type: 'hero' })
      if (kind === 'ingredient') imageHints.push({ type: 'ingredient', index: Math.max(0, Number(scene.index ?? 1) - 1) })
      if (kind === 'step') imageHints.push({ type: 'step', index: Math.max(0, Number(scene.index ?? 1) - 1) })
      if (kind === 'tips' || kind === 'outro' || kind === 'context' || kind === 'variation') imageHints.push({ type: 'dish' })
      return {
        kind,
        heading: String(scene.heading ?? `Escena ${index + 1}`).slice(0, 60),
        narration: String(scene.narration).replace(/\s+/g, ' ').trim(),
        imageHints,
        imageQueries: Array.isArray(scene.imageQueries) ? scene.imageQueries.map(String) : [],
      }
    })
}
