import path from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { ROOT } from '../config.js'
import { exists } from '../util/fsx.js'
import { run } from '../util/exec.js'

/**
 * Intérprete de Python con edge-tts instalado.
 * @returns {Promise<string>}
 */
export async function pythonExecutable() {
  const venv = path.join(ROOT, '.venv', 'bin', 'python')
  if (await exists(venv)) return venv
  return process.platform === 'win32' ? 'python' : 'python3'
}

/**
 * Sintetiza con el servicio neural de Microsoft Edge (sin clave).
 * Devuelve los límites de palabra reales del servicio.
 *
 * @param {{ text: string, outFile: string, wordsFile: string, voice: string, rate: string, pitch: string, volume: string }} options
 * @returns {Promise<Array<{ text: string, start: number, end: number }>>}
 */
export async function synthesizeEdge(options) {
  const { text, outFile, wordsFile, voice, rate, pitch, volume } = options
  const textFile = outFile.replace(/\.mp3$/, '.txt')
  await writeFile(textFile, text, 'utf8')

  const python = await pythonExecutable()
  const script = path.join(ROOT, 'scripts', 'edge_tts_bridge.py')
  try {
    await run(python, [
      script,
      '--text-file', textFile,
      '--voice', voice,
      '--out', outFile,
      '--words', wordsFile,
      '--rate', rate,
      '--pitch', pitch,
      '--volume', volume,
    ], { timeoutMs: 180000 })
  } catch (error) {
    throw new Error(`edge-tts falló. Comprueba la instalación con «./setup.sh».\n${error.message}`)
  }

  return readEdgeBoundariesFile(wordsFile)
}

/**
 * Lee un archivo de límites de palabra sin procesar y lo convierte a segundos.
 * @param {string} file
 * @returns {Promise<Array<{ text: string, start: number, end: number }>>}
 */
export async function readEdgeBoundariesFile(file) {
  const raw = JSON.parse(await readFile(file, 'utf8'))
  return raw.map((entry) => ({
    text: entry.text,
    start: entry.offset / 1e7,
    end: (entry.offset + entry.duration) / 1e7,
  }))
}

/**
 * Comprueba que edge-tts responde.
 * @returns {Promise<{ ok: boolean, detail: string }>}
 */
export async function checkEdgeTts() {
  const python = await pythonExecutable()
  const result = await run(python, ['-c', 'import edge_tts; print(edge_tts.__version__)'], { allowFailure: true })
  return { ok: result.code === 0, detail: result.code === 0 ? `edge-tts ${result.stdout.trim()}` : result.stderr.trim() }
}
