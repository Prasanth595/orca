import { ipcRenderer } from 'electron'
import type { CodexConfigSyncStatus } from '../../shared/codex-config-sync-types'
import type { PreloadApi } from '../api-types'

export const codexConfigSyncApi = {
  status: (): Promise<CodexConfigSyncStatus> => ipcRenderer.invoke('codexConfigSync:status'),
  userDefinesDeveloperInstructions: (cwd?: string): Promise<boolean> =>
    ipcRenderer.invoke('codexConfigSync:userDefinesDeveloperInstructions', cwd)
} satisfies PreloadApi['codexConfigSync']
