import { useEffect, useState } from 'react'
import { ExternalLink, LoaderCircle } from 'lucide-react'
import { getPlaneErrorCopy, type PlaneErrorKind } from '@/components/plane/plane-error-copy'
import { usePlaneHostLabel } from '@/components/plane/use-plane-host-label'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle
} from '@/components/ui/sheet'
import { translate } from '@/i18n/i18n'
import { formatUiRelativeTimeFromDate } from '@/i18n/relative-time-format'
import {
  isPlaneRuntimeUpdateRequiredError,
  planeGetWorkItemForTarget,
  planeListCommentsForTarget
} from '@/runtime/runtime-plane-client'
import type {
  PlaneComment,
  PlaneWorkItem,
  PlaneWorkItemDetail as PlaneWorkItemDetailValue
} from '../../../../../shared/plane-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'
import { PlaneAssigneeAvatars, PlaneStatePill } from './PlaneWorkItemRow'
import { getPlanePriorityLabel } from './plane-work-item-labels'

type DetailState = {
  detail: PlaneWorkItemDetailValue | null
  comments: PlaneComment[] | null
  error: PlaneErrorKind | null
}

function isDetail(item: PlaneWorkItem): item is PlaneWorkItemDetailValue {
  return 'descriptionText' in item
}

function usePlaneWorkItemDetail(
  target: RuntimeClientTarget,
  item: PlaneWorkItem | null
): DetailState {
  const [state, setState] = useState<DetailState>({ detail: null, comments: null, error: null })

  useEffect(() => {
    if (!item) {
      return
    }
    let cancelled = false
    setState({ detail: isDetail(item) ? item : null, comments: null, error: null })
    const ref = { projectId: item.projectId, workItemId: item.id }
    const fail = (error: unknown): void => {
      if (!cancelled) {
        const kind = isPlaneRuntimeUpdateRequiredError(error) ? 'update_required' : 'runtime_error'
        setState((previous) => ({ ...previous, error: kind }))
      }
    }
    if (!isDetail(item)) {
      planeGetWorkItemForTarget(target, ref).then((result) => {
        if (!cancelled) {
          setState((previous) =>
            result.ok
              ? { ...previous, detail: result.value }
              : { ...previous, error: result.error.kind }
          )
        }
      }, fail)
    }
    planeListCommentsForTarget(target, ref).then((result) => {
      if (!cancelled) {
        setState((previous) =>
          result.ok
            ? { ...previous, comments: result.value }
            : { ...previous, comments: [], error: previous.error ?? result.error.kind }
        )
      }
    }, fail)
    return () => {
      cancelled = true
    }
  }, [item, target])

  return state
}

function MetadataRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-20 shrink-0 text-muted-foreground">{label}</span>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-foreground">{children}</div>
    </div>
  )
}

function PlaneComments({ comments }: { comments: PlaneComment[] | null }): React.JSX.Element {
  if (!comments) {
    return <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
  }
  if (comments.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        {translate('plane.detail.noComments', 'No comments yet.')}
      </p>
    )
  }
  return (
    <ul className="space-y-3">
      {comments.map((comment) => (
        <li key={comment.id} className="space-y-1">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">{comment.authorName}</span>
            {' · '}
            {formatUiRelativeTimeFromDate(comment.createdAt)}
          </p>
          {/* Why plain text: Plane comment HTML is never rendered; the host sends stripped text. */}
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">{comment.text}</p>
        </li>
      ))}
    </ul>
  )
}

function PlaneWorkItemMetadata({
  item: shown,
  stateControl
}: {
  item: PlaneWorkItem
  stateControl?: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="space-y-2 px-4">
      <MetadataRow label={translate('plane.detail.state', 'State')}>
        {stateControl ?? <PlaneStatePill item={shown} />}
      </MetadataRow>
      <MetadataRow label={translate('plane.detail.priority', 'Priority')}>
        {getPlanePriorityLabel(shown.priority)}
      </MetadataRow>
      <MetadataRow label={translate('plane.detail.assignees', 'Assignees')}>
        {shown.assignees.length > 0 ? (
          <>
            <PlaneAssigneeAvatars assignees={shown.assignees} />
            {shown.assignees.map((member) => member.displayName).join(', ')}
          </>
        ) : (
          translate('plane.detail.unassigned', 'Unassigned')
        )}
      </MetadataRow>
      {shown.labels.length > 0 ? (
        <MetadataRow label={translate('plane.detail.labels', 'Labels')}>
          {shown.labels.map((label) => (
            <Badge key={label.id} variant="outline">
              {label.name}
            </Badge>
          ))}
        </MetadataRow>
      ) : null}
      <MetadataRow label={translate('plane.detail.updated', 'Updated')}>
        {formatUiRelativeTimeFromDate(shown.updatedAt)}
      </MetadataRow>
    </div>
  )
}

function PlaneDescription({
  detail,
  failed
}: {
  detail: PlaneWorkItemDetailValue | null
  failed: boolean
}): React.JSX.Element {
  return (
    <section className="space-y-2 px-4">
      <h3 className="text-xs font-medium text-muted-foreground">
        {translate('plane.detail.description', 'Description')}
      </h3>
      {detail ? (
        <>
          {/* Why plain text: description_html is never rendered as markup. */}
          <p className="whitespace-pre-wrap break-words text-sm text-foreground">
            {detail.descriptionText || translate('plane.detail.noDescription', 'No description.')}
          </p>
          {detail.truncated ? (
            <p className="text-xs text-muted-foreground">
              {translate(
                'plane.detail.truncated',
                'The description was shortened. Open in Plane to read all of it.'
              )}
            </p>
          ) : null}
        </>
      ) : failed ? null : (
        <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
      )}
    </section>
  )
}

export function PlaneWorkItemDetail({
  item,
  target,
  onClose,
  actions,
  stateControl,
  commentComposer
}: {
  item: PlaneWorkItem | PlaneWorkItemDetailValue | null
  target: RuntimeClientTarget
  onClose: () => void
  /** Header actions slot, e.g. starting a workspace from this item. */
  actions?: React.ReactNode
  /** Replaces the read-only state pill when the state can be changed here. */
  stateControl?: React.ReactNode
  /** Shown under the comments when commenting is available. */
  commentComposer?: React.ReactNode
}): React.JSX.Element {
  const { detail, comments, error } = usePlaneWorkItemDetail(target, item)
  const hostLabel = usePlaneHostLabel()
  const shown = detail ?? item

  return (
    <Sheet open={item !== null} onOpenChange={(open) => (open ? undefined : onClose())}>
      <SheetContent side="right" className="w-full sm:max-w-[560px]">
        {shown ? (
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto scrollbar-sleek">
            <SheetHeader>
              <SheetDescription>
                <span className="font-mono">{shown.identifier}</span>
              </SheetDescription>
              <SheetTitle>{shown.name}</SheetTitle>
            </SheetHeader>
            <div className="flex flex-wrap items-center gap-2 px-4">
              <Button
                variant="outline"
                size="sm"
                onClick={() => void window.api.shell.openUrl(shown.url)}
              >
                <ExternalLink />
                {translate('plane.detail.openInPlane', 'Open in Plane')}
              </Button>
              {actions}
            </div>
            <PlaneWorkItemMetadata item={shown} stateControl={stateControl} />
            <PlaneDescription detail={detail} failed={error !== null} />
            {error ? (
              <p role="alert" className="px-4 text-xs text-destructive">
                {getPlaneErrorCopy(error, hostLabel)}
              </p>
            ) : null}
            <section className="space-y-2 px-4 pb-6">
              <h3 className="text-xs font-medium text-muted-foreground">
                {translate('plane.detail.comments', 'Comments')}
              </h3>
              <PlaneComments comments={comments} />
              {commentComposer}
            </section>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}
