import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { lstat, realpath } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** A file name stays in one directory: no separators, reserved characters, controls, or edge dots and spaces. */
const UNSAFE_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f\u007f]/gu

/**
 * The one directory saves land in, relative to the Session's workspace root.
 * DSH loads nothing from it: skills come from `.dsh/skills` and
 * `.agents/skills`, configuration from the profile, and `.tmp/` is scratch.
 */
export const DOWNLOAD_DIRECTORY = '.tmp/downloads'
const MAX_NAME_ATTEMPTS = 1000
const WRITER_TIMEOUT_MS = 30_000

/**
 * Names DSH reads as agent instructions when a file tool touches their
 * directory. A download never takes one of these names.
 */
const INSTRUCTION_FILE_NAMES = new Set(['agents.md', 'claude.md', 'agents.local.md', 'claude.local.md'])

/** Reduce any candidate to one safe file name, or undefined when nothing usable remains. */
export function sanitizeFileName(value) {
  if (typeof value !== 'string') return undefined
  const name = value
    .replace(UNSAFE_NAME_CHARACTERS, '_')
    .replace(/^[.\s]+|[.\s]+$/gu, '')
    .slice(0, 200)
  if (name === '') return undefined
  return INSTRUCTION_FILE_NAMES.has(name.toLowerCase()) ? 'download-' + name : name
}

/** Whether a caller-supplied name is already a safe single file name. */
export function isSimpleFileName(value) {
  return typeof value === 'string' && value.length <= 200 && sanitizeFileName(value) === value
}

/** Read the file name a server proposes in Content-Disposition, preferring RFC 5987 filename*. */
export function fileNameFromDisposition(header) {
  if (typeof header !== 'string' || header === '') return undefined
  const extended = /filename\*\s*=\s*([^']*)'[^']*'([^;]+)/iu.exec(header)
  if (extended !== null) {
    try { return decodeURIComponent(extended[2].trim().replace(/^"|"$/gu, '')) } catch {}
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/iu.exec(header)
  if (plain !== null) return (plain[2] ?? plain[1]).trim()
  return undefined
}

/**
 * Pick the saved name: explicit name, then Content-Disposition, then the URL
 * path, then a fallback. A missing extension is added later from the content.
 */
export function chooseFileName({ requested, contentDisposition, url }) {
  let fromUrl
  try {
    const last = new URL(url).pathname.split('/').filter(Boolean).pop()
    if (last !== undefined) fromUrl = decodeURIComponent(last)
  } catch {}
  return sanitizeFileName(requested)
    ?? sanitizeFileName(fileNameFromDisposition(contentDisposition))
    ?? sanitizeFileName(fromUrl)
    ?? 'download'
}

/**
 * Creates the download directory. Runs confined to the workspace root, so a
 * symlink planted on the way cannot make it create directories elsewhere.
 */
const MKDIR_SCRIPT = `
const fs = require('node:fs')
fs.mkdirSync(process.argv[1], { recursive: true })
process.stdout.write(JSON.stringify({ ok: true }))
`

/**
 * Writes stdin to the first free name. Runs confined to the download
 * directory alone. It first checks that the directory it can write is the
 * very inode the plugin validated, so a directory swapped between that check
 * and the sandbox start is refused. 'wx' never overwrites and never follows a
 * planted symlink.
 */
const WRITE_SCRIPT = `
const fs = require('node:fs')
const path = require('node:path')
const [directory, expectedDev, expectedIno, fileName, maxAttempts] = process.argv.slice(1)
const fail = message => { process.stdout.write(JSON.stringify({ error: message })); process.exit(0) }
const info = fs.lstatSync(directory, { bigint: true })
if (!info.isDirectory() || String(info.dev) !== expectedDev || String(info.ino) !== expectedIno) {
  fail('The download directory changed while the file was being saved')
}
const chunks = []
process.stdin.on('data', chunk => chunks.push(chunk))
process.stdin.on('end', () => {
  const data = Buffer.concat(chunks)
  const extension = path.extname(fileName)
  const stem = extension === '' ? fileName : fileName.slice(0, -extension.length)
  for (let attempt = 0; attempt < Number(maxAttempts); attempt++) {
    const candidate = attempt === 0 ? fileName : stem + ' (' + String(attempt) + ')' + extension
    let fd
    try {
      fd = fs.openSync(path.join(directory, candidate), 'wx', 0o644)
    } catch (error) {
      if (error && error.code === 'EEXIST') continue
      fail('Could not create the file: ' + String(error && error.message || error))
    }
    try { fs.writeSync(fd, data) } finally { fs.closeSync(fd) }
    process.stdout.write(JSON.stringify({ name: candidate, bytes: data.length }))
    return
  }
  fail('Could not find a free file name for ' + fileName)
})
`

/**
 * Run one Node script under `ctx.sandbox` with `workspace-write` confined to
 * `root`. The sandbox provider enforces the boundary in the kernel or OS
 * (bwrap, Landlock, Seatbelt, or Windows ACLs) and fails closed when none is
 * usable.
 * @returns {Promise<object>} the JSON object the script printed.
 */
async function runConfined({ sandbox, root, sessionId, script, args, input, signal }) {
  const policy = { mode: 'workspace-write', workspaceRoot: root }
  if (sessionId !== undefined) policy.sessionId = sessionId
  const confined = await sandbox.confine([process.execPath, '-e', script, ...args], policy, signal)
  if (!Array.isArray(confined?.argv) || confined.argv.length === 0) {
    throw new Error('The DSH sandbox returned no command to run')
  }
  const [program, ...programArgs] = confined.argv
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(program, programArgs, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'], signal })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), WRITER_TIMEOUT_MS)
    child.stdout.setEncoding('utf8').on('data', chunk => { stdout += chunk })
    child.stderr.setEncoding('utf8').on('data', chunk => { if (stderr.length < 4096) stderr += chunk })
    child.on('error', error => { clearTimeout(timer); rejectPromise(error) })
    child.on('close', code => {
      clearTimeout(timer)
      let parsed
      try { parsed = JSON.parse(stdout) } catch {}
      if (code === 0 && parsed !== null && typeof parsed === 'object') {
        if (typeof parsed.error === 'string') rejectPromise(new Error(parsed.error))
        else resolvePromise(parsed)
        return
      }
      rejectPromise(new Error('The sandboxed file writer failed (exit ' + String(code) + ')' + (stderr.trim() === '' ? '' : ': ' + stderr.trim().slice(0, 500))))
    })
    child.stdin.on('error', () => {})
    child.stdin.end(input ?? Buffer.alloc(0))
  })
}

/**
 * Write downloaded bytes into `<workspaceRoot>/.tmp/downloads/`, the only
 * place saves can land. Both the directory creation and the file creation run
 * in processes the DSH sandbox confines: the first to the workspace root, the
 * second to the download directory alone, pinned to the inode validated here.
 * Never overwrites: an existing name gets a " (n)" suffix.
 * @param {object} input
 * @param {{ confine: Function }} input.sandbox - the DSH `ctx.sandbox` provider.
 * @param {string} input.workspaceRoot - absolute Session workspace root.
 * @param {string} input.cwd - absolute Session directory, for the reported relative path.
 * @param {string} [input.sessionId] - Session id, for per-session sandbox preparation.
 * @param {string} input.fileName - sanitized file name.
 * @param {Buffer} input.data - file bytes.
 * @param {AbortSignal} [input.signal]
 * @returns {Promise<{ path: string, relativePath: string, bytes: number, sha256: string }>}
 */
export async function saveWorkspaceFile({ sandbox, workspaceRoot, cwd, sessionId, fileName, data, signal }) {
  if (typeof sandbox?.confine !== 'function') {
    throw new Error('This DSH profile has no sandbox provider, so files cannot be saved into the workspace')
  }
  if (!isSimpleFileName(fileName)) throw new Error('The file name is invalid')
  const root = await realpath(workspaceRoot)
  const expectedDirectory = join(root, ...DOWNLOAD_DIRECTORY.split('/'))
  await runConfined({ sandbox, root, sessionId, script: MKDIR_SCRIPT, args: [expectedDirectory], signal })
  const directory = await realpath(expectedDirectory)
  if (directory !== expectedDirectory) {
    throw new Error('The download directory ' + DOWNLOAD_DIRECTORY + ' must not be a symlink')
  }
  const info = await lstat(directory, { bigint: true })
  if (!info.isDirectory()) throw new Error('The download directory is not a directory')
  const written = await runConfined({
    sandbox,
    root: directory,
    sessionId,
    script: WRITE_SCRIPT,
    args: [directory, String(info.dev), String(info.ino), fileName, String(MAX_NAME_ATTEMPTS)],
    input: data,
    signal,
  })
  if (typeof written.name !== 'string' || !isSimpleFileName(written.name) || written.bytes !== data.length) {
    throw new Error('The sandboxed file writer returned an invalid result')
  }
  const path = join(directory, written.name)
  let relativeBase = cwd
  try { relativeBase = await realpath(cwd) } catch {}
  return {
    path,
    relativePath: relative(relativeBase, path).split(sep).join('/'),
    bytes: data.length,
    sha256: createHash('sha256').update(data).digest('hex'),
  }
}
