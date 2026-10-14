import { useId } from 'react'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import { translate } from '@/i18n/i18n'
import type { AutomationDraft } from './AutomationEditorDialog'

export function AutomationNotificationsField({
  draft,
  onDraftChange
}: {
  draft: AutomationDraft
  onDraftChange: (updater: (current: AutomationDraft) => AutomationDraft) => void
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>
          {translate('auto.components.automations.notifications.label', 'Notify on failure')}
        </Label>
        <Switch
          id={id}
          checked={draft.notifyOnFailure === true}
          aria-describedby={`${id}-description`}
          onCheckedChange={(notifyOnFailure) =>
            onDraftChange((current) => ({ ...current, notifyOnFailure }))
          }
        />
      </div>
      <p id={`${id}-description`} className="text-2xs leading-relaxed text-muted-foreground">
        {translate(
          'auto.components.automations.notifications.description',
          'Alert when a run fails or the agent reports something that needs attention. Uses your notification settings.'
        )}
      </p>
    </div>
  )
}
