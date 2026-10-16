import React, { useEffect, useState } from 'react'
import { DropdownMenuSeparator } from '@/components/ui/dropdown-menu'
import { translate } from '@/i18n/i18n'
import {
  listClaudeSessionsOnOtherLogin,
  moveClaudeSessionsToSelectedAccount,
  refreshClaudeMoveAccounts
} from '@/lib/claude-session-move-coordinator'
import { useAppStore } from '../../store'

/** Offers to move Claude sessions still on the old account, the way Codex offers a restart. */
export function ClaudeSessionMovePrompt(): React.JSX.Element | null {
  const selection = useAppStore((s) => s.settings?.activeClaudeManagedAccountIdsByRuntime)
  const [accountsRead, setAccountsRead] = useState(0)
  useEffect(() => {
    let current = true
    void refreshClaudeMoveAccounts().then(() => {
      if (current) {
        setAccountsRead((count) => count + 1)
      }
    })
    return () => {
      current = false
    }
  }, [selection])
  const sessionCount = useAppStore((s) =>
    accountsRead > 0 ? listClaudeSessionsOnOtherLogin(s).length : 0
  )

  if (sessionCount === 0) {
    return null
  }

  return (
    <>
      <DropdownMenuSeparator />
      <div className="px-2 py-2">
        <div className="text-[11px] text-muted-foreground">
          {sessionCount === 1
            ? translate(
                'accounts.claude.moveSessionsOnOldAccountOne',
                '1 Claude session is still on the old account.'
              )
            : translate(
                'accounts.claude.moveSessionsOnOldAccountMany',
                '{{value0}} Claude sessions are still on the old account.',
                { value0: sessionCount }
              )}
          <span className="mt-0.5 block">
            {translate(
              'accounts.claude.moveSessionsHint',
              'Each one reopens its conversation on the selected account once it finishes its turn and holds no unsent text.'
            )}
          </span>
        </div>
        <button
          type="button"
          onClick={() => void moveClaudeSessionsToSelectedAccount()}
          className="mt-2 inline-flex w-full items-center justify-center rounded-md border border-border/70 px-2.5 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-accent/60"
        >
          {sessionCount === 1
            ? translate('accounts.claude.moveSessionsButtonOne', 'Move Session')
            : translate('accounts.claude.moveSessionsButtonMany', 'Move {{value0}} Sessions', {
                value0: sessionCount
              })}
        </button>
      </div>
    </>
  )
}
