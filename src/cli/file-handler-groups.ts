import type { HandlerGroup } from './handler-group-manifest'

// Why split out: file commands and the comments anchored to files change together, and
// handler-group-manifest.ts has no room left under its line limit.
export const FILE_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'file',
    keys: ['file open', 'file diff', 'file open-changed'],
    load: async () => (await import('./handlers/file.js')).FILE_HANDLERS
  },
  {
    name: 'comment',
    keys: ['comment list', 'comment rm', 'comment edit'],
    load: async () => (await import('./handlers/comment.js')).COMMENT_HANDLERS
  }
]
