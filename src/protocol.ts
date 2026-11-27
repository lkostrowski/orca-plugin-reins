// Panel <-> worker contract, and the shape of <workspace>/.reins/state.json.
export type Todo = {
  id: string
  title: string
  /** Markdown. */
  description?: string
  status: 'open' | 'closed'
  archived?: boolean
}

export type Group = {
  id: string
  emoji: string
  title: string
  archived?: boolean
  todos: Todo[]
}

export type ReinsState = { version: 1; groups: Group[] }

/** One workspace's board as the worker read it. `rev` is the file's mtime (0 when absent). */
export type Snapshot = { workspaceId: string; path: string; rev: number; state: ReinsState }

declare module 'orca' {
  interface PluginRequests {
    /** Reads the workspace's board and starts watching its file. */
    'reins.get': { input: { workspaceId: string }; output: Snapshot }
    /** Replaces the board; `conflict` when the file changed since `rev`. */
    'reins.save': { input: { workspaceId: string; rev: number; state: ReinsState }; output: Snapshot }
    /** Puts `text` on the OS clipboard (the panel frame has no clipboard access). */
    'reins.copy': { input: { text: string }; output: null }
  }
  interface PluginPanelEvents {
    /** The file changed on disk (the agent, or a save). */
    'reins.changed': Snapshot
  }
}
