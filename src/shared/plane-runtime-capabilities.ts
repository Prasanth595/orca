// Hosts without this have no `plane.*` methods.
export const PLANE_RUNTIME_CAPABILITY = 'plane.v1' as const
// Why separate: older hosts reject a whole worktree.create whose linked item names a provider
// they do not know, so a client must check this before sending a Plane link.
export const PLANE_LINKED_WORK_ITEM_RUNTIME_CAPABILITY =
  'worktree.linked-work-item.plane.v1' as const

export const PLANE_RUNTIME_CAPABILITIES = [
  PLANE_RUNTIME_CAPABILITY,
  PLANE_LINKED_WORK_ITEM_RUNTIME_CAPABILITY
] as const

export const PLANE_UPDATE_REQUIRED_MESSAGE =
  'Plane requires a newer Orca server. Update the server and try again.'
