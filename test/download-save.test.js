import assert from 'node:assert/strict'
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { apply } from '../lib/index.js'

const EXTENSION_ORIGIN = 'chrome-extension://' + 'b'.repeat(32)
const PAIRING_KEY = 'dsh-plugin-chrome-controller/pairing-code'

/** A plugin context complete enough to apply the whole plugin. */
function fakePluginContext({ mode = 'workspace-write', root, withServices = true, approvals = [] }) {
  const routes = new Map()
  const tools = new Map()
  const records = new Map()
  const services = withServices ? {
    sandboxPolicy: { resolve: () => ({ mode, workspaceRoot: root }) },
    workingDirectory: { ensure: async () => root },
    sandbox: { async confine(argv) { return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] } } },
    approval: {
      asked: [],
      async request(request) {
        this.asked.push(request)
        return approvals.shift() ?? 'unavailable'
      },
    },
  } : {}
  const disposers = []
  return {
    routes,
    services,
    registered: tools,
    disposers,
    skills: { register() {} },
    systemPrompt: { section() {}, getSectionOrder: () => 0 },
    tools: { register(tool) { tools.set(tool.name, tool) } },
    webServer: { host: '127.0.0.1', register(route) { routes.set(route.path, route.handler); return () => routes.delete(route.path) } },
    connection: { fetch: { register: () => () => {} }, requestRejection: () => 401 },
    credentials: {
      async readRecord(key) { return records.get(key) },
      async modifyRecord(key, update) {
        const next = await update(records.get(key))
        if (next !== undefined) records.set(key, next)
        return records.get(key)
      },
    },
    on: () => () => {},
    effect(factory) { disposers.push(factory()) },
    get: name => services[name],
  }
}

async function call(context, path, body) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))])
  request.method = 'POST'
  request.headers = { host: '127.0.0.1:3080', origin: EXTENSION_ORIGIN }
  request.socket = { remoteAddress: '127.0.0.1' }
  let text = ''
  const response = {
    destroyed: false,
    writeHead() {},
    end(chunk) { if (chunk !== undefined) text += String(chunk) },
    once() {},
    removeListener() {},
  }
  await context.routes.get('/dsh-browser-extension/' + path)(request, response)
  return text === '' ? undefined : JSON.parse(text)
}

/** Pair a fake extension, then answer the first command it polls with `reply`. */
async function pairAndAnswer(context, reply) {
  const pairingCode = (await context.credentials.readRecord(PAIRING_KEY)).key
  const { pairToken } = await call(context, 'authorize', { pairingCode })
  const { sessionToken } = await call(context, 'connect', { pairToken })
  return async () => {
    let commands = []
    while (commands.length === 0) ({ commands } = await call(context, 'poll', { sessionToken }))
    const [command] = commands
    await call(context, 'respond', { sessionToken, id: command.id, ok: true, result: reply(command) })
    return command
  }
}

describe('dsh_browser_save_file', () => {
  let root
  let context
  const exec = () => ({ name: 'dsh_browser_save_file', callId: 'call-1', agent: { session: { header: { cwd: root } } }, signal: new AbortController().signal })

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-chrome-save-')))
  })

  afterEach(async () => {
    for (const dispose of context?.disposers ?? []) await dispose?.()
    await rm(root, { recursive: true, force: true })
  })

  it('fetches through the tab and writes the bytes into the workspace', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const pdf = Buffer.from('%PDF-1.7 invoice')
    const answer = await pairAndAnswer(context, () => ({
      tabId: 7, frameId: 0, via: 'page', finalUrl: 'https://shop.test/inv?id=1', status: 200,
      contentType: 'application/pdf', contentDisposition: 'attachment; filename="Invoice-1.pdf"',
      bytes: pdf.length, base64: pdf.toString('base64'),
    }))
    const tool = context.registered.get('dsh_browser_save_file')
    const pending = tool.execute({ tabId: 7, url: 'https://shop.test/inv?id=1' }, exec())
    const command = await answer()
    assert.equal(command.method, 'page.fetchFile')
    assert.deepEqual(command.params, { tabId: 7, url: 'https://shop.test/inv?id=1' })
    const result = await pending
    assert.equal(result.saved, true)
    assert.equal(result.relativePath, '.tmp/downloads/Invoice-1.pdf')
    assert.equal(result.finalOrigin, 'https://shop.test')
    assert.equal(result.base64, undefined)
    assert.deepEqual(await readFile(join(root, '.tmp', 'downloads', 'Invoice-1.pdf')), pdf)
    assert.deepEqual(context.services.approval.asked, [])
  })

  it('has no directory argument', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const tool = context.registered.get('dsh_browser_save_file')
    assert.equal(tool.parameters.properties.directory, undefined)
    await assert.rejects(tool.execute({ tabId: 7, url: 'https://shop.test/a.pdf', directory: '.dsh/skills' }, exec()), /Unknown browser argument: directory/u)
  })

  it('saves into .tmp/downloads by default and leaves dsh_browser_download unchanged', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const pdf = Buffer.from('%PDF-1.4 x')
    const answer = await pairAndAnswer(context, () => ({ via: 'page', finalUrl: 'https://shop.test/a.pdf', contentType: 'application/pdf', bytes: pdf.length, base64: pdf.toString('base64') }))
    const pending = context.registered.get('dsh_browser_save_file').execute({ tabId: 7, url: 'https://shop.test/a.pdf' }, exec())
    await answer()
    assert.equal((await pending).relativePath, '.tmp/downloads/a.pdf')
    const download = context.registered.get('dsh_browser_download')
    assert.deepEqual(download.parameters.properties.action.enum, ['start', 'status', 'cancel'])
    await assert.rejects(download.execute({ action: 'save', url: 'https://shop.test/a.pdf' }, exec()), /Invalid value for browser argument: action/u)
  })

  it('refuses an HTML error page served for a PDF link and writes nothing', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const page = Buffer.from('<html><head><title>Toutes nos excuses</title></head><body>Erreur</body></html>')
    const answer = await pairAndAnswer(context, () => ({ via: 'page', finalUrl: 'https://shop.test/inv/invoice.pdf', status: 200, contentType: 'text/html', bytes: page.length, base64: page.toString('base64') }))
    const pending = context.registered.get('dsh_browser_save_file').execute({ tabId: 7, url: 'https://shop.test/inv/invoice.pdf' }, exec())
    await answer()
    await assert.rejects(pending, /Expected a PDF for invoice\.pdf, but received an HTML page titled "Toutes nos excuses"/u)
    await assert.rejects(readdir(join(root, '.tmp', 'downloads')), { code: 'ENOENT' })
  })

  it('refuses to save under a read-only session file policy', async () => {
    context = fakePluginContext({ root, mode: 'read-only' })
    await apply(context)
    await pairAndAnswer(context, () => ({}))
    const tool = context.registered.get('dsh_browser_save_file')
    await assert.rejects(tool.execute({ tabId: 7, url: 'https://shop.test/a.pdf' }, exec()), /read-only/u)
  })

  it('fails closed when the profile has no sandbox-policy service', async () => {
    context = fakePluginContext({ root, withServices: false })
    await apply(context)
    await pairAndAnswer(context, () => ({}))
    await assert.rejects(
      context.registered.get('dsh_browser_save_file').execute({ tabId: 7, url: 'https://shop.test/a.pdf' }, exec()),
      /no working-directory, sandbox-policy, or sandbox service/u)
  })

  const pdfReply = pdf => ({ via: 'extension', finalUrl: 'https://bucket.s3.test/inv.pdf', contentType: 'application/pdf', bytes: pdf.length, base64: pdf.toString('base64') })

  it('asks the user before the credentialed retry, then once per redirect, each bound to its URL', async () => {
    context = fakePluginContext({ root, approvals: ['allowed-once', 'allowed-once'] })
    await apply(context)
    const pdf = Buffer.from('%PDF-1.4 s3')
    const answer = await pairAndAnswer(context, command => {
      if (command.method === 'page.fetchFile') return { tabId: 7, needsApproval: 'cors-retry', url: 'https://shop.test/dl/1', retryToken: 'token-1' }
      if (command.params.retryToken === 'token-1') return { tabId: 7, needsApproval: 'redirect', url: 'https://shop.test/dl/1', status: 302, location: 'https://bucket.s3.test/inv.pdf?X-Amz-Signature=abc', retryToken: 'token-2' }
      return pdfReply(pdf)
    })
    const pending = context.registered.get('dsh_browser_save_file').execute({ tabId: 7, url: 'https://shop.test/dl/1' }, exec())
    const commands = [await answer(), await answer(), await answer()]
    assert.deepEqual(commands.map(command => [command.method, command.params]), [
      ['page.fetchFile', { tabId: 7, url: 'https://shop.test/dl/1' }],
      ['page.fetchFileRetry', { tabId: 7, url: 'https://shop.test/dl/1', retryToken: 'token-1' }],
      ['page.fetchFileRetry', { tabId: 7, url: 'https://bucket.s3.test/inv.pdf?X-Amz-Signature=abc', retryToken: 'token-2' }],
    ])
    const result = await pending
    assert.equal(result.fetchedBy, 'extension')
    assert.equal(result.approvedRequests, 2)
    assert.equal(result.retryToken, undefined)
    const asked = context.services.approval.asked
    assert.equal(asked.length, 2)
    assert.equal(asked[0].callId, 'call-1')
    assert.match(asked[0].reason, /cannot read https:\/\/shop\.test .*URL: https:\/\/shop\.test\/dl\/1$/u)
    assert.match(asked[1].reason, /redirected \(HTTP 302\) to https:\/\/bucket\.s3\.test.*URL: https:\/\/bucket\.s3\.test\/inv\.pdf\?X-Amz-Signature=abc$/u)
  })

  for (const outcome of ['rejected', 'unavailable']) {
    it('sends no retry and saves nothing when approval is ' + outcome, async () => {
      context = fakePluginContext({ root, approvals: [outcome] })
      await apply(context)
      const answer = await pairAndAnswer(context, () => ({ tabId: 7, needsApproval: 'cors-retry', url: 'https://s3.test/a.pdf', retryToken: 't' }))
      const pending = context.registered.get('dsh_browser_save_file').execute({ tabId: 7, url: 'https://s3.test/a.pdf' }, exec())
      assert.equal((await answer()).method, 'page.fetchFile')
      await assert.rejects(pending, /credentialed request to https:\/\/s3\.test\/a\.pdf\. Nothing was saved/u)
      await assert.rejects(readdir(join(root, '.tmp')), { code: 'ENOENT' })
    })
  }

  it('stops a redirect chain at the user\'s refusal of a hop', async () => {
    context = fakePluginContext({ root, approvals: ['allowed-once', 'rejected'] })
    await apply(context)
    const answer = await pairAndAnswer(context, command => command.method === 'page.fetchFile'
      ? { tabId: 7, needsApproval: 'cors-retry', url: 'https://shop.test/dl', retryToken: 't1' }
      : { tabId: 7, needsApproval: 'redirect', url: 'https://shop.test/dl', location: 'https://tracker.test/x', retryToken: 't2' })
    const pending = context.registered.get('dsh_browser_save_file').execute({ tabId: 7, url: 'https://shop.test/dl' }, exec())
    await answer()
    await answer()
    await assert.rejects(pending, /declined the credentialed request to https:\/\/tracker\.test\/x/u)
  })

  it('caps the number of redirects', async () => {
    context = fakePluginContext({ root, approvals: Array(10).fill('allowed-once') })
    await apply(context)
    let hop = 0
    const answer = await pairAndAnswer(context, command => command.method === 'page.fetchFile'
      ? { tabId: 7, needsApproval: 'cors-retry', url: 'https://a.test/0', retryToken: 't' }
      : { tabId: 7, needsApproval: 'redirect', url: command.params.url, location: 'https://a.test/' + String(++hop), retryToken: 't' })
    const pending = context.registered.get('dsh_browser_save_file').execute({ tabId: 7, url: 'https://a.test/0' }, exec())
    pending.catch(() => {})
    // One page fetch, then six approved retries; the sixth redirect exceeds the cap.
    for (let index = 0; index < 7; index++) await answer()
    await assert.rejects(pending, /redirected more than 5 times/u)
    assert.equal(context.services.approval.asked.length, 6)
  })

  it('refuses bytes an older extension fetched from its service worker without approval', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const pdf = Buffer.from('%PDF-1.4 x')
    const answer = await pairAndAnswer(context, () => pdfReply(pdf))
    const pending = context.registered.get('dsh_browser_save_file').execute({ tabId: 7, url: 'https://bucket.s3.test/inv.pdf' }, exec())
    await answer()
    await assert.rejects(pending, /out of date/u)
    await assert.rejects(readdir(join(root, '.tmp')), { code: 'ENOENT' })
  })

  it('requires a tab for save', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const tool = context.registered.get('dsh_browser_save_file')
    await assert.rejects(tool.execute({ url: 'https://shop.test/a.pdf' }, exec()), /Missing browser argument: tabId/u)
  })
})
