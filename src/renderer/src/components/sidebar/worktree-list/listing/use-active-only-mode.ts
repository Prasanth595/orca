import { useEffect } from 'react'
import { useAppStore } from '@/store'
import type { AppState } from '@/store/types'
import { isHierarchySidebarStyle } from '../../../../../../shared/sidebar-style'

// Whether the hierarchy sidebar's Active view applies, gated on style so Classic never narrows.
export function useActiveOnlySidebarMode(settings: AppState['settings']): boolean {
  const sidebarActiveOnly = useAppStore((s) => s.sidebarActiveOnly)
  const setSidebarActiveOnly = useAppStore((s) => s.setSidebarActiveOnly)
  const hierarchyStyle = isHierarchySidebarStyle(settings)
  useEffect(() => {
    // Why: leaving Hierarchy also leaves the Active view, so the full view's collapse memory swaps back.
    if (sidebarActiveOnly && !hierarchyStyle) {
      setSidebarActiveOnly(false)
    }
  }, [hierarchyStyle, setSidebarActiveOnly, sidebarActiveOnly])
  return sidebarActiveOnly && hierarchyStyle
}
