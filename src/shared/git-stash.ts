export type GitStashAction =
  | 'push'
  | 'push_untracked'
  | 'push_staged'
  | 'apply'
  | 'pop'
  | 'drop'
  | 'clear'
  | 'show'

export type GitStashEntry = { ref: string; oid: string; subject: string }

export type GitStashOptions = {
  action: GitStashAction
  stash?: GitStashEntry
  message?: string
  expectedStashes?: string[]
}

export type GitStashListResult = { entries: GitStashEntry[]; truncated: boolean }

export type GitStashResult = { output: string }
