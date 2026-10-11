import { useCallback } from 'react'
import { toast } from 'sonner'
import type { AiVaultSession } from '../../../../shared/ai-vault-types'
import { translate } from '@/i18n/i18n'
import { useConfirmationDialog } from '@/components/confirmation-dialog-context'
import { agentLabel } from './ai-vault-session-filters'

/**
 * Confirms, then deletes an AI Vault session: toasts the outcome and forces a
 * refresh so the row goes away immediately.
 */
export function useAiVaultSessionDeleteAction({
  refresh,
  onDeleted
}: {
  refresh: (options: { force: boolean }) => Promise<void>
  onDeleted?: (session: AiVaultSession) => void
}): (session: AiVaultSession) => Promise<void> {
  const confirm = useConfirmationDialog()

  return useCallback(
    async (session: AiVaultSession) => {
      const confirmed = await confirm({
        title: translate(
          'auto.components.right.sidebar.AiVaultSessionDeleteDialog.title',
          'Delete this session?'
        ),
        description:
          session.agent === 'codex'
            ? translate(
                'auto.components.right.sidebar.AiVaultSessionDeleteDialog.codexDescription',
                '"{{value0}}" will be permanently deleted from Codex history on this device. Your workspace files will be kept. Close any Codex session using it outside Orca before deleting; Orca cannot detect those sessions.',
                { value0: session.title }
              )
            : translate(
                'auto.components.right.sidebar.AiVaultSessionDeleteDialog.description',
                '"{{value0}}" will be deleted. Once deleted, it will no longer be resumable from {{value1}}\'s own command line either.',
                { value0: session.title, value1: agentLabel(session.agent) }
              ),
        confirmLabel: translate(
          'auto.components.right.sidebar.AiVaultSessionDeleteDialog.confirm',
          'Delete'
        ),
        confirmVariant: 'destructive'
      })
      if (!confirmed) {
        return
      }
      try {
        const result = await window.api.aiVault.deleteSession({
          agent: session.agent,
          sessionId: session.sessionId,
          filePath: session.filePath,
          executionHostId: session.executionHostId
        })
        if (result.outcome !== 'deleted') {
          if (result.outcome === 'failed' && result.detail) {
            toast.error(
              result.detail === 'unsupported'
                ? translate(
                    'auto.components.right.sidebar.AiVaultPanel.codexDeleteUnsupported',
                    'This Codex version does not support session deletion. Update Codex and try again.'
                  )
                : result.detail === 'active'
                  ? translate(
                      'auto.components.right.sidebar.AiVaultPanel.codexDeleteActive',
                      'This session is still owned by a Codex terminal or native chat. Close its terminal, or delete it from its chat.'
                    )
                  : translate(
                      'auto.components.right.sidebar.AiVaultPanel.codexDeleteIncomplete',
                      'Deletion incomplete. Some Codex session data may remain. Try Delete again to finish cleanup.'
                    )
            )
            return
          }
          // 'rejected' and 'failed' share one message: the specific reason is a
          // main-side detail, not something to surface raw.
          throw new Error(result.outcome)
        }
        onDeleted?.(session)
        toast.success(
          translate('auto.components.right.sidebar.AiVaultPanel.sessionDeleted', 'Session deleted')
        )
        // Main already invalidated its caches; this is only for immediate UX.
        void refresh({ force: true })
      } catch {
        // A rejected IPC invoke (transport/serialization) lands here too.
        toast.error(
          translate(
            'auto.components.right.sidebar.AiVaultPanel.sessionDeleteFailed',
            "Couldn't delete the session"
          )
        )
      }
    },
    [confirm, refresh, onDeleted]
  )
}
