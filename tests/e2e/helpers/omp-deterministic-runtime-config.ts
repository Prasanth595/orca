import { writeFile } from 'node:fs/promises'
import path from 'node:path'

/** Keep the isolated installed-SDK model roles and native task settings together. */
export async function writeOmpDeterministicRuntimeConfig(options: {
  agentDir: string
  workspace: string
  maxConcurrency?: number
  asyncChildNames?: string[]
}): Promise<void> {
  const { agentDir, workspace } = options
  await writeFile(
    path.join(agentDir, 'config.yml'),
    JSON.stringify(
      {
        async: { enabled: true },
        task: {
          batch: true,
          structured: false,
          maxConcurrency: options.maxConcurrency ?? 3,
          isolation: { enabled: false }
        },
        retry: { enabled: false, modelFallback: false },
        modelRoles: {
          default: 'orca-status-smoke/deterministic',
          task: 'orca-status-smoke/deterministic',
          smol: 'orca-status-smoke/label',
          tiny: 'orca-status-smoke/label'
        },
        approval: { mode: 'yolo' }
      },
      null,
      2
    )
  )
  await writeFile(
    path.join(workspace, '.omp', 'agents', 'status-smoke.md'),
    [
      '---',
      'name: status-smoke',
      'description: Deterministic native status smoke',
      'model: orca-status-smoke/deterministic',
      'thinkingLevel: off',
      options.asyncChildNames?.length ? 'tools: [bash]' : 'tools: []',
      'spawns: []',
      '---',
      'Return the configured deterministic response.'
    ].join('\n')
  )
}
