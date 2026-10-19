export const LOCAL_TASK_VIEW_PREFS_KEY = 'orca.local.view'

export type LocalTaskGroupBy = 'status'
export type LocalTaskOrderBy = 'created'

export type LocalTaskViewState = {
  groupBy: LocalTaskGroupBy
  orderBy: LocalTaskOrderBy
}

const DEFAULT_VIEW_STATE: LocalTaskViewState = { groupBy: 'status', orderBy: 'created' }

// Why localStorage, not taskResumeState: the resume object is strict, so any
// key an older host predates makes that host drop the entire resume state
// (linear-issue-view-storage precedent). Per-device prefs survive restarts.
export function loadLocalTaskViewState(): LocalTaskViewState {
  try {
    const raw = localStorage.getItem(LOCAL_TASK_VIEW_PREFS_KEY)
    if (!raw) {
      return DEFAULT_VIEW_STATE
    }
    const parsed: unknown = JSON.parse(raw)
    if (typeof parsed !== 'object' || parsed === null) {
      return DEFAULT_VIEW_STATE
    }
    if (!('groupBy' in parsed) || !('orderBy' in parsed)) {
      return DEFAULT_VIEW_STATE
    }
    const { groupBy, orderBy }: { groupBy: unknown; orderBy: unknown } = parsed
    if (groupBy !== 'status' || orderBy !== 'created') {
      return DEFAULT_VIEW_STATE
    }
    return DEFAULT_VIEW_STATE
  } catch {
    return DEFAULT_VIEW_STATE
  }
}

export function saveLocalTaskViewState(state: LocalTaskViewState): void {
  try {
    localStorage.setItem(LOCAL_TASK_VIEW_PREFS_KEY, JSON.stringify(state))
  } catch {
    // The live view stays usable when browser storage is unavailable or full.
  }
}
