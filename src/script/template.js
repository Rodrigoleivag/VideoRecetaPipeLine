import { capitalize, pickBySeed, truncate, wordCount } from '../util/text.js'

/**
 * Generador de guion sin LLM: escribe una narración castellana, cercana y con ritmo
 * a partir de la receta extraída. Se usa cuando no hay clave de LLM configurada.
 *
 * @param {import('../recipe/extract.js').RecipeDoc} recipe
 * @param {import('../config.js').PipelineConfig} config
 * @param {{ tone?: string, targetMinutes?: number, channel?: string }} [options]
 * @returns {import('./index.js').Script}
 */
export function buildTemplateScript(recipe, config, options = {}) {
  const tone = options.tone ?? config.script.tone ?? 'cercano'
  const targetMinutes = options.targetMinutes ?? config.script.targetMinutes ?? 4
  const wordsPerMinute = config.script.wordsPerMinute ?? 148
  const seed = recipe.title

  const scenes = []
  const totalTime = recipe.times?.total ?? null
  const servings = recipe.servings
  const usedPhrases = new Set()

  // 1. INTRO - específica al tipo de plato
  scenes.push({
    kind: 'intro',
    heading: 'Introducción',
    narration: buildIntro(recipe, { tone, seed, totalTime, servings, usedPhrases }),
    imageHints: [{ type: 'hero' }],
    imageQueries: [`${recipe.title} plato terminado`, 'cocina casera'],
  })

  // 2. INGREDIENTES - usar imagen de "ingredientes" del artículo si existe
  const hasIngredientsPhoto = recipe.photos?.ingredients?.url
  recipe.ingredients.forEach((ingredient, index) => {
    scenes.push({
      kind: 'ingredient',
      heading: `Ingrediente ${index + 1}`,
      narration: buildIngredientText(ingredient, index, recipe.ingredients.length, seed, usedPhrases),
      imageHints: [
        { type: 'ingredient', index },
        ...(hasIngredientsPhoto && index === 0 ? [{ type: 'ingredients_photo' }] : [])
      ],
      imageQueries: [ingredient.searchTerm ?? ingredient.name, 'ingredientes cocina'],
    })
  })

  // 3. PASOS - narración contextual, sin repeticiones
  recipe.steps.forEach((step, index) => {
    scenes.push({
      kind: 'step',
      heading: `Paso ${index + 1} de ${recipe.steps.length}`,
      narration: buildStepText(step, index, recipe.steps.length, recipe, seed, usedPhrases),
      imageHints: [{ type: 'step', index }],
      imageQueries: [buildStepQuery(step.text, recipe.title)],
    })
  })

  // 4. TRUCOS - específicos a los ingredientes
  scenes.push({
    kind: 'tips',
    heading: 'Trucos',
    narration: buildTipsText(recipe, seed, usedPhrases),
    imageHints: [{ type: 'dish' }],
    imageQueries: [`${recipe.title} receta`, 'plato servido mesa'],
  })

  // 5. OUTRO - con CTA obligatorio
  scenes.push({
    kind: 'outro',
    heading: 'Despedida',
    narration: buildOutroText(recipe, { tone, channel: options.channel, usedPhrases, seed }),
    imageHints: [{ type: 'dish' }],
    imageQueries: [`${recipe.title} receta`],
  })

  const script = { title: recipe.title, recipe, scenes }
  const targetWords = Math.round(targetMinutes * wordsPerMinute)
  const minWords = Math.round(3.1 * wordsPerMinute)
  const maxWords = Math.round(5 * wordsPerMinute)

  if (scriptWordCount(script) < Math.min(minWords, targetWords) && recipe.steps.length > 0) {
    const extras = buildExtraScenes(recipe, seed, usedPhrases)
    const insertAt = scenes.length - 2
    scenes.splice(insertAt, 0, ...extras)
  }

  const total = scriptWordCount(script)
  if (total > maxWords) {
    script.scenes = trimToBudget(script.scenes, maxWords)
  }

  script.estimatedSeconds = Math.round((scriptWordCount(script) / wordsPerMinute) * 60)
  return script
}

/** @param {import('./index.js').Script} script */
function scriptWordCount(script) {
  return script.scenes.reduce((sum, scene) => sum + wordCount(scene.narration), 0)
}

/** @param {import('./index.js').Script} script */
export function sceneWordCount(script) {
  return script.scenes.map((scene) => ({ heading: scene.heading, words: wordCount(scene.narration) }))
}

/** @param {import('./index.js').Script['scenes'][number]} scene @param {number} maxWords */
function trimToBudget(scenes, maxWords) {
  let total = scenes.reduce((sum, scene) => sum + wordCount(scene.narration), 0)
  const out = [...scenes]
  for (let index = out.length - 1; index >= 0 && total > maxWords; index -= 1) {
    // Preservar escenas esenciales: intro, step, tips, outro
    if (out[index].kind === 'intro' || out[index].kind === 'step' || out[index].kind === 'tips' || out[index].kind === 'outro') continue
    const words = wordCount(out[index].narration)
    if (total - words < maxWords) continue
    out.splice(index, 1)
    total -= words
  }
  return out
}

/* -------------------------------------------------------------------------- */
/* INTRO                                                                      */
/* -------------------------------------------------------------------------- */

function buildIntro(recipe, { tone, seed, totalTime, servings, usedPhrases }) {
  const dish = recipe.title.toLowerCase()
  const category = recipe.category?.toLowerCase() ?? ''
  const cuisine = recipe.cuisine?.toLowerCase() ?? ''

  const hooks = [
    `Hay platos que parecen reservados a restaurantes y luego resultan sorprendentemente asequibles en casa. ${capitalize(recipe.title)} es uno de ellos.`,
    `Si buscas impresionar sin complicarte la vida, apunta: ${dish}.`,
    `Hoy preparamos ${dish}, un clásico que siempre triunfa y es más fácil de lo que parece.`,
    `Vamos con ${dish}: presencia de restaurante, técnica de casa.`,
  ]

  const contextLines = []
  if (cuisine) contextLines.push(`Es un plato de cocina ${cuisine}.`)
  if (category) contextLines.push(`Perfecto como ${category.toLowerCase()}.`)
  if (totalTime) contextLines.push(`En unos ${totalTime} minutos lo tienes en la mesa.`)
  if (servings) contextLines.push(`Rinde para ${servings} comensales.`)

  const toneLine = pickUnique([
    'Sin técnicas imposibles, solo pasos claros y trucos que marcan la diferencia.',
    'Producto bueno, gestos precisos y el horno hace el resto.',
    'Cocinar bien no es complicado, solo hace falta saber qué hacer en cada momento.',
    'Te guío paso a paso para que no falle nada.',
  ], `${seed}-tone`, usedPhrases)

  const closing = pickUnique([
    'Coge el delantal, que empezamos.',
    'Manos a la obra.',
    'Vamos a ello.',
  ], `${seed}-intro-close`, usedPhrases)

  const parts = [
    pickUnique(hooks, `${seed}-hook`, usedPhrases),
    toneLine,
    ...contextLines.slice(0, 2),
    closing,
  ]
  return parts.join(' ')
}

/* -------------------------------------------------------------------------- */
/* INGREDIENTES                                                               */
/* -------------------------------------------------------------------------- */

function buildIngredientText(ingredient, index, total, seed, usedPhrases) {
  const openings = index === 0
    ? ['Empezamos por lo fundamental:', 'La base de todo:', 'Lo primero, imprescindible:']
    : index === total - 1
    ? ['Y el toque final:', 'Cerramos la lista con:', 'No puede faltar:']
    : ['Seguimos con:', 'Añadimos:', 'También necesitas:']

  const amount = describeAmount(ingredient)
  const label = ingredient.label ?? ingredient.name
  const note = ingredient.note ? `${capitalize(ingredient.note)}.` : ''

  const tips = [
    'Tenlo pesado y a mano antes de empezar.',
    'Sácalo de la nevera un rato antes si hace falta.',
    'La calidad de este ingrediente se nota en el resultado.',
    'No lo sustituyas a la ligera, aquí está la clave del sabor.',
    'Mide bien: en repostería y masas la precisión cuenta.',
  ]

  return `${pickUnique(openings, `${seed}-ing-open-${index}`, usedPhrases)} ${amount}${label}. ${note} ${pickUnique(tips, `${seed}-ing-tip-${index}`, usedPhrases)}`.replace(/\s+/g, ' ').trim()
}

function describeAmount(ingredient) {
  const unit = (ingredient.unit ?? '').toLowerCase()
  const amount = ingredient.amount ?? ''
  if (!amount) return ''
  if (/^(g|gramos?|kg|kilos?|ml|mililitros?|l|litros?)$/.test(unit)) return `${amount} ${unit} de `
  if (amount === '1' && unit) return `${/a$/.test(unit) ? 'una' : 'un'} ${unit} de `
  if (unit) return `${amount} ${unit} de `
  if (/^\d+$/.test(amount) && amount !== '1') return `${amount} `
  if (amount === '1') return 'un '
  if (amount === 'una') return 'una '
  return ''
}

/* -------------------------------------------------------------------------- */
/* PASOS - narración contextual por acción                                    */
/* -------------------------------------------------------------------------- */

function buildStepText(step, index, total, recipe, seed, usedPhrases) {
  const text = step.text.toLowerCase()
  const isFirst = index === 0
  const isLast = index === total - 1

  // Transición de apertura variada
  const transitions = isFirst
    ? ['Arrancamos.', 'Manos a la obra.', 'Empezamos fuerte.']
    : isLast
    ? ['Llegamos al paso final.', 'Último paso.', 'Rematamos.']
    : [
        'Continuamos.',
        'Avanzamos al siguiente paso.',
        'Seguimos con la elaboración.',
        'Pasamos a la siguiente fase.',
      ]

  const instruction = ensureSentence(step.text)

  // Tip de técnica específico a LO QUE SE HACE EN ESTE PASO
  const technique = buildContextualTechnique(text, index, seed, usedPhrases)

  // Comentario sensorial/observación relevante
  const observation = buildContextualObservation(text, index, seed, usedPhrases)

  const parts = [
    pickUnique(transitions, `${seed}-trans-${index}`, usedPhrases),
    instruction,
    technique,
    observation,
  ].filter(Boolean)

  return parts.join(' ')
}

function buildContextualTechnique(text, index, seed, usedPhrases) {
  // Horneado
  if (/horno|hornea|gratin|mete.*horno|horneamos/.test(text)) {
    return pickUnique([
      'Horno precalentado: el choque térmico sella los jugos y dora parejo.',
      'No metas nada en horno frío: alarga la cocción y reseca.',
      'La temperatura exacta marca la diferencia entre dorado y quemado.',
    ], `${seed}-tech-oven-${index}`, usedPhrases)
  }

  // Sellado / sartén
  if (/sart[ée]n|sella|dora|fre[ií]r|sofre[ií]r|reho?ga/.test(text)) {
    return pickUnique([
      'Sartén bien caliente antes de echar la carne: así se sella y no suelta agua.',
      'No amontones piezas: necesitan espacio para dorar, no para cocerse en su jugo.',
      'Deja que coja color sin moverla; la costra es sabor.',
    ], `${seed}-tech-pan-${index}`, usedPhrases)
  }

  // Duxelles / setas / reducción
  if (/setas|champiñones|duxelle|reduc|evapora|secar|pasta/.test(text)) {
    return pickUnique([
      'Cocina las setas hasta que suelten toda el agua y empiecen a freírse en su grasa: ahí está el umami.',
      'La duxelles debe quedar casi seca, una pasta concentrada; si queda húmeda moja el hojaldre.',
      'Paciencia aquí: el agua de las setas tiene que evaporarse del todo.',
    ], `${seed}-tech-dux-${index}`, usedPhrases)
  }

  // Hojaldre / masa
  if (/hojaldre|masa|estir|extend|enrejad|cubrir.*masa|pincela/.test(text)) {
    return pickUnique([
      'Trabaja el hojaldre en frío: si se calienta la mantequilla, no sube en capas.',
      'Estira con movimientos firmes y suaves, sin amasar: las capas son la clave.',
      'Mantén la masa fría al horno: la mantequilla fría crea el hojaldrado.',
    ], `${seed}-tech-puff-${index}`, usedPhrases)
  }

  // Bridado / atado
  if (/brid|atad|bridamos/.test(text)) {
    return pickUnique([
      'Bridar mantiene la forma cilíndrica y evita que se aplaste al sellar.',
      'Hilo de cocina, nudos firmes pero no ahogados: la carne necesita expandirse.',
    ], `${seed}-tech-tie-${index}`, usedPhrases)
  }

  // Reposo
  if (/repos|descans|templ/.test(text)) {
    return pickUnique([
      'El reposo no es opcional: los jugos se redistribuyen y el corte sale limpio.',
      'Diez minutos de paciencia te evitan un charco en la tabla.',
    ], `${seed}-tech-rest-${index}`, usedPhrases)
  }

  // Mezcla / batido
  if (/batir|mezclar|integrar|homogen/.test(text)) {
    return pickUnique([
      'Integra con movimientos envolventes, sin batir: queremos aire, no gluten.',
      'Poco a poco, que la mezcla coja cuerpo sin cortarse.',
    ], `${seed}-tech-mix-${index}`, usedPhrases)
  }

  // Por defecto - consejo genérico pero útil
  return pickUnique([
    'Sigue el tiempo indicado, ni más ni menos: la receta está probada.',
    'Controla el fuego, no la prisa: cada cosa tiene su punto.',
  ], `${seed}-tech-gen-${index}`, usedPhrases)
}

function buildContextualObservation(text, index, seed, usedPhrases) {
  // Horneado final
  if (/horno|hornea|gratin|mete.*horno|horneamos/.test(text)) {
    return pickUnique([
      'El aroma te avisará cuando esté listo, pero confía en el tiempo.',
      'Verás burbujear los bordes y dorarse la superficie: es la señal.',
    ], `${seed}-obs-oven-${index}`, usedPhrases)
  }

  // Sartén / sellado
  if (/sart[ée]n|sella|dora|fre[ií]r|sofre[ií]r|reho?ga/.test(text)) {
    return pickUnique([
      'El chisporroteo te dice que la temperatura es la correcta.',
      'Cuando suelte sola de la sartén, ya está dorada.',
    ], `${seed}-obs-pan-${index}`, usedPhrases)
  }

  // Duxelles
  if (/setas|champiñones|duxelle|reduc|evapora|secar|pasta/.test(text)) {
    return pickUnique([
      'Verás cómo pasa de húmeda a una pasta densa y aromática.',
      'El olor a bosque inunda la cocina: vas por buen camino.',
    ], `${seed}-obs-dux-${index}`, usedPhrases)
  }

  // Hojaldre
  if (/hojaldre|masa|estir|extend|enrejad|cubrir.*masa|pincela/.test(text)) {
    return pickUnique([
      'La masa debe quedar fina pero sin romperse: transparenta ligeramente.',
      'El horno hará el resto: verás subir las capas y dorarse la superficie.',
    ], `${seed}-obs-puff-${index}`, usedPhrases)
  }

  // Reposo / final
  if (/repos|descans|serv|emplata/.test(text)) {
    return pickUnique([
      'El corte limpio y jugoso es la recompensa a la paciencia.',
      'Sirve caliente, que el contraste de texturas es lo mejor.',
    ], `${seed}-obs-rest-${index}`, usedPhrases)
  }

  // Observación genérica
  return pickUnique([
    'Aquí es donde la receta cobra forma.',
    'Fíjate en los detalles: marcan la diferencia.',
  ], `${seed}-obs-gen-${index}`, usedPhrases)
}

/* -------------------------------------------------------------------------- */
/* TRUCOS                                                                     */
/* -------------------------------------------------------------------------- */

function buildTipsText(recipe, seed, usedPhrases) {
  const tips = []
  const haystack = recipe.ingredients.map((i) => `${i.name} ${i.label ?? ''}`).join(' ').toLowerCase()

  if (/solomillo|ternera|carne/.test(haystack)) {
    tips.push('Saca la carne de la nevera 30 min antes: a temperatura ambiente se sella mejor y se cuece parejo.')
    tips.push('Usa termómetro: 50-52 °C para poco hecho, 55-57 °C al punto. El carryover cooking sube 2-3 °C en reposo.')
  }
  if (/hojaldre/.test(haystack)) {
    tips.push('Hojaldre siempre frío al horno: la mantequilla fría crea el hojaldrado; si está blando, no sube.')
    tips.push('Pincela con huevo batido + pizca de sal: el brillo sale más uniforme y la sal rompe la tensión superficial.')
  }
  if (/setas|champiñones|duxelle/.test(haystack)) {
    tips.push('Seca bien las setas antes de picarlas: agua extra = duxelles aguada = hojaldre mojado.')
    tips.push('Congela la duxelles en porciones: la tienes lista para el siguiente Wellington.')
  }
  if (/chalota|cebolla/.test(haystack)) {
    tips.push('Pica chalotas finitas: se funden en la duxelles sin notar trozos.')
  }
  if (/vino|jerez|brandy/.test(haystack)) {
    tips.push('Alcohol al final de la duxelles: evapora el alcohol y concentra el aroma sin amargar.')
  }

  // Tips genéricos si no hay específicos
  if (tips.length < 3) {
    tips.push('Prepara todo (mise en place) antes de encender fuegos: cocinar con calma evita errores.')
    tips.push('Horno precalentado de verdad: 15-20 min antes, no cuando metes la bandeja.')
    tips.push('Cuchillo afilado para el corte final: limpios los bordes, bonita la presentación.')
  }

  const intro = pickUnique([
    'Antes de irme, tres claves que marcan la diferencia entre "bueno" y "espectacular".',
    'Trucos de cocina que no te cuentan en la receta escrita pero sí te explico yo.',
    'Pequeños gestos, gran resultado: apunta estos tres.',
  ], `${seed}-tips-intro`, usedPhrases)

  return `${intro} ${tips.slice(0, 3).join(' ')}`
}

/* -------------------------------------------------------------------------- */
/* OUTRO - con CTA obligatorio                                                */
/* -------------------------------------------------------------------------- */

function buildOutroText(recipe, { tone, channel, usedPhrases, seed }) {
  const channelName = channel ? `Aquí, en ${channel}, ` : ''
  const dish = capitalize(recipe.title)

  const cta = pickUnique([
    `${channelName}déjame un like si te ha servido y suscríbete para no perderte la siguiente receta.`,
    `${channelName}si te ha gustado, dale a like y suscríbete: cada semana una receta nueva.`,
    `${channelName}suscríbete y activa la campanita para no perderte nada.`,
  ], `${seed}-cta`, usedPhrases)

  const closers = {
    cercano: `Y hasta aquí ${dish}. Si lo preparas, cuéntame en los comentarios cómo te quedó. ${cta}`,
    divertido: `Y esto es todo con ${dish}: presencia de restaurante, esfuerzo de casa. ${capitalize(`${channelName}nos vemos en la próxima.`)}`,
    elegante: `Con esto tienes ${recipe.title.toLowerCase()} resuelto. ${capitalize(`${channelName}si te ha gustado, suscríbete: cada semana un plato explicado con calma.`)}`,
    directo: `Listo. ${dish} terminado. ${capitalize(`${channelName}suscríbete si quieres más recetas así.`)}`,
  }

  return closers[tone] ?? closers.cercano
}

/* -------------------------------------------------------------------------- */
/* ESCENAS EXTRA (para llegar a duración mínima)                              */
/* -------------------------------------------------------------------------- */

function buildExtraScenes(recipe, seed, usedPhrases) {
  const dish = recipe.title.toLowerCase()
  return [
    {
      kind: 'context',
      heading: 'Contexto',
      narration: pickUnique([
        `${capitalize(dish)} brilla solo, pero con un puré de patatas trufado o unas verduras al horno tienes menú de fiesta.`,
        `Acompaña ${dish} con una guarnición neutra: el protagonista es la carne.`,
      ], `${seed}-extra-ctx`, usedPhrases),
      imageHints: [{ type: 'dish' }],
      imageQueries: [`${dish} mesa`, 'plato principal guarnición'],
    },
    {
      kind: 'variation',
      heading: 'Variantes',
      narration: pickUnique([
        '¿Quieres darle tu toque? Cambia la duxelles por espinacas y queso azul, o añade foie gras en el centro para versión premium.',
        'Prueba con solomillo de cerdo ibérico: más jugoso, más económico, igual de lucido.',
      ], `${seed}-extra-var`, usedPhrases),
      imageHints: [{ type: 'dish' }],
      imageQueries: [`${dish} variante`, 'receta alternativa'],
    },
    {
      kind: 'context',
      heading: 'Conservación',
      narration: 'Si sobra (difícil), guárdalo en nevera tapado y recalienta 10 min a 160 °C: recupera el hojaldre sin secar la carne. Máximo 2 días.',
      imageHints: [{ type: 'dish' }],
      imageQueries: ['comida guardada', 'horno recalentar'],
    },
  ]
}

/* -------------------------------------------------------------------------- */
/* UTILIDADES                                                                 */
/* -------------------------------------------------------------------------- */

function pickUnique(pool, seed, used) {
  const start = pool.indexOf(pickBySeed(pool, seed))
  for (let offset = 0; offset < pool.length; offset += 1) {
    const candidate = pool[(start + offset) % pool.length]
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }
  return pool[start]
}

/** @param {string} text */
function ensureSentence(text) {
  const value = text.trim().replace(/\s+/g, ' ')
  if (!value) return ''
  const withStop = /[.!?…]$/.test(value) ? value : `${value}.`
  return capitalize(withEndingPunctuation(withStop))
}

/** @param {string} text */
function withEndingPunctuation(text) {
  return text.replace(/[.]{2,}/g, '.')
}

function buildStepQuery(text, title) {
  const words = text
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word.length > 4 && !STOPWORDS.has(word))
    .slice(0, 4)
  return [...words, title].join(' ')
}

const STOPWORDS = new Set(['para', 'como', 'cuando', 'donde', 'todos', 'todas', 'hasta', 'desde', 'sobre', 'entre', 'durante', 'después', 'antes', 'según', 'donde', 'queda', 'quede'])

/** Texto plano del guion, útil para revisar o pasarlo a otro sistema. @param {import('./index.js').Script} script */
export function scriptToPlainText(script) {
  return script.scenes
    .map((scene, index) => `[${String(index + 1).padStart(2, '0')}] ${scene.heading}\n${truncate(scene.narration, 5000)}\n`)
    .join('\n')
}