import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { translate } from '@/i18n/i18n'

type Props = {
  localData: Record<string, string>
  onDataChange: (patch: Record<string, string>) => void
}

export default function WorkflowFileWriteFields({
  localData,
  onDataChange
}: Props): React.JSX.Element {
  return (
    <>
      <div className="space-y-1">
        <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {translate('workflows.nodeEditor.fileWriteMode', 'Mode')}
        </span>
        <Select
          value={localData['mode'] ?? 'overwrite'}
          onValueChange={(v) => onDataChange({ mode: v })}
        >
          <SelectTrigger className="h-7">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="overwrite">
              {translate('workflows.nodeEditor.fileWriteModeOverwrite', 'Overwrite')}
            </SelectItem>
            <SelectItem value="append">
              {translate('workflows.nodeEditor.fileWriteModeAppend', 'Append')}
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <label className="flex items-center gap-2 text-[12px] cursor-pointer">
        <input
          type="checkbox"
          checked={localData['createParents'] !== 'false'}
          onChange={(e) => onDataChange({ createParents: e.target.checked ? 'true' : 'false' })}
        />
        {translate('workflows.nodeEditor.createParents', 'Create parent directories')}
      </label>
    </>
  )
}
