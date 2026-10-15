import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { PlaneProject } from '../../../../../shared/plane-types'
import type { RuntimeClientTarget } from '../../../../../shared/runtime-client-target'

const NO_PROJECTS: PlaneProject[] = []

/** The live projects of one workspace connection, loaded once per runtime context. */
export function usePlaneConnectionProjects(
  connectionId: string,
  target: RuntimeClientTarget,
  contextKey: string
): PlaneProject[] {
  const projects = useAppStore((s) => s.planeProjectsByConnection[connectionId])
  const projectsContextKey = useAppStore((s) => s.planeProjectsContextKey)
  const loadPlaneProjects = useAppStore((s) => s.loadPlaneProjects)
  const loaded = projectsContextKey === contextKey && projects !== undefined
  useEffect(() => {
    if (!loaded) {
      void loadPlaneProjects(target, { connectionId })
    }
  }, [connectionId, loadPlaneProjects, loaded, target])
  return projects ?? NO_PROJECTS
}

/** Projects of several connections at once (the "all workspaces" view); loads only what is missing. */
export function usePlaneProjectsByConnection(
  connectionIds: readonly string[],
  target: RuntimeClientTarget,
  contextKey: string
): Record<string, PlaneProject[]> {
  const byConnection = useAppStore((s) => s.planeProjectsByConnection)
  const projectsContextKey = useAppStore((s) => s.planeProjectsContextKey)
  const loadPlaneProjects = useAppStore((s) => s.loadPlaneProjects)
  const missingKey = connectionIds
    .filter((id) => projectsContextKey !== contextKey || byConnection[id] === undefined)
    .join(',')
  useEffect(() => {
    for (const connectionId of missingKey.split(',').filter(Boolean)) {
      void loadPlaneProjects(target, { connectionId })
    }
  }, [loadPlaneProjects, missingKey, target])
  return byConnection
}
