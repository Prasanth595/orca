import { useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import { toast } from 'sonner'
import { getPlaneMutationErrorCopy } from '@/components/plane/plane-error-copy'
import { usePlaneHostLabel } from '@/components/plane/use-plane-host-label'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { translate } from '@/i18n/i18n'
import { getScreenSubmitShortcutLabel, isScreenSubmitShortcut } from '@/lib/screen-submit-shortcut'
import {
  isPlaneRuntimeUpdateRequiredError,
  planeAddCommentForTarget
} from '@/runtime/runtime-plane-client'
import type { PlaneComment, PlaneWorkItem } from '../../../../../shared/plane-types'
import { PLANE_COMMENT_MAX_LENGTH } from '../../../../../shared/rpc-contract/plane-params'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'

/**
 * Posts one plain-text comment per submit. A failure keeps the draft and shows a toast; it is
 * never retried, since a timed-out post may still have landed in Plane.
 */
export function PlaneCommentComposer({
  item,
  target,
  onCommentAdded
}: {
  item: Pick<PlaneWorkItem, 'projectId' | 'id'>
  target: RuntimeClientTarget
  onCommentAdded: (comment: PlaneComment) => void
}): React.JSX.Element {
  const hostLabel = usePlaneHostLabel()
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  // Why a ref: a fast double Cmd/Ctrl+Enter fires before the disabled state renders.
  const inFlightRef = useRef(false)
  const trimmed = text.trim()
  const tooLong = trimmed.length > PLANE_COMMENT_MAX_LENGTH
  const canSubmit = trimmed.length > 0 && !tooLong && !submitting

  const submit = (): void => {
    if (inFlightRef.current || !trimmed || tooLong) {
      return
    }
    inFlightRef.current = true
    setSubmitting(true)
    const finish = (): void => {
      inFlightRef.current = false
      setSubmitting(false)
    }
    planeAddCommentForTarget(target, {
      projectId: item.projectId,
      workItemId: item.id,
      text: trimmed
    }).then(
      (result) => {
        finish()
        if (result.ok) {
          setText('')
          onCommentAdded(result.value)
        } else {
          toast.error(getPlaneMutationErrorCopy(result.error.kind, hostLabel))
        }
      },
      (error: unknown) => {
        finish()
        const kind = isPlaneRuntimeUpdateRequiredError(error) ? 'update_required' : 'runtime_error'
        toast.error(getPlaneMutationErrorCopy(kind, hostLabel))
      }
    )
  }

  return (
    <div className="space-y-2">
      <Textarea
        value={text}
        rows={3}
        disabled={submitting}
        aria-label={translate('plane.comment.label', 'Comment')}
        placeholder={translate('plane.comment.placeholder', 'Add a comment…')}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (isScreenSubmitShortcut(event)) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] text-muted-foreground">
          {tooLong
            ? translate('plane.comment.tooLong', 'Comments can be at most {{max}} characters.', {
                max: PLANE_COMMENT_MAX_LENGTH
              })
            : translate('plane.comment.shortcut', '{{shortcut}} to comment', {
                shortcut: getScreenSubmitShortcutLabel()
              })}
        </span>
        <Button size="sm" disabled={!canSubmit} onClick={submit}>
          {submitting ? <LoaderCircle className="animate-spin" /> : null}
          {translate('plane.comment.submit', 'Comment')}
        </Button>
      </div>
    </div>
  )
}
