const COLORS = {
  reset: '\u001b[0m',
  dim: '\u001b[2m',
  bold: '\u001b[1m',
  red: '\u001b[31m',
  green: '\u001b[32m',
  yellow: '\u001b[33m',
  blue: '\u001b[34m',
  magenta: '\u001b[35m',
  cyan: '\u001b[36m',
}

const useColor = process.stdout.isTTY && !process.env.NO_COLOR

function paint(color, text) {
  return useColor ? `${COLORS[color]}${text}${COLORS.reset}` : text
}

/** Encabezado de etapa del pipeline. */
export function stage(title) {
  console.log(`\n${paint('bold', paint('magenta', '▶ ' + title))}`)
}

/** Mensaje informativo. */
export function info(message) {
  console.log(`  ${message}`)
}

/** Detalle tenue, solo con --verbose. */
export function debug(message) {
  if (process.env.VOICERECETA_VERBOSE) console.log(paint('dim', `  · ${message}`))
}

/** Advertencia recuperable. */
export function warn(message) {
  console.warn(`  ${paint('yellow', '⚠')} ${message}`)
}

/** Paso completado. */
export function ok(message) {
  console.log(`  ${paint('green', '✓')} ${message}`)
}

/** Error fatal (no lanza; el llamador decide). */
export function fail(message) {
  console.error(`  ${paint('red', '✗')} ${message}`)
}

/** Cronómetro simple para medir etapas. */
export function timer() {
  const start = Date.now()
  return () => `${((Date.now() - start) / 1000).toFixed(1)}s`
}
