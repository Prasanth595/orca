import type * as Monaco from 'monaco-editor'
import type { LanguageRegistration } from 'shiki/core'
import {
  registerTextMateLanguage,
  type TextMateLanguageRegistration
} from './textmate-language-registration'

type MonacoModule = typeof Monaco

export const RUBY_LANGUAGE_ID = 'ruby'
export const RUBY_TEXTMATE_SCOPE = 'source.ruby'

export async function loadRubyTextMateGrammar(): Promise<LanguageRegistration> {
  // Why: VS Code's Ruby grammar (microsoft/vscode@af600487b1e9); provenance and MIT licenses in ruby-LICENSE.txt.
  const grammarModule = await import('./textmate-grammars/ruby.tmLanguage.json')
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: TextMate injects the $self/$base repository entries a registration's type requires; real tokenization tests validate this vendored JSON.
  const grammar = grammarModule.default as unknown as LanguageRegistration
  // Why: heredoc-embedded grammars (source.sql, text.html.basic, ...) are not vendored; their bodies stay plain.
  return { ...grammar, name: RUBY_LANGUAGE_ID }
}

export const rubyTextMateRegistration: TextMateLanguageRegistration = {
  // Why: Monaco already registers Ruby; Orca's file associations live in language-detect.ts.
  language: { id: RUBY_LANGUAGE_ID },
  loadGrammar: loadRubyTextMateGrammar,
  // Why: Monaco pre-registers Ruby (Monarch tokenizer + configuration); only the tokenizer is replaced.
  replaceExistingTokenizer: true
}

export function registerRubyLanguage(monaco: MonacoModule): void {
  registerTextMateLanguage(monaco, rubyTextMateRegistration)
}
