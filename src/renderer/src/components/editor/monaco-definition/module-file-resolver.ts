import {
  isKeyInsideRoot,
  joinKey,
  keyDirname,
  type DefinitionFileRoot
} from './definition-file-keys'
import {
  firstHostFile,
  isHostDirectory,
  isJsonObject,
  parseJsonObject,
  type DefinitionFileHost,
  type JsonObject
} from './definition-file-host'
import type { PathAlias } from './tsconfig-path-aliases'

/**
 * Mirrors TS's `bundler` resolution closely enough to prefetch what the worker will look for.
 * It never decides a definition: the worker resolves again over the files this loads.
 */

const MODULE_EXTENSIONS = ['.ts', '.tsx', '.d.ts', '.js', '.jsx']
const TYPESCRIPT_FILE = /(?:\.d)?\.[mc]?ts$|\.tsx$/
const JAVASCRIPT_FILE = /\.([mc]?)js(x?)$/
const PACKAGE_SPECIFIER = /^((?:@[^/]+\/)?[^/]+)(?:\/(.+))?$/
// Bundler resolution matches these conditions; `node`, `browser` and the rest never apply.
const EXPORT_CONDITIONS = new Set(['types', 'import', 'require', 'default'])
const NODE_BUILTIN_MODULES = new Set([
  'assert',
  'async_hooks',
  'buffer',
  'child_process',
  'cluster',
  'crypto',
  'dgram',
  'dns',
  'events',
  'fs',
  'fs/promises',
  'http',
  'http2',
  'https',
  'inspector',
  'module',
  'net',
  'os',
  'path',
  'perf_hooks',
  'process',
  'querystring',
  'readline',
  'stream',
  'string_decoder',
  'timers',
  'tls',
  'url',
  'util',
  'v8',
  'vm',
  'worker_threads',
  'zlib'
])

export type ModuleResolution = {
  /** The module's own file. */
  moduleKey: string
  /** Files TS must also read to reach it, such as a package's package.json. */
  supportKeys: string[]
}

export async function resolveModuleFile(
  host: DefinitionFileHost,
  root: DefinitionFileRoot,
  aliases: readonly PathAlias[],
  specifier: string,
  importerKey: string
): Promise<ModuleResolution | null> {
  if (
    specifier.startsWith('./') ||
    specifier.startsWith('../') ||
    specifier === '.' ||
    specifier === '..'
  ) {
    return asModule(await resolveFileOrDirectory(host, joinKey(keyDirname(importerKey), specifier)))
  }
  const aliased = await resolveAlias(host, aliases, specifier)
  if (aliased) {
    return { moduleKey: aliased, supportKeys: [] }
  }
  const isNodeBuiltin = specifier.startsWith('node:') || NODE_BUILTIN_MODULES.has(specifier)
  return resolvePackage(host, root, isNodeBuiltin ? 'node' : specifier, importerKey)
}

function asModule(moduleKey: string | null): ModuleResolution | null {
  return moduleKey ? { moduleKey, supportKeys: [] } : null
}

async function resolveAlias(
  host: DefinitionFileHost,
  aliases: readonly PathAlias[],
  specifier: string
): Promise<string | null> {
  for (const alias of aliases) {
    const starMatch = matchAliasPattern(alias.pattern, specifier)
    if (starMatch === null) {
      continue
    }
    for (const substitution of alias.substitutions) {
      const resolved = await resolveFileOrDirectory(host, substitution.replace('*', starMatch))
      if (resolved) {
        return resolved
      }
    }
  }
  return null
}

/** The text `*` stands for, `''` for an exact match, or `null` when the pattern doesn't apply. */
function matchAliasPattern(pattern: string, specifier: string): string | null {
  const star = pattern.indexOf('*')
  if (star === -1) {
    return pattern === specifier ? '' : null
  }
  const prefix = pattern.slice(0, star)
  const suffix = pattern.slice(star + 1)
  const fits =
    specifier.length >= prefix.length + suffix.length &&
    specifier.startsWith(prefix) &&
    specifier.endsWith(suffix)
  return fits ? specifier.slice(prefix.length, specifier.length - suffix.length) : null
}

async function resolveFileOrDirectory(
  host: DefinitionFileHost,
  baseKey: string
): Promise<string | null> {
  const file = await firstHostFile(host, fileCandidates(baseKey))
  if (file || !(await isHostDirectory(host, baseKey))) {
    return file
  }
  return firstHostFile(
    host,
    MODULE_EXTENSIONS.map((extension) => `${baseKey}/index${extension}`)
  )
}

/** TS prefers a `.ts` source over the `.js` an ESM import names, then falls back to the `.js`. */
function fileCandidates(baseKey: string): string[] {
  if (TYPESCRIPT_FILE.test(baseKey)) {
    return [baseKey]
  }
  const javascript = JAVASCRIPT_FILE.exec(baseKey)
  if (!javascript) {
    return MODULE_EXTENSIONS.map((extension) => `${baseKey}${extension}`)
  }
  const [extension, moduleFlavor, jsx] = javascript
  const stem = baseKey.slice(0, -extension.length)
  if (jsx) {
    return [`${stem}.tsx`, baseKey]
  }
  return [
    `${stem}.${moduleFlavor}ts`,
    ...(moduleFlavor ? [] : [`${stem}.tsx`]),
    `${stem}.d.${moduleFlavor}ts`,
    baseKey
  ]
}

async function resolvePackage(
  host: DefinitionFileHost,
  root: DefinitionFileRoot,
  specifier: string,
  importerKey: string
): Promise<ModuleResolution | null> {
  const parsed = PACKAGE_SPECIFIER.exec(specifier)
  if (!parsed) {
    return null
  }
  const [, packageName, subpath] = parsed
  // Same passes as TS: typed entries anywhere up the tree beat a JavaScript-only entry.
  for (const allowJavaScript of [false, true]) {
    for (
      let directoryKey = keyDirname(importerKey);
      isKeyInsideRoot(root, directoryKey);
      directoryKey = keyDirname(directoryKey)
    ) {
      for (const name of [packageName, typesPackageName(packageName)]) {
        const resolution = await resolveInstalledPackage(
          host,
          `${directoryKey}/node_modules/${name}`,
          subpath
        )
        if (resolution && (allowJavaScript || !JAVASCRIPT_FILE.test(resolution.moduleKey))) {
          return resolution
        }
      }
      if (directoryKey === root.rootKey) {
        break
      }
    }
  }
  return null
}

function typesPackageName(packageName: string): string {
  return packageName.startsWith('@')
    ? `@types/${packageName.slice(1).replace('/', '__')}`
    : `@types/${packageName}`
}

async function resolveInstalledPackage(
  host: DefinitionFileHost,
  packageKey: string,
  subpath: string | undefined
): Promise<ModuleResolution | null> {
  if (!(await isHostDirectory(host, packageKey))) {
    return null
  }
  const manifestKey = `${packageKey}/package.json`
  const manifest = parseJsonObject(await host.readText(manifestKey))
  const moduleKey = await resolvePackageEntry(host, packageKey, manifest, subpath)
  if (!moduleKey) {
    return null
  }
  return { moduleKey, supportKeys: manifest ? [manifestKey] : [] }
}

async function resolvePackageEntry(
  host: DefinitionFileHost,
  packageKey: string,
  manifest: JsonObject | null,
  subpath: string | undefined
): Promise<string | null> {
  if (manifest && manifest.exports !== undefined && manifest.exports !== null) {
    // An `exports` map is authoritative: TS doesn't fall back to probing the package folder.
    const target = resolveExportsTarget(manifest.exports, subpath ? `./${subpath}` : '.')
    return target ? resolveFileOrDirectory(host, joinKey(packageKey, target)) : null
  }
  if (subpath) {
    return resolveFileOrDirectory(host, joinKey(packageKey, subpath))
  }
  const declaredEntry = [manifest?.types, manifest?.typings, manifest?.main].find(
    (entry): entry is string => typeof entry === 'string' && entry.length > 0
  )
  const entry = declaredEntry
    ? await resolveFileOrDirectory(host, joinKey(packageKey, declaredEntry))
    : null
  return (
    entry ??
    firstHostFile(
      host,
      MODULE_EXTENSIONS.map((extension) => `${packageKey}/index${extension}`)
    )
  )
}

export function resolveExportsTarget(exports: unknown, subpath: string): string | null {
  const isSubpathMap =
    isJsonObject(exports) && Object.keys(exports).some((key) => key.startsWith('.'))
  if (!isSubpathMap) {
    return subpath === '.' ? pickExportCondition(exports, null) : null
  }
  if (subpath in exports) {
    return pickExportCondition(exports[subpath], null)
  }
  let best: { key: string; starMatch: string } | null = null
  for (const key of Object.keys(exports)) {
    const starMatch = matchAliasPattern(key, subpath)
    if (starMatch !== null && key.includes('*') && (!best || key.length > best.key.length)) {
      best = { key, starMatch }
    }
  }
  return best ? pickExportCondition(exports[best.key], best.starMatch) : null
}

function pickExportCondition(target: unknown, starMatch: string | null): string | null {
  if (typeof target === 'string') {
    return starMatch === null ? target : target.replaceAll('*', starMatch)
  }
  if (Array.isArray(target)) {
    for (const candidate of target) {
      const picked = pickExportCondition(candidate, starMatch)
      if (picked) {
        return picked
      }
    }
    return null
  }
  if (!isJsonObject(target)) {
    return null
  }
  // Condition objects are ordered: the first applicable key wins.
  for (const [condition, value] of Object.entries(target)) {
    const picked = EXPORT_CONDITIONS.has(condition) ? pickExportCondition(value, starMatch) : null
    if (picked) {
      return picked
    }
  }
  return null
}
