import { normalizePlaneWorkspaceSlug } from '../../../../shared/plane-ids'
import type { PlaneHostKind } from '../../../../shared/plane-types'
import { normalizePlaneConnectionUrls } from '../../../../shared/plane-url'
import type { PlaneErrorKind } from './plane-error-copy'

export type PlaneWorkspaceChipStatus = 'pending' | 'connecting' | 'connected' | 'failed'

/** One workspace slug in the connect dialog and how its own verification went. */
export type PlaneWorkspaceChip = {
  slug: string
  status: PlaneWorkspaceChipStatus
  error?: PlaneErrorKind
  connectionId?: string
  projectCount?: number
}

/** What a pasted Plane browser URL says about the server, besides its workspace slug. */
export type PlanePastedServer = { hostKind: PlaneHostKind; serverUrl: string }

export type PlaneSlugEntries = {
  slugs: string[]
  /** Entries that are neither a valid slug nor a Plane URL with one. */
  invalid: string[]
  server: PlanePastedServer | null
}

const ENTRY_SEPARATOR = /[\s,]+/

function looksLikeUrl(entry: string): boolean {
  return entry.includes('/') || /^[a-z][a-z0-9+.-]*:/i.test(entry)
}

/**
 * Splits typed or pasted text on commas and whitespace. A Plane browser URL contributes its
 * workspace slug and, for the first one, its server; anything else must already be a slug.
 */
export function parsePlaneSlugEntries(text: string): PlaneSlugEntries {
  const result: PlaneSlugEntries = { slugs: [], invalid: [], server: null }
  for (const entry of text.split(ENTRY_SEPARATOR).filter(Boolean)) {
    if (!looksLikeUrl(entry)) {
      const slug = normalizePlaneWorkspaceSlug(entry)
      if (slug) {
        result.slugs.push(slug)
      } else {
        result.invalid.push(entry)
      }
      continue
    }
    const urls = normalizePlaneConnectionUrls({ hostKind: 'self-hosted', serverUrl: entry })
    if (!urls.ok || !urls.slugSuggestion) {
      result.invalid.push(entry)
      continue
    }
    result.slugs.push(urls.slugSuggestion)
    result.server ??= { hostKind: urls.hostKind, serverUrl: urls.webBaseUrl }
  }
  return result
}

export function addPlaneWorkspaceChips(
  chips: readonly PlaneWorkspaceChip[],
  slugs: readonly string[]
): PlaneWorkspaceChip[] {
  const next = [...chips]
  for (const slug of slugs) {
    if (!next.some((chip) => chip.slug === slug)) {
      next.push({ slug, status: 'pending' })
    }
  }
  return next
}

export function updatePlaneWorkspaceChip(
  chips: readonly PlaneWorkspaceChip[],
  slug: string,
  patch: Omit<Partial<PlaneWorkspaceChip>, 'slug'>
): PlaneWorkspaceChip[] {
  return chips.map((chip) => {
    if (chip.slug !== slug) {
      return chip
    }
    // Why rebuild: a retried chip must not keep the previous attempt's error or connection.
    return { slug: chip.slug, status: chip.status, ...patch }
  })
}

/** Chips still to verify: new ones and ones whose last attempt failed. */
export function planeChipsToConnect(chips: readonly PlaneWorkspaceChip[]): PlaneWorkspaceChip[] {
  return chips.filter((chip) => chip.status === 'pending' || chip.status === 'failed')
}

export function allPlaneChipsConnected(chips: readonly PlaneWorkspaceChip[]): boolean {
  return chips.length > 0 && chips.every((chip) => chip.status === 'connected')
}
