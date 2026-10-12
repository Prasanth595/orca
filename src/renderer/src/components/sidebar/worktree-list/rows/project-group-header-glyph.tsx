import React from 'react'
import { RepoIconGlyph } from '@/components/repo/repo-icon'
import type { RepoIcon } from '../../../../../../shared/repo-icon'

export function ProjectGroupHeaderGlyph({
  icon,
  defaultIcon: DefaultIcon
}: {
  icon: RepoIcon | null
  defaultIcon: React.ComponentType<{ className?: string }> | undefined
}): React.JSX.Element | null {
  if (icon) {
    return <RepoIconGlyph repoIcon={icon} className="size-4" iconClassName="size-3.5" />
  }
  return DefaultIcon ? <DefaultIcon className="size-3" /> : null
}
