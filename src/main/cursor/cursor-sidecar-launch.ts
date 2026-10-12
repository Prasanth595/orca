import { requireLegacyAgentSessionAccountHome } from '../../shared/agent-session-account-home'
import { NATIVE_CHAT_VISUALS_DIR_ENV } from '../native-chat/native-chat-visuals-delivery'
import type { StructuredAgentLaunchPartResolver } from '../runtime/structured-agent-launch-composition'
import { STRUCTURED_CHILD_ENV_TO_DELETE } from '../runtime/structured-session-child-env'

/** The sidecar's composed launch: its folder, the env laid over Orca's, and inherited keys it drops. */
export type CursorSidecarLaunch = {
  cwd: string
  env: Record<string, string>
  envToDelete: readonly string[]
}

/** Cursor's part of a launch: the SDK's pinned account directory, run on this app's own Node. */
export const cursorSidecarLaunchPart: StructuredAgentLaunchPartResolver<
  CursorSidecarLaunch
> = async (basis) => ({
  launch: {},
  env: {
    ...(await basis.environment()),
    CURSOR_SDK_HOME: requireLegacyAgentSessionAccountHome(basis.record.accountHome).path,
    ELECTRON_RUN_AS_NODE: '1'
  },
  // Cursor gets no visuals skill; a registered worker's handle comes back through the seal.
  inheritedEnvToDelete: [
    ...STRUCTURED_CHILD_ENV_TO_DELETE,
    'ORCA_TERMINAL_HANDLE',
    NATIVE_CHAT_VISUALS_DIR_ENV
  ]
})
