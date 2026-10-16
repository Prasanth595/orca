import { spacing } from '../theme/mobile-theme'
import type { Section } from './workspace-list-types'

// Why a cap: groups nest without limit, and every level costs a phone row branch-name width.
export const MAX_PROJECT_GROUP_INDENT_DEPTH = 3

/** Left inset for a header or row nested `depth` Project Groups deep. */
export function projectGroupIndent(depth: number | undefined): number {
  return Math.min(Math.max(depth ?? 0, 0), MAX_PROJECT_GROUP_INDENT_DEPTH) * spacing.md
}

/** Depth of a section's rows: a group header's own rows (its folder workspaces) sit inside it. */
export function sectionRowDepth(section: Pick<Section, 'depth' | 'icon'>): number {
  return (section.depth ?? 0) + (section.icon === 'project-group' ? 1 : 0)
}
