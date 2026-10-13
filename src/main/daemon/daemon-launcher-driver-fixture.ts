// Test fixture: the desktop's daemon launcher, run outside Electron's main process so a test can
// choose which runtime it runs on (and so which runtime a daemon it starts runs on).
import { build } from 'esbuild'

export type DaemonLauncherDriverResult = { adopted: boolean; mode: string | null }

/**
 * Bundles the driver to `outfile`; run it as `<userData> <appPath> <appVersion>` with piped stdin.
 * It prints one JSON line, stays connected like an open window, and exits when stdin closes
 * without stopping the daemon, as a quitting window leaves it.
 */
export async function buildDaemonLauncherDriver(outfile: string): Promise<void> {
  await build({
    stdin: {
      contents: `
        import { mkdirSync } from 'node:fs'
        import { join } from 'node:path'
        import { createOutOfProcessLauncher } from './src/main/daemon/daemon-out-of-process-launcher'
        import { getDaemonSocketPath, getDaemonTokenPath } from './src/main/daemon/daemon-spawner'
        import { setAppEnvironment } from './src/shared/app-environment'
        const [userData, appPath, version] = process.argv.slice(2)
        setAppEnvironment({
          getPath: () => userData, getAppPath: () => appPath, getVersion: () => version,
          isPackaged: () => true, onWillQuit() {}, exit: code => process.exit(code),
          getAppMetrics: () => []
        })
        const runtimeDir = join(userData, 'daemon')
        mkdirSync(runtimeDir, { recursive: true, mode: 0o700 })
        createOutOfProcessLauncher(runtimeDir)(getDaemonSocketPath(runtimeDir), getDaemonTokenPath(runtimeDir))
          .then(handle => {
            console.log(JSON.stringify({ adopted: handle.adopted === true, mode: handle.mode ?? null }))
            process.stdin.on('end', () => process.exit(0))
            process.stdin.resume()
          })
          .catch(error => { console.error(error); process.exit(1) })
      `,
      resolveDir: process.cwd(),
      loader: 'ts'
    },
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node18',
    external: ['electron', 'node-pty', '@parcel/watcher', '*.node'],
    outfile,
    logLevel: 'silent'
  })
}
