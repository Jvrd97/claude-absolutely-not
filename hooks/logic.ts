import type { TicCounts } from '../types'

/** Praise and agreement openers stripped and counted with no configuration. */
export const DEFAULT_OPENERS: readonly string[] = [
  "You're absolutely right",
  'You are absolutely right',
  'Great question',
  'Excellent point',
  'Good catch',
  'Perfect',
  'Absolutely',
]

/** Words counted (and named in the rule) with no configuration. */
export const DEFAULT_BANNED_WORDS = 'load-bearing, delve, seamless, robust, leverage, comprehensive'

/** "Great question! You're absolutely right!" is two openers; more in a row than this is no longer an opener. */
const MAX_LEADING_OPENERS = 3
/** A word this short that ends in "e" keeps its "e" in every form ("use" is not stemmed to "us"). */
const MIN_STEM_LENGTH = 4
const NAME_COLUMN_MIN = 12
const NUMBER_COLUMN = 8

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** One phrase as a pattern: any run of spaces between words, a straight or curly apostrophe. */
const phraseSource = (phrase: string): string =>
  phrase
    .trim()
    .split(/\s+/)
    .map(word => escapeRegExp(word).replace(/'/g, "['’]"))
    .join('\\s+')

/** Comma-separated settings text as a list: trimmed, empties dropped, duplicates (any case) dropped. */
export const parseList = (text: string): string[] => {
  const seen = new Set<string>()
  const list: string[] = []

  for (const part of text.split(',')) {
    const item = part.trim()
    const key = item.toLowerCase()

    if (item === '' || seen.has(key)) {
      continue
    }

    seen.add(key)
    list.push(item)
  }

  return list
}

/** The default openers plus the ones the `extraOpeners` setting adds. */
export const openersOf = (extra: string): string[] => parseList([...DEFAULT_OPENERS, extra].join(','))

/**
 * A leading opener: the phrase, then "!" or "." and whitespace, or nothing more
 * on its line. A comma or a following word ("You're right that X fails because…",
 * "Absolutely not") means the phrase starts a sentence with content, so it is kept.
 */
const leadingOpener = (phrase: string): RegExp =>
  new RegExp(`^\\s*${phraseSource(phrase)}(?:[!.]+(?=\\s|$)|[ \\t]*(?=\\n|$))\\s*`, 'i')

export type Strip = { text: string; stripped: string[] }

/**
 * Removes the opener sentences at the start of a text, and nothing after them.
 * A text that is only an opener ("Absolutely!" as a whole answer) is the answer,
 * so it is left as it is.
 */
export const stripOpeners = (text: string, openers: readonly string[]): Strip => {
  const patterns = openers.map(phrase => ({ phrase, pattern: leadingOpener(phrase) }))
  const stripped: string[] = []
  let rest = text

  for (let round = 0; round < MAX_LEADING_OPENERS; round++) {
    const hit = patterns.map(({ phrase, pattern }) => ({ phrase, match: pattern.exec(rest) })).find(({ match }) => match !== null)

    if (hit === undefined || hit.match === null) {
      break
    }

    stripped.push(hit.phrase)
    rest = rest.slice(hit.match[0].length)
  }

  if (stripped.length === 0 || rest.trim() === '') {
    return { text, stripped: [] }
  }

  return { text: rest, stripped }
}

/** A content block as the engine hands it: a kind and that kind's fields. */
export type Block = { type: string; [field: string]: unknown }

export type BlocksStrip = { content: Block[]; stripped: string[] }

/**
 * Strips the openers from the first text block of a response row. Every other
 * block (thinking, tool_use, later text) is returned as the same object.
 */
export const stripFirstTextBlock = (content: readonly Block[], openers: readonly string[]): BlocksStrip => {
  const index = content.findIndex(block => block.type === 'text')
  const block = content[index]

  if (block === undefined || typeof block.text !== 'string') {
    return { content: [...content], stripped: [] }
  }

  const result = stripOpeners(block.text, openers)

  if (result.stripped.length === 0) {
    return { content: [...content], stripped: [] }
  }

  const next = [...content]
  next[index] = { ...block, text: result.text }

  return { content: next, stripped: result.stripped }
}

/** The text blocks of a row, joined; the rest (thinking, tool_use) is not prose the person reads. */
export const textOf = (content: readonly Block[]): string =>
  content
    .filter(block => block.type === 'text' && typeof block.text === 'string')
    .map(block => String(block.text))
    .join('\n')

/** Prose without code: fenced blocks and inline code spans become line breaks. */
export const proseOf = (text: string): string => text.replace(/```[\s\S]*?(?:```|$)/g, '\n').replace(/`[^`\n]*`/g, ' ')

/** A banned word and its common forms: "delve" also finds "delves", "delved", "delving". */
const wordSource = (word: string): string => {
  const base = phraseSource(word)

  if (word.length >= MIN_STEM_LENGTH && /e$/i.test(word)) {
    return `${base.slice(0, -1)}(?:e|es|ed|ing)`
  }

  return `${base}(?:s|es|ed|ing)?`
}

const countMatches = (text: string, pattern: RegExp): number => text.match(pattern)?.length ?? 0

/** An opener where a sentence starts, followed by "!", "." or "," or the end of its line. */
const openerAnywhere = (phrase: string): RegExp =>
  new RegExp(`(?:^|[.!?]\\s+|\\n)\\s*${phraseSource(phrase)}(?=[!.,]|[ \\t]*$)`, 'gim')

const bannedWord = (word: string): RegExp => new RegExp(`(?<![\\w-])${wordSource(word)}(?![\\w-])`, 'gi')

export type Tics = { openers: readonly string[]; bannedWords: readonly string[] }

/** Every opener and banned word in a text's prose, by phrase; phrases not found are left out. */
export const countTics = (text: string, tics: Tics): TicCounts => {
  const prose = proseOf(text)
  const counts: TicCounts = {}
  const add = (phrase: string, pattern: RegExp): void => {
    const count = countMatches(prose, pattern)

    if (count > 0) {
      counts[phrase] = (counts[phrase] ?? 0) + count
    }
  }

  for (const phrase of tics.openers) {
    add(phrase, openerAnywhere(phrase))
  }

  for (const word of tics.bannedWords) {
    add(word, bannedWord(word))
  }

  return counts
}

export const addCounts = (a: TicCounts, b: TicCounts): TicCounts => {
  const sum: TicCounts = { ...a }

  for (const [phrase, count] of Object.entries(b)) {
    sum[phrase] = (sum[phrase] ?? 0) + count
  }

  return sum
}

/**
 * Per phrase, the larger of two counts of the same text seen twice: the response
 * rows as they arrived, and the turn's answer. Whichever saw more saw the tic.
 */
export const maxCounts = (a: TicCounts, b: TicCounts): TicCounts => {
  const most: TicCounts = { ...a }

  for (const [phrase, count] of Object.entries(b)) {
    most[phrase] = Math.max(most[phrase] ?? 0, count)
  }

  return most
}

export const totalOf = (counts: TicCounts): number => Object.values(counts).reduce((sum, count) => sum + count, 0)

/** A store value read back as counts; anything else (unset, hand-edited) counts as none. */
export const countsFrom = (value: unknown): TicCounts => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const counts: TicCounts = {}

  for (const [phrase, count] of Object.entries(value)) {
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) {
      counts[phrase] = Math.floor(count)
    }
  }

  return counts
}

const quoted = (items: readonly string[]): string => items.map(item => `"${item}"`).join(', ')

/** The section the system prompt carries while the `rule` setting is on. */
export const ruleText = (openers: readonly string[], bannedWords: readonly string[]): string => {
  const lines = [
    '# Tone',
    '',
    `- Do not open with praise or agreement (${quoted(openers)}). Start with the answer.`,
    '- When the user is wrong, say so plainly and explain why. Agree only when they are right, and then just continue.',
    '- Do not end with filler offers or check-ins ("Let me know if...", "Hope this helps").',
  ]

  if (bannedWords.length > 0) {
    lines.push(`- Never use these words: ${bannedWords.join(', ')}.`)
  }

  return lines.join('\n')
}

/** The host section's text with the rule after it, once, whatever a hook above already did. */
export const withRule = (text: string | null, rule: string): string => {
  if (text !== null && text.includes(rule)) {
    return text
  }

  return text === null || text.trim() === '' ? rule : `${text}\n\n${rule}`
}

/** What `/tics` prints: counts by phrase for this session and all time, then the rule. */
export const report = (session: TicCounts, allTime: TicCounts, rule: string | null): string => {
  const phrases = Object.keys({ ...allTime, ...session }).sort(
    (a, b) => (allTime[b] ?? 0) - (allTime[a] ?? 0) || (session[b] ?? 0) - (session[a] ?? 0) || a.localeCompare(b),
  )
  const lines: string[] = []

  if (phrases.length === 0) {
    lines.push('No tics counted yet.')
  } else {
    const width = Math.max(NAME_COLUMN_MIN, ...phrases.map(phrase => phrase.length))
    const row = (name: string, a: string, b: string): string =>
      `${name.padEnd(width)}  ${a.padStart(NUMBER_COLUMN)}  ${b.padStart(NUMBER_COLUMN)}`

    lines.push('Tics by phrase:', '', row('phrase', 'session', 'all time'))

    for (const phrase of phrases) {
      lines.push(row(phrase, String(session[phrase] ?? 0), String(allTime[phrase] ?? 0)))
    }

    lines.push(row('total', String(totalOf(session)), String(totalOf(allTime))))
  }

  lines.push('')

  if (rule === null) {
    lines.push('Rule: off (the system prompt is unchanged).')
  } else {
    lines.push('Rule: on. The system prompt carries this section:', '', rule)
  }

  return lines.join('\n')
}

export const statusText = (session: TicCounts): string => `tics: ${totalOf(session)}`
