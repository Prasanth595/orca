import { createElement, type ComponentType } from 'react'
import {
  ChartColumn,
  Eye,
  GitCompareArrows,
  ListChecks,
  ShieldAlert,
  Smartphone
} from 'lucide-react'
import { getFileTypeIcon } from '@/lib/file-type-icons'
import type { OpenFile } from '../../store/slices/editor'

// The tab's view mode outranks the file type: a diff or conflict-review tab of `App.tsx` reads as
// that view first, so only a plain edit tab falls through to the file-type glyph.
export function resolveEditorFileTabIcon(file: OpenFile): ComponentType<{ className?: string }> {
  switch (file.mode) {
    case 'conflict-review':
      return ShieldAlert
    case 'check-details':
      return ListChecks
    case 'chat-visual':
      return ChartColumn
    case 'diff':
      return GitCompareArrows
    case 'markdown-preview':
      return Eye
    case 'edit':
      // Simulator tabs borrow this chrome with a device name ("iPhone 16 Pro") as their filePath,
      // which has no extension to type off — without this they fall through to a generic glyph.
      return file.language === 'simulator' ? Smartphone : getFileTypeIcon(file.filePath)
  }
}

export function EditorFileTabLeadingIcon({
  file,
  isActive
}: {
  file: OpenFile
  isActive: boolean
}): React.JSX.Element {
  const tone = isActive ? 'text-foreground' : 'text-muted-foreground'
  if (file.mode === 'conflict-review') {
    return (
      <ShieldAlert
        className={`w-3 h-3 mr-1 shrink-0 ${isActive ? 'text-orange-400' : 'text-orange-400/70'}`}
      />
    )
  }
  if (file.mode === 'markdown-preview') {
    return <Eye className={`w-3.5 h-3.5 mr-1.5 shrink-0 ${tone}`} />
  }
  return createElement(resolveEditorFileTabIcon(file), {
    className: `w-3 h-3 mr-1 shrink-0 ${tone}`
  })
}
