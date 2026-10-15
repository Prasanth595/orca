import {
  isKeyInsideRoot,
  joinKey,
  keyDirname,
  type DefinitionFileRoot
} from './definition-file-keys'
import {
  isHostFile,
  isJsonObject,
  parseJsonObject,
  type DefinitionFileHost
} from './definition-file-host'

/** A tsconfig `paths` entry with every substitution made absolute, so one map serves every project. */
export type PathAlias = {
  pattern: string
  substitutions: string[]
}

const CONFIG_FILE_NAMES = ['tsconfig.json', 'jsconfig.json']
const MAX_EXTENDS_DEPTH = 5

/** Aliases of the config nearest the importer, plus those of the configs it references. */
export async function readPathAliases(
  host: DefinitionFileHost,
  root: DefinitionFileRoot,
  importerKey: string
): Promise<PathAlias[]> {
  const configKey = await findNearestConfig(host, root, keyDirname(importerKey))
  if (!configKey) {
    return []
  }
  const config = parseJsonObject(await host.readText(configKey))
  if (!config) {
    return []
  }
  const referenced = await Promise.all(
    referencedConfigKeys(config, keyDirname(configKey)).map(
      async (key) => (await readConfigAliases(host, key, 1)) ?? []
    )
  )
  return [...((await aliasesOfConfig(host, config, configKey, 0)) ?? []), ...referenced.flat()]
}

async function findNearestConfig(
  host: DefinitionFileHost,
  root: DefinitionFileRoot,
  startDirectoryKey: string
): Promise<string | null> {
  for (
    let directoryKey = startDirectoryKey;
    isKeyInsideRoot(root, directoryKey);
    directoryKey = keyDirname(directoryKey)
  ) {
    const configKey = await firstConfigIn(host, directoryKey)
    if (configKey || directoryKey === root.rootKey) {
      return configKey
    }
  }
  return null
}

async function firstConfigIn(
  host: DefinitionFileHost,
  directoryKey: string
): Promise<string | null> {
  for (const name of CONFIG_FILE_NAMES) {
    const key = `${directoryKey}/${name}`
    if (await isHostFile(host, key)) {
      return key
    }
  }
  return null
}

async function readConfigAliases(
  host: DefinitionFileHost,
  configKey: string,
  depth: number
): Promise<PathAlias[] | null> {
  const config = parseJsonObject(await host.readText(configKey))
  return config ? aliasesOfConfig(host, config, configKey, depth) : null
}

/** `null` means the config chain declares no `paths`; an empty list would override a parent's. */
async function aliasesOfConfig(
  host: DefinitionFileHost,
  config: Record<string, unknown>,
  configKey: string,
  depth: number
): Promise<PathAlias[] | null> {
  const configDirectoryKey = keyDirname(configKey)
  const compilerOptions = isJsonObject(config.compilerOptions) ? config.compilerOptions : {}
  if (isJsonObject(compilerOptions.paths)) {
    const baseKey =
      typeof compilerOptions.baseUrl === 'string'
        ? joinKey(configDirectoryKey, compilerOptions.baseUrl)
        : configDirectoryKey
    return toPathAliases(compilerOptions.paths, baseKey)
  }
  if (depth >= MAX_EXTENDS_DEPTH) {
    return null
  }
  // Why relative only: a package `extends` (e.g. @tsconfig/node20) never declares project paths.
  const parents = (Array.isArray(config.extends) ? config.extends : [config.extends])
    .filter((parent): parent is string => typeof parent === 'string' && parent.startsWith('.'))
    .map((parent) =>
      joinKey(configDirectoryKey, parent.endsWith('.json') ? parent : `${parent}.json`)
    )
  const inherited = await Promise.all(
    parents.map((parentKey) => readConfigAliases(host, parentKey, depth + 1))
  )
  // TS applies `extends` in order, so the last parent declaring `paths` wins.
  return inherited.findLast((aliases) => aliases !== null) ?? null
}

function referencedConfigKeys(
  config: Record<string, unknown>,
  configDirectoryKey: string
): string[] {
  if (!Array.isArray(config.references)) {
    return []
  }
  return config.references.flatMap((reference) => {
    if (!isJsonObject(reference) || typeof reference.path !== 'string') {
      return []
    }
    const key = joinKey(configDirectoryKey, reference.path)
    return [key.endsWith('.json') ? key : `${key}/tsconfig.json`]
  })
}

function toPathAliases(paths: Record<string, unknown>, baseKey: string): PathAlias[] {
  return Object.entries(paths).flatMap(([pattern, targets]) => {
    const substitutions = Array.isArray(targets)
      ? targets
          .filter((target): target is string => typeof target === 'string')
          .map((target) => joinKey(baseKey, target))
      : []
    return substitutions.length > 0 ? [{ pattern, substitutions }] : []
  })
}
