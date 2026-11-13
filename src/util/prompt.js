import readline from 'node:readline/promises'

/**
 * Pregunta por consola y devuelve la respuesta.
 * @param {string} question
 */
export async function ask(question) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout })
  try {
    return (await rl.question(question)).trim()
  } finally {
    rl.close()
  }
}

/**
 * Confirmación sí/no.
 * @param {string} question
 * @param {boolean} [fallback]
 */
export async function confirm(question, fallback = false) {
  const answer = (await ask(`${question} ${fallback ? '[S/n]' : '[s/N]'} `)).toLowerCase()
  if (!answer) return fallback
  return answer.startsWith('s') || answer.startsWith('y')
}
