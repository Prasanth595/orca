import type { PlaneProject, PlaneProjectScope } from '../../shared/plane-types'

export type ResolvedPlaneProjectScope =
  | { needsScope: true; projects: []; missingProjectIds: [] }
  | { needsScope: false; projects: PlaneProject[]; missingProjectIds: string[] }

/**
 * Applies a saved scope to the live project list. 'all' follows the list, so new projects
 * appear; 'selected' keeps only live ids and reports the rest. The saved scope is never
 * rewritten here, so a project that comes back is picked up again.
 */
export function resolvePlaneProjectScope(
  scope: PlaneProjectScope | null,
  liveProjects: readonly PlaneProject[]
): ResolvedPlaneProjectScope {
  if (!scope) {
    return { needsScope: true, projects: [], missingProjectIds: [] }
  }
  if (scope.mode === 'all') {
    return { needsScope: false, projects: [...liveProjects], missingProjectIds: [] }
  }
  const byId = new Map(liveProjects.map((project) => [project.id, project]))
  const projects: PlaneProject[] = []
  const missingProjectIds: string[] = []
  for (const id of scope.projectIds) {
    const project = byId.get(id)
    if (project) {
      projects.push(project)
    } else {
      missingProjectIds.push(id)
    }
  }
  return { needsScope: false, projects, missingProjectIds }
}
