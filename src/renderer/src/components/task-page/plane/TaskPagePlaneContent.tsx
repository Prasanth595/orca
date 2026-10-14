import { useEffect, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { PlaneIcon } from '@/components/icons/PlaneIcon'
import { PlaneConnectDialog } from '@/components/plane/PlaneConnectDialog'
import { getPlaneErrorCopy, type PlaneErrorKind } from '@/components/plane/plane-error-copy'
import { usePlaneHostLabel } from '@/components/plane/use-plane-host-label'
import { Button } from '@/components/ui/button'
import { translate } from '@/i18n/i18n'
import { defaultScopeSource } from '@/lib/default-creation-host'
import { getProviderRuntimeContextKey } from '@/lib/provider-runtime-context'
import {
  isPlaneRuntimeUpdateRequiredError,
  planeListWorkItemsForTarget
} from '@/runtime/runtime-plane-client'
import { getPlaneRuntimeTarget } from '@/runtime/runtime-plane-target'
import { useAppStore } from '@/store'
import type { PlaneConnection, PlaneWorkItem } from '../../../../../shared/plane-types'

type DialogMode = 'connect' | 'editScope'
type ListState =
  | { kind: 'loading' }
  | { kind: 'ready'; items: PlaneWorkItem[] }
  | { kind: 'error'; error: PlaneErrorKind }
  | { kind: 'needsScope' }

function EmptyCard({
  title,
  body,
  children
}: {
  title: string
  body: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-md border border-border/50 bg-muted/50 px-6 py-14 text-center shadow-sm">
      <PlaneIcon className="mb-4 size-8 text-muted-foreground/60" />
      <p className="text-base font-medium text-foreground">{title}</p>
      <p className="mt-2 max-w-sm text-sm text-muted-foreground">{body}</p>
      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">{children}</div>
    </div>
  )
}

function usePlaneWorkItems(connection: PlaneConnection): ListState {
  const settings = useAppStore((s) => s.settings)
  const [state, setState] = useState<ListState>({ kind: 'loading' })
  const scopeKey = JSON.stringify(connection.projectScope)

  useEffect(() => {
    let cancelled = false
    setState({ kind: 'loading' })
    const target = getPlaneRuntimeTarget(defaultScopeSource(settings))
    planeListWorkItemsForTarget(target).then(
      (result) => {
        if (cancelled) {
          return
        }
        if (!result.ok) {
          setState({ kind: 'error', error: result.error.kind })
        } else if (result.value.needsScope) {
          setState({ kind: 'needsScope' })
        } else {
          setState({ kind: 'ready', items: result.value.items })
        }
      },
      (error: unknown) => {
        if (!cancelled) {
          setState({
            kind: 'error',
            error: isPlaneRuntimeUpdateRequiredError(error) ? 'update_required' : 'runtime_error'
          })
        }
      }
    )
    return () => {
      cancelled = true
    }
  }, [connection.id, scopeKey, settings])

  return state
}

function PlaneWorkItemRows({ items }: { items: PlaneWorkItem[] }): React.JSX.Element {
  if (items.length === 0) {
    return (
      <p className="px-3 py-10 text-center text-sm text-muted-foreground">
        {translate('plane.tasks.empty', 'No work items in the chosen projects.')}
      </p>
    )
  }
  return (
    <ul className="divide-y divide-border/50">
      {items.map((item) => (
        <li key={item.id} className="flex items-center gap-3 px-3 py-2 text-sm">
          <span className="w-20 shrink-0 font-mono text-xs text-muted-foreground">
            {item.identifier}
          </span>
          <span className="min-w-0 flex-1 truncate text-foreground">{item.name}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{item.state?.name ?? ''}</span>
        </li>
      ))}
    </ul>
  )
}

function PlaneWorkItemList({
  connection,
  onChooseProjects
}: {
  connection: PlaneConnection
  onChooseProjects: () => void
}): React.JSX.Element {
  const list = usePlaneWorkItems(connection)
  const hostLabel = usePlaneHostLabel()
  if (list.kind === 'needsScope') {
    return <PlaneNeedsScope onChooseProjects={onChooseProjects} />
  }
  return (
    <div className="mt-3 flex min-h-0 max-h-full flex-col overflow-hidden rounded-md border border-border/50 bg-background shadow-sm">
      <div className="flex min-h-10 flex-none items-center justify-between gap-3 border-b border-border/50 bg-muted/35 px-3 py-1">
        <div className="min-w-0 text-[11px] font-medium uppercase tracking-[0.12em] text-muted-foreground">
          {translate('plane.tasks.listTitle', 'Plane work items')}
        </div>
        {list.kind === 'ready' ? (
          <span className="text-2xs text-muted-foreground">
            {translate('plane.tasks.shown', '{{count}} shown', { count: list.items.length })}
          </span>
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto scrollbar-sleek">
        {list.kind === 'loading' ? (
          <div className="flex items-center justify-center py-14">
            <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
          </div>
        ) : list.kind === 'error' ? (
          <p role="alert" className="px-3 py-10 text-center text-sm text-destructive">
            {getPlaneErrorCopy(list.error, hostLabel)}
          </p>
        ) : (
          <PlaneWorkItemRows items={list.items} />
        )}
      </div>
    </div>
  )
}

function PlaneNeedsScope({ onChooseProjects }: { onChooseProjects: () => void }) {
  return (
    <EmptyCard
      title={translate('plane.tasks.needsScopeTitle', 'Choose Plane projects')}
      body={translate(
        'plane.tasks.needsScopeBody',
        'Pick which projects Orca lists. Your saved choice is no longer available, or none was made yet.'
      )}
    >
      <Button onClick={onChooseProjects}>
        {translate('plane.tasks.chooseProjects', 'Choose projects')}
      </Button>
    </EmptyCard>
  )
}

export function TaskPagePlaneContent({ onHide }: { onHide: () => void }): React.JSX.Element {
  const planeStatus = useAppStore((s) => s.planeStatus)
  const planeStatusChecked = useAppStore((s) => s.planeStatusChecked)
  const planeStatusContextKey = useAppStore((s) => s.planeStatusContextKey)
  const settings = useAppStore((s) => s.settings)
  const checkPlaneConnection = useAppStore((s) => s.checkPlaneConnection)
  const [dialogMode, setDialogMode] = useState<DialogMode | null>(null)

  const contextKey = getProviderRuntimeContextKey(settings)
  const ready = planeStatusChecked && planeStatusContextKey === contextKey
  const connection = ready && planeStatus.connected ? planeStatus.connection : null

  useEffect(() => {
    if (!ready) {
      void checkPlaneConnection()
    }
  }, [checkPlaneConnection, contextKey, ready])

  const body = !ready ? (
    <div className="mt-4 flex items-center justify-center py-14">
      <LoaderCircle className="size-5 animate-spin text-muted-foreground" />
    </div>
  ) : !connection ? (
    <EmptyCard
      title={translate('plane.tasks.connectTitle', 'Connect Plane')}
      body={translate(
        'plane.tasks.connectBody',
        'Browse work items from Plane Cloud or your self-hosted Plane server and start workspaces from them.'
      )}
    >
      <Button onClick={() => setDialogMode('connect')}>
        {translate('plane.tasks.connect', 'Connect Plane')}
      </Button>
      <Button variant="outline" onClick={onHide}>
        {translate('plane.tasks.hide', 'Hide Plane')}
      </Button>
    </EmptyCard>
  ) : connection.projectScope === null ? (
    <PlaneNeedsScope onChooseProjects={() => setDialogMode('editScope')} />
  ) : (
    <PlaneWorkItemList
      connection={connection}
      onChooseProjects={() => setDialogMode('editScope')}
    />
  )

  return (
    <>
      {body}
      <PlaneConnectDialog
        open={dialogMode !== null}
        mode={dialogMode ?? 'connect'}
        onOpenChange={(open) => {
          if (!open) {
            setDialogMode(null)
          }
        }}
      />
    </>
  )
}
