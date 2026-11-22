import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { apply } from '../lib/index.js'

const ROOT = '/workspace'

/** A plugin context complete enough to apply the whole plugin. */
function fakePluginContext() {
  const routes = new Map()
  const tools = new Map()
  const records = new Map()
  const disposers = []
  const services = {
    sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: ROOT }) },
    workingDirectory: { ensure: async () => ROOT },
    sandbox: { async confine(argv) { return { argv: [...argv], enforcement: 'full', denialSignatures: [], runnerFailureRules: [] } } },
    approval: { async request() { return 'unavailable' } },
  }
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

async function applyPlugin() {
  const context = fakePluginContext()
  await apply(context)
  return context
}

async function dispose(context) {
  for (const disposer of context.disposers) await disposer?.()
}

const exec = () => ({ name: 'dsh_browser_wait_user', callId: 'c', agent: { session: { header: { cwd: ROOT } } }, signal: new AbortController().signal })

describe('dsh_browser_wait_user', () => {
  it('returns a lossless JSON result without tabId when tabId is omitted', async () => {
    const context = await applyPlugin()
    try {
      const result = await context.registered.get('dsh_browser_wait_user').execute({ reason: 'Solve the verification prompt, then reply.' }, exec())
      assert.deepEqual(result, JSON.parse(JSON.stringify(result)))
      assert.equal('tabId' in result, false)
      assert.deepEqual(Object.keys(result).sort(), ['awaitingUser', 'instruction', 'reason'])
      assert.equal(result.awaitingUser, true)
      assert.equal(result.reason, 'Solve the verification prompt, then reply.')
      assert.match(result.instruction, /Tell the user what action is required/u)
    } finally {
      await dispose(context)
    }
  })

  it('includes tabId when the caller names a tab', async () => {
    const context = await applyPlugin()
    try {
      const result = await context.registered.get('dsh_browser_wait_user').execute({ tabId: 7, reason: 'Choose the file to upload.' }, exec())
      assert.deepEqual(result, JSON.parse(JSON.stringify(result)))
      assert.deepEqual(Object.keys(result).sort(), ['awaitingUser', 'instruction', 'reason', 'tabId'])
      assert.equal(result.tabId, 7)
    } finally {
      await dispose(context)
    }
  })
})
