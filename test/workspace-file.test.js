import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { chooseFileName, fileNameFromDisposition, sanitizeFileName, saveWorkspaceFile } from '../lib/workspace-file.js'

describe('file name selection', () => {
  it('prefers RFC 5987 filename* over filename', () => {
    assert.equal(fileNameFromDisposition('attachment; filename="plain.pdf"; filename*=UTF-8\'\'facture%20n%C2%B01.pdf'), 'facture n°1.pdf')
    assert.equal(fileNameFromDisposition('attachment; filename="invoice 42.pdf"'), 'invoice 42.pdf')
    assert.equal(fileNameFromDisposition('inline'), undefined)
  })

  it('strips path separators, control characters, and leading dots', () => {
    assert.equal(sanitizeFileName('../../etc/passwd'), '_.._etc_passwd')
    assert.equal(sanitizeFileName('..'), undefined)
    assert.equal(sanitizeFileName('a\u0000b:c.pdf'), 'a_b_c.pdf')
  })

  it('falls back from the explicit name to the header, the URL, then a default', () => {
    assert.equal(chooseFileName({ requested: 'mine.pdf', contentDisposition: 'attachment; filename="x.pdf"', url: 'https://e.test/y.pdf' }), 'mine.pdf')
    assert.equal(chooseFileName({ contentDisposition: 'attachment; filename="x.pdf"', url: 'https://e.test/y.pdf' }), 'x.pdf')
    assert.equal(chooseFileName({ url: 'https://e.test/docs/y%20z.pdf?sig=1' }), 'y z.pdf')
    assert.equal(chooseFileName({ url: 'https://e.test/', contentType: 'application/pdf; charset=binary' }), 'download.pdf')
    assert.equal(chooseFileName({ url: 'https://e.test/invoice', contentType: 'application/pdf' }), 'invoice.pdf')
  })
})

describe('saveWorkspaceFile', () => {
  let root
  let outside

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-chrome-ws-')))
    outside = await realpath(await mkdtemp(join(tmpdir(), 'dsh-chrome-out-')))
  })

  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
    await rm(outside, { recursive: true, force: true })
  })

  it('writes into .tmp/downloads/ by default and reports a cwd-relative path', async () => {
    const data = Buffer.from('%PDF-1.7 test')
    const saved = await saveWorkspaceFile({ workspaceRoot: root, cwd: root, fileName: 'a.pdf', data })
    assert.equal(saved.path, join(root, '.tmp', 'downloads', 'a.pdf'))
    assert.equal(saved.relativePath, '.tmp/downloads/a.pdf')
    assert.equal(saved.bytes, data.length)
    assert.match(saved.sha256, /^[0-9a-f]{64}$/u)
    assert.deepEqual(await readFile(saved.path), data)
  })

  it('never overwrites: a second save gets a numbered name', async () => {
    const first = await saveWorkspaceFile({ workspaceRoot: root, cwd: root, directory: 'invoices', fileName: 'a.pdf', data: Buffer.from('1') })
    const second = await saveWorkspaceFile({ workspaceRoot: root, cwd: root, directory: 'invoices', fileName: 'a.pdf', data: Buffer.from('2') })
    assert.equal(second.path, join(root, 'invoices', 'a (1).pdf'))
    assert.equal(await readFile(first.path, 'utf8'), '1')
    assert.equal(await readFile(second.path, 'utf8'), '2')
  })

  it('resolves relative directories against the current directory', async () => {
    const cwd = join(root, 'project')
    await mkdir(cwd)
    const saved = await saveWorkspaceFile({ workspaceRoot: root, cwd, directory: '../shared', fileName: 'a.pdf', data: Buffer.from('x') })
    assert.equal(saved.path, join(root, 'shared', 'a.pdf'))
  })

  it('rejects directories outside the workspace', async () => {
    await assert.rejects(
      saveWorkspaceFile({ workspaceRoot: root, cwd: root, directory: outside, fileName: 'a.pdf', data: Buffer.from('x') }),
      /inside the session workspace/u)
    await assert.rejects(
      saveWorkspaceFile({ workspaceRoot: root, cwd: root, directory: '../escape', fileName: 'a.pdf', data: Buffer.from('x') }),
      /inside the session workspace/u)
  })

  it('rejects a symlinked directory that points outside, without creating anything there', async () => {
    await symlink(outside, join(root, 'link'))
    await assert.rejects(
      saveWorkspaceFile({ workspaceRoot: root, cwd: root, directory: 'link/new', fileName: 'a.pdf', data: Buffer.from('x') }),
      /inside the session workspace/u)
    await assert.rejects(readFile(join(outside, 'new', 'a.pdf')))
    await assert.rejects(realpath(join(outside, 'new')))
  })

  it('does not follow a planted symlink at the target name', async () => {
    await mkdir(join(root, '.tmp', 'downloads'), { recursive: true })
    await writeFile(join(outside, 'victim'), 'keep')
    await symlink(join(outside, 'victim'), join(root, '.tmp', 'downloads', 'a.pdf'))
    const saved = await saveWorkspaceFile({ workspaceRoot: root, cwd: root, fileName: 'a.pdf', data: Buffer.from('x') })
    assert.equal(saved.path, join(root, '.tmp', 'downloads', 'a (1).pdf'))
    assert.equal(await readFile(join(outside, 'victim'), 'utf8'), 'keep')
  })

  it('rejects unsafe file names', async () => {
    await assert.rejects(
      saveWorkspaceFile({ workspaceRoot: root, cwd: root, fileName: '../a.pdf', data: Buffer.from('x') }),
      /file name is invalid/u)
  })
})
