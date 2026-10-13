import { FeishuBitableConnectionPicker } from './FeishuBitableConnectionPicker'
import { useEffect, useMemo, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
import type {
  FeishuBitableField,
  FeishuBitableFieldMapping
} from '../../../../shared/feishu-bitable-types'
import { normalizeFeishuBitableFieldMapping } from '../../../../shared/feishu-bitable-types'
import { useAppStore } from '@/store'
import { useMountedRef } from '@/hooks/useMountedRef'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { FeishuBitableConnectDialog } from '@/components/feishu-bitable-connect-dialog'
import { TaskSourceShowInTasksStep } from './TaskSourceShowInTasksStep'
import { TaskSourceStepRow } from './TaskSourceStepRow'
import { translate } from '@/i18n/i18n'

type FeishuBitableSetupStepsProps = {
  connected: boolean
  checking: boolean
  visible: boolean
  canHide: boolean
  onToggleVisible: () => void
  onConnected: () => void
}

type MappingSlot = keyof FeishuBitableFieldMapping

const MAPPING_SLOTS: { slot: MappingSlot; label: string; required: boolean }[] = [
  {
    slot: 'titleField',
    label: translate('auto.components.settings.FeishuBitableSetupSteps.titleField', 'Title'),
    required: true
  },
  {
    slot: 'descriptionField',
    label: translate(
      'auto.components.settings.FeishuBitableSetupSteps.descriptionField',
      'Description'
    ),
    required: false
  },
  {
    slot: 'acceptanceCriteriaField',
    label: translate(
      'auto.components.settings.FeishuBitableSetupSteps.acceptanceCriteriaField',
      'Acceptance criteria'
    ),
    required: false
  },
  {
    slot: 'urlField',
    label: translate('auto.components.settings.FeishuBitableSetupSteps.urlField', 'Link'),
    required: false
  }
]

export function FeishuBitableSetupSteps(props: FeishuBitableSetupStepsProps): React.JSX.Element {
  const [dialogOpen, setDialogOpen] = useState(false)
  return (
    <>
      {props.connected ? <FeishuBitableConnectionPicker /> : null}
      <ol className="divide-y divide-border/50">
        <TaskSourceStepRow
          index={1}
          state={props.checking ? 'in-progress' : props.connected ? 'done' : 'pending'}
          title={translate(
            'auto.components.settings.FeishuBitableSetupSteps.connectTitle',
            'Connect Feishu Bitable'
          )}
          description={translate(
            'auto.components.settings.FeishuBitableSetupSteps.connectDescription',
            'Add an enterprise self-built app with access to the Bitable base and table.'
          )}
          action={
            <Button
              type="button"
              size="sm"
              variant={props.connected ? 'outline' : 'default'}
              onClick={() => setDialogOpen(true)}
            >
              {props.connected
                ? translate(
                    'auto.components.settings.FeishuBitableSetupSteps.addAnother',
                    'Add another table'
                  )
                : translate(
                    'auto.components.settings.FeishuBitableSetupSteps.connect',
                    'Add Feishu access'
                  )}
            </Button>
          }
        />
        {props.connected ? <FeishuBitableMappingStep /> : null}
        <TaskSourceShowInTasksStep
          index={props.connected ? 3 : 2}
          providerLabel={translate(
            'auto.components.settings.TasksPane.feishuBitable',
            'Feishu Bitable'
          )}
          visible={props.visible}
          canHide={props.canHide}
          onToggleVisible={props.onToggleVisible}
        />
      </ol>
      <FeishuBitableConnectDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onConnected={props.onConnected}
      />
    </>
  )
}

/**
 * Field mapping editor for the active connection. Slot values are field
 * names; a renamed Feishu column drops out of the list and the slot reads
 * "(none)" until remapped, which is the visible failure mode we want.
 */
function FeishuBitableMappingStep(): React.JSX.Element | null {
  const status = useAppStore((s) => s.feishuBitableStatus)
  const fetchFields = useAppStore((s) => s.fetchFeishuBitableFields)
  const updateMapping = useAppStore((s) => s.updateFeishuBitableFieldMapping)
  const mountedRef = useMountedRef()
  const activeConnection = useMemo(
    () =>
      status.connections.find((entry) => entry.id === status.activeConnectionId) ??
      status.connections[0] ??
      null,
    [status]
  )
  const connectionId = activeConnection?.id ?? null
  const savedMapping = activeConnection?.fieldMapping ?? null

  const [fields, setFields] = useState<FeishuBitableField[]>([])
  const [fieldsState, setFieldsState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [fieldsError, setFieldsError] = useState<string | null>(null)
  const [draft, setDraft] = useState<FeishuBitableFieldMapping | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!connectionId) {
      return
    }
    let cancelled = false
    setFieldsState('loading')
    setFieldsError(null)
    fetchFields(connectionId)
      .then((result) => {
        if (cancelled || !mountedRef.current) {
          return
        }
        if (result.ok) {
          setFields(result.fields)
          setFieldsState('ready')
        } else {
          setFields([])
          setFieldsError(result.error)
          setFieldsState('error')
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && mountedRef.current) {
          setFieldsError(error instanceof Error ? error.message : 'Could not load fields.')
          setFieldsState('error')
        }
      })
    return () => {
      cancelled = true
    }
  }, [connectionId, fetchFields, mountedRef])

  // Track the saved mapping; draft picks it up on connection change or after save.
  useEffect(() => {
    if (savedMapping) {
      setDraft(normalizeFeishuBitableFieldMapping(savedMapping))
    }
  }, [savedMapping])

  if (!connectionId || !draft) {
    return null
  }

  const isDirty =
    draft.titleField !== savedMapping?.titleField ||
    draft.descriptionField !== savedMapping?.descriptionField ||
    draft.acceptanceCriteriaField !== savedMapping?.acceptanceCriteriaField ||
    draft.urlField !== savedMapping?.urlField
  const canSave = Boolean(draft.titleField) && isDirty && !saving

  const handleSave = async (): Promise<void> => {
    if (!canSave) {
      return
    }
    setSaving(true)
    setSaveError(null)
    try {
      const result = await updateMapping({ connectionId, fieldMapping: draft })
      if (mountedRef.current && !result.ok) {
        setSaveError(result.error)
      }
    } catch (error) {
      if (mountedRef.current) {
        setSaveError(error instanceof Error ? error.message : 'Could not save mapping.')
      }
    } finally {
      if (mountedRef.current) {
        setSaving(false)
      }
    }
  }

  return (
    <TaskSourceStepRow
      index={2}
      state={
        fieldsState === 'loading' ? 'in-progress' : fieldsState === 'error' ? 'pending' : 'done'
      }
      title={translate(
        'auto.components.settings.FeishuBitableSetupSteps.mappingTitle',
        'Field mapping'
      )}
      description={
        fieldsState === 'error' && fieldsError
          ? fieldsError
          : translate(
              'auto.components.settings.FeishuBitableSetupSteps.mappingDescription',
              'Pick which Bitable columns feed each task slot for {{connection}}.',
              { connection: activeConnection?.label ?? '' }
            )
      }
      action={
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!canSave}
          onClick={() => void handleSave()}
        >
          {saving ? (
            <>
              <LoaderCircle className="size-4 animate-spin" />
              {translate('auto.components.settings.FeishuBitableSetupSteps.saving', 'Saving…')}
            </>
          ) : (
            translate(
              'auto.components.settings.FeishuBitableSetupSteps.saveMapping',
              'Save mapping'
            )
          )}
        </Button>
      }
    >
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {MAPPING_SLOTS.map(({ slot, label, required }) => (
          <div key={slot} className="space-y-1">
            <p className="text-xs font-medium text-foreground">
              {label}
              {required ? <span className="text-destructive"> *</span> : null}
            </p>
            <Select
              value={draft[slot] ?? 'none'}
              onValueChange={(value) => {
                const next = { ...draft, [slot]: value === 'none' ? null : value }
                setDraft(next)
                setSaveError(null)
              }}
            >
              <SelectTrigger size="sm" className="w-full" aria-label={label}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">
                  {translate(
                    'auto.components.settings.FeishuBitableSetupSteps.noneField',
                    '(none)'
                  )}
                </SelectItem>
                {fields.map((field) => (
                  <SelectItem key={field.fieldName} value={field.fieldName}>
                    {field.fieldName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ))}
      </div>
      {saveError ? <p className="mt-2 text-xs text-destructive">{saveError}</p> : null}
    </TaskSourceStepRow>
  )
}
