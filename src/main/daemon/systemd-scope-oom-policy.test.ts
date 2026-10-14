import { describe, expect, it } from 'vitest'
import {
  busctlOomPolicyProperties,
  parseSystemdMajorVersion,
  parseSystemdManagerVersion,
  scopeOomPolicyReason,
  supportsScopeOomPolicy,
  systemdRunOomPolicyArgs
} from './systemd-scope-oom-policy'

describe('parseSystemdMajorVersion', () => {
  it.each([
    ['systemd 253 (253.5-1)\n+PAM +AUDIT', 253],
    ['systemd 245 (245.4-4ubuntu3.24)\n', 245],
    ['systemd 257 (257~rc1)\r\n+PAM', 257],
    ['  systemd 256 (256.7-1-arch)', 256],
    ['systemd 259\r\nfoo', 259]
  ])('parses %j', (input, expected) => {
    expect(parseSystemdMajorVersion(input)).toBe(expected)
  })

  it.each(['', 'garbage', 'systemd', 'foo\nsystemd 255 (255)', 'systemd 99999999999999999999'])(
    'returns null for %j',
    (input) => {
      expect(parseSystemdMajorVersion(input)).toBeNull()
    }
  )
})

describe('parseSystemdManagerVersion', () => {
  it.each([
    ['259.5-0ubuntu3.4\n', 259],
    ['245.4-4ubuntu3.24', 245],
    ['257~rc1', 257],
    ['256.7-1-arch\r\n', 256],
    ['  253  ', 253]
  ])('parses %j', (input, expected) => {
    expect(parseSystemdManagerVersion(input)).toBe(expected)
  })

  it.each(['', '  ', 'garbage', 'v255'])('returns null for %j', (input) => {
    expect(parseSystemdManagerVersion(input)).toBeNull()
  })
})

describe('supportsScopeOomPolicy', () => {
  it('starts at systemd 253', () => {
    expect(supportsScopeOomPolicy(252)).toBe(false)
    expect(supportsScopeOomPolicy(253)).toBe(true)
    expect(supportsScopeOomPolicy(null)).toBe(false)
  })
})

describe('OOM policy arguments', () => {
  it('emits systemd-run and busctl properties only when on', () => {
    expect(systemdRunOomPolicyArgs({ oomPolicyContinue: true })).toEqual([
      '--property=OOMPolicy=continue'
    ])
    expect(systemdRunOomPolicyArgs({})).toEqual([])
    expect(busctlOomPolicyProperties({ oomPolicyContinue: true })).toEqual({
      count: 1,
      args: ['OOMPolicy', 's', 'continue']
    })
    expect(busctlOomPolicyProperties({ oomPolicyContinue: false })).toEqual({ count: 0, args: [] })
  })
})

describe('scopeOomPolicyReason', () => {
  it('names the branch that decided', () => {
    expect(scopeOomPolicyReason(null, null)).toContain('unparsable')
    expect(scopeOomPolicyReason(245, null)).toContain('systemd-run 245')
    expect(scopeOomPolicyReason(255, null)).toContain('unavailable')
    expect(scopeOomPolicyReason(255, 249)).toContain('user manager 249')
  })
})
