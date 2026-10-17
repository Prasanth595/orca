import { describe, expect, it } from 'vitest'
import { ISSUE_QUERY, mapIssue } from './issue-context-raw'

const issue = {
  id: '11111111-1111-4111-8111-111111111111',
  identifier: 'ENG-1',
  title: 'Task',
  url: 'https://linear.app/example/issue/ENG-1',
  description: 'Body',
  priority: 2
}
const parent = {
  id: '22222222-2222-4222-8222-222222222222',
  identifier: 'ENG-2',
  url: 'https://linear.app/example/issue/ENG-2',
  team: { id: '33333333-3333-4333-8333-333333333333', key: 'ENG' }
}

describe('Issue parent and label completeness', () => {
  it('queries parent identity and label page completeness alongside legacy fields', () => {
    expect(ISSUE_QUERY).toContain('parent { id identifier url team { id key } }')
    expect(ISSUE_QUERY).toContain('labels(first: 50)')
    expect(ISSUE_QUERY).toContain('pageInfo { hasNextPage }')
  })
  it('preserves explicit null and fully resolved parent identity', () => {
    expect(mapIssue({ ...issue, parent: null })).toMatchObject({
      ...issue,
      parent: null,
      parentComplete: true
    })
    expect(mapIssue({ ...issue, parent })).toMatchObject({ parent, parentComplete: true })
  })
  it('does not convert absent or malformed parent into known null', () => {
    const absent = mapIssue(issue)
    expect(absent.parentComplete).toBe(false)
    expect(absent).not.toHaveProperty('parent')
    const malformed = mapIssue({ ...issue, parent: { ...parent, id: 'bad-id' } })
    expect(malformed.parentComplete).toBe(false)
    expect(malformed).not.toHaveProperty('parent')
  })
  it('distinguishes complete empty labels from unknown and capped labels', () => {
    expect(
      mapIssue({ ...issue, labels: { nodes: [], pageInfo: { hasNextPage: false } } }).labelsComplete
    ).toBe(true)
    expect(
      mapIssue({ ...issue, labels: { nodes: [], pageInfo: { hasNextPage: true } } }).labelsComplete
    ).toBe(false)
    expect(mapIssue({ ...issue, labels: { nodes: [] } }).labelsComplete).toBe(false)
    expect(mapIssue(issue).labelsComplete).toBe(false)
  })
  it('preserves existing label objects, description, priority and identity', () => {
    const labels = [{ id: 'label-1', name: 'Ready', color: '#ffffff' }]
    expect(
      mapIssue({ ...issue, labels: { nodes: labels, pageInfo: { hasNextPage: false } } })
    ).toMatchObject({ ...issue, labels, labelsComplete: true })
  })
})
