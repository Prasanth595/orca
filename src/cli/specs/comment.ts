import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

const COMMENT_NOTES = [
  'Comments are the review notes left on lines of a file in the Orca app, markdown and diff alike. When --worktree is omitted, local CLI calls infer the current Orca worktree from cwd.',
  'Changes go through the running Orca app, which saves them and refreshes any open window. Never edit the profile data file by hand while Orca runs.'
]

export const COMMENT_COMMAND_SPECS: CommandSpec[] = [
  {
    path: ['comment', 'list'],
    summary: 'List the comments left on files in a worktree',
    usage: 'orca comment list [<file>] [--source markdown|diff] [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'file', 'source', 'worktree'],
    positionalArgs: ['file'],
    notes: [
      ...COMMENT_NOTES,
      'Pass a file to list only its comments; the path may be relative to the worktree or an absolute path inside it. Without one, every comment in the worktree is listed.',
      'Each comment has id, filePath, source, line, body and createdAt, plus startLine, selectedText, updatedAt and sentAt when set. line is the last line of a multi-line comment.'
    ],
    examples: [
      'orca comment list notes/status.md --json',
      'orca comment list --file notes/status.md --source markdown --worktree active --json'
    ]
  },
  {
    path: ['comment', 'rm'],
    // Why: agents reach for `delete`/`remove`; accept them so a conventional guess resolves.
    aliases: [
      ['comment', 'delete'],
      ['comment', 'remove']
    ],
    destructive: true,
    summary: 'Delete one comment by id',
    usage: 'orca comment rm <id> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'worktree'],
    positionalArgs: ['id'],
    notes: [
      ...COMMENT_NOTES,
      'Get the id from orca comment list. Fails with comment_not_found when no comment has that id.'
    ],
    examples: ['orca comment rm 3f9c1a52-7e0b-4d6a-9a41-0c2f8e5b6d17 --worktree active']
  },
  {
    path: ['comment', 'edit'],
    summary: 'Replace the text of one comment',
    usage: 'orca comment edit <id> --body <text> [--worktree <selector>] [--json]',
    allowedFlags: [...GLOBAL_FLAGS, 'id', 'body', 'worktree'],
    positionalArgs: ['id'],
    notes: [
      ...COMMENT_NOTES,
      "The new text is trimmed and cannot be empty. Like an edit in the app, it clears the comment's sent mark, so the comment counts as unsent again."
    ],
    examples: ['orca comment edit 3f9c1a52-7e0b-4d6a-9a41-0c2f8e5b6d17 --body "done"']
  }
]
