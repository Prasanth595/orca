import { describe, expect, it } from 'vitest'
import { createUIStore, makePersistedUI } from './ui-slice-test-harness'
import { makeAutomationInboxEntry } from '../../../../shared/automation-inbox-test-fixture'
import { normalizeAutomationInboxEntries } from '../../../../shared/automation-inbox'
import {
  capturePersistedUIWriteBaseline,
  diffPersistedUIWriteFields
} from './persisted-ui-write-baseline'

describe('automation inbox hydration', () => {
  it.each(['read', 'dismiss'] as const)(
    'keeps an unsaved %s receipt dirty after an older UI broadcast',
    (action) => {
      const store = createUIStore()
      const records = normalizeAutomationInboxEntries({ entry: makeAutomationInboxEntry() })
      const previous = makePersistedUI({ automationInboxEntries: records })
      store.getState().hydratePersistedUI(previous, 'startup')
      store.getState().changeAutomationInbox(Object.keys(records), action)
      const current = store.getState().automationInboxEntries
      const incoming = normalizeAutomationInboxEntries({
        ...records,
        other: makeAutomationInboxEntry({ runId: 'run-2', createdAt: 20 })
      })

      store
        .getState()
        .hydratePersistedUI(makePersistedUI({ automationInboxEntries: incoming }), 'sync')

      const state = store.getState()
      expect(Object.values(state.automationInboxEntries)).toHaveLength(2)
      expect(state.automationInboxEntries[Object.keys(records)[0]]).toEqual(
        Object.values(current)[0]
      )
      expect(state.persistedUIWriteBaseline?.automationInboxEntries).toEqual(incoming)
      expect(
        diffPersistedUIWriteFields(
          capturePersistedUIWriteBaseline(state),
          state.persistedUIWriteBaseline ?? capturePersistedUIWriteBaseline(state)
        )
      ).toEqual({ automationInboxEntries: state.automationInboxEntries })
    }
  )

  it('accepts another client’s newer read receipt without writing it back', () => {
    const store = createUIStore()
    const entry = makeAutomationInboxEntry()
    store.getState().hydratePersistedUI(
      makePersistedUI({
        automationInboxEntries: normalizeAutomationInboxEntries({ entry })
      }),
      'startup'
    )
    const updated = normalizeAutomationInboxEntries({
      entry: { ...entry, read: true, interactionAt: 100 }
    })

    store
      .getState()
      .hydratePersistedUI(makePersistedUI({ automationInboxEntries: updated }), 'sync')

    const state = store.getState()
    expect(state.automationInboxEntries).toEqual(updated)
    expect(
      diffPersistedUIWriteFields(
        capturePersistedUIWriteBaseline(state),
        state.persistedUIWriteBaseline ?? capturePersistedUIWriteBaseline(state)
      )
    ).toEqual({})
  })
})
