import { isDescendantOrEqual } from './filesystem-path-containment'
import { hasGitMarker } from '../project-groups/nested-repo-discovery'

export function findLongestRegisteredAncestor(
  targetPath: string,
  roots: Iterable<string>
): string | null {
  let bestRoot: string | null = null
  for (const root of roots) {
    if (isDescendantOrEqual(targetPath, root) && (!bestRoot || root.length > bestRoot.length)) {
      bestRoot = root
    }
  }
  return bestRoot
}

/** Independent git roots under a registered worktree stay authorized for SCM. */
export async function resolveNestedGitRootUnderAncestor(
  normalizedTarget: string,
  ancestorRoot: string | null
): Promise<string | null> {
  if (!ancestorRoot || ancestorRoot === normalizedTarget) {
    return null
  }
  return (await hasGitMarker(normalizedTarget)) ? normalizedTarget : null
}
