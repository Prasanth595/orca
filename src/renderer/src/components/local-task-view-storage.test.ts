// @vitest-environment happy-dom
import { describe, expect, it, beforeEach, afterEach } from 'vitest'
import {
  loadLocalTaskViewState,
  saveLocalTaskViewState,
  LOCAL_TASK_VIEW_PREFS_KEY
} from './local-task-view-storage'

describe('local-task-view-storage', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  afterEach(() => {
    localStorage.clear()
  })

  it('round-trips group and order prefs under the orca.local key', () => {
    saveLocalTaskViewState({ groupBy: 'status', orderBy: 'created' })
    expect(localStorage.getItem(LOCAL_TASK_VIEW_PREFS_KEY)).toContain('status')
    expect(loadLocalTaskViewState()).toEqual({ groupBy: 'status', orderBy: 'created' })
  })

  it('falls back to defaults on missing or malformed payloads', () => {
    expect(loadLocalTaskViewState()).toEqual({ groupBy: 'status', orderBy: 'created' })
    localStorage.setItem(LOCAL_TASK_VIEW_PREFS_KEY, 'not-json{')
    expect(loadLocalTaskViewState()).toEqual({ groupBy: 'status', orderBy: 'created' })
    localStorage.setItem(LOCAL_TASK_VIEW_PREFS_KEY, JSON.stringify({ groupBy: 'nope' }))
    expect(loadLocalTaskViewState()).toEqual({ groupBy: 'status', orderBy: 'created' })
  })
})
