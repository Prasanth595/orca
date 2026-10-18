#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import glibcVerification from './verify-linux-glibc-floor.cjs'

export function waylandClipboardFingerprint(root, arch) {
  const hash = createHash('sha256').update(arch)
  for (const file of [
    'native/wayland-clipboard/wayland-clipboard.c',
    'native/wayland-clipboard/x11-clipboard-publisher.c',
    'native/wayland-clipboard/x11-clipboard-publisher.h',
    'native/wayland-clipboard/protocol_test.py',
    'native/wayland-clipboard/x11_test.py',
    'native/wayland-clipboard/Dockerfile',
    'config/scripts/build-wayland-clipboard.mjs'
  ]) {
    hash.update('\0').update(readFileSync(join(root, file)))
  }
  return hash.digest('hex')
}

const CONTAINER_ENGINE_NAMES = { docker: 'Docker', podman: 'Podman' }

// Why an env var: electron-builder's beforePack runs this script as a child, so a flag cannot reach it.
export function resolveContainerEngine(env = process.env) {
  const engine = env.ORCA_CONTAINER_ENGINE || 'docker'
  if (!Object.hasOwn(CONTAINER_ENGINE_NAMES, engine)) {
    throw new Error(`Unsupported ORCA_CONTAINER_ENGINE: ${engine}. Use docker or podman.`)
  }
  return engine
}

export function buildWaylandClipboard({
  arch = process.arch,
  root = resolve(import.meta.dirname, '../..'),
  run = spawnSync,
  engine = resolveContainerEngine()
} = {}) {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new Error(`Unsupported Wayland clipboard architecture: ${arch}`)
  }
  if (!Object.hasOwn(CONTAINER_ENGINE_NAMES, engine)) {
    throw new Error(`Unsupported Wayland clipboard container engine: ${engine}`)
  }
  const nativeDir = join(root, 'native', 'wayland-clipboard')
  const outputDir = join(nativeDir, '.build', arch)
  const output = join(outputDir, 'orca-wayland-clipboard')
  const fingerprint = waylandClipboardFingerprint(root, arch)
  const stamp = `${output}.sha256`
  function verifyOutput() {
    if (!glibcVerification.collectNativeBinaries(outputDir).includes(output)) {
      throw new Error('The Wayland clipboard build did not produce an ELF executable.')
    }
    glibcVerification.verifyLinuxGlibcFloor(outputDir, { targetArch: arch })
  }
  if (existsSync(output) && existsSync(stamp) && readFileSync(stamp, 'utf8') === fingerprint) {
    verifyOutput()
    chmodSync(output, 0o755)
    return output
  }
  mkdirSync(outputDir, { recursive: true })
  rmSync(stamp, { force: true })
  rmSync(output, { force: true })
  const imageHash = createHash('sha256')
    .update(readFileSync(join(nativeDir, 'Dockerfile')))
    .digest('hex')
    .slice(0, 16)
  const image = `orca-wayland-clipboard-build:${imageHash}`
  function container(args) {
    const result = run(engine, args, { stdio: 'inherit', cwd: root })
    if (result.error) {
      throw new Error(
        `Unable to run ${CONTAINER_ENGINE_NAMES[engine]} to build the Wayland clipboard helper.`,
        {
          cause: result.error
        }
      )
    }
    if (result.status !== 0) {
      throw new Error(`Wayland clipboard ${args[0]} failed; see the build output above.`)
    }
  }
  container(['build', '-t', image, nativeDir])
  // Compile against the supported glibc floor, including when packaging another architecture.
  container([
    'run',
    '--rm',
    '--user',
    `${process.getuid?.() ?? 0}:${process.getgid?.() ?? 0}`,
    '-v',
    `${nativeDir}:/source:ro`,
    '-v',
    `${outputDir}:/output`,
    image,
    'sh',
    '-ec',
    'case "$1" in x64) compiler=x86_64-linux-gnu-gcc;; arm64) compiler=aarch64-linux-gnu-gcc;; esac; "$compiler" -O2 -Wall -Wextra -Werror -fstack-protector-strong -D_FORTIFY_SOURCE=2 -fPIE -pie -Wl,-z,relro,-z,now /source/wayland-clipboard.c /source/x11-clipboard-publisher.c -ldl -o /output/orca-wayland-clipboard; case "$(uname -m):$1" in x86_64:x64|aarch64:arm64) python3 /source/protocol_test.py /output/orca-wayland-clipboard; python3 /source/x11_test.py /output/orca-wayland-clipboard;; esac',
    'build',
    arch
  ])
  chmodSync(output, 0o755)
  verifyOutput()
  writeFileSync(stamp, fingerprint)
  return output
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const archIndex = process.argv.indexOf('--arch')
  buildWaylandClipboard({ arch: archIndex === -1 ? process.arch : process.argv[archIndex + 1] })
}
