import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { TicCounts } from '../types'
import {
  DEFAULT_BANNED_WORDS,
  addCounts,
  countTics,
  countsFrom,
  maxCounts,
  openersOf,
  parseList,
  report,
  ruleText,
  statusText,
  stripFirstTextBlock,
  textOf,
  withRule,
} from './logic'
import type { Tics } from './logic'

const COMMAND = 'tics'
/**
 * The environment section: the engine composes it for every full system prompt,
 * after the cache boundary. A plugin cannot add a section of its own on 2.1.285
 * (no `prompt.compose` there), so the rule rides after this one's text.
 */
const HOST_SECTIONS = ['env_info_simple', 'env_info_static']
const STORE_KEY = 'counts'
const NO_COUNTS: TicCounts = {}

const sessionCounts = atom({ plugin: 'absolutely-not', key: 'session' } as const, NO_COUNTS)
const pending = atom({ plugin: 'absolutely-not', key: 'pending' } as const, NO_COUNTS)

type Settings = { tics: Tics; rule: string | null; strips: boolean; showsStatus: boolean }

const settingsOf = (options: Record<string, unknown>): Settings => {
  const openers = openersOf(String(options.extraOpeners ?? ''))
  const bannedWords = parseList(String(options.bannedWords ?? DEFAULT_BANNED_WORDS))

  return {
    tics: { openers, bannedWords },
    rule: options.rule === false ? null : ruleText(openers, bannedWords),
    strips: options.strip !== false,
    showsStatus: options.status === true,
  }
}

async function noteSeen($: EngineInterface, counts: TicCounts): Promise<void> {
  if (Object.keys(counts).length > 0) {
    await update($, pending, seen => addCounts(seen, counts))
  }
}

/** Folds a finished turn's tics into the session's counts and the all-time store. */
async function commitTurn($: EngineInterface, answer: string, settings: Settings): Promise<void> {
  const seen = await read($, pending)
  const counts = maxCounts(seen, countTics(answer, settings.tics))
  await update($, pending, () => NO_COUNTS)

  if (Object.keys(counts).length > 0) {
    await update($, sessionCounts, session => addCounts(session, counts))
    const allTime = countsFrom(await $.store.get(STORE_KEY))
    await $.store.set(STORE_KEY, addCounts(allTime, counts))
  }

  if (settings.showsStatus) {
    $.ui.status(statusText(await read($, sessionCounts)))
  }
}

export const register: Register = (on, options) => {
  const settings = settingsOf(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({ name: COMMAND, description: 'Count sycophantic openers and banned words, this session and all time' })

    if (settings.showsStatus) {
      $.ui.status(statusText(await read($, sessionCounts)))
    }

    return next(e)
  })

  on('prompt.section', { name: HOST_SECTIONS }, async ($, e, next) => {
    const section = await next(e)

    return settings.rule === null ? section : { ...section, text: withRule(section.text, settings.rule) }
  })

  on('session.append', { door: 'response' }, async ($, e, next) => {
    if (e.message.type !== 'assistant') {
      return next(e)
    }

    if (e.agentId === undefined) {
      await noteSeen($, countTics(textOf(e.message.content), settings.tics))
    }

    if (!settings.strips) {
      return next(e)
    }

    const result = stripFirstTextBlock(e.message.content, settings.tics.openers)

    return result.stripped.length === 0 ? next(e) : next({ ...e, message: { ...e.message, content: result.content } })
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await commitTurn($, e.answer, settings)
    }

    return next(e)
  })

  on('command.run', { command: COMMAND }, async $ => {
    const allTime = countsFrom(await $.store.get(STORE_KEY))

    return { text: report(await read($, sessionCounts), allTime, settings.rule) }
  })
}
