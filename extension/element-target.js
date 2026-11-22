/**
 * Target selection for click, hover, and scroll by XPath or visible text.
 *
 * The page side collects descriptors for the matching elements (see
 * collectTargetCandidates in background.js); this module ranks them without
 * touching the DOM, so the rules are unit-tested and shared by every tool that
 * clicks a target. Only visible candidates are considered: a hidden duplicate
 * (zero box, display:none, visibility:hidden) is never selected, which is the
 * usual case for repeated row buttons on a page.
 */

export const MAX_XPATH_CHARS = 2_000
export const MAX_TEXT_CHARS = 1_000

/** Collapse whitespace and trim, so "Download\n  file" and "Download file" compare equal. */
export function normalizeText(value) {
  return String(value ?? '').replace(/\s+/gu, ' ').trim()
}

/** Whether a page-side candidate descriptor is an interactive control. */
export function isInteractive(candidate) {
  return candidate?.interactive === true
}

/**
 * Choose the element a target declaration refers to.
 *
 * `candidates` are page-side descriptors in document order; `text` is present
 * for a text target and absent for an XPath target. For text, the list is
 * ranked: the innermost match first (one whose text is not also matched by a
 * visible descendant), then interactive controls, so ancestors that merely
 * contain the text come last. `index` picks an entry of that visible candidate
 * list, which is the escape hatch when several elements match.
 *
 * Returns { selected, candidates, index } where `candidates` are the visible
 * candidates in list order and `index` is the selected position in that list
 * (the value a retry would pass as `index`), or throws an Error whose message
 * lists those candidates.
 */
export function selectElementTarget(candidates, { text, index, matchCount } = {}) {
  if (!Array.isArray(candidates)) throw new Error('No element candidates were collected')
  const visible = candidates.filter(candidate => candidate?.visible === true)
  const ordered = text === undefined ? visible : rankTextCandidates(visible)
  const total = Number.isSafeInteger(matchCount) ? matchCount : candidates.length
  const kind = text === undefined ? 'xpath' : 'text'
  const label = describeTarget(kind, text)
  if (index !== undefined) {
    if (!Number.isSafeInteger(index) || index < 0) throw new Error('index must be a non-negative integer')
    if (index >= ordered.length) {
      throw new Error('index ' + String(index) + ' is out of range: ' + String(ordered.length)
        + ' visible ' + (kind === 'text' ? 'text match(es)' : 'XPath match(es)'))
    }
    return { selected: ordered[index], candidates: ordered, index }
  }
  if (ordered.length === 0) throw new Error(describeEmpty(candidates, total, label))
  if (kind === 'xpath' && ordered.length === 1) return { selected: ordered[0], candidates: ordered, index: 0 }
  if (kind === 'text') {
    const best = rankKey(ordered[0])
    if (ordered.filter(candidate => rankKey(candidate) === best).length === 1) {
      return { selected: ordered[0], candidates: ordered, index: 0 }
    }
  }
  throw ambiguousError(ordered.length, label, ordered)
}

/** Innermost text matches first, then interactive controls; stable otherwise. */
function rankTextCandidates(visible) {
  return [...visible].sort((left, right) => rankKey(left) - rankKey(right))
}

/**
 * Lower is better: an innermost text match first (no other match is its
 * descendant), then an interactive control. Ties keep document order.
 */
function rankKey(candidate) {
  const innermost = candidate.hasMatchingDescendant === true ? 1 : 0
  const interactive = isInteractive(candidate) ? 0 : 1
  return innermost * 2 + interactive
}

function describeTarget(kind, text) {
  if (kind === 'xpath') return 'XPath'
  const query = normalizeText(text).slice(0, 80)
  return 'text "' + query + '"'
}

function describeEmpty(candidates, total, label) {
  if (total > 0 && candidates.every(candidate => candidate?.visible !== true)) {
    return 'No visible element matches the ' + label + '; ' + String(total)
      + ' matching element(s) are hidden, and hidden duplicates are skipped'
  }
  return 'No element matches the ' + label
}

function ambiguousError(count, label, visible) {
  return new Error(String(count) + ' visible elements match the ' + label + ': '
    + describeCandidates(visible) + '. Pass index to choose one.')
}

/** One line per candidate (at most 20), in the order `index` refers to. */
function describeCandidates(visible) {
  const shown = visible.slice(0, 20).map((candidate, position) => {
    const bounds = candidate.bounds ?? {}
    const size = formatNumber(bounds.width) + 'x' + formatNumber(bounds.height)
    const at = formatNumber(bounds.x) + ',' + formatNumber(bounds.y)
    const text = normalizeText(candidate.text).slice(0, 80)
    const tag = typeof candidate.tagName === 'string' && candidate.tagName !== '' ? candidate.tagName : 'element'
    return '[' + String(position) + '] ' + tag + ' "' + text + '" at ' + at + ' ' + size
  })
  const suffix = visible.length > shown.length
    ? '; and ' + String(visible.length - shown.length) + ' more'
    : ''
  return shown.join('; ') + suffix
}

function formatNumber(value) {
  return Number.isFinite(value) ? String(Math.round(value)) : '?'
}
