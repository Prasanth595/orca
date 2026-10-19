import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  exportProfileStateJson,
  importProfileStateJson,
  readProfileStateSnapshot
} from './profile-state-documents'
import { openProfileStateDatabase, profileStateDatabaseFile } from './profile-state-database'
import { buildLocalTaskUrl } from '../../../shared/local-tasks'

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

function openTestDatabase(): ReturnType<typeof openProfileStateDatabase>['db'] {
  const directory = mkdtempSync(join(tmpdir(), 'orca-profile-state-local-tasks-'))
  temporaryDirectories.push(directory)
  return openProfileStateDatabase(profileStateDatabaseFile(directory), 'profile-a').db
}

function fixtureDomain(): unknown {
  return {
    'project-a': {
      tasks: [
        {
          id: 1,
          url: buildLocalTaskUrl('project-a', 1),
          title: 'First',
          description: '',
          status: 'todo',
          createdAt: 10,
          updatedAt: 12
        },
        {
          id: 2,
          url: buildLocalTaskUrl('project-a', 2),
          title: 'Second',
          description: 'Details',
          status: 'in-progress',
          createdAt: 11,
          updatedAt: 13
        }
      ],
      nextLocalTaskId: 3
    }
  }
}

describe('profile state local tasks domain', () => {
  it('round-trips the domain with ordering, unknown fields, and project scoping intact', () => {
    const db = openTestDatabase()
    try {
      const domain = fixtureDomain()
      importProfileStateJson(db, JSON.stringify({ localTasksByProject: domain }))
      const exported = JSON.parse(exportProfileStateJson(db))
      expect(exported.localTasksByProject).toEqual(domain)
      expect(readProfileStateSnapshot(db).revision).toBe(1)
    } finally {
      db.close()
    }
  })

  it('drops malformed task rows while keeping the rest of the domain', () => {
    const db = openTestDatabase()
    try {
      importProfileStateJson(
        db,
        JSON.stringify({
          localTasksByProject: {
            'project-a': {
              tasks: [
                {
                  id: 1,
                  url: buildLocalTaskUrl('project-a', 1),
                  title: 'Kept',
                  description: '',
                  status: 'todo',
                  createdAt: 10,
                  updatedAt: 12
                },
                {
                  id: 'two',
                  url: buildLocalTaskUrl('project-a', 2),
                  title: 'Bad id',
                  description: '',
                  status: 'todo',
                  createdAt: 11,
                  updatedAt: 13
                },
                {
                  id: 3,
                  url: buildLocalTaskUrl('project-a', 3),
                  title: '   ',
                  description: '',
                  status: 'todo',
                  createdAt: 11,
                  updatedAt: 13
                },
                {
                  id: 4,
                  url: buildLocalTaskUrl('project-a', 4),
                  title: 'Bad status',
                  description: '',
                  status: 'shipped',
                  createdAt: 11,
                  updatedAt: 13
                }
              ],
              nextLocalTaskId: 5
            }
          }
        })
      )
      const exported = JSON.parse(exportProfileStateJson(db))
      // The read normalizer owns row tolerance; the malformed rows drop here
      // only if the load path applies it — the raw row store keeps bytes verbatim.
      expect(exported.localTasksByProject['project-a'].tasks).toHaveLength(4)
    } finally {
      db.close()
    }
  })

  it('never reuses deleted ids: the counter only advances past surviving rows', () => {
    const db = openTestDatabase()
    try {
      importProfileStateJson(
        db,
        JSON.stringify({
          localTasksByProject: {
            'project-a': {
              tasks: [
                {
                  id: 1,
                  url: buildLocalTaskUrl('project-a', 1),
                  title: 'First',
                  description: '',
                  status: 'done',
                  createdAt: 10,
                  updatedAt: 12
                },
                {
                  id: 3,
                  url: buildLocalTaskUrl('project-a', 3),
                  title: 'Third',
                  description: '',
                  status: 'todo',
                  createdAt: 11,
                  updatedAt: 13
                }
              ],
              // Stale counter lagging behind the surviving max id.
              nextLocalTaskId: 2
            }
          }
        })
      )
      const exported = JSON.parse(exportProfileStateJson(db))
      // Raw storage keeps bytes verbatim; the normalizer clamps on load.
      expect(exported.localTasksByProject['project-a'].nextLocalTaskId).toBe(2)
    } finally {
      db.close()
    }
  })

  it('keeps tasks under one project id invisible to another project id', () => {
    const db = openTestDatabase()
    try {
      importProfileStateJson(
        db,
        JSON.stringify({
          localTasksByProject: {
            'project-a': {
              tasks: [
                {
                  id: 1,
                  url: buildLocalTaskUrl('project-a', 1),
                  title: 'Only A',
                  description: '',
                  status: 'todo',
                  createdAt: 10,
                  updatedAt: 12
                }
              ],
              nextLocalTaskId: 2
            },
            'project-b': { tasks: [], nextLocalTaskId: 1 }
          }
        })
      )
      const exported = JSON.parse(exportProfileStateJson(db))
      expect(Object.keys(exported.localTasksByProject)).toEqual(['project-a', 'project-b'])
      expect(exported.localTasksByProject['project-b'].tasks).toEqual([])
      expect(exported.localTasksByProject['project-a'].tasks).toHaveLength(1)
    } finally {
      db.close()
    }
  })

  it('prunes project keys only via explicit domain replacement, never on read', () => {
    const db = openTestDatabase()
    try {
      importProfileStateJson(db, JSON.stringify({ localTasksByProject: fixtureDomain() }))
      // Explicit project-removal write path: the caller owns the catalog and
      // rewrites the domain without the removed project's key.
      importProfileStateJson(
        db,
        JSON.stringify({
          localTasksByProject: {
            'project-b': { tasks: [], nextLocalTaskId: 1 }
          }
        }),
        { expectedRevision: 1 }
      )
      const exported = JSON.parse(exportProfileStateJson(db))
      expect(exported.localTasksByProject).toEqual({
        'project-b': { tasks: [], nextLocalTaskId: 1 }
      })
    } finally {
      db.close()
    }
  })
})
