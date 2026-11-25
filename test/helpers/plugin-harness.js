// Shared test harness: a plugin context complete enough to apply the whole
// plugin through apply(), plus helpers that pair a fake extension and answer
// the commands it polls. Tests import from here instead of copying the block.

import { Readable } from 'node:stream'
import { apply } from '../../lib/index.js'

export const EXTENSION_ORIGIN = 'chrome-extension://' + 'b'.repeat(32)
export const PAIRING_KEY = 'dsh-plugin-chrome-controller/pairing-code'

/** A plugin context complete enough to apply the whole plugin. */
export function fakePluginContext({ mode = 'workspace-write', root = '/tmp', withServices = true, approvals = [] } = {}) {
  const routes = new Map()
  const tools = new Map()
  const records = new Map()
  const disposers = []
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

/** A plugin context with the plugin already applied. */
export async function applyPlugin(options) {
  const context = fakePluginContext(options)
  await apply(context)
  return context
}

/** Run every disposer the plugin registered on a context. */
export async function dispose(context) {
  for (const disposer of context.disposers) await disposer?.()
}

/** Call one plugin HTTP route with a JSON body and return its JSON response. */
export async function call(context, path, body) {
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
export async function pairAndAnswer(context, reply) {
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
