import { resolve } from 'node:path'
import { createWorkspaceSourceResolver } from '../scripts/workspace-source-exports.mjs'
import { markdownParserAliases } from './markdown-parser-exports'

export const rendererSourceAliases = [
  ...createWorkspaceSourceResolver().aliases,
  ...Object.entries(markdownParserAliases).map(([find, replacement]) => ({ find, replacement })),
  { find: '@renderer', replacement: resolve('src/renderer/src') },
  { find: '@', replacement: resolve('src/renderer/src') }
]
