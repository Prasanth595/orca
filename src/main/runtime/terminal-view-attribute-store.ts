/**
 * Phase 5 slice 2 (View-attribute bridge): main-side cache of the renderer's
 * `pty:terminalViewAttributes` push, an atomic `{global, byAgent}` snapshot.
 * Per-pane font zoom never affects these attributes; an agent key is present
 * only when that agent's theme overrides the global one (absent = inherit).
 *
 * Null until the first push; the hidden-pane model responder answers its
 * OSC 4/12 and ?996n queries only once it is set. OSC 10/11 never reach it
 * from a current PTY owner, which answers them itself from the viewer colours
 * below. Staleness is bounded by one IPC hop; subscribed TUIs are corrected by
 * the renderer-owned 2031/997 flip. Fan-out to live emulators is effective-diff
 * only, so a no-op inherit never clears live OSC overlays.
 */
import {
  terminalViewAttributesEqual,
  terminalViewColorQueryReplyColors,
  type TerminalViewAttributes
} from '../../shared/terminal-view-attributes'
import type { TerminalOscColorQueryReplyColors } from '../../shared/terminal-osc-color-reply'
import {
  colorQueryReplyColorsEqual,
  type PtyOwnerHostColors
} from '../../shared/pty-owner-color-query-colors'
import { isTuiAgent } from '../../shared/tui-agent-config'
import type { TuiAgent } from '../../shared/tui-agent'

export type TerminalViewAttributesSnapshotState = {
  global: TerminalViewAttributes
  byAgent: Partial<Record<TuiAgent, TerminalViewAttributes>>
}

export type TerminalViewAttributesApplier = (
  attributes: TerminalViewAttributes,
  scope: { launchAgent: TuiAgent | null }
) => void

// Why module state (pattern of pty-hidden-delivery-gate.ts): pty.ts receives
// the push, the runtime emulators consult it at reply time via the getter.
let currentSnapshot: TerminalViewAttributesSnapshotState | null = null

// Why one value for every pane: the host shows the same panes to every viewer. This host's own
// window answers when it has one; a paired client's push answers only on a headless host.
// Per-agent seeds stand in for the agent overrides until this host's window reports them.
let pairedViewerColors: TerminalOscColorQueryReplyColors | null = null
let seedColors: TerminalOscColorQueryReplyColors | null = null
let seedAgentColors: Partial<Record<TuiAgent, TerminalOscColorQueryReplyColors>> = {}
let viewerColorsListener: ((colors: PtyOwnerHostColors) => void) | null = null

// Why appliers (pattern of registerConptyDa1OverrideInstaller): each push
// must also reach already-live emulators — cursor options under the replay
// guard, plus the per-PTY override reset a theme apply implies.
const pushAppliers = new Set<TerminalViewAttributesApplier>()

export function registerTerminalViewAttributesApplier(
  applier: TerminalViewAttributesApplier
): void {
  pushAppliers.add(applier)
}

export function effectiveTerminalViewAttributes(
  snapshot: TerminalViewAttributesSnapshotState | null,
  launchAgent?: TuiAgent | null
): TerminalViewAttributes | null {
  if (!snapshot) {
    return null
  }
  return (launchAgent ? snapshot.byAgent[launchAgent] : undefined) ?? snapshot.global
}

function collectEffectiveScopes(
  previous: TerminalViewAttributesSnapshotState | null,
  next: TerminalViewAttributesSnapshotState
): Set<TuiAgent | null> {
  const scopes = new Set<TuiAgent | null>([null])
  for (const key of [...Object.keys(previous?.byAgent ?? {}), ...Object.keys(next.byAgent)]) {
    if (isTuiAgent(key)) {
      scopes.add(key)
    }
  }
  return scopes
}

/** Called from the pty:terminalViewAttributes IPC handler with a validated
 *  push. Last push wins (replies always use the freshest snapshot). */
export function commitTerminalViewAttributesSnapshot(
  snapshot: TerminalViewAttributesSnapshotState
): void {
  const next: TerminalViewAttributesSnapshotState = {
    global: snapshot.global,
    byAgent: { ...snapshot.byAgent }
  }
  const previous = currentSnapshot
  const before = getTerminalViewerHostColors()
  currentSnapshot = next
  // Why per effective scope and idempotent: the renderer publisher's dedupe is per-process, so a
  // fresh renderer (second window, reload, macOS re-activation) re-pushes identical attributes.
  // That is not a theme apply — fanning out would wipe every PTY's OSC SET overlay while visible
  // panes keep theirs.
  for (const scope of collectEffectiveScopes(previous, next)) {
    const newEffective = effectiveTerminalViewAttributes(next, scope)
    const oldEffective = effectiveTerminalViewAttributes(previous, scope)
    if (
      !newEffective ||
      (oldEffective && terminalViewAttributesEqual(oldEffective, newEffective))
    ) {
      continue
    }
    for (const applier of pushAppliers) {
      applier(newEffective, { launchAgent: scope })
    }
  }
  notifyIfViewerColorsChanged(before)
}

/** A single global palette with no agent overrides. */
export function setTerminalViewAttributes(attributes: TerminalViewAttributes): void {
  commitTerminalViewAttributesSnapshot({ global: attributes, byAgent: {} })
}

export function getTerminalViewAttributes(
  launchAgent?: TuiAgent | null
): TerminalViewAttributes | null {
  return effectiveTerminalViewAttributes(currentSnapshot, launchAgent)
}

export function hasExplicitAgentViewAttributes(agent: TuiAgent): boolean {
  return currentSnapshot?.byAgent[agent] != null
}

/** Whether a PTY launched by `ptyLaunchAgent` is governed by the fan-out scope: its own agent's
 *  override, or the global palette when that agent has no override. */
export function ptyMatchesViewAttributeScope(
  ptyLaunchAgent: TuiAgent | null | undefined,
  scopeLaunchAgent: TuiAgent | null
): boolean {
  const agent = ptyLaunchAgent ?? null
  if (agent === scopeLaunchAgent) {
    return true
  }
  return scopeLaunchAgent === null && agent !== null && !hasExplicitAgentViewAttributes(agent)
}

export function getTerminalViewColorQueryReplyColors(
  launchAgent?: TuiAgent | null
): TerminalOscColorQueryReplyColors | null {
  const attributes = getTerminalViewAttributes(launchAgent)
  return attributes ? terminalViewColorQueryReplyColors(attributes) : null
}

/** The colours OSC 10/11 answer with on this host for a pane launched by `launchAgent`: its own
 *  window, else a paired client, else the saved theme. */
export function getTerminalViewerColors(
  launchAgent?: TuiAgent | null
): TerminalOscColorQueryReplyColors | null {
  return (
    getTerminalViewColorQueryReplyColors(launchAgent) ??
    (launchAgent && !currentSnapshot ? seedAgentColors[launchAgent] : undefined) ??
    pairedViewerColors ??
    seedColors
  )
}

/** The host-wide colours plus every agent override the owner should answer with. */
export function getTerminalViewerHostColors(): PtyOwnerHostColors | null {
  const colors = getTerminalViewerColors()
  if (!colors) {
    return null
  }
  const byAgent: Partial<Record<TuiAgent, TerminalOscColorQueryReplyColors>> = {}
  const overriddenAgents = Object.keys(currentSnapshot ? currentSnapshot.byAgent : seedAgentColors)
  for (const agent of overriddenAgents) {
    if (!isTuiAgent(agent)) {
      continue
    }
    const agentColors = getTerminalViewerColors(agent)
    if (agentColors) {
      byAgent[agent] = agentColors
    }
  }
  return Object.keys(byAgent).length > 0 ? { ...colors, byAgent } : colors
}

/** A paired client's theme, from terminal.setViewerColors or the colours on terminal.create. */
export function setPairedViewerColors(colors: TerminalOscColorQueryReplyColors): void {
  const before = getTerminalViewerHostColors()
  pairedViewerColors = colors
  notifyIfViewerColorsChanged(before)
}

/** The saved theme, answering until a viewer reports its colours. */
export function seedTerminalViewerColors(
  colors: TerminalOscColorQueryReplyColors,
  byAgent: Partial<Record<TuiAgent, TerminalOscColorQueryReplyColors>> = {}
): void {
  const before = getTerminalViewerHostColors()
  seedColors = colors
  seedAgentColors = { ...byAgent }
  notifyIfViewerColorsChanged(before)
}

function notifyIfViewerColorsChanged(before: PtyOwnerHostColors | null): void {
  const colors = getTerminalViewerHostColors()
  if (colors && !colorQueryReplyColorsEqual(before, colors)) {
    viewerColorsListener?.(colors)
  }
}

/** One listener: the PTY IPC layer re-installs it on macOS re-activation. */
export function setTerminalViewerColorsListener(
  listener: ((colors: PtyOwnerHostColors) => void) | null
): void {
  viewerColorsListener = listener
}

/** Test seam: reset module state between tests. */
export function _resetTerminalViewAttributesForTest(): void {
  currentSnapshot = null
  pushAppliers.clear()
  pairedViewerColors = null
  seedColors = null
  seedAgentColors = {}
  viewerColorsListener = null
}
