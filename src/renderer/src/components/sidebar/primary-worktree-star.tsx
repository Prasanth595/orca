import React from 'react'
import { translate } from '@/i18n/i18n'

// Why: lucide's Star has rounded tips; at 8px it reads as a blob, so the hierarchy row draws a sharp one.
export function PrimaryWorktreeStar(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      className="relative top-px size-2 shrink-0 fill-worktree-sidebar-primary-star"
      role="img"
      aria-label={translate('auto.components.sidebar.WorktreeCard.0d224eff10', 'Primary worktree')}
    >
      <polygon points="12,1.5 14.9,8.6 22.5,9.2 16.7,14.1 18.5,21.6 12,17.6 5.5,21.6 7.3,14.1 1.5,9.2 9.1,8.6" />
    </svg>
  )
}
