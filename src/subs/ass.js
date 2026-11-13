import { escapeAss, assTime } from '../util/text.js'

/**
 * Genera un archivo ASS con resaltado palabra a palabra: la palabra que suena
 * va en verde y el resto de la frase en blanco. Cada palabra es un evento con
 * los mismos saltos de línea, así el texto no se mueve al cambiar el color.
 *
 * @param {ReturnType<import('./timeline.js').buildTimeline>} timeline
 * @param {import('../config.js').PipelineConfig} config
 * @param {{ fontFamily?: string }} [options]
 * @returns {{ content: string, captions: number, events: number }}
 */
export function buildAss(timeline, config, options = {}) {
  const style = { ...config.subtitles, font: options.fontFamily ?? config.subtitles.font }
  const header = buildHeader(style, config)
  const blocks = []

  for (const scene of timeline.scenes) {
    const captions = groupCaptions(scene.words, style)
    captions.forEach((caption, index) => {
      blocks.push(renderCaption(caption, style, captions[index + 1]?.words[0]?.start))
    })
  }

  return {
    content: `${header}\n${blocks.join('\n')}\n`,
    captions: blocks.length,
    events: blocks.reduce((sum, block) => sum + (block.match(/^Dialogue:/gm)?.length ?? 0), 0),
  }
}

/**
 * @param {any} style
 * @param {import('../config.js').PipelineConfig} config
 */
function buildHeader(style, config) {
  const { width, height } = config.video
  return `[Script Info]
; Subtítulos karaoke generados por VideoRecetaPipeLine
ScriptType: v4.00+
PlayResX: ${width}
PlayResY: ${height}
WrapStyle: 2
ScaledBorderAndShadow: yes
YCbCr Matrix: TV.709

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Caption,${style.font},${style.fontSize},${style.primaryColour},${style.highlightColour},${style.outlineColour},${style.backColour},-1,0,0,0,100,100,0.6,0,1,${style.outline},${style.shadow},2,${style.marginLR},${style.marginLR},${style.marginV},1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text`
}

/**
 * Agrupa palabras en bloques de como máximo N líneas legibles.
 * @param {Array<{ text: string, start: number, end: number }>} words
 * @param {any} style
 */
function groupCaptions(words, style) {
  const maxChars = style.maxCharsPerLine ?? 38
  const maxLines = style.maxLines ?? 2
  const limit = maxChars * maxLines
  const blocks = []
  let current = []
  let length = 0

  for (const word of words) {
    const addition = word.text.length + 1
    const endsSentence = /[.!?…]$/.test(word.text)
    const overflow = current.length > 0 && length + addition > limit
    if (overflow) {
      blocks.push(current)
      current = []
      length = 0
    }
    current.push(word)
    length += addition
    if (endsSentence && length > maxChars * 0.55) {
      blocks.push(current)
      current = []
      length = 0
    }
  }
  if (current.length > 0) blocks.push(current)

  return blocks.map((block) => ({ words: block, lines: splitLines(block, maxChars) }))
}

/**
 * Reparte las palabras en líneas sin cortar palabras.
 * @param {Array<{ text: string }>} words
 * @param {number} maxChars
 */
function splitLines(words, maxChars) {
  const lines = [[]]
  let length = 0
  for (const word of words) {
    const addition = word.text.length + (lines[lines.length - 1].length > 0 ? 1 : 0)
    if (length + addition > maxChars && lines[lines.length - 1].length > 0) {
      lines.push([])
      length = 0
    }
    lines[lines.length - 1].push(word)
    length += word.text.length + 1
  }
  return lines.filter((line) => line.length > 0)
}

/**
 * Crea un evento por palabra con esa palabra resaltada.
 * @param {{ words: Array<{ text: string, start: number, end: number }>, lines: Array<Array<{ text: string }>> }} caption
 * @param {any} style
 * @param {number} [nextBlockStart] inicio del bloque siguiente, para no solaparlo
 */
function renderCaption(caption, style, nextBlockStart) {
  const events = []
  const flat = caption.words
  for (let index = 0; index < flat.length; index += 1) {
    const word = flat[index]
    const next = flat[index + 1]
    const start = word.start
    // El evento termina justo cuando empieza la palabra siguiente: alargarlo
    // por debajo de ese instante solaparía dos resaltados en el mismo fotograma.
    const hold = style.maxGapToHold ?? 0.28
    const held = Math.max(word.end + hold, start + 0.3)
    const end = next ? next.start : Math.min(held, nextBlockStart ?? held)
    if (end <= start) continue

    let cursor = 0
    const text = caption.lines
      .map((line) => line
        .map((lineWord) => {
          const isCurrent = cursor === index
          cursor += 1
          const safe = escapeAss(lineWord.text)
          if (!isCurrent) return safe
          return `{\\c${style.highlightColour}}${safe}{\\c${style.primaryColour}}`
        })
        .join(' '))
      .join('\\N')

    events.push(`Dialogue: 0,${assTime(start)},${assTime(end)},Caption,,0,0,0,,${text}`)
  }
  return events.join('\n')
}
