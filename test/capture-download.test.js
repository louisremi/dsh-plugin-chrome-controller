import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, it } from 'node:test'
import { apply } from '../lib/index.js'
import { call, fakePluginContext, pairAndAnswer } from './helpers/plugin-harness.js'

const TOOL = 'dsh_browser_capture_download'

describe('dsh_browser_capture_download', () => {
  let root
  let context
  const exec = () => ({
    name: TOOL,
    callId: 'call-1',
    agent: { session: { header: { cwd: root } } },
    signal: new AbortController().signal,
  })
  const tool = () => context.registered.get(TOOL)

  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'dsh-chrome-capture-')))
  })

  afterEach(async () => {
    for (const dispose of context?.disposers ?? []) await dispose?.()
    await rm(root, { recursive: true, force: true })
  })

  it('requires exactly one click target', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const target = tool()
    await assert.rejects(target.execute({ tabId: 7 }, exec()),
      /Provide a CSS selector, an XPath, a text, or both x and y coordinates/u)
    await assert.rejects(target.execute({ tabId: 7, selector: 'a', text: 'Download' }, exec()),
      /Provide only one of selector, xpath, or text/u)
    await assert.rejects(target.execute({ tabId: 7, selector: 'a', x: 10, y: 20 }, exec()),
      /not both/u)
    await assert.rejects(target.execute({ tabId: 7, x: 10 }, exec()),
      /Provide both finite x and y coordinates/u)
  })

  it('rejects index without xpath or text, and a bad filename or accept entry', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const target = tool()
    await assert.rejects(target.execute({ tabId: 7, selector: 'a', index: 1 }, exec()),
      /index must be a non-negative integer used with xpath or text/u)
    await assert.rejects(target.execute({ tabId: 7, selector: 'a', filename: '../invoice.pdf' }, exec()),
      /filename must be a simple file name without path separators/u)
    await assert.rejects(target.execute({ tabId: 7, selector: 'a', accept: ['html'] }, exec()),
      /accept entries must be MIME types or extensions/u)
    await assert.rejects(target.execute({ tabId: 7, selector: 'a', accept: [42] }, exec()),
      /accept entries must be MIME types or extensions/u)
    await assert.rejects(target.execute({ tabId: 7, selector: 'a', accept: ['application/' + 'x'.repeat(200)] }, exec()),
      /accept entries must be MIME types or extensions/u)
    await assert.rejects(target.execute({ tabId: 7, selector: 'a', accept: [] }, exec()),
      /Invalid number of entries for browser argument: accept/u)
  })

  it('bounds timeoutMs', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const target = tool()
    for (const timeoutMs of [0, 30_001]) {
      await assert.rejects(target.execute({ tabId: 7, selector: 'a', timeoutMs }, exec()),
        /timeoutMs must be an integer between 1 and 30000/u)
    }
    await assert.rejects(target.execute({ tabId: 7, selector: 'a', timeoutMs: 1.5 }, exec()),
      /Invalid browser argument: timeoutMs/u)
  })

  it('clicks the target and saves the bytes the extension captured', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const pdf = Buffer.from('%PDF-1.7 captured invoice')
    const answer = await pairAndAnswer(context, () => ({
      captured: true,
      source: 'bytes',
      via: 'download',
      base64: pdf.toString('base64'),
      bytes: pdf.length,
      contentType: 'application/pdf',
      contentDisposition: 'attachment; filename="Invoice-42.pdf"',
      url: 'https://shop.test/invoices/42.pdf?token=secret',
      sourceOrigin: 'https://shop.test',
      navigated: false,
      also: [{ via: 'response', contentType: 'application/pdf', bytes: pdf.length }],
    }))
    const pending = tool().execute({
      tabId: 7,
      text: 'Télécharger la facture',
      timeoutMs: 5_000,
      accept: ['application/pdf'],
    }, exec())
    const command = await answer()
    assert.equal(command.method, 'page.captureDownload')
    assert.deepEqual(command.params, {
      tabId: 7,
      timeoutMs: 5_000,
      text: 'Télécharger la facture',
      accept: ['application/pdf'],
    })
    const result = await pending
    assert.equal(result.saved, true)
    assert.equal(result.relativePath, '.tmp/downloads/Invoice-42.pdf')
    assert.equal(result.contentType, 'application/pdf')
    assert.equal(result.via, 'download')
    assert.equal(result.sourceOrigin, 'https://shop.test')
    assert.equal(result.navigated, false)
    assert.equal(result.bytes, pdf.length)
    assert.equal(result.sha256, createHash('sha256').update(pdf).digest('hex'))
    assert.deepEqual(result.also, [{ via: 'response', contentType: 'application/pdf', bytes: pdf.length }])
    const serialized = JSON.stringify(result)
    for (const secret of ['base64', 'blob:', 'token=secret', '/invoices/', 'JVBERi0']) {
      assert.ok(!serialized.includes(secret), 'the result must not contain ' + secret)
    }
    assert.deepEqual(await readFile(join(root, '.tmp', 'downloads', 'Invoice-42.pdf')), pdf)
  })

  it('uses the download name the extension suggests when the caller gave none', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const zip = Buffer.from('PK\x03\x04 stored zip of invoices')
    const answer = await pairAndAnswer(context, () => ({
      captured: true,
      source: 'bytes',
      via: 'window-open',
      base64: zip.toString('base64'),
      bytes: zip.length,
      contentType: 'application/zip',
      sourceOrigin: 'https://shop.test',
      navigated: false,
      suggestedFileName: 'Laposte_Factures_140926_300926.zip',
      also: [],
    }))
    const pending = tool().execute({ tabId: 7, text: 'Télécharger', timeoutMs: 5_000, accept: ['application/zip'] }, exec())
    await answer()
    const result = await pending
    assert.equal(result.saved, true)
    assert.equal(result.relativePath, '.tmp/downloads/Laposte_Factures_140926_300926.zip')
    assert.ok(!JSON.stringify(result).includes('suggestedFileName'))
    assert.deepEqual(await readFile(join(root, '.tmp', 'downloads', 'Laposte_Factures_140926_300926.zip')), zip)
  })

  it('prefers an explicit filename over the suggested download name', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const pdf = Buffer.from('%PDF-1.7 explicit')
    const answer = await pairAndAnswer(context, () => ({
      captured: true,
      source: 'bytes',
      via: 'download',
      base64: pdf.toString('base64'),
      bytes: pdf.length,
      contentType: 'application/pdf',
      sourceOrigin: 'https://shop.test',
      navigated: false,
      suggestedFileName: 'suggested-name.pdf',
      also: [],
    }))
    const pending = tool().execute({ tabId: 7, text: 'Télécharger', filename: 'mine.pdf', timeoutMs: 5_000 }, exec())
    await answer()
    assert.equal((await pending).relativePath, '.tmp/downloads/mine.pdf')
  })

  it('fetches a URL the click exposed through the tab, and saves it without exposing the URL', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const pdf = Buffer.from('%PDF-1.4 opened document')
    const answer = await pairAndAnswer(context, command => {
      if (command.method === 'page.captureDownload') {
        return {
          captured: true,
          source: 'url',
          via: 'window-open',
          url: 'https://docs.test/getDoc?orderId=42&token=abc',
          contentType: '',
          navigated: false,
          also: [],
        }
      }
      return {
        tabId: 7,
        frameId: 0,
        via: 'page',
        finalUrl: 'https://docs.test/file/invoice-42.pdf',
        status: 200,
        contentType: 'application/pdf',
        contentDisposition: '',
        bytes: pdf.length,
        base64: pdf.toString('base64'),
      }
    })
    const pending = tool().execute({ tabId: 7, selector: 'a[href*="invoice"]' }, exec())
    const commands = [await answer(), await answer()]
    assert.deepEqual(commands.map(command => [command.method, command.params]), [
      ['page.captureDownload', { tabId: 7, timeoutMs: 10_000, selector: 'a[href*="invoice"]' }],
      ['page.fetchFile', { tabId: 7, url: 'https://docs.test/getDoc?orderId=42&token=abc' }],
    ])
    const result = await pending
    assert.equal(result.saved, true)
    assert.equal(result.via, 'window-open')
    // The extension reported no sourceOrigin for this URL, so the fetched final URL's origin is used.
    assert.equal(result.sourceOrigin, 'https://docs.test')
    assert.equal(result.relativePath, '.tmp/downloads/invoice-42.pdf')
    assert.equal(result.also, undefined)
    const serialized = JSON.stringify(result)
    for (const secret of ['token=abc', 'getDoc', 'finalUrl', 'blob:']) {
      assert.ok(!serialized.includes(secret), 'the result must not contain ' + secret)
    }
  })

  it('reports a capture timeout without writing anything', async () => {
    context = fakePluginContext({ root })
    await apply(context)
    const answer = await pairAndAnswer(context, () => ({
      captured: false,
      reason: 'no file within 10000 ms',
      navigated: true,
      clicked: true,
    }))
    const pending = tool().execute({ tabId: 7, xpath: '//button[contains(., "Télécharger")]' }, exec())
    await answer()
    assert.deepEqual(await pending, {
      saved: false,
      reason: 'no file within 10000 ms',
      navigated: true,
      clicked: true,
    })
    await assert.rejects(readdir(join(root, '.tmp')), { code: 'ENOENT' })
  })

  it('keeps the approval rules for a credentialed cross-origin retry', async () => {
    context = fakePluginContext({ root, approvals: ['allowed-once'] })
    await apply(context)
    const pdf = Buffer.from('%PDF-1.4 s3 invoice')
    const answer = await pairAndAnswer(context, command => {
      if (command.method === 'page.captureDownload') {
        return {
          captured: true,
          source: 'url',
          via: 'download',
          url: 'https://shop.test/dl/1',
          contentType: '',
          sourceOrigin: 'https://shop.test',
          navigated: false,
        }
      }
      if (command.method === 'page.fetchFile') {
        return { tabId: 7, needsApproval: 'cors-retry', url: 'https://shop.test/dl/1', retryToken: 'token-1' }
      }
      return {
        tabId: 7,
        via: 'extension',
        finalUrl: 'https://bucket.s3.test/inv.pdf',
        contentType: 'application/pdf',
        bytes: pdf.length,
        base64: pdf.toString('base64'),
      }
    })
    const pending = tool().execute({ tabId: 7, selector: '#download' }, exec())
    const commands = [await answer(), await answer(), await answer()]
    assert.deepEqual(commands.map(command => command.method), ['page.captureDownload', 'page.fetchFile', 'page.fetchFileRetry'])
    const result = await pending
    assert.equal(result.saved, true)
    assert.equal(result.sourceOrigin, 'https://shop.test')
    assert.equal(context.services.approval.asked.length, 1)
    assert.match(context.services.approval.asked[0].reason, /Allow the Chrome extension to fetch it/u)
    assert.equal(JSON.stringify(result).includes('retryToken'), false)
    assert.deepEqual(await readFile(join(root, '.tmp', 'downloads', 'inv.pdf')), pdf)
  })

  it('refuses to save under a read-only session file policy', async () => {
    context = fakePluginContext({ root, mode: 'read-only' })
    await apply(context)
    await assert.rejects(tool().execute({ tabId: 7, selector: 'a' }, exec()), /read-only/u)
  })
})
