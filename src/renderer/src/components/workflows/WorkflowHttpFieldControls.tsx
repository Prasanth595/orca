import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'

export type ExprHint = (value: string) => React.JSX.Element | null

export function HttpFieldLabel({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {children}
    </span>
  )
}

export function HttpSelectField<T extends string>({
  label,
  value,
  options,
  onChange
}: {
  label?: string
  value: T
  options: { value: T; label: string }[]
  onChange: (value: T) => void
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      {label && <HttpFieldLabel>{label}</HttpFieldLabel>}
      <Select
        value={value}
        onValueChange={(v) => {
          const match = options.find((o) => o.value === v)
          if (match) {
            onChange(match.value)
          }
        }}
      >
        <SelectTrigger className="h-7">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o.value} value={o.value}>
              {o.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

export function HttpTextField({
  label,
  value,
  onChange,
  placeholder,
  exprHint,
  type = 'text',
  multiline = false
}: {
  label: string
  value: string
  onChange: (value: string) => void
  placeholder?: string
  exprHint?: ExprHint
  type?: 'text' | 'password' | 'number'
  multiline?: boolean
}): React.JSX.Element {
  return (
    <div className="space-y-1">
      <HttpFieldLabel>{label}</HttpFieldLabel>
      {multiline ? (
        <Textarea
          variant="code"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={5}
        />
      ) : (
        <Input
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="h-7"
        />
      )}
      {exprHint?.(value)}
    </div>
  )
}

export function HttpToggleRow({
  label,
  checked,
  onChange
}: {
  label: string
  checked: boolean
  onChange: (checked: boolean) => void
}): React.JSX.Element {
  return (
    <label className="flex items-center justify-between gap-2 text-[12px] cursor-pointer">
      {label}
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  )
}

/** Parses a number input, falling back when the field is cleared or invalid. */
export function toNonNegativeNumber(value: string, fallback: number): number {
  const n = Number(value)
  return value.trim() !== '' && Number.isFinite(n) && n >= 0 ? n : fallback
}
