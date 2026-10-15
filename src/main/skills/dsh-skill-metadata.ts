import { parseDocument } from 'yaml'
import { z } from 'zod'

const skillMetadata = z.object({
  name: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().min(1),
  'user-invocable': z.unknown().optional(),
  'disable-model-invocation': z.unknown().optional(),
  userInvocable: z.never().optional(),
  modelInvocable: z.never().optional(),
  disableModelInvocation: z.never().optional()
})

function invocationBoolean(value: unknown): boolean | undefined {
  if (value === undefined || typeof value === 'boolean') {
    return value
  }
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new Error('Invalid DSH skill invocation policy')
  }
  const spelling = String(value).toLowerCase()
  if (['true', 'yes', 'on', '1'].includes(spelling)) {
    return true
  }
  if (['false', 'no', 'off', '0'].includes(spelling)) {
    return false
  }
  throw new Error('Invalid DSH skill invocation policy')
}

/** The user-facing DSH catalog needs valid frontmatter and a user-invocable skill. */
export function readDshSkillMetadata(
  markdown: string
): { name: string; description: string; userInvocable: boolean } | null {
  const match = /^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/.exec(markdown)
  if (!match) {
    return null
  }
  try {
    const document = parseDocument(match[1]!)
    if (document.errors.length > 0) {
      return null
    }
    const parsed = skillMetadata.safeParse(document.toJS())
    if (!parsed.success) {
      return null
    }
    invocationBoolean(parsed.data['disable-model-invocation'])
    return {
      name: parsed.data.name,
      description: parsed.data.description,
      userInvocable: invocationBoolean(parsed.data['user-invocable']) !== false
    }
  } catch {
    return null
  }
}
