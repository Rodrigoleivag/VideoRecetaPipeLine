import { writeFile } from 'node:fs/promises'
import { ensureDir, exists } from './fsx.js'

const USER_AGENT = 'VideoRecetaPipeline/0.1 (+https://github.com; contacto: canal de recetas)'

/**
 * Petición HTTP con reintentos y timeout.
 * @param {string} url
 * @param {{ timeoutMs?: number, retries?: number, headers?: Record<string, string>, method?: string, body?: string }} [options]
 * @returns {Promise<Response>}
 */
export async function request(url, options = {}) {
  const { timeoutMs = 25000, retries = 2, headers = {}, method = 'GET', body } = options
  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        method,
        body,
        redirect: 'follow',
        headers: {
          'user-agent': USER_AGENT,
          'accept-language': 'es-ES,es;q=0.9,en;q=0.8',
          ...headers,
        },
        signal: AbortSignal.timeout(timeoutMs),
      })
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} en ${url}`)
      }
      return response
    } catch (error) {
      lastError = error
      if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 600 * (attempt + 1)))
    }
  }
  throw lastError
}

/**
 * Descarga texto.
 * @param {string} url
 * @param {{ timeoutMs?: number, headers?: Record<string, string> }} [options]
 */
export async function fetchText(url, options = {}) {
  const response = await request(url, options)
  return response.text()
}

/**
 * Descarga y parsea JSON.
 * @param {string} url
 * @param {{ timeoutMs?: number, headers?: Record<string, string> }} [options]
 */
export async function fetchJson(url, options = {}) {
  const response = await request(url, options)
  const text = await response.text()
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`Respuesta no JSON de ${url}: ${text.slice(0, 120)}`)
  }
}

/**
 * Descarga un archivo binario con caché en disco.
 * @param {string} url
 * @param {string} dest
 * @param {{ force?: boolean, timeoutMs?: number, headers?: Record<string, string> }} [options]
 * @returns {Promise<string>}
 */
export async function download(url, dest, options = {}) {
  const { force = false, timeoutMs = 60000, headers = {} } = options
  if (!force && (await exists(dest))) return dest
  await ensureDir(dest.slice(0, dest.lastIndexOf('/')) || '.')
  const response = await request(url, { timeoutMs, retries: 1, headers })
  const buffer = Buffer.from(await response.arrayBuffer())
  if (buffer.length === 0) throw new Error(`Descarga vacía: ${url}`)
  await writeFile(dest, buffer)
  return dest
}
