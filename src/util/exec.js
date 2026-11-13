import { spawn } from 'node:child_process'

/**
 * Ejecuta un proceso y resuelve con su salida.
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, input?: string, timeoutMs?: number, allowFailure?: boolean }} [options]
 * @returns {Promise<{ stdout: string, stderr: string, code: number }>}
 */
export function run(command, args, options = {}) {
  const { cwd, input, timeoutMs = 0, allowFailure = false } = options
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    let timer
    if (timeoutMs > 0) {
      timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    }
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (code !== 0 && !allowFailure) {
        const tail = stderr.trim().split('\n').slice(-12).join('\n')
        reject(new Error(`${command} ${args.slice(0, 6).join(' ')} falló (código ${code})\n${tail}`))
        return
      }
      resolve({ stdout, stderr, code })
    })
    if (input !== undefined) child.stdin.end(input)
    else child.stdin.end()
  })
}

/**
 * Ejecuta ffmpeg con los argumentos indicados.
 * @param {string[]} args
 * @param {{ cwd?: string, allowFailure?: boolean }} [options]
 */
export async function ffmpeg(args, options = {}) {
  return run('ffmpeg', ['-hide_banner', '-nostdin', '-y', ...args], options)
}

/**
 * Comprueba si un ejecutable existe en el PATH.
 * @param {string} name
 * @returns {Promise<boolean>}
 */
export async function hasCommand(name) {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  try {
    const { code } = await run(probe, [name], { allowFailure: true })
    return code === 0
  } catch {
    return false
  }
}

/**
 * Duración de un archivo multimedia en segundos.
 * @param {string} file
 * @returns {Promise<number>}
 */
export async function mediaDuration(file) {
  const { stdout } = await run('ffprobe', [
    '-v', 'error',
    '-show_entries', 'format=duration',
    '-of', 'default=noprint_wrappers=1:nokey=1',
    file,
  ])
  const value = Number.parseFloat(stdout.trim())
  if (!Number.isFinite(value)) throw new Error(`No se pudo leer la duración de ${file}`)
  return value
}
