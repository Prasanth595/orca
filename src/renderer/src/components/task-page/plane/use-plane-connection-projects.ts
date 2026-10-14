import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { PlaneProject } from '../../../../../shared/plane-types'

const NO_PROJECTS: PlaneProject[] = []

/** The live projects of one workspace connection, loaded once per runtime context. */
export function usePlaneConnectionProjects(connectionId: string, contextKey: string): PlaneProject[] {
  const projects = useAppStore((s) => s.planeProjectsByConnection[connectionId])
  const projectsContextKey = useAppStore((s) => s.planeProjectsContextKey)
  const loadPlaneProjects = useAppStore((s) => s.loadPlaneProjects)
  const loaded = projectsContextKey === contextKey && projects !== undefined
  useEffect(() => {
    if (!loaded) {
      void loadPlaneProjects({ connectionId })
    }
  }, [connectionId, loadPlaneProjects, loaded])
  return projects ?? NO_PROJECTS
}
