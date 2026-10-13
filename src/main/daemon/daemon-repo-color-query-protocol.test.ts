import { describe, expect, it } from 'vitest'
import { supportsRepoColorQueryReplyColors } from './daemon-protocol-version'

describe('project colour query protocol gate', () => {
  it('sends project colours only to daemons that answer each session from them', () => {
    expect(supportsRepoColorQueryReplyColors(45)).toBe(false)
    expect(supportsRepoColorQueryReplyColors(46)).toBe(true)
  })
})
