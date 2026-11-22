import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { normalizeText, selectElementTarget } from '../extension/element-target.js'

/** A page-side candidate descriptor, as collectTargetCandidates returns it. */
function candidate(overrides = {}) {
  return {
    tagName: 'button',
    role: null,
    text: 'Download',
    interactive: true,
    visible: true,
    bounds: { x: 10, y: 20, width: 100, height: 30 },
    center: { x: 60, y: 35 },
    xpath: '/html/body/button[1]',
    hasMatchingDescendant: false,
    depth: 2,
    ...overrides,
  }
}

describe('normalizeText', () => {
  it('collapses whitespace and trims', () => {
    assert.equal(normalizeText('  Télécharger\n   la\tfacture  '), 'Télécharger la facture')
    assert.equal(normalizeText(undefined), '')
  })
})

describe('selectElementTarget', () => {
  it('ignores a hidden duplicate', () => {
    const hidden = candidate({ visible: false, xpath: '/html/body/button[1]' })
    const shown = candidate({ xpath: '/html/body/button[2]' })
    const { selected, candidates, index } = selectElementTarget([hidden, shown], { text: 'Download' })
    assert.equal(selected, shown)
    assert.deepEqual(candidates, [shown])
    assert.equal(index, 0)
  })

  it('reports every visible duplicate when no index is given', () => {
    const first = candidate({ text: 'Télécharger la facture', xpath: '/html/body/div[1]/button[1]' })
    const second = candidate({ text: 'Télécharger la facture', xpath: '/html/body/div[2]/button[1]', bounds: { x: 10, y: 80, width: 120, height: 24 } })
    assert.throws(
      () => selectElementTarget([first, second], { text: 'Télécharger la facture' }),
      error => {
        assert.match(error.message, /2 visible elements match the text "Télécharger la facture"/u)
        assert.match(error.message, /\[0\] button "Télécharger la facture" at 10,20 100x30/u)
        assert.match(error.message, /\[1\] button "Télécharger la facture" at 10,80 120x24/u)
        assert.match(error.message, /Pass index to choose one/u)
        return true
      })
  })

  it('selects the requested entry of the visible candidate list', () => {
    const first = candidate({ xpath: '/html/body/button[1]' })
    const second = candidate({ xpath: '/html/body/button[2]' })
    const hidden = candidate({ visible: false, xpath: '/html/body/button[3]' })
    const { selected } = selectElementTarget([first, second, hidden], { text: 'Download', index: 1 })
    assert.equal(selected, second)
  })

  it('chooses the inner match when a text target matches nested elements', () => {
    const outer = candidate({ tagName: 'a', interactive: true, hasMatchingDescendant: true, xpath: '/html/body/a[1]' })
    const inner = candidate({ tagName: 'span', interactive: false, hasMatchingDescendant: false, xpath: '/html/body/a[1]/span[1]' })
    const { selected } = selectElementTarget([outer, inner], { text: 'Download' })
    assert.equal(selected, inner)
  })

  it('prefers an interactive control over a non-interactive match', () => {
    const label = candidate({ tagName: 'span', interactive: false, xpath: '/html/body/div[1]/span[1]' })
    const button = candidate({ tagName: 'button', interactive: true, xpath: '/html/body/div[1]/button[1]' })
    const { selected } = selectElementTarget([label, button], { text: 'Download' })
    assert.equal(selected, button)
  })

  it('lists innermost and interactive matches first, so index 0 is the control', () => {
    const ancestor = candidate({ tagName: 'div', interactive: true, hasMatchingDescendant: true, xpath: '/html/body/div[1]' })
    const first = candidate({ xpath: '/html/body/div[1]/button[1]' })
    const second = candidate({ xpath: '/html/body/div[1]/button[2]' })
    const { selected, candidates, index } = selectElementTarget([ancestor, first, second], { text: 'Download', index: 0 })
    assert.equal(selected, first)
    assert.deepEqual(candidates, [first, second, ancestor])
    assert.equal(index, 0)
    assert.throws(
      () => selectElementTarget([ancestor, first, second], { text: 'Download' }),
      /\[0\] button.*\[1\] button.*\[2\] div/u)
  })

  it('considers only visible XPath matches', () => {
    const hidden = candidate({ visible: false, xpath: '/html/body/button[1]' })
    const shown = candidate({ xpath: '/html/body/button[2]' })
    const alsoHidden = candidate({ visible: false, xpath: '/html/body/button[3]' })
    const { selected, candidates } = selectElementTarget([hidden, shown, alsoHidden], {})
    assert.equal(selected, shown)
    assert.deepEqual(candidates, [shown])
  })

  it('reports visible XPath matches when no index is given', () => {
    const first = candidate({ tagName: 'a', xpath: '/html/body/a[1]' })
    const second = candidate({ tagName: 'a', xpath: '/html/body/a[2]' })
    assert.throws(
      () => selectElementTarget([first, second], {}),
      /2 visible elements match the XPath: \[0\] a "Download" at 10,20 100x30; \[1\] a "Download" at 10,20 100x30\. Pass index to choose one\./u)
  })

  it('rejects an out-of-range or negative index', () => {
    const only = candidate({})
    assert.throws(() => selectElementTarget([only], { text: 'Download', index: 1 }), /index 1 is out of range: 1 visible text match\(es\)/u)
    assert.throws(() => selectElementTarget([only], { text: 'Download', index: -1 }), /index must be a non-negative integer/u)
  })

  it('says when no element contains the text', () => {
    assert.throws(() => selectElementTarget([], { text: 'Missing' }), /No element matches the text "Missing"/u)
  })

  it('says when every match is hidden instead of selecting one', () => {
    const hidden = candidate({ visible: false })
    assert.throws(
      () => selectElementTarget([hidden], { text: 'Download', matchCount: 1 }),
      /No visible element matches the text "Download"; 1 matching element\(s\) are hidden/u)
  })

  it('truncates a long candidate list in the error', () => {
    const many = Array.from({ length: 25 }, (_, index) => candidate({ xpath: '/html/body/button[' + String(index + 1) + ']' }))
    assert.throws(() => selectElementTarget(many, { text: 'Download' }), /\[19\].*and 5 more/u)
  })
})
