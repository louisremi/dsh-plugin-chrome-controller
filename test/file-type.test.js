import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { detectKind, expectedKindForMime, expectedKindForName, verifyContent } from '../lib/file-type.js'

const bytes = value => Buffer.from(value, 'latin1')
const PDF = bytes('%PDF-1.4\n%\xe2\xe3\xcf\xd3\n1 0 obj')
const PNG = bytes('\x89PNG\r\n\x1a\n\0\0\0\rIHDR')
const ZIP = bytes('PK\x03\x04\x14\0\0\0')
// Shape of the page amazon.fr returned with HTTP 200 for an expired invoice link.
const AMAZON_ERROR = bytes('\n\n<html>\n<head>\n<title>Toutes nos excuses</title>\n<style><!--\n.serif { font-family: times,serif; }\n--></style>\n</head>\n<body>Une erreur de syst&egrave;me interne a &eacute;t&eacute; d&eacute;cel&eacute;e.</body></html>')

describe('content detection', () => {
  it('recognises binary signatures', () => {
    assert.equal(detectKind(PDF), 'pdf')
    assert.equal(detectKind(PNG), 'png')
    assert.equal(detectKind(bytes('\xff\xd8\xff\xe0')), 'jpeg')
    assert.equal(detectKind(bytes('GIF89a')), 'gif')
    assert.equal(detectKind(bytes('RIFF\0\0\0\0WEBPVP8 ')), 'webp')
    assert.equal(detectKind(ZIP), 'zip')
    assert.equal(detectKind(bytes('\x1f\x8b\x08')), 'gzip')
  })

  it('accepts a PDF header after leading junk, as PDF readers do', () => {
    assert.equal(detectKind(bytes('\r\n\r\n%PDF-1.7')), 'pdf')
  })

  it('recognises HTML pages, including with a BOM, whitespace, or uppercase tags', () => {
    assert.equal(detectKind(AMAZON_ERROR), 'html')
    assert.equal(detectKind(bytes('\xef\xbb\xbf  <!DOCTYPE html><html>')), 'html')
    assert.equal(detectKind(bytes('<HTML><BODY>')), 'html')
    assert.equal(detectKind(bytes('<!-- comment --><p>')), 'html')
  })

  it('does not mistake text that starts like a tag for HTML', () => {
    assert.equal(detectKind(bytes('<bogus> not html')), 'text')
    assert.equal(detectKind(bytes('<abc,def\n1,2')), 'text')
  })

  it('separates text from unrecognised binary', () => {
    assert.equal(detectKind(bytes('date,amount\n2026-11-18,42.00\n')), 'text')
    assert.equal(detectKind(bytes('{"ok":true}')), 'text')
    assert.equal(detectKind(bytes('\0\x01\x02\x03binary')), undefined)
  })

  it('only trusts known extensions and specific content types', () => {
    assert.equal(expectedKindForName('invoice.PDF'), 'pdf')
    assert.equal(expectedKindForName('report.xlsx'), 'zip')
    assert.equal(expectedKindForName('download.php'), undefined)
    assert.equal(expectedKindForName('invoice'), undefined)
    assert.equal(expectedKindForMime('application/pdf; charset=UTF-8'), 'pdf')
    assert.equal(expectedKindForMime('application/octet-stream'), undefined)
    assert.equal(expectedKindForMime(undefined), undefined)
  })
})

describe('verifyContent', () => {
  it('accepts content that matches the extension', () => {
    assert.deepEqual(verifyContent({ fileName: 'a.pdf', contentType: 'application/pdf', data: PDF }), { fileName: 'a.pdf', kind: 'pdf' })
    assert.equal(verifyContent({ fileName: 'r.xlsx', contentType: 'application/octet-stream', data: ZIP }).fileName, 'r.xlsx')
    assert.equal(verifyContent({ fileName: 'a.csv', contentType: 'text/csv', data: bytes('a,b\n1,2\n') }).fileName, 'a.csv')
  })

  it('refuses an HTML error page saved as a PDF, naming its title', () => {
    assert.throws(
      () => verifyContent({ fileName: 'invoice.pdf', contentType: 'text/html', data: AMAZON_ERROR }),
      error => error.message === 'Expected a PDF for invoice.pdf, but received an HTML page titled "Toutes nos excuses". Nothing was saved. The link may have expired or need a sign-in: read it again from the page that lists it.')
  })

  it('trusts the bytes, not the declared type: a real PDF sent as octet-stream or text/html is accepted', () => {
    assert.equal(verifyContent({ fileName: 'a.pdf', contentType: 'application/octet-stream', data: PDF }).kind, 'pdf')
    assert.equal(verifyContent({ fileName: 'a.pdf', contentType: 'text/html', data: PDF }).kind, 'pdf')
  })

  it('refuses a web page where text data is expected', () => {
    assert.throws(() => verifyContent({ fileName: 'export.csv', contentType: 'text/csv', data: AMAZON_ERROR }), /Expected a text file for export\.csv, but received an HTML page/u)
  })

  it('refuses an empty file under a known extension', () => {
    assert.throws(() => verifyContent({ fileName: 'a.pdf', contentType: 'application/pdf', data: Buffer.alloc(0) }), /received an empty file/u)
  })

  it('falls back to the declared Content-Type when the extension proves nothing', () => {
    assert.throws(
      () => verifyContent({ fileName: 'get.php', contentType: 'application/pdf', data: AMAZON_ERROR }),
      /Expected a PDF from the declared Content-Type application\/pdf, but received an HTML page/u)
    assert.equal(verifyContent({ fileName: 'get.php', contentType: 'application/octet-stream', data: AMAZON_ERROR }).fileName, 'get.php')
  })

  it('accepts an HTML page saved on purpose as .html', () => {
    assert.equal(verifyContent({ fileName: 'page.html', contentType: 'text/html', data: AMAZON_ERROR }).kind, 'html')
  })

  it('adds an extension from the content when the name has none', () => {
    assert.equal(verifyContent({ fileName: 'invoice', contentType: 'application/octet-stream', data: PDF }).fileName, 'invoice.pdf')
    assert.equal(verifyContent({ fileName: 'download', contentType: undefined, data: bytes('\0\x01\x02') }).fileName, 'download')
  })

  it('reports an unrecognised binary file under a known extension', () => {
    assert.throws(() => verifyContent({ fileName: 'a.png', contentType: 'image/png', data: bytes('\0\x01\x02\x03') }), /Expected a PNG image for a\.png, but received unrecognised binary content/u)
  })
})
