import { useState, useEffect } from 'react'
import { Loader2, Server, CheckCircle2, Circle } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import { useAppStore } from '@/store'
import type { SshTarget } from '../../../../shared/ssh-types'

type Props = {
  open: boolean
  workflowName: string
  onClose: () => void
  onImport: (targetId: string) => void
}

export default function WorkflowImportSshDialog({
  open,
  workflowName,
  onClose,
  onImport
}: Props): React.JSX.Element {
  const [sshTargets, setSshTargets] = useState<SshTarget[]>([])
  const [selectedTargetId, setSelectedTargetId] = useState<string | null>(null)
  const [connectingId, setConnectingId] = useState<string | null>(null)

  const sshConnectionStates = useAppStore((s) => s.sshConnectionStates)

  useEffect(() => {
    if (!open) {
      return
    }
    void window.api.ssh.listTargets().then((targets) => {
      setSshTargets(targets)
      if (targets.length > 0 && selectedTargetId === null) {
        setSelectedTargetId(targets[0].id)
      }
    })
  }, [open, selectedTargetId])

  function connectionStatus(targetId: string): 'connected' | 'connecting' | 'disconnected' {
    const state = sshConnectionStates.get(targetId)
    if (!state) {
      return 'disconnected'
    }
    if (state.status === 'connected') {
      return 'connected'
    }
    if (state.status === 'connecting' || state.status === 'reconnecting') {
      return 'connecting'
    }
    return 'disconnected'
  }

  async function handleConnect(targetId: string): Promise<void> {
    setConnectingId(targetId)
    try {
      await window.api.ssh.connect({ targetId })
    } finally {
      setConnectingId(null)
    }
  }

  const canImport = selectedTargetId !== null

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>
            <span className="flex items-center gap-2">
              <Server className="size-4 text-muted-foreground" />
              {translate('workflows.import.sshTitle', 'Select SSH Connection')}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-3 py-1">
          <p className="text-[12px] text-muted-foreground">
            {translate(
              'workflows.import.sshHint',
              '"{name}" was configured for SSH. Choose a connection to run it on.',
              { name: workflowName }
            )}
          </p>

          {sshTargets.length === 0 ? (
            <p className="text-[11px] text-muted-foreground px-1">
              {translate(
                'workflows.import.noSshConnections',
                'No SSH connections saved. Add one in Settings → SSH.'
              )}
            </p>
          ) : (
            <div className="flex flex-col rounded-md border border-border overflow-hidden">
              {sshTargets.map((t) => {
                const status = connectionStatus(t.id)
                const isSelected = selectedTargetId === t.id
                return (
                  <div
                    key={t.id}
                    onClick={() => setSelectedTargetId(t.id)}
                    className={cn(
                      'flex items-center gap-2.5 px-3 py-2.5 cursor-pointer text-[12px] border-b border-border/50 last:border-b-0 transition-colors',
                      isSelected
                        ? 'bg-primary/5 text-foreground'
                        : 'hover:bg-muted/50 text-muted-foreground'
                    )}
                  >
                    {isSelected ? (
                      <CheckCircle2 className="size-3.5 text-primary shrink-0" />
                    ) : (
                      <Circle className="size-3.5 shrink-0 opacity-40" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="font-medium truncate">{t.label}</div>
                      <div className="text-[10px] opacity-60 truncate">
                        {t.host}:{t.port}
                      </div>
                    </div>
                    {status === 'connected' ? (
                      <span className="text-[10px] text-status-success shrink-0">
                        {translate('workflows.create.sshConnected', 'connected')}
                      </span>
                    ) : status === 'connecting' ? (
                      <Loader2 className="size-3 animate-spin text-muted-foreground shrink-0" />
                    ) : (
                      <button
                        type="button"
                        className="shrink-0 text-[10px] text-primary hover:underline disabled:opacity-50 disabled:no-underline"
                        onClick={(e) => {
                          e.stopPropagation()
                          void handleConnect(t.id)
                        }}
                        disabled={connectingId === t.id}
                      >
                        {connectingId === t.id ? (
                          <Loader2 className="size-3 animate-spin" />
                        ) : (
                          translate('workflows.create.sshConnect', 'Connect')
                        )}
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" size="sm" onClick={onClose}>
            {translate('workflows.create.cancel', 'Cancel')}
          </Button>
          <Button
            size="sm"
            disabled={!canImport}
            onClick={() => selectedTargetId && onImport(selectedTargetId)}
          >
            {translate('workflows.import.importButton', 'Import')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
