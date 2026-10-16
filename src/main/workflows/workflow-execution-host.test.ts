/**
 * Every node of a workflow runs on the workflow's execution host: this machine for a local
 * workflow, the SSH target for an SSH workflow. The "SSH host" here is a real /bin/sh in a sandbox
 * with its own HOME and PATH (and its own agent CLI); local process spawns, local file I/O and the
 * local HTTP transport are instrumented so a node that runs on the wrong host fails the test.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import http from 'node:http'
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type * as ProcessHost from '@orca/process-host'
import type * as FsPromises from 'node:fs/promises'
import type * as HttpTransport from './workflow-http-transport'

const { localSpawns, localFs, localHttp, actual } = vi.hoisted(() => {
  const real: { runProcess?: typeof ProcessHost.runProcess } = {}
  return {
    localSpawns: new Array<string>(),
    localFs: new Array<string>(),
    localHttp: new Array<string>(),
    actual: real
  }
})

vi.mock('@orca/process-host', async (importOriginal) => {
  const real = await importOriginal<typeof ProcessHost>()
  actual.runProcess = real.runProcess
  return {
    ...real,
    runProcess: (spec: Parameters<typeof real.runProcess>[0]) => {
      localSpawns.push(spec.program)
      return real.runProcess(spec)
    }
  }
})
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof FsPromises>()
  const track =
    <A extends unknown[], R>(name: string, fn: (...args: A) => R) =>
    (...args: A): R => {
      localFs.push(`${name} ${String(args[0])}`)
      return fn(...args)
    }
  return {
    ...real,
    default: real,
    readFile: track('readFile', real.readFile),
    writeFile: track('writeFile', real.writeFile),
    mkdir: track('mkdir', real.mkdir)
  }
})
vi.mock('./workflow-http-transport', async (importOriginal) => {
  const real = await importOriginal<typeof HttpTransport>()
  return {
    ...real,
    localHttpTransport: {
      ...real.localHttpTransport,
      send: (...args: Parameters<typeof real.localHttpTransport.send>) => {
        localHttp.push(args[0].url)
        return real.localHttpTransport.send(...args)
      }
    }
  }
})

import { executeWorkflow } from './workflow-executor'
import { createWorkflowRun } from './workflow-run-store'
import {
  detectRemoteAgents,
  fetchModelsForAgent,
  remoteAgentHostRunner
} from './workflow-agent-host-probe'
import { defaultHttpRequestData } from '../../shared/workflow-http-request-defaults'
import type { AgentWorkflow, WorkflowNode, WorkflowNodeRun } from '../../shared/workflow-types'
import type { WorkflowStoreOperations } from './workflow-run-store'
import type { PersistedState } from '../../shared/persisted-state-types'
import type { RemoteExecFn } from './workflow-remote-exec'

const canRun =
  process.platform !== 'win32' && existsSync('/usr/bin/python3') && existsSync('/usr/bin/curl')

let host = ''
let hostBin = ''
let localBin = ''
let server: http.Server
let base = ''
const requests: { url: string; userAgent: string }[] = []
const remoteCommands: string[] = []

/** The SSH host: commands run in a sandboxed shell with that host's HOME and PATH. */
const sshHost: RemoteExecFn = async (command, options = {}) => {
  remoteCommands.push(command)
  const result = await actual.runProcess!({
    program: '/bin/sh',
    args: ['-c', command],
    cwd: host,
    env: { HOME: host, PATH: `${hostBin}:/usr/bin:/bin` },
    input: options.stdin,
    timeoutMs: options.timeoutMs ?? 30_000
  })
  return { stdout: result.stdout, stderr: result.stderr, exitCode: result.code ?? 1 }
}

function script(dir: string, name: string, body: string): void {
  writeFileSync(join(dir, name), `#!/bin/sh\n${body}\n`)
  chmodSync(join(dir, name), 0o755)
}

beforeAll(async () => {
  host = realpathSync(mkdtempSync(join(tmpdir(), 'orca-ssh-host-')))
  hostBin = join(host, 'bin')
  localBin = realpathSync(mkdtempSync(join(tmpdir(), 'orca-local-bin-')))
  mkdirSync(hostBin)
  mkdirSync(join(host, 'work'))
  // Agent CLIs that exist only on the SSH host.
  script(hostBin, 'claude', 'echo "remote-claude cwd=$PWD args=$*"')
  script(hostBin, 'cursor-agent', 'echo "gpt-5 - GPT 5"; echo "sonnet-4 - Sonnet 4"')
  script(localBin, 'local-agent', 'echo "local-agent cwd=$PWD args=$*"')
  server = http.createServer((req, res) => {
    requests.push({ url: req.url ?? '', userAgent: req.headers['user-agent'] ?? '' })
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ path: req.url }))
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  base = `http://127.0.0.1:${address && typeof address === 'object' ? address.port : 0}`
})

afterAll(() => {
  server?.close()
  rmSync(host, { recursive: true, force: true })
  rmSync(localBin, { recursive: true, force: true })
})

beforeEach(() => {
  localSpawns.length = 0
  localFs.length = 0
  localHttp.length = 0
  requests.length = 0
  remoteCommands.length = 0
})

const pos = { x: 0, y: 0 }

/** trigger → form → shell → python → (file write → file read) + (http → json) + agent */
function workflowFor(root: string, agent: WorkflowNode): AgentWorkflow {
  const nodes: WorkflowNode[] = [
    { id: 'trigger', type: 'trigger_manual', pos, data: {} },
    {
      id: 'form',
      type: 'form_input',
      pos,
      data: { fields: [{ id: 'f', label: 'name', type: 'string', value: 'Ada' }] }
    },
    {
      id: 'shell',
      type: 'shell_command',
      pos,
      data: {
        command: 'printf %s "$PWD"',
        workingDirectory: join(root, 'work'),
        timeoutSeconds: 10
      }
    },
    {
      id: 'py',
      type: 'python_script',
      pos,
      data: {
        script:
          'import json, os, sys\nprint(json.dumps({"shell": sys.stdin.read(), "cwd": os.getcwd()}))',
        workingDirectory: join(root, 'work'),
        timeoutSeconds: 10
      }
    },
    {
      id: 'write',
      type: 'file_write',
      pos,
      data: {
        filePath: join(root, 'out', 'result.json'),
        content: '{{steps.py.output}}',
        mode: 'overwrite',
        createParents: true
      }
    },
    { id: 'read', type: 'file_read', pos, data: { filePath: join(root, 'out', 'result.json') } },
    {
      id: 'http',
      type: 'http_request',
      pos,
      data: { ...defaultHttpRequestData(), url: `${base}/echo?who={{steps.form.json.name}}` }
    },
    { id: 'json', type: 'json_transform', pos, data: { expression: '$.path' } },
    agent
  ]
  const edge = (s: string, t: string) => ({ id: `${s}-${t}`, sourceNodeId: s, targetNodeId: t })
  return {
    id: 'wf',
    name: 'host routing',
    description: '',
    schedule: null,
    enabled: true,
    executionTargetType: 'local',
    executionTargetId: 'local',
    nodes,
    edges: [
      edge('trigger', 'form'),
      edge('form', 'shell'),
      edge('shell', 'py'),
      edge('py', 'write'),
      edge('write', 'read'),
      edge('py', 'http'),
      edge('http', 'json'),
      edge('form', 'agent')
    ],
    createdAt: 0,
    updatedAt: 0
  }
}

async function run(workflow: AgentWorkflow, remoteExec?: RemoteExecFn) {
  const state: Partial<PersistedState> = { agentWorkflows: [workflow], agentWorkflowRuns: [] }
  // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: test stub holding only the workflow slices the executor reads.
  const ops: WorkflowStoreOperations = { state: state as PersistedState, flush: vi.fn() }
  const runId = createWorkflowRun(ops, workflow, 'manual').id
  await executeWorkflow(workflow, runId, ops, {}, undefined, remoteExec)
  const record = ops.state.agentWorkflowRuns.find((r) => r.id === runId)!
  const out = (id: string): WorkflowNodeRun => record.nodeRuns.find((n) => n.nodeId === id)!
  return { record, out }
}

describe.skipIf(!canRun)('workflow execution host', () => {
  it('runs every node of an SSH workflow on the SSH host and nothing on this machine', async () => {
    const workflow = workflowFor(host, {
      id: 'agent',
      type: 'agent_call',
      pos,
      data: {
        agentId: 'claude',
        prompt: 'hello {{steps.form.json.name}}',
        structuredOutputSchema: null,
        workingDirectory: join(host, 'work'),
        timeoutSeconds: 10
      }
    })
    const { record, out } = await run(
      { ...workflow, executionTargetType: 'ssh', executionTargetId: 'target-1' },
      sshHost
    )
    expect(record.status, record.error ?? '').toBe('completed')

    // Shell and Python ran in the host's working directory; Python got the shell output on stdin.
    expect(out('shell').stdout ?? '').toBe(join(host, 'work'))
    expect(JSON.parse(out('py').stdout ?? '')).toEqual({
      shell: join(host, 'work'),
      cwd: join(host, 'work')
    })
    // The file landed on the host and was read back from it.
    expect(JSON.parse(readFileSync(join(host, 'out', 'result.json'), 'utf8'))).toEqual({
      shell: join(host, 'work'),
      cwd: join(host, 'work')
    })
    expect(JSON.parse(out('read').stdout ?? '')).toMatchObject({ cwd: join(host, 'work') })
    // The HTTP request left from the host (curl), with the template resolved.
    expect(requests).toEqual([
      { url: '/echo?who=Ada', userAgent: expect.stringMatching(/^curl\//) }
    ])
    expect(out('json').outputValue).toBe('/echo?who=Ada')
    // The agent CLI found on the host's PATH ran in the host working directory.
    expect((out('agent').stdout ?? '').trim()).toBe(
      `remote-claude cwd=${join(host, 'work')} args=-p hello Ada`
    )

    expect(localSpawns).toEqual([])
    expect(localFs).toEqual([])
    expect(localHttp).toEqual([])
  })

  it('runs every node of a local workflow on this machine and never touches SSH', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'orca-local-wf-')))
    mkdirSync(join(root, 'work'))
    try {
      const { record, out } = await run(
        workflowFor(root, {
          id: 'agent',
          type: 'agent_call',
          pos,
          data: {
            agentId: 'custom',
            customExecutable: join(localBin, 'local-agent'),
            customArgTemplate: '{prompt}',
            prompt: 'hello {{steps.form.json.name}}',
            structuredOutputSchema: null,
            workingDirectory: join(root, 'work'),
            timeoutSeconds: 10
          }
        })
      )
      expect(record.status, record.error ?? '').toBe('completed')
      expect(out('shell').stdout ?? '').toBe(join(root, 'work'))
      expect(JSON.parse(out('py').stdout ?? '')).toEqual({
        shell: join(root, 'work'),
        cwd: join(root, 'work')
      })
      expect(readFileSync(join(root, 'out', 'result.json'), 'utf8')).toContain(join(root, 'work'))
      expect(requests).toEqual([
        { url: '/echo?who=Ada', userAgent: expect.not.stringMatching(/^curl\//) }
      ])
      expect((out('agent').stdout ?? '').trim()).toBe(
        `local-agent cwd=${join(root, 'work')} args=hello Ada`
      )
      expect(remoteCommands).toEqual([])
      expect(localSpawns.length).toBeGreaterThan(0)
      expect(localFs.some((call) => call.startsWith('writeFile'))).toBe(true)
      expect(localHttp).toEqual([`${base}/echo?who=Ada`])
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('fails host nodes instead of running locally when the SSH host is unreachable', async () => {
    const unreachable: RemoteExecFn = async () => {
      throw new Error('SSH target "target-1" is not connected.')
    }
    const { record } = await run(
      {
        ...workflowFor(host, { id: 'agent', type: 'collect', pos, data: {} }),
        executionTargetType: 'ssh',
        executionTargetId: 'target-1'
      },
      unreachable
    )
    expect(record.status).toBe('failed')
    expect(record.error).toContain('not connected')
    expect(localSpawns).toEqual([])
    expect(localFs).toEqual([])
    expect(localHttp).toEqual([])
  })

  it('detects agents and lists their models on the SSH host', async () => {
    expect(await detectRemoteAgents(sshHost)).toEqual(['claude', 'cursor'])
    expect(await fetchModelsForAgent('cursor', remoteAgentHostRunner(sshHost))).toEqual([
      { id: 'gpt-5', label: 'GPT 5' },
      { id: 'sonnet-4', label: 'Sonnet 4' }
    ])
    expect(localSpawns).toEqual([])
  })
})
