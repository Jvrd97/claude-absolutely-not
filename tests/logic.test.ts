import { describe, expect, test } from 'claude-code/testing'

import {
  DEFAULT_BANNED_WORDS,
  DEFAULT_OPENERS,
  addCounts,
  countTics,
  countsFrom,
  maxCounts,
  openersOf,
  parseList,
  report,
  ruleText,
  stripFirstTextBlock,
  stripOpeners,
  withRule,
} from '../hooks/logic'
import type { Block, Tics } from '../hooks/logic'

const OPENERS = [...DEFAULT_OPENERS]
const TICS: Tics = { openers: OPENERS, bannedWords: parseList(DEFAULT_BANNED_WORDS) }

/** [what the model wrote, what is left after the strip] */
const STRIPPED: ReadonlyArray<readonly [string, string]> = [
  ["You're absolutely right! The loop is off by one.", 'The loop is off by one.'],
  ["You're absolutely right. The loop is off by one.", 'The loop is off by one.'],
  ['You are absolutely right. Fixing it now.', 'Fixing it now.'],
  ['You are absolutely right!\n\nHere is the fix.', 'Here is the fix.'],
  ["you're ABSOLUTELY right! Done.", 'Done.'],
  ['You’re absolutely right! Curly apostrophe.', 'Curly apostrophe.'],
  ["You're absolutely right\nThe test fails because the mock is stale.", 'The test fails because the mock is stale.'],
  ["You're absolutely right!!! Sorry.", 'Sorry.'],
  ['Great question! The cache expires after an hour.', 'The cache expires after an hour.'],
  ['Great question. It depends on the plan.', 'It depends on the plan.'],
  ['Excellent point! Let me change the schema.', 'Let me change the schema.'],
  ['Perfect! Now let me run the tests.', 'Now let me run the tests.'],
  ['Perfect. Tests pass.', 'Tests pass.'],
  ['Good catch! The index was wrong.', 'The index was wrong.'],
  ['Absolutely! Here is how.', 'Here is how.'],
  ['  Perfect!  Leading spaces go too.', 'Leading spaces go too.'],
  ["Great question! You're absolutely right! Two openers in a row.", 'Two openers in a row.'],
  ['Perfect!\n```ts\nconst x = 1\n```', '```ts\nconst x = 1\n```'],
]

/** What the model wrote that must stay exactly as it is. */
const KEPT: readonly string[] = [
  "You're right that X fails because the lock is never released.",
  "You're absolutely right that the lock is never released.",
  "You're absolutely right, the lock is never released.",
  'Absolutely not. 2 + 2 is 4.',
  'Absolutely nothing changed.',
  'Perfectly fine as written.',
  'Perfect hashing needs a static key set.',
  'Perfect!Typo with no space.',
  'Great questions come from reading the code.',
  'Good catches are rare.',
  'This is a perfect fit. Absolutely!',
  'The answer is 4. You are absolutely right to check.',
  '```\nPerfect! inside a code block\n```',
  'Absolutely!',
  "You're absolutely right!",
  '**Perfect!** Bold is left alone.',
  '',
]

describe('the opener strip', () => {
  test('the table has at least 25 cases', () => {
    expect(STRIPPED.length + KEPT.length).toBeGreaterThanOrEqual(25)
  })

  for (const [input, output] of STRIPPED) {
    test(`strips: ${JSON.stringify(input)}`, () => {
      expect(stripOpeners(input, OPENERS).text).toBe(output)
    })
  }

  for (const input of KEPT) {
    test(`keeps: ${JSON.stringify(input)}`, () => {
      const result = stripOpeners(input, OPENERS)

      expect(result.text).toBe(input)
      expect(result.stripped).toEqual([])
    })
  }

  test('says which openers it took, in order', () => {
    expect(stripOpeners("Great question! You're absolutely right! So.", OPENERS).stripped).toEqual([
      'Great question',
      "You're absolutely right",
    ])
  })

  test('the rest of the text is kept byte for byte', () => {
    const rest = 'Line one.\n\n  - item with  two spaces\n\n```py\nprint("Perfect!")\n```\nTrailing text.\n'

    expect(stripOpeners(`Perfect! ${rest}`, OPENERS).text).toBe(rest)
  })

  test('extra openers from the setting are stripped too', () => {
    const openers = openersOf('Great catch, Excellent question')

    expect(stripOpeners('Great catch! Fixed.', openers).text).toBe('Fixed.')
    expect(stripOpeners('Excellent question. Yes.', openers).text).toBe('Yes.')
  })
})

describe('response rows', () => {
  test('only the first text block is stripped; thinking, tool_use and later text keep their identity', () => {
    const thinking: Block = { type: 'thinking', thinking: 'Perfect! the user is right', signature: 's' }
    const later: Block = { type: 'text', text: 'Perfect! Still here.' }
    const toolUse: Block = { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo Perfect!' } }
    const content: Block[] = [thinking, { type: 'text', text: "You're absolutely right! The fix:" }, toolUse, later]
    const result = stripFirstTextBlock(content, OPENERS)

    expect(result.stripped).toEqual(["You're absolutely right"])
    expect(result.content[0]).toBe(thinking)
    expect(result.content[1]).toEqual({ type: 'text', text: 'The fix:' })
    expect(result.content[2]).toBe(toolUse)
    expect(result.content[3]).toBe(later)
  })

  test('a row with no text, or no opener, comes back unchanged', () => {
    const toolOnly: Block[] = [{ type: 'tool_use', id: 't1', name: 'Read', input: {} }]
    const plain: Block[] = [{ type: 'text', text: 'The answer is 4.' }]

    expect(stripFirstTextBlock(toolOnly, OPENERS)).toEqual({ content: toolOnly, stripped: [] })
    expect(stripFirstTextBlock(plain, OPENERS)).toEqual({ content: plain, stripped: [] })
  })

  test('other fields of the text block survive the strip', () => {
    const content: Block[] = [{ type: 'text', text: 'Perfect! Done.', citations: [{ id: 1 }] }]

    expect(stripFirstTextBlock(content, OPENERS).content[0]).toEqual({ type: 'text', text: 'Done.', citations: [{ id: 1 }] })
  })
})

describe('counting', () => {
  test('openers count where a sentence starts, banned words anywhere in prose', () => {
    const text = "You're absolutely right! This is load-bearing. Great question, by the way.\nPerfect. Let me delve into the robust, seamless parts."

    expect(countTics(text, TICS)).toEqual({
      "You're absolutely right": 1,
      'Great question': 1,
      Perfect: 1,
      'load-bearing': 1,
      delve: 1,
      robust: 1,
      seamless: 1,
    })
  })

  test('word forms count under the configured word', () => {
    expect(countTics('It delves, it delved, it is delving. We leveraged and leverages it.', TICS)).toEqual({ delve: 3, leverage: 2 })
  })

  test('no false positives on ordinary words', () => {
    const text = 'A perfect fit. Absolutely nothing changed. Robustness is a different word. Unloaded bearings. Deliver it.'

    expect(countTics(text, TICS)).toEqual({})
  })

  test('code is not prose', () => {
    expect(countTics('Done.\n```ts\nconst robust = leverage()\n```\nUse `seamless` here.', TICS)).toEqual({})
  })

  test('an empty banned list counts openers alone', () => {
    expect(countTics('Perfect! It is robust.', { openers: OPENERS, bannedWords: parseList('') })).toEqual({ Perfect: 1 })
  })

  test('counts add up, and two views of one text take the larger', () => {
    expect(addCounts({ a: 1 }, { a: 2, b: 1 })).toEqual({ a: 3, b: 1 })
    expect(maxCounts({ a: 1, b: 2 }, { a: 2 })).toEqual({ a: 2, b: 2 })
  })

  test('a hand-edited store reads as clean counts', () => {
    expect(countsFrom({ a: 2, b: 'x', c: -1, d: 1.7 })).toEqual({ a: 2, d: 1 })
    expect(countsFrom(undefined)).toEqual({})
    expect(countsFrom([1, 2])).toEqual({})
  })
})

describe('settings and text', () => {
  test('lists parse from the settings text, trimmed and deduplicated', () => {
    expect(parseList(' delve, ,Delve, robust ')).toEqual(['delve', 'robust'])
  })

  test('the rule names the openers and the banned words', () => {
    const rule = ruleText(['Perfect'], ['delve'])

    expect(rule).toContain('"Perfect"')
    expect(rule).toContain('Never use these words: delve.')
    expect(rule).toContain('say so plainly and explain why')
    expect(ruleText(['Perfect'], [])).not.toContain('Never use')
  })

  test('the rule is added to the host section once', () => {
    const once = withRule('Env', 'RULE')

    expect(once).toBe('Env\n\nRULE')
    expect(withRule(once, 'RULE')).toBe(once)
    expect(withRule(null, 'RULE')).toBe('RULE')
  })

  test('the report lists phrases with session and all-time counts', () => {
    const text = report({ Perfect: 1 }, { Perfect: 4, delve: 2 }, 'RULE')

    expect(text).toMatch(/Perfect\s+1\s+4/)
    expect(text).toMatch(/delve\s+0\s+2/)
    expect(text).toMatch(/total\s+1\s+6/)
    expect(text).toContain('RULE')
    expect(report({}, {}, null)).toContain('No tics counted yet.')
    expect(report({}, {}, null)).toContain('Rule: off')
  })
})
