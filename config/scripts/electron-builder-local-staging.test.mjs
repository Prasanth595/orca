import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, it } from 'vitest'

const require = createRequire(import.meta.url)
const config = require('../electron-builder.config.cjs')
const { copyFiles, FileMatcher } = require('app-builder-lib/out/fileMatcher')

it('excludes local .tmp staging recursively while preserving application files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'orca-local-staging-'))
  const source = join(root, 'app')
  const destination = join(root, 'selected')
  const runtime = ['package.json', 'out/main/index.js', 'out/renderer/index.html']
  const staging = [
    '.tmp/windows-build-tools/pnpm.cmd',
    '.tmp/linux-arm64-build/archive.tar.gz',
    'out/.tmp/snapshot.index',
    'resources/nested/.tmp/profile/credentials.json'
  ]
  try {
    for (const path of [...runtime, ...staging]) {
      const file = join(source, path)
      await mkdir(dirname(file), { recursive: true })
      await writeFile(file, 'fixture\n')
    }
    await copyFiles([new FileMatcher(source, destination, (value) => value, config.files)])
    for (const path of runtime) {
      expect(await readFile(join(destination, path), 'utf8')).toBe('fixture\n')
    }
    for (const path of staging) {
      expect(existsSync(join(destination, path)), path).toBe(false)
    }
    for (const path of ['.tmp', 'out/.tmp', 'resources/nested/.tmp']) {
      expect(existsSync(join(destination, path)), path).toBe(false)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
