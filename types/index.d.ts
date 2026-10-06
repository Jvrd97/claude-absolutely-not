/** Tic counts by phrase, as `/tics` prints them: the phrase as configured, its count. */
export type TicCounts = Record<string, number>

declare module 'claude-code' {
  interface PluginState {
    'absolutely-not': {
      /** Tics counted in this session's finished turns. */
      session: TicCounts
      /** Tics seen in the running turn's response rows, before any strip; folded in at turn.complete. */
      pending: TicCounts
    }
  }
}
