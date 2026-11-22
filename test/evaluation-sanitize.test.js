import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { sanitizeEvaluationValue } from '../extension/evaluation-sanitize.js'

const base64 = length => Buffer.from('invoice '.repeat(Math.ceil(length / 8))).toString('base64').slice(0, length)
const elidedMarker = (n, mime = 'application/pdf') => 'data:' + mime + ';base64,…[' + String(n) + ' chars elided]'

describe('sanitizeEvaluationValue', () => {
  it('elides a data: URL of file size, nested in the result, with its length', () => {
    const dataUrl = 'data:application/pdf;base64,' + base64(5_000)
    const result = sanitizeEvaluationValue({ spy: [{ name: 'invoice.pdf' }, { url: dataUrl }] })
    assert.equal(result.elided, 1)
    assert.equal(result.value.spy[0].name, 'invoice.pdf')
    assert.equal(result.value.spy[1].url, elidedMarker(dataUrl.length))
    assert.ok(result.totalChars < 200)
  })

  it('replaces a long base64 run with a counted marker', () => {
    const result = sanitizeEvaluationValue({ bytes: 'A'.repeat(30_000) })
    assert.equal(result.elided, 1)
    assert.equal(result.value.bytes, '…[base64, 30000 chars elided]')
    assert.ok(result.totalChars < 100)
  })

  it('replaces a long base64url run', () => {
    const run = '-_'.repeat(600)
    const result = sanitizeEvaluationValue({ data: run })
    assert.equal(result.elided, 1)
    assert.equal(result.value.data, '…[base64, ' + String(run.length) + ' chars elided]')
  })

  it('masks sensitive URL query values', () => {
    const url = 'https://api.test/download?id=42&token=abc&expires=1&lang=fr'
    const result = sanitizeEvaluationValue({ url })
    assert.equal(result.redacted, 2)
    assert.equal(result.value.url, 'https://api.test/download?id=42&token=<redacted>&expires=<redacted>&lang=fr')
  })

  it('masks an access_token object field and an embedded JSON access_token', () => {
    const masked = sanitizeEvaluationValue({
      response: { access_token: 'ya29.secret-token-value', tok: 'visible' },
      log: '{"access_token": "abc123"}',
    })
    assert.equal(masked.redacted, 2)
    assert.equal(masked.value.response.access_token, '<redacted>')
    assert.equal(masked.value.response.tok, 'visible')
    assert.equal(masked.value.log, '{"access_token": "<redacted>"}')
  })

  it('masks access_token= and Bearer tokens', () => {
    const result = sanitizeEvaluationValue({
      body: 'access_token=abc123&scope=read',
      header: 'Authorization: Bearer abc.def-123',
      plain: 'Bearer xyz789',
    })
    assert.equal(result.redacted, 3)
    assert.equal(result.value.body, 'access_token=<redacted>&scope=read')
    assert.equal(result.value.header, 'Authorization: Bearer <redacted>')
    assert.equal(result.value.plain, 'Bearer <redacted>')
  })

  it('keeps short base64-looking words and short data: URLs unchanged', () => {
    const value = { word: 'aGVsbG8', short: 'data:text/plain,hello', count: 2 }
    const result = sanitizeEvaluationValue(value)
    assert.deepEqual(result.value, value)
    assert.equal(result.elided, undefined)
    assert.equal(result.redacted, undefined)
  })

  it('leaves a clean small value deep-equal with no extra fields', () => {
    const value = { ok: true, count: 3, items: ['a', 'b'], nested: { empty: null }, url: 'https://example.test/report' }
    const result = sanitizeEvaluationValue(value)
    assert.deepEqual(result.value, value)
    assert.equal(result.totalChars, JSON.stringify(value).length)
    assert.equal(result.truncated, undefined)
    assert.equal(result.elided, undefined)
    assert.equal(result.redacted, undefined)
  })

  it('caps the serialized result at maxChars', () => {
    const value = { text: 'é'.repeat(1_000) }
    const result = sanitizeEvaluationValue(value, { maxChars: 100 })
    assert.equal(result.truncated, true)
    assert.equal(result.valueText.length, 100)
    assert.equal(result.totalChars, JSON.stringify(value).length)
    assert.equal(result.value, undefined)
  })

  it('returns the value when the sanitized JSON fits under maxChars', () => {
    const value = { text: 'short' }
    assert.equal(sanitizeEvaluationValue(value, { maxChars: 100 }).value.text, 'short')
    assert.equal(sanitizeEvaluationValue(value, { maxChars: 16 }).totalChars, 16)
  })

  it('does not mutate or truncate deeply nested values', () => {
    const value = { a: [{ b: { c: [1, 2, 3] } }] }
    const before = JSON.stringify(value)
    const result = sanitizeEvaluationValue(value)
    assert.deepEqual(result.value, value)
    assert.notEqual(result.value, value)
    assert.notEqual(result.value.a, value.a)
    assert.equal(JSON.stringify(value), before)
  })

  it('limits its walk and reports replacement counts compactly', () => {
    let deep = 'leaf'
    for (let index = 0; index < 20; index++) deep = { child: deep }
    const result = sanitizeEvaluationValue(deep)
    assert.match(JSON.stringify(result.value), /depth limit/u)
    assert.equal(result.elided, undefined)
    assert.equal(result.redacted, undefined)
  })
})
