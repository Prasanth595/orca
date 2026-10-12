import { z } from 'zod'
import { parseHostStableKey, automationInboxKey } from './automation-owner-key'
import { normalizeExecutionHostId } from './execution-host'
import { MAX_AUTOMATION_INBOX_TEXT_LENGTH } from './automation-run-inbox-alert'

export const MAX_AUTOMATION_INBOX_ENTRIES = 200

const HostId = z
  .string()
  .transform((value) => normalizeExecutionHostId(value) ?? undefined)
  .optional()
const Alert = z.object({
  automationId: z.string().min(1),
  runId: z.string().min(1),
  title: z.string().transform((value) => value.slice(0, MAX_AUTOMATION_INBOX_TEXT_LENGTH)),
  message: z.string().transform((value) => value.slice(0, MAX_AUTOMATION_INBOX_TEXT_LENGTH)),
  status: z.enum(['failed', 'needs_attention']),
  createdAt: z.number().finite().nonnegative(),
  workspaceId: z.string().nullable(),
  paneKey: z.string().nullable(),
  hostId: HostId,
  executionHostId: HostId
})
const Entry = z.object({
  alert: Alert,
  catalogKey: z.string().refine((key) => parseHostStableKey(key) !== null),
  read: z.boolean().default(false),
  dismissed: z.boolean().default(false),
  interactionAt: z.number().finite().nonnegative().default(0)
})

export type AutomationInboxEntry = z.infer<typeof Entry>
export type AutomationInboxEntries = Record<string, AutomationInboxEntry>

export function automationInboxEntryKey(entry: AutomationInboxEntry): string {
  const catalog = parseHostStableKey(entry.catalogKey)
  if (!catalog) {
    throw new Error('Invalid automation inbox host')
  }
  return automationInboxKey(catalog, entry.alert.runId)
}

function capEntries(entries: AutomationInboxEntries): AutomationInboxEntries {
  const values = Object.entries(entries)
  if (values.length <= MAX_AUTOMATION_INBOX_ENTRIES) {
    return entries
  }
  values.sort((a, b) => b[1].alert.createdAt - a[1].alert.createdAt || a[0].localeCompare(b[0]))
  return Object.fromEntries(values.slice(0, MAX_AUTOMATION_INBOX_ENTRIES))
}

export function normalizeAutomationInboxEntries(value: unknown): AutomationInboxEntries {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }
  const entries: AutomationInboxEntries = {}
  for (const item of Object.values(value)) {
    const parsed = Entry.safeParse(item)
    if (parsed.success) {
      entries[automationInboxEntryKey(parsed.data)] = parsed.data
    }
  }
  return capEntries(entries)
}

function sameEntry(a: AutomationInboxEntry, b: AutomationInboxEntry): boolean {
  const fields = [
    'automationId',
    'runId',
    'title',
    'message',
    'status',
    'createdAt',
    'workspaceId',
    'paneKey',
    'hostId',
    'executionHostId'
  ] as const
  return (
    a.catalogKey === b.catalogKey &&
    a.read === b.read &&
    a.dismissed === b.dismissed &&
    a.interactionAt === b.interactionAt &&
    fields.every((key) => a.alert[key] === b.alert[key])
  )
}

export function automationInboxEntriesEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true
  }
  const left = normalizeAutomationInboxEntries(a)
  const right = normalizeAutomationInboxEntries(b)
  const keys = Object.keys(left)
  return (
    keys.length === Object.keys(right).length &&
    keys.every((key) => right[key] && sameEntry(left[key], right[key]))
  )
}

export function mergeAutomationInboxEntries(
  current: AutomationInboxEntries,
  incoming: AutomationInboxEntries
): AutomationInboxEntries {
  let next = current
  for (const [key, entry] of Object.entries(incoming)) {
    const previous = current[key]
    if (previous?.alert.status === 'failed' && entry.alert.status === 'needs_attention') {
      continue
    }
    if (
      previous &&
      previous.alert.status === entry.alert.status &&
      previous.alert.createdAt > entry.alert.createdAt
    ) {
      continue
    }
    const sameVersion =
      previous?.alert.status === entry.alert.status &&
      previous.alert.createdAt === entry.alert.createdAt
    const updated =
      sameVersion && previous.interactionAt >= entry.interactionAt
        ? {
            ...entry,
            read: previous.read,
            dismissed: previous.dismissed,
            interactionAt: previous.interactionAt
          }
        : entry
    if (previous && sameEntry(previous, updated)) {
      continue
    }
    if (next === current) {
      next = { ...current }
    }
    next[key] = updated
  }
  return capEntries(next)
}

export function changeAutomationInboxEntries(
  current: AutomationInboxEntries,
  keys: readonly string[],
  action: 'read' | 'unread' | 'dismiss'
): AutomationInboxEntries {
  let next = current
  for (const key of keys) {
    const previous = current[key]
    if (
      !previous ||
      (action === 'dismiss' ? previous.dismissed : previous.read === (action === 'read'))
    ) {
      continue
    }
    if (next === current) {
      next = { ...current }
    }
    next[key] = {
      ...previous,
      ...(action === 'dismiss' ? { dismissed: true, read: true } : { read: action === 'read' }),
      interactionAt: Date.now()
    }
  }
  return next
}

export function countAutomationInboxUnread(entries: AutomationInboxEntries): number {
  return Object.values(entries).filter((entry) => !entry.read && !entry.dismissed).length
}
