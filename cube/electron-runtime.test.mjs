import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { launchElectronServe, electronServeEnvironment } from './electron-runtime.mjs'

test('pins the profile and removes inherited Electron development overrides', () => {
  const env = electronServeEnvironment('/app', '/state', ':44', {
    PATH: '/bin',
    HOME: '/home/test',
    ELECTRON_RUN_AS_NODE: '1',
    ELECTRON_RENDERER_URL: 'http://wrong',
    ORCA_E2E_USER_DATA_DIR: '/other'
  })
  assert.equal(env.ORCA_DEV_USER_DATA_PATH, '/state')
  assert.equal(env.ORCA_SERVE_USER_DATA_PATH, '/state')
  assert.equal(env.HOME, '/home/test')
  assert.equal(env.DISPLAY, ':44')
  assert.equal(env.ELECTRON_RUN_AS_NODE, undefined)
  assert.equal(env.ELECTRON_RENDERER_URL, undefined)
  assert.equal(env.ORCA_E2E_USER_DATA_DIR, undefined)
})

test('stops only its Electron process and display when cancelled', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'orca-electron-supervisor-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const display = join(root, 'display'),
    electron = join(root, 'electron')
  await writeFile(
    display,
    `#!${process.execPath}\nrequire('fs').writeSync(3,'44\\n');setInterval(()=>{},1000)`,
    { mode: 0o755 }
  )
  await writeFile(electron, `#!${process.execPath}\nsetInterval(()=>{},1000)`, { mode: 0o755 })
  const controller = new AbortController()
  const app = await launchElectronServe({
    root,
    state: join(root, 'state'),
    signal: controller.signal,
    displayExecutable: display,
    electronExecutable: electron
  })
  t.after(() => app.stop())
  assert.ok(app.pid > 0)
  controller.abort()
  assert.equal(await app.closed, 0)
  assert.throws(() => process.kill(app.pid, 0), /ESRCH/)
  assert.throws(() => process.kill(app.displayPid, 0), /ESRCH/)
})

test('a failed Electron launch cleans up its display', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'orca-electron-failure-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const display = join(root, 'display')
  await writeFile(
    display,
    `#!${process.execPath}\nrequire('fs').writeSync(3,'44\\n');setInterval(()=>{},1000)`,
    { mode: 0o755 }
  )
  await assert.rejects(
    launchElectronServe({
      root,
      state: join(root, 'state'),
      displayExecutable: display,
      electronExecutable: join(root, 'missing')
    }),
    /ENOENT/
  )
})
