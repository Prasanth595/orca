import { describe, expect, it } from 'vitest'
import { extractModuleReferences } from './module-references'

describe('extractModuleReferences', () => {
  it('marks re-exports and triple-slash references as declarations to follow', () => {
    const source = [
      '/// <reference path="globals.d.ts" />',
      '/// <reference types="node" />',
      "import { useState } from 'react'",
      'import type {',
      '  Props,',
      '  State',
      "} from './types'",
      "export { Button } from './button'",
      "export * as icons from '@scope/icons'",
      "import './styles.css'",
      "const lazy = import('./lazy')",
      "const legacy = require('legacy')"
    ].join('\n')

    const references = extractModuleReferences(source)

    expect(references).toEqual(
      expect.arrayContaining([
        { specifier: './globals.d.ts', reexport: true },
        { specifier: 'node', reexport: true },
        { specifier: 'react', reexport: false },
        { specifier: './types', reexport: false },
        { specifier: './button', reexport: true },
        { specifier: '@scope/icons', reexport: true },
        { specifier: './styles.css', reexport: false },
        { specifier: './lazy', reexport: false },
        { specifier: 'legacy', reexport: false }
      ])
    )
    expect(references).toHaveLength(9)
  })

  it('reports a module once, as a re-export if any statement re-exports it', () => {
    const source = "import { a } from './a'\nexport { b } from './a'"

    expect(extractModuleReferences(source)).toEqual([{ specifier: './a', reexport: true }])
  })
})
