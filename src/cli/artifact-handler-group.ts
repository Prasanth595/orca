import type { HandlerGroup } from './handler-group-manifest'

export const ARTIFACT_HANDLER_GROUP: HandlerGroup = {
  name: 'artifacts',
  keys: [
    'artifacts list',
    'artifacts share',
    'artifacts update',
    'artifacts unshare',
    'artifacts delete'
  ],
  load: async () => (await import('./handlers/artifacts.js')).ARTIFACT_HANDLERS
}
