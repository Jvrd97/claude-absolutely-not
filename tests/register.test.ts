import type { ApiContentBlock, SessionAppendInput, SessionStartInput, TurnCompleteInput } from 'claude-code'
import { describe, expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const SESSION: SessionStartInput = { surface: 'terminal', isInteractive: true, cwd: '/work' }
const COMMAND_RUN = { command: 'tics', args: '', origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 140 } } as const

type TestOn = Parameters<Extract<Parameters<typeof test>[1], (...args: never[]) => unknown>>[1]

const world = (on: TestOn, store: Record<string, unknown> = {}) => {
  const state = { statuses: [] as (string | undefined)[], stored: [] as ApiContentBlock[][] }

  mock.store(on, store)
  on('ui.status', ($, e) => {
    state.statuses.push(e.text)

    return { value: undefined }
  })
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('prompt.section', ($, e) => ({ text: e.text }))
  on('session.append', ($, e, next) => {
    state.stored.push(e.message.content)

    return next(e)
  })
  on('turn.complete', ($, e) => ({ text: e.answer }))

  return state
}

/**
 * The 2.1.285 test kit keeps no conversation beneath `session.append`: a test hook
 * may not answer it without `next`, and `next` there throws "no implementation".
 * So a test reads the row as it reached the layer beneath the plugin (the row the
 * engine would store) and lets exactly that one rejection pass.
 */
const append = async ($: Engine, input: SessionAppendInput): Promise<void> => {
  await $.session.append(input).catch((error: unknown) => {
    if (!String(error).includes('no implementation for session.append')) {
      throw error
    }
  })
}

let rows = 0

const response = (content: ApiContentBlock[], agentId?: string): SessionAppendInput => ({
  message: { type: 'assistant', role: 'assistant', content },
  door: 'response',
  origin: { kind: 'model', model: 'claude-opus-5-5' },
  uuid: `row-${++rows}`,
  ...(agentId === undefined ? {} : { agentId }),
})

const turn = (answer: string, agentId?: string): TurnCompleteInput => ({
  answer,
  durationMs: 1000,
  isAborted: false,
  turnId: `turn-${++rows}`,
  reason: 'answer',
  ...(agentId === undefined ? {} : { agentId }),
})

const text = (value: string): ApiContentBlock => ({ type: 'text', text: value })

describe('the tone rule', () => {
  test('is added once, after the environment section', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    const section = await $.prompt.section({ name: 'env_info_simple', text: 'Working directory: /work' })

    expect(section.text).toMatch(/^Working directory: \/work\n\n# Tone/)
    expect(section.text?.split('# Tone').length).toBe(2)
    expect(section.text).toContain('Never use these words: load-bearing, delve')
  })

  test('leaves other sections alone', async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    expect((await $.prompt.section({ name: 'memory', text: 'notes' })).text).toBe('notes')
  })

  test('is off with rule: false', { options: { rule: false } }, async ($, on) => {
    world(on)
    await $.session.start(SESSION)

    expect((await $.prompt.section({ name: 'env_info_simple', text: 'Env' })).text).toBe('Env')
  })
})

describe('the strip', () => {
  test('stores the response row without its leading opener', async ($, on) => {
    const state = world(on)
    await $.session.start(SESSION)

    await append($, response([text("You're absolutely right! The loop is off by one.")]))

    expect(state.stored.length).toBe(1)
    expect(state.stored[0]).toEqual([text('The loop is off by one.')])
  })

  test('keeps a row that only agrees with content after it', async ($, on) => {
    const state = world(on)
    await $.session.start(SESSION)
    await append($, response([text("You're right that the lock is never released.")]))

    expect(state.stored[0]).toEqual([text("You're right that the lock is never released.")])
  })

  test('touches only the first text block of a multi-block row', async ($, on) => {
    const state = world(on)
    await $.session.start(SESSION)
    const toolUse: ApiContentBlock = { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'echo Perfect!' } }
    await append($, response([text('Perfect! Running it.'), toolUse, text('Good catch! Second block.')]))

    expect(state.stored[0]).toEqual([text('Running it.'), toolUse, text('Good catch! Second block.')])
  })

  test('leaves prompts and tool results alone', async ($, on) => {
    const state = world(on)
    await $.session.start(SESSION)
    await append($, {
      message: { type: 'user', role: 'user', content: [text('Perfect! Now fix the other one.')] },
      door: 'prompt',
      origin: { kind: 'composer' },
      uuid: 'prompt-1',
    })

    expect(state.stored[0]).toEqual([text('Perfect! Now fix the other one.')])
  })

  test('is off with strip: false', { options: { strip: false } }, async ($, on) => {
    const state = world(on)
    await $.session.start(SESSION)
    await append($, response([text('Perfect! Done.')]))

    expect(state.stored[0]).toEqual([text('Perfect! Done.')])
  })
})

describe('counting and /tics', () => {
  test('a turn counts its tics once, whether the answer is seen before or after the strip', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await append($, response([text("You're absolutely right! It is load-bearing.")]))
    await $.turn.complete(turn("You're absolutely right! It is load-bearing."))

    const answer = await $.command.run(COMMAND_RUN)

    expect(answer.text).toMatch(/You're absolutely right\s+1\s+1/)
    expect(answer.text).toMatch(/load-bearing\s+1\s+1/)
    expect(answer.text).toMatch(/total\s+2\s+2/)
  })

  test('an opener stripped from an earlier row still counts', async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await append($, response([text('Perfect! Let me run the tests.')]))
    await append($, response([text('All 12 tests pass.')]))
    await $.turn.complete(turn('All 12 tests pass.'))

    expect((await $.command.run(COMMAND_RUN)).text).toMatch(/Perfect\s+1\s+1/)
  })

  test('all-time counts add to what the store already held', async ($, on) => {
    world(on, { counts: { Perfect: 5, delve: 1 } })
    await $.session.start(SESSION)
    await $.turn.complete(turn('Perfect! Done.'))
    await $.turn.complete(turn('Perfect. Also done.'))

    const report = (await $.command.run(COMMAND_RUN)).text

    expect(report).toMatch(/Perfect\s+2\s+7/)
    expect(report).toMatch(/delve\s+0\s+1/)
    expect(report).toContain('Rule: on')
  })

  test("a subagent's turns are not counted", async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await append($, response([text('Perfect! Searching.')], 'agent-1'))
    await $.turn.complete(turn('Perfect! Found it.', 'agent-1'))

    expect((await $.command.run(COMMAND_RUN)).text).toContain('No tics counted yet.')
  })

  test('custom banned words and extra openers are counted', { options: { bannedWords: 'synergy', extraOpeners: 'Great catch' } }, async ($, on) => {
    world(on)
    await $.session.start(SESSION)
    await $.turn.complete(turn('Great catch! The synergy is robust.'))

    const report = (await $.command.run(COMMAND_RUN)).text

    expect(report).toMatch(/Great catch\s+1\s+1/)
    expect(report).toMatch(/synergy\s+1\s+1/)
    expect(report).not.toContain('robust')
  })

  test('the status line shows the session count when turned on', { options: { status: true } }, async ($, on) => {
    const state = world(on)
    await $.session.start(SESSION)
    await $.turn.complete(turn('Perfect! It is robust.'))

    expect(state.statuses).toEqual(['tics: 0', 'tics: 2'])
  })

  test('the status line stays untouched by default', async ($, on) => {
    const state = world(on)
    await $.session.start(SESSION)
    await $.turn.complete(turn('Perfect! Done.'))

    expect(state.statuses).toEqual([])
  })
})
