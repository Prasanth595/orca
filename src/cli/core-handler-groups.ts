import type { HandlerGroup } from './handler-group-manifest'

export const CORE_HANDLER_GROUPS: readonly HandlerGroup[] = [
  {
    name: 'agent',
    keys: ['agent mcp-readiness'],
    load: async () => (await import('./handlers/agent.js')).AGENT_HANDLERS
  },
  {
    name: 'reference',
    keys: ['reference list', 'reference add', 'reference remove', 'reference find'],
    load: async () => (await import('./handlers/reference.js')).REFERENCE_HANDLERS
  },
  {
    name: 'core',
    keys: ['claude-teams', 'open', 'serve', 'status'],
    load: async () => (await import('./handlers/core.js')).CORE_HANDLERS
  },
  {
    name: 'serve-restore',
    keys: ['serve restore resume'],
    load: async () => (await import('./handlers/serve-restore.js')).SERVE_RESTORE_HANDLERS
  },
  {
    name: 'serve-service',
    keys: ['serve service install', 'serve service status', 'serve service uninstall'],
    load: async () => (await import('./handlers/serve-service.js')).SERVE_SERVICE_HANDLERS
  },
  {
    name: 'account',
    keys: ['account add', 'account list', 'account select', 'account rm'],
    load: async () => (await import('./handlers/account.js')).ACCOUNT_HANDLERS
  },
  {
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
]
