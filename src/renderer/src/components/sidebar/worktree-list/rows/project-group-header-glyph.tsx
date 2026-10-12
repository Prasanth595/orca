import React from 'react'
import { Folder } from 'lucide-react'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import type { RepoIcon } from '../../../../../../shared/repo-icon'

export function ProjectGroupHeaderGlyph({
  icon,
  hierarchyStyle,
  defaultIcon: DefaultIcon
}: {
  icon: RepoIcon | null
  hierarchyStyle: boolean
  defaultIcon: React.ComponentType<{ className?: string }> | undefined
}): React.JSX.Element | null {
  if (icon) {
    return <RepoIconGlyph repoIcon={icon} className="size-4" iconClassName="size-3.5" />
  }
  if (hierarchyStyle) {
    // Why: hierarchy groups read as plain folders; the tree glyph duplicated the guide lines.
    return <Folder className="size-3.5" />
  }
  return DefaultIcon ? <DefaultIcon className="size-3" /> : null
}
