import type { NativeChatGlobalSettings } from './native-chat-appearance-settings'
import type { WorktreeDeletionPreferences } from './worktree-deletion-preferences'
import type { PerforceGlobalSettings } from './perforce/perforce-settings'

/** Setting groups owned by their own modules and mixed into GlobalSettings. */
export type GlobalSettingsBase = NativeChatGlobalSettings &
  WorktreeDeletionPreferences &
  PerforceGlobalSettings
