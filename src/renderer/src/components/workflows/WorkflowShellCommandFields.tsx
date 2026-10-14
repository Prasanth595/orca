import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'
import { getAvailableShells } from './workflow-node-editor-config'

type Props = {
  showShellSelector: boolean
  isRemote: boolean
  localData: Record<string, string>
  onDataChange: (patch: Record<string, string>) => void
}

export default function WorkflowShellCommandFields({
  showShellSelector,
  isRemote,
  localData,
  onDataChange
}: Props): React.JSX.Element {
  return (
    <>
      {showShellSelector && (
        <div className="space-y-1">
          <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {translate('workflows.nodeEditor.shell', 'Shell')}
          </span>
          <Select
            value={localData['shell'] ?? ''}
            onValueChange={(v) => onDataChange({ shell: v })}
          >
            <SelectTrigger className="h-7">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {getAvailableShells(isRemote).map((s) => (
                <SelectItem key={s} value={s}>
                  {s}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      <label className="flex items-center gap-2 text-[12px] cursor-pointer">
        <input
          type="checkbox"
          checked={localData['failOnNonZeroExit'] === 'true'}
          onChange={(e) => onDataChange({ failOnNonZeroExit: e.target.checked ? 'true' : 'false' })}
        />
        {translate('workflows.nodeEditor.failOnNonZeroExit', 'Fail node if exit code ≠ 0')}
      </label>
    </>
  )
}
