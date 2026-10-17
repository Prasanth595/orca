import { describe, expect, it } from 'vitest'
import {
  ompSettingsMayPickModel,
  openCodeAgentFileMayPickModel
} from './agent-project-model-config-keys'

describe('project YAML config', () => {
  it('reads a repeated key rather than counting the file as unparseable', () => {
    expect(ompSettingsMayPickModel('theme: dark\ntheme: light\n', 'yaml')).toBe(false)
    expect(ompSettingsMayPickModel('theme: dark\ntheme: light\nmodelRoles: {}\n', 'yaml')).toBe(
      true
    )
    expect(openCodeAgentFileMayPickModel('---\ndescription: a\ndescription: b\n---\nBody')).toBe(
      false
    )
    expect(openCodeAgentFileMayPickModel('---\nmodel: a/b\nmodel: c/d\n---\n')).toBe(true)
  })

  it('counts a file that uses aliases as unreadable without resolving them', () => {
    expect(ompSettingsMayPickModel('theme: &t dark\naccent: *t\n', 'yaml')).toBe(true)
    expect(ompSettingsMayPickModel('theme: &t dark\n', 'yaml')).toBe(false)
    expect(openCodeAgentFileMayPickModel('---\ndescription: &d a\ntitle: *d\n---\n')).toBe(true)
  })
})
