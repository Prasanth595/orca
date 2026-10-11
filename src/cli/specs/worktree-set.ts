import type { CommandSpec } from '../args'
import { GLOBAL_FLAGS } from '../args'

export const WORKTREE_SET_COMMAND_SPEC: CommandSpec = {
  path: ['worktree', 'set'],
  summary: 'Update Orca metadata for a worktree',
  usage:
    'orca worktree set --worktree <selector> [--display-name <name>] [--issue <number|null>] [--pr <number|null>] [--linear-issue <identifier-or-url|null>] [--gitlab-issue <number-or-url|null>] [--gitlab-mr <number-or-url|null>] [--comment <text>] [--workspace-status <id>] [--setup-profile <name|null>] [--profile-setup <run|skip|inherit>] [--required-mcp <server[|alternative]>:<read|write>] [--confirm-shared-profile-change] [--unread|--read] [--parent-worktree <selector>|--no-parent] [--json]',
  allowedFlags: [
    ...GLOBAL_FLAGS,
    'worktree',
    'display-name',
    'issue',
    'pr',
    'linear-issue',
    'gitlab-issue',
    'gitlab-mr',
    'comment',
    'workspace-status',
    'setup-profile',
    'profile-setup',
    'required-mcp',
    'confirm-shared-profile-change',
    'unread',
    'read',
    'parent-worktree',
    'no-parent'
  ],
  repeatableFlags: ['required-mcp'],
  notes: [
    'Workspace status ids match the board columns (defaults: todo, in-progress, in-review, completed); custom statuses use their configured id.',
    'Pass --linear-issue null to clear the Linear issue link.',
    'Pass --pr null, --gitlab-issue null, or --gitlab-mr null to clear only the matching link.',
    'Each link flag updates its own field and leaves unrelated links unchanged. GitLab URLs must match the stored source project or remote; they cannot select a foreign project.',
    'A setup profile stores policy and MCP requirements only. Repository hook commands remain repository-owned.',
    'Pass --setup-profile null to clear a direct profile. Replacing or clearing an existing direct profile requires --confirm-shared-profile-change.'
  ],
  examples: [
    'orca worktree set --worktree active --linear-issue STA-335 --json',
    'orca worktree set --worktree active --linear-issue null --json',
    'orca worktree set --worktree active --workspace-status in-review --unread --json',
    'orca worktree set --worktree active --setup-profile customer-default --profile-setup run --required-mcp linear:write --json',
    'orca worktree set --worktree active --setup-profile null --confirm-shared-profile-change --json'
  ]
}
