import { describe, expect, it } from 'vitest'
import {
  RUBY_LANGUAGE_ID,
  RUBY_TEXTMATE_SCOPE,
  loadRubyTextMateGrammar,
  rubyTextMateRegistration
} from './register-ruby'

describe('rubyTextMateRegistration', () => {
  it("replaces the built-in Ruby tokenizer and keeps Monaco's Ruby language configuration", () => {
    expect(rubyTextMateRegistration).toMatchObject({
      loadGrammar: loadRubyTextMateGrammar,
      replaceExistingTokenizer: true
    })
    expect(rubyTextMateRegistration.configuration).toBeUndefined()
  })

  it('only names the pre-registered Ruby language', () => {
    expect(rubyTextMateRegistration.language).toEqual({ id: RUBY_LANGUAGE_ID })
  })
})

describe('loadRubyTextMateGrammar', () => {
  it('loads the vendored VS Code Ruby grammar under the Ruby language id', async () => {
    await expect(loadRubyTextMateGrammar()).resolves.toMatchObject({
      name: RUBY_LANGUAGE_ID,
      scopeName: RUBY_TEXTMATE_SCOPE
    })
  })
})
