import type { RepoIcon } from '../../../../../../shared/repo-icon'
import type { Row } from '../grouping/row-types'
import { getActiveViewGroupKey } from '../../active-only-sidebar-scope'
import {
  getNestedRepoHeaderPaddingLeft,
  getProjectGroupHeaderPaddingLeft,
  WORKTREE_SECTION_HEADER_PADDING_LEFT
} from './indentation'

type HeaderRow = Extract<Row, { type: 'header' }>

export type SectionHeaderLayout = {
  /** A project inside a group: secondary context, so no icon and a quieter label. */
  isNestedRepoHeader: boolean
  /** Hierarchy moves the runtime host icon from worktree rows up to the project row. */
  showRepoRuntimeIndicator: boolean
  paddingLeft: number
  projectGroupIcon: RepoIcon | null
  /** Host-qualified key for the Active view's per-group opt-out; hierarchy style only. */
  activeViewGroupKey: string | undefined
}

export function getSectionHeaderLayout(args: {
  row: HeaderRow
  hierarchyStyle: boolean
  isRepoHeader: boolean
  isProjectGroupHeader: boolean
}): SectionHeaderLayout {
  const { row, hierarchyStyle, isRepoHeader, isProjectGroupHeader } = args
  const depth = row.projectGroupDepth ?? 0
  const isNestedRepoHeader = hierarchyStyle && isRepoHeader && depth > 0
  const group = !row.repo && row.projectGroup?.id != null ? row.projectGroup : null
  return {
    isNestedRepoHeader,
    showRepoRuntimeIndicator: hierarchyStyle && isRepoHeader,
    // Why: non-project headers like "All" are flat-list labels; don't reserve project hierarchy indent.
    paddingLeft: isNestedRepoHeader
      ? getNestedRepoHeaderPaddingLeft(depth)
      : isRepoHeader || isProjectGroupHeader
        ? getProjectGroupHeaderPaddingLeft(depth)
        : WORKTREE_SECTION_HEADER_PADDING_LEFT,
    projectGroupIcon: isProjectGroupHeader && group ? (group.icon ?? null) : null,
    activeViewGroupKey: hierarchyStyle && group ? getActiveViewGroupKey(group) : undefined
  }
}
