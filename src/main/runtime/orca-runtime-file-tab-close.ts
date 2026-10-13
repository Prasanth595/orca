import { OrcaRuntimeWithMigrationCatalog } from './orca-runtime-migration-catalog'
import { closeRuntimeFileTabs } from './runtime-file-tab-close'
import type {
  RuntimeFileCloseOptions,
  RuntimeFileCloseResult
} from '../../shared/runtime-file-contracts'

export class OrcaRuntimeWithFileTabClose extends OrcaRuntimeWithMigrationCatalog {
  async closeFileTabs(
    selector: string,
    options: RuntimeFileCloseOptions
  ): Promise<RuntimeFileCloseResult> {
    const notifier = this.notifier
    const closeSessionTab = notifier?.closeSessionTab?.bind(notifier)
    return closeRuntimeFileTabs(
      {
        confirmClosePinnedTab: this.requireStore().getSettings().confirmClosePinnedTab,
        listTabs: (worktree) => this.listMobileSessionTabs(worktree),
        ...(closeSessionTab
          ? {
              closeInRenderer: async (worktreeId: string, tabIds: string[], force: boolean) => {
                const firstTabId = tabIds[0]
                if (!firstTabId) {
                  throw new Error('File tab not found')
                }
                await closeSessionTab(firstTabId, worktreeId, { tabIds, force })
              }
            }
          : {}),
        closeHeadless: async (worktreeId, tabId, force) => {
          const result = await this.closeMobileSessionTab(`id:${worktreeId}`, tabId, {
            reason: 'user',
            force
          })
          if (result.refused) {
            throw new Error(`File close refused: ${result.refusalReason}`)
          }
        }
      },
      selector,
      options
    )
  }
}
