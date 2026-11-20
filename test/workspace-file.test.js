import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { chooseFileName, fileNameFromDisposition, isSimpleFileName, sanitizeFileName, saveWorkspaceFile } from '../lib/workspace-file.js'

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

  it('renames files DSH would read as agent instructions', () => {
    assert.equal(sanitizeFileName('AGENTS.md'), 'download-AGENTS.md')
    assert.equal(sanitizeFileName('claude.local.md'), 'download-claude.local.md')
    assert.equal(isSimpleFileName('CLAUDE.md'), false)
    assert.equal(chooseFileName({ url: 'https://e.test/AGENTS.md' }), 'download-AGENTS.md')
  })

  it('accepts only names that are already safe', () => {
    assert.equal(isSimpleFileName('Invoice 42.pdf'), true)
    for (const name of ['', '.', '..', 'a.', ' a', 'a/b', 'a\\b', 'a\u0001', 'x'.repeat(201)]) {
      assert.equal(isSimpleFileName(name), false, JSON.stringify(name))
    }
  })

  it('falls back from the explicit name to the header, the URL, then a default', () => {
    assert.equal(chooseFileName({ requested: 'mine.pdf', contentDisposition: 'attachment; filename="x.pdf"', url: 'https://e.test/y.pdf' }), 'mine.pdf')
    assert.equal(chooseFileName({ contentDisposition: 'attachment; filename="x.pdf"', url: 'https://e.test/y.pdf' }), 'x.pdf')
    assert.equal(chooseFileName({ url: 'https://e.test/docs/y%20z.pdf?sig=1' }), 'y z.pdf')
    assert.equal(chooseFileName({ url: 'https://e.test/' }), 'download')
    assert.equal(chooseFileName({ url: 'https://e.test/invoice' }), 'invoice')
  })
})

/** A sandbox that runs the command unconfined, recording each policy. */
function passthroughSandbox() {
  const policies = []
  return {
    policies,
    async confine(argv, policy) {
      policies.push(policy)
      return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] }
    },
  }
}

const hasBwrap = spawnSync('bwrap', ['--ro-bind', '/', '/', '--dev', '/dev', 'true']).status === 0

/** A bwrap sandbox shaped like DSH's: read-only host, the workspace root writable. */
function bwrapSandbox(beforeConfine = async () => {}) {
  return {
    async confine(argv, policy) {
      await beforeConfine(policy)
      return {
        argv: ['bwrap', '--ro-bind', '/', '/', '--dev', '/dev', '--bind', policy.workspaceRoot, policy.workspaceRoot, '--', ...argv],
        enforcement: 'full',
        denialSignatures: [],
        runnerFailureRules: [],
      }
    },
  }
}

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

  it('writes into .tmp/downloads/ through the sandbox, confined first to the workspace, then to the download directory', async () => {
    const sandbox = passthroughSandbox()
    const data = Buffer.from('%PDF-1.7 test')
    const saved = await saveWorkspaceFile({ sandbox, workspaceRoot: root, cwd: root, sessionId: 's1', fileName: 'a.pdf', data })
    assert.equal(saved.path, join(root, '.tmp', 'downloads', 'a.pdf'))
    assert.equal(saved.relativePath, '.tmp/downloads/a.pdf')
    assert.equal(saved.bytes, data.length)
    assert.match(saved.sha256, /^[0-9a-f]{64}$/u)
    assert.deepEqual(await readFile(saved.path), data)
    assert.deepEqual(sandbox.policies, [
      { mode: 'workspace-write', workspaceRoot: root, sessionId: 's1' },
      { mode: 'workspace-write', workspaceRoot: join(root, '.tmp', 'downloads'), sessionId: 's1' },
    ])
  })

  it('never overwrites: a second save gets a numbered name', async () => {
    const sandbox = passthroughSandbox()
    const first = await saveWorkspaceFile({ sandbox, workspaceRoot: root, cwd: root, fileName: 'a.pdf', data: Buffer.from('1') })
    const second = await saveWorkspaceFile({ sandbox, workspaceRoot: root, cwd: root, fileName: 'a.pdf', data: Buffer.from('2') })
    assert.equal(second.path, join(root, '.tmp', 'downloads', 'a (1).pdf'))
    assert.equal(await readFile(first.path, 'utf8'), '1')
    assert.equal(await readFile(second.path, 'utf8'), '2')
  })

  it('anchors at the workspace root and reports the path relative to the current directory', async () => {
    const cwd = join(root, 'project')
    await mkdir(cwd)
    const saved = await saveWorkspaceFile({ sandbox: passthroughSandbox(), workspaceRoot: root, cwd, fileName: 'a.pdf', data: Buffer.from('x') })
    assert.equal(saved.path, join(root, '.tmp', 'downloads', 'a.pdf'))
    assert.equal(saved.relativePath, '../.tmp/downloads/a.pdf')
  })

  it('refuses a download directory that is a symlink, and writes nothing through it', async () => {
    await mkdir(join(root, '.tmp'))
    await symlink(outside, join(root, '.tmp', 'downloads'))
    await assert.rejects(
      saveWorkspaceFile({ sandbox: passthroughSandbox(), workspaceRoot: root, cwd: root, fileName: 'a.pdf', data: Buffer.from('x') }),
      /must not be a symlink/u)
    assert.deepEqual(await readdir(outside), [])
  })

  it('does not follow a planted symlink at the target name', async () => {
    await mkdir(join(root, '.tmp', 'downloads'), { recursive: true })
    await writeFile(join(outside, 'victim'), 'keep')
    await symlink(join(outside, 'victim'), join(root, '.tmp', 'downloads', 'a.pdf'))
    const saved = await saveWorkspaceFile({ sandbox: passthroughSandbox(), workspaceRoot: root, cwd: root, fileName: 'a.pdf', data: Buffer.from('x') })
    assert.equal(saved.path, join(root, '.tmp', 'downloads', 'a (1).pdf'))
    assert.equal(await readFile(join(outside, 'victim'), 'utf8'), 'keep')
  })

  it('fails closed without a sandbox provider, and when the sandbox cannot confine', async () => {
    await assert.rejects(
      saveWorkspaceFile({ workspaceRoot: root, cwd: root, fileName: 'a.pdf', data: Buffer.from('x') }),
      /no sandbox provider/u)
    const unavailable = { async confine() { throw Object.assign(new Error('sandbox unavailable'), { code: 'SANDBOX_UNAVAILABLE' }) } }
    await assert.rejects(
      saveWorkspaceFile({ sandbox: unavailable, workspaceRoot: root, cwd: root, fileName: 'a.pdf', data: Buffer.from('x') }),
      /sandbox unavailable/u)
    await assert.rejects(readdir(join(root, '.tmp')), { code: 'ENOENT' })
  })

  it('rejects unsafe file names', async () => {
    await assert.rejects(
      saveWorkspaceFile({ sandbox: passthroughSandbox(), workspaceRoot: root, cwd: root, fileName: '../a.pdf', data: Buffer.from('x') }),
      /file name is invalid/u)
  })

  it('writes under a real bwrap sandbox', { skip: !hasBwrap && 'bwrap is not usable here' }, async () => {
    const saved = await saveWorkspaceFile({ sandbox: bwrapSandbox(), workspaceRoot: root, cwd: root, fileName: 'a.pdf', data: Buffer.from('%PDF-1.4 x') })
    assert.equal(await readFile(saved.path, 'utf8'), '%PDF-1.4 x')
  })

  it('refuses a download directory swapped for a symlink after it was checked', { skip: !hasBwrap && 'bwrap is not usable here' }, async () => {
    const downloads = join(root, '.tmp', 'downloads')
    // Swap the directory between the plugin's check and the writer's sandbox start.
    const sandbox = bwrapSandbox(async policy => {
      if (policy.workspaceRoot !== downloads) return
      await rename(downloads, join(root, '.tmp', 'moved'))
      await symlink(outside, downloads)
    })
    // bwrap itself refuses to bind a symlink; the writer never starts.
    await assert.rejects(
      saveWorkspaceFile({ sandbox, workspaceRoot: root, cwd: root, fileName: 'a.pdf', data: Buffer.from('x') }),
      /symlink|download directory changed/u)
    assert.deepEqual(await readdir(outside), [])
  })

  it('refuses a download directory replaced by another directory after it was checked', { skip: !hasBwrap && 'bwrap is not usable here' }, async () => {
    const downloads = join(root, '.tmp', 'downloads')
    const sandbox = bwrapSandbox(async policy => {
      if (policy.workspaceRoot !== downloads) return
      await rename(downloads, join(root, '.tmp', 'moved'))
      await mkdir(downloads)
    })
    await assert.rejects(
      saveWorkspaceFile({ sandbox, workspaceRoot: root, cwd: root, fileName: 'a.pdf', data: Buffer.from('x') }),
      /download directory changed/u)
    assert.deepEqual(await readdir(downloads), [])
  })
})
