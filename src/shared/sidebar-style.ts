import type { GlobalSettings, SidebarStyle } from './global-settings-types'

export function isSidebarStyle(value: unknown): value is SidebarStyle {
  return value === 'classic' || value === 'hierarchy'
}

export function isHierarchySidebarStyle(
  settings: Pick<GlobalSettings, 'sidebarStyle'> | null | undefined
): boolean {
  return settings?.sidebarStyle === 'hierarchy'
}
