import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { applyPlugin, dispose } from './helpers/plugin-harness.js'

const ROOT = '/workspace'

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
