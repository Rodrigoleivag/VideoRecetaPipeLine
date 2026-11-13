import { mkdir, readFile, writeFile, stat, access } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'

/** Crea el directorio (y sus padres) si no existe. @param {string} dir */
export async function ensureDir(dir) {
  await mkdir(dir, { recursive: true })
  return dir
}

/** @param {string} file */
export async function exists(file) {
  try {
    await access(file)
    return true
  } catch {
    return false
  }
}

/** @param {string} file */
export async function isFile(file) {
  try {
    return (await stat(file)).isFile()
  } catch {
    return false
  }
}

/** @param {string} file */
export async function readJson(file) {
  return JSON.parse(await readFile(file, 'utf8'))
}

/** Escribe JSON legible y crea el directorio destino. @param {string} file @param {unknown} data */
export async function writeJson(file, data) {
  await ensureDir(path.dirname(file))
  await writeFile(file, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  return file
}

/** @param {string} value */
export function hash(value) {
  return createHash('sha1').update(value).digest('hex').slice(0, 16)
}
