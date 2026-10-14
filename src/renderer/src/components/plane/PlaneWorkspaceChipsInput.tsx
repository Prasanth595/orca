import { useId } from 'react'
import { Check, LoaderCircle, TriangleAlert, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import { normalizePlaneWorkspaceSlug } from '../../../../shared/plane-ids'
import type { PlaneConnectFormAction, PlaneConnectFormState } from './plane-connect-form-model'
import { getPlaneErrorCopy } from './plane-error-copy'
import type { PlaneWorkspaceChip } from './plane-workspace-chips'

function ChipIcon({ chip }: { chip: PlaneWorkspaceChip }): React.JSX.Element | null {
  switch (chip.status) {
    case 'connecting':
      return <LoaderCircle className="animate-spin" />
    case 'connected':
      return <Check />
    case 'failed':
      return <TriangleAlert />
    case 'pending':
      return null
  }
}

function chipLabel(chip: PlaneWorkspaceChip): string {
  return chip.status === 'connected' && chip.projectCount !== undefined
    ? translate('plane.connect.chipProjects', '{{slug}} · {{count}} projects', {
        slug: chip.slug,
        count: chip.projectCount
      })
    : chip.slug
}

/** Workspace slugs as chips: Enter, comma or a space adds one; a pasted Plane URL adds its slug. */
export function PlaneWorkspaceChipsInput({
  state,
  dispatch,
  hostLabel,
  autoFocus = false
}: {
  state: PlaneConnectFormState
  dispatch: (action: PlaneConnectFormAction) => void
  hostLabel: string
  autoFocus?: boolean
}): React.JSX.Element {
  const id = useId()
  const failed = state.chips.filter((chip) => chip.status === 'failed' && chip.error)
  const draft = state.slugDraft.trim()
  const draftInvalid =
    draft.length > 0 && !normalizePlaneWorkspaceSlug(draft) && !draft.includes('/')
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{translate('plane.connect.workspaces', 'Workspaces')}</Label>
      {state.chips.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5">
          {state.chips.map((chip) => (
            <li key={chip.slug}>
              <Badge
                variant={chip.status === 'failed' ? 'destructive' : 'secondary'}
                data-status={chip.status}
              >
                <ChipIcon chip={chip} />
                {chipLabel(chip)}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  disabled={state.submitting}
                  aria-label={translate('plane.connect.removeWorkspace', 'Remove {{slug}}', {
                    slug: chip.slug
                  })}
                  onClick={() => dispatch({ type: 'removeChip', slug: chip.slug })}
                >
                  <X />
                </Button>
              </Badge>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        id={id}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        placeholder={translate('plane.connect.workspacesPlaceholder', 'acme, or paste a Plane URL')}
        value={state.slugDraft}
        disabled={state.submitting}
        aria-invalid={draftInvalid || undefined}
        onChange={(event) => dispatch({ type: 'setSlugDraft', value: event.target.value })}
        onBlur={() => dispatch({ type: 'commitSlugDraft' })}
        onPaste={(event) => {
          event.preventDefault()
          dispatch({ type: 'pasteSlugs', text: event.clipboardData.getData('text') })
        }}
        onKeyDown={(event) => {
          // Why only with a draft: an empty field lets Enter submit the form as usual.
          if (event.key === 'Enter' && state.slugDraft.trim()) {
            event.preventDefault()
            dispatch({ type: 'commitSlugDraft' })
          }
        }}
      />
      <p className="text-xs text-muted-foreground">
        {draftInvalid
          ? translate(
              'plane.connect.invalidSlug',
              '{{value}} is not a workspace slug or a Plane URL.',
              { value: draft }
            )
          : translate(
              'plane.connect.workspacesDescription',
              'Type each workspace slug and press Enter or comma, or paste a Plane URL. One token is used for all of them.'
            )}
      </p>
      {failed.map((chip) => (
        <p key={chip.slug} role="alert" className="text-xs text-destructive">
          {translate('plane.connect.chipFailed', '{{slug}}: {{reason}}', {
            slug: chip.slug,
            reason: chip.error ? getPlaneErrorCopy(chip.error, hostLabel) : ''
          })}
        </p>
      ))}
    </div>
  )
}
