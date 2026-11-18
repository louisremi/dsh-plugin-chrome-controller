import { createHash } from 'node:crypto'
import { mkdir, open, realpath } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'

/** A file name stays in one directory: no separators, reserved characters, controls, or edge dots and spaces. */
const UNSAFE_NAME_CHARACTERS = /[\\/:*?"<>|\u0000-\u001f\u007f]/gu

const DEFAULT_DOWNLOAD_DIRECTORY = '.tmp/downloads'
const MAX_NAME_ATTEMPTS = 1000

/** Whether `child` is `parent` or lies below it, both absolute and canonical. */
function isInside(parent, child) {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

/** Canonical form of `path`, resolving its longest existing prefix and appending the missing rest. */
async function canonicalizeExistingPrefix(path) {
  const missing = []
  let current = path
  for (;;) {
    try {
      return join(await realpath(current), ...missing.reverse())
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      const parent = dirname(current)
      if (parent === current) throw error
      missing.push(basename(current))
      current = parent
    }
  }
}

/** Reduce any candidate to one safe file name, or undefined when nothing usable remains. */
export function sanitizeFileName(value) {
  if (typeof value !== 'string') return undefined
  const name = value
    .replace(UNSAFE_NAME_CHARACTERS, '_')
    .replace(/^[.\s]+|[.\s]+$/gu, '')
    .slice(0, 200)
  return name === '' ? undefined : name
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
 * Write downloaded bytes inside the Session's writable directories.
 * Never overwrites: an existing name gets a " (n)" suffix.
 * @param {object} input
 * @param {string[]} input.writableRoots - absolute directories writes must stay inside.
 * @param {string} input.cwd - absolute directory relative paths resolve against.
 * @param {string | undefined} input.directory - destination directory, relative to cwd or absolute.
 * @param {string} input.fileName - sanitized file name.
 * @param {Buffer} input.data - file bytes.
 * @returns {Promise<{ path: string, relativePath: string, bytes: number, sha256: string }>}
 */
export async function saveWorkspaceFile({ writableRoots, cwd, directory, fileName, data }) {
  if (!Array.isArray(writableRoots) || writableRoots.length === 0 || !writableRoots.every(isAbsolute) || !isAbsolute(cwd)) {
    throw new Error('The workspace directories must be absolute')
  }
  if (!isSimpleFileName(fileName)) throw new Error('The file name is invalid')
  const roots = await Promise.all(writableRoots.map(root => realpath(root)))
  const insideWritableRoot = path => roots.some(root => isInside(root, path))
  const canonicalCwd = await realpath(cwd)
  const requestedDirectory = resolve(canonicalCwd, directory ?? DEFAULT_DOWNLOAD_DIRECTORY)
  // Canonicalize the existing prefix before creating anything, so a symlink
  // inside the workspace cannot make mkdir create directories elsewhere.
  if (!insideWritableRoot(await canonicalizeExistingPrefix(requestedDirectory))) {
    throw new Error('The download directory must be inside the session workspace')
  }
  await mkdir(requestedDirectory, { recursive: true })
  // Canonicalize after creation so a symlinked directory cannot redirect the write.
  const targetDirectory = await realpath(requestedDirectory)
  if (!insideWritableRoot(targetDirectory)) throw new Error('The download directory must be inside the session workspace')
  const extension = extname(fileName)
  const stem = extension === '' ? fileName : fileName.slice(0, -extension.length)
  for (let attempt = 0; attempt < MAX_NAME_ATTEMPTS; attempt++) {
    const candidate = attempt === 0 ? fileName : stem + ' (' + String(attempt) + ')' + extension
    const path = join(targetDirectory, candidate)
    let handle
    try {
      // 'wx' fails on any existing entry, including a planted symlink.
      handle = await open(path, 'wx', 0o644)
    } catch (error) {
      if (error?.code === 'EEXIST') continue
      throw error
    }
    try {
      await handle.writeFile(data)
    } finally {
      await handle.close()
    }
    return {
      path,
      relativePath: relative(canonicalCwd, path).split(sep).join('/'),
      bytes: data.length,
      sha256: createHash('sha256').update(data).digest('hex'),
    }
  }
  throw new Error('Could not find a free file name for ' + fileName + ' in ' + targetDirectory)
}
