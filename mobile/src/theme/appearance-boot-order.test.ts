import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('mobile/index.js', () => {
  it('imports the appearance boot module before any other module', () => {
    const source = readFileSync(join(__dirname, '../../index.js'), 'utf8')
    const imports = [...source.matchAll(/^import\s+(?:[^'"]*from\s+)?['"]([^'"]+)['"]/gm)].map(
      (match) => match[1]
    )
    expect(imports[0]).toBe('./src/theme/appearance-boot')
    expect(imports.length).toBeGreaterThan(1)
  })
})
