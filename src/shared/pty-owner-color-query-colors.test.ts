import { expect, it } from 'vitest'
import { DEFAULT_TERMINAL_THEME_DARK } from './terminal-theme-selection'
import { TERMINAL_THEME_CATALOG } from './terminal-themes'
import {
  ORCA_DEFAULT_COLOR_QUERY_REPLY_COLORS,
  _resetPtyOwnerHostColorsForTest,
  colorQueryReplyColorsEqual,
  getPtyOwnerHostColors,
  normalizeColorQueryReplyColors,
  normalizePtyOwnerHostColors,
  resolvePtyOwnerColorQueryColors,
  setPtyOwnerHostColors
} from './pty-owner-color-query-colors'

it("falls back to the colours of Orca's default dark terminal theme", () => {
  const theme = TERMINAL_THEME_CATALOG[DEFAULT_TERMINAL_THEME_DARK]
  expect(ORCA_DEFAULT_COLOR_QUERY_REPLY_COLORS).toEqual({
    foreground: theme?.foreground,
    background: theme?.background
  })
})

it('prefers host colours, then spawn colours, then the default, skipping unusable pairs', () => {
  const host = { foreground: '#000000', background: '#111111' }
  const spawn = { foreground: '#222222', background: '#333333' }
  const unusable = { foreground: 'red', background: '#333333' }

  expect(resolvePtyOwnerColorQueryColors(host, spawn)).toEqual(host)
  expect(resolvePtyOwnerColorQueryColors(null, spawn)).toEqual(spawn)
  expect(resolvePtyOwnerColorQueryColors(unusable, spawn)).toEqual(spawn)
  expect(resolvePtyOwnerColorQueryColors(null, unusable)).toBe(
    ORCA_DEFAULT_COLOR_QUERY_REPLY_COLORS
  )
  expect(resolvePtyOwnerColorQueryColors(undefined, {})).toBe(ORCA_DEFAULT_COLOR_QUERY_REPLY_COLORS)
})

it('keeps only a wire pair that answers both slots', () => {
  expect(
    normalizeColorQueryReplyColors({ foreground: '#fff', background: 'rgb(1, 2, 3)' })
  ).toEqual({ foreground: '#fff', background: 'rgb(1, 2, 3)' })
  expect(normalizeColorQueryReplyColors({ foreground: '#fff' })).toBeNull()
  expect(normalizeColorQueryReplyColors({ foreground: '#fff', background: 'blue' })).toBeNull()
  expect(normalizeColorQueryReplyColors('#fff')).toBeNull()
  expect(normalizeColorQueryReplyColors(null)).toBeNull()
})

it('answers an agent pane from its host override, else the host colours', () => {
  const host = {
    foreground: '#000000',
    background: '#111111',
    byAgent: { codex: { foreground: '#aaaaaa', background: '#bbbbbb' } }
  }
  const spawn = { foreground: '#222222', background: '#333333' }

  expect(resolvePtyOwnerColorQueryColors(host, spawn, 'codex')).toEqual(host.byAgent.codex)
  expect(resolvePtyOwnerColorQueryColors(host, spawn, 'claude')).toBe(host)
  expect(resolvePtyOwnerColorQueryColors(host, spawn, null)).toBe(host)
  expect(resolvePtyOwnerColorQueryColors(host, spawn)).toBe(host)
})

it('keeps each usable per-agent pair of a host push and drops the rest', () => {
  const normalized = normalizePtyOwnerHostColors({
    foreground: '#000000',
    background: '#111111',
    byAgent: {
      codex: { foreground: '#aaaaaa', background: '#bbbbbb' },
      claude: { foreground: 'red', background: '#bbbbbb' },
      'not-an-agent': { foreground: '#aaaaaa', background: '#bbbbbb' }
    }
  })

  expect(normalized).toEqual({
    foreground: '#000000',
    background: '#111111',
    byAgent: { codex: { foreground: '#aaaaaa', background: '#bbbbbb' } }
  })
  expect(normalizePtyOwnerHostColors({ foreground: '#000000', background: '#111111' })).toEqual({
    foreground: '#000000',
    background: '#111111'
  })
  expect(normalizePtyOwnerHostColors({ byAgent: {} })).toBeNull()
})

it('compares host colours including per-agent overrides', () => {
  const base = { foreground: '#000000', background: '#111111' }
  const withCodex = {
    ...base,
    byAgent: { codex: { foreground: '#aaaaaa', background: '#bbbbbb' } }
  }

  expect(colorQueryReplyColorsEqual(base, { ...base })).toBe(true)
  expect(colorQueryReplyColorsEqual(base, withCodex)).toBe(false)
  expect(colorQueryReplyColorsEqual(withCodex, { ...withCodex })).toBe(true)
  expect(colorQueryReplyColorsEqual(null, null)).toBe(true)
})

it('stores per-agent host colours pushed to this process', () => {
  setPtyOwnerHostColors({
    foreground: '#000000',
    background: '#111111',
    byAgent: { codex: { foreground: '#aaaaaa', background: '#bbbbbb' } }
  })
  expect(getPtyOwnerHostColors()?.byAgent?.codex).toEqual({
    foreground: '#aaaaaa',
    background: '#bbbbbb'
  })
  _resetPtyOwnerHostColorsForTest()
})
