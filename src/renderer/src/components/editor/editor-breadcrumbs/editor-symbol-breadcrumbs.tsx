import { useMemo, useState } from 'react'
import { ChevronRight, Code } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu'
import { useAppStore } from '@/store'
import { extractSymbols, symbolAtLine } from './editor-symbol-extractor'
import type { EditorSymbol } from './editor-symbol-extractor'
import { translate } from '@/i18n/i18n'

const SUPPORTED_LANGUAGES = new Set(['python', 'c', 'cpp', 'systemverilog', 'verilog'])

function symbolIcon(kind: EditorSymbol['kind']): string {
  switch (kind) {
    case 'class':
      return 'C'
    case 'struct':
      return 'S'
    case 'enum':
      return 'E'
    case 'module':
      return 'M'
    case 'function':
    case 'method':
      return 'ƒ'
    case 'variable':
      return 'v'
    case 'other':
      return '●'
  }
}

type SymbolKindBadgeProps = { kind: EditorSymbol['kind'] }

function SymbolKindBadge({ kind }: SymbolKindBadgeProps): React.JSX.Element {
  return (
    <span className="symbol-kind-badge" data-kind={kind} aria-hidden>
      {symbolIcon(kind)}
    </span>
  )
}

type EditorSymbolBreadcrumbsProps = {
  fileId: string
  languageId: string
  content: string | undefined
  onRevealLine: (line: number) => void
}

export function EditorSymbolBreadcrumbs({
  fileId,
  languageId,
  content,
  onRevealLine
}: EditorSymbolBreadcrumbsProps): React.JSX.Element | null {
  const cursorLine = useAppStore((s) => s.editorCursorLine[fileId] ?? 1)
  const [pickerOpen, setPickerOpen] = useState(false)

  const symbols = useMemo(() => {
    if (!SUPPORTED_LANGUAGES.has(languageId) || !content) {
      return []
    }
    return extractSymbols(languageId, content)
  }, [languageId, content])

  const activeSymbol = useMemo(() => symbolAtLine(symbols, cursorLine), [symbols, cursorLine])

  if (!SUPPORTED_LANGUAGES.has(languageId) || symbols.length === 0) {
    return null
  }

  return (
    <span className="breadcrumb-item">
      <ChevronRight className="breadcrumb-sep" aria-hidden />
      <DropdownMenu open={pickerOpen} onOpenChange={setPickerOpen} modal={false}>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            className={`breadcrumb-segment breadcrumb-segment--symbol ${activeSymbol ? '' : 'breadcrumb-segment--inactive'}`}
            aria-label={translate(
              'auto.components.editor.editorBreadcrumbs.symbolBreadcrumbs.goToSymbol',
              'Go to symbol'
            )}
          >
            {activeSymbol ? (
              <>
                <SymbolKindBadge kind={activeSymbol.kind} />
                {activeSymbol.name}
              </>
            ) : (
              <Code className="size-3" aria-hidden />
            )}
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent className="w-64 p-0" align="start" sideOffset={4}>
          <div className="max-h-72 overflow-y-auto scrollbar-sleek p-1">
            {symbols.map((sym) => (
              <DropdownMenuItem
                key={`${sym.name}-${sym.line}`}
                variant="mono"
                active={sym === activeSymbol}
                onSelect={() => onRevealLine(sym.line)}
              >
                <SymbolKindBadge kind={sym.kind} />
                <span className="truncate">{sym.name}</span>
                <span className="ml-auto text-muted-foreground tabular-nums">:{sym.line}</span>
              </DropdownMenuItem>
            ))}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </span>
  )
}
