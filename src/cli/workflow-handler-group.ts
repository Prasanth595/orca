import type { HandlerGroup } from './handler-group-manifest'

export const WORKFLOW_HANDLER_GROUP: HandlerGroup = {
  name: 'workflows',
  keys: [
    'workflows list',
    'workflows show',
    'workflows import',
    'workflows rm',
    'workflows run',
    'workflows runs'
  ],
  load: async () => (await import('./handlers/workflows.js')).WORKFLOW_HANDLERS
}
