/**
 * An SSH agent workflow runs every node on the SSH host: shell, Python, file write and read,
 * HTTP, and the agent call (with agents detected there). The host is the Docker SSH fixture; its
 * HTTP endpoint listens on the container's own loopback, which this machine cannot reach, so a
 * successful request proves it left from the host.
 *
 * Connecting deploys orcad from a template, as for every managed SSH host. Run (CI's managed
 * Docker job sets both):
 *   ORCA_E2E_SSH_DOCKER=1 ORCA_E2E_ORCAD_CONVERT_TEMPLATE=<orcad template> ORCA_BACKGROUND_LAUNCH=1 \
 *     pnpm exec playwright test tests/e2e/ssh-orcad-workflow-execution-host.spec.ts \
 *     --config tests/playwright.config.ts --project electron-headless --workers=1
 */
import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ElectronApplication, Page } from '@stablyai/playwright-test'
import { expect, test } from './helpers/orca-app'
import { createRestartSession } from './helpers/orca-restart'
import { waitForSessionReady } from './helpers/store'
import { ensureDockerSshHostImage } from './helpers/docker-ssh-host-image'
import { ORCAD_TEMPLATE, skipUnlessManagedDockerHost } from './helpers/orcad-managed-workspace'
import {
  cleanupDockerSshHostTarget,
  execDockerSshHostTargetControlCommand,
  startDockerSshHostTarget,
  type DockerSshHostTarget
} from './helpers/docker-ssh-host-target'

skipUnlessManagedDockerHost()

const HOST_HTTP_PORT = 18080

function prepareHost(target: DockerSshHostTarget): void {
  execDockerSshHostTargetControlCommand(
    target,
    [
      // An agent CLI that exists only on the SSH host.
      `printf '#!/bin/sh\\necho "host-claude cwd=$PWD args=$*"\\n' > /usr/local/bin/claude`,
      'chmod +x /usr/local/bin/claude',
      'mkdir -p /root/wf-work'
    ].join(' && ')
  )
  // Reachable only from inside the container.
  execDockerSshHostTargetControlCommand(
    target,
    `nohup node -e "require('http').createServer((q,s)=>{s.setHeader('content-type','application/json');s.end(JSON.stringify({path:q.url,ua:q.headers['user-agent']}))}).listen(${HOST_HTTP_PORT},'127.0.0.1')" >/dev/null 2>&1 & sleep 1`
  )
}

async function connectTarget(page: Page, target: DockerSshHostTarget): Promise<string> {
  const targetId = await page.evaluate(
    async ({ host, port, identityFile }) => {
      const added = await window.api.ssh.addTarget({
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: optional SshTarget fields keep their defaults.
        target: {
          label: `workflow host ${Date.now()}`,
          host,
          port,
          username: 'root',
          identityFile,
          identitiesOnly: true
        } as never
      })
      return added.target.id
    },
    { host: target.host, port: target.port, identityFile: target.identityFile }
  )
  await page.evaluate((id) => window.api.ssh.connect({ targetId: id }), targetId)
  await expect
    .poll(() => page.evaluate((id) => window.api.ssh.getState({ targetId: id }), targetId), {
      timeout: 120_000,
      message: 'SSH target never connected'
    })
    .toMatchObject({ status: 'connected' })
  return targetId
}

test('an SSH workflow runs every node on the SSH host', async (// oxlint-disable-next-line no-empty-pattern -- Owns app launch.
{}, testInfo) => {
  test.setTimeout(8 * 60_000)
  ensureDockerSshHostImage(process.cwd())
  const target = startDockerSshHostTarget(testInfo)
  const scratch = mkdtempSync(path.join(tmpdir(), 'orca-wf-ssh-'))
  const template = path.join(scratch, 'template')
  cpSync(ORCAD_TEMPLATE!, template, { recursive: true })
  const session = createRestartSession(testInfo, { ORCA_ORCAD_TEMPLATE_PATH: template })
  let app: ElectronApplication | null = null
  try {
    prepareHost(target)
    const launched = await session.launch()
    app = launched.app
    const page = launched.page
    await waitForSessionReady(page)
    const targetId = await connectTarget(page, target)

    // The agent picker detects agents on the SSH host, not on this machine.
    expect(await page.evaluate((id) => window.api.workflows.detectAgents(id), targetId)).toEqual([
      'claude'
    ])

    const run = await page.evaluate(
      async ({ targetId, port }) => {
        const pos = { x: 0, y: 0 }
        // oxlint-disable-next-line typescript/consistent-type-assertions -- SAFETY: node data covers what each runner reads; defaults fill the rest.
        const wf = await window.api.workflows.create({
          name: 'SSH host routing',
          description: '',
          schedule: null,
          enabled: true,
          executionTargetType: 'ssh',
          executionTargetId: targetId,
          nodes: [
            { id: 'trigger', type: 'trigger_manual', pos, data: {} },
            {
              id: 'shell',
              type: 'shell_command',
              pos,
              data: {
                command: 'printf %s "$(hostname):$PWD"',
                workingDirectory: '/root/wf-work',
                timeoutSeconds: 30
              }
            },
            {
              id: 'py',
              type: 'python_script',
              pos,
              data: {
                script:
                  'import json, platform, sys\nprint(json.dumps({"shell": sys.stdin.read(), "os": platform.system()}))',
                workingDirectory: '/root/wf-work',
                timeoutSeconds: 30
              }
            },
            {
              id: 'write',
              type: 'file_write',
              pos,
              data: {
                filePath: '/root/wf-out/result.json',
                content: '{{steps.py.output}}',
                mode: 'overwrite',
                createParents: true
              }
            },
            { id: 'read', type: 'file_read', pos, data: { filePath: '/root/wf-out/result.json' } },
            {
              id: 'http',
              type: 'http_request',
              pos,
              data: { method: 'GET', url: `http://127.0.0.1:${port}/ping?os={{steps.py.json.os}}` }
            },
            { id: 'json', type: 'json_transform', pos, data: { expression: '$.path' } },
            {
              id: 'agent',
              type: 'agent_call',
              pos,
              data: {
                agentId: 'claude',
                prompt: 'from {{steps.py.json.os}}',
                structuredOutputSchema: null,
                workingDirectory: '/root/wf-work',
                timeoutSeconds: 30
              }
            }
          ],
          edges: [
            { id: 'e1', sourceNodeId: 'trigger', targetNodeId: 'shell' },
            { id: 'e2', sourceNodeId: 'shell', targetNodeId: 'py' },
            { id: 'e3', sourceNodeId: 'py', targetNodeId: 'write' },
            { id: 'e4', sourceNodeId: 'write', targetNodeId: 'read' },
            { id: 'e5', sourceNodeId: 'py', targetNodeId: 'http' },
            { id: 'e6', sourceNodeId: 'http', targetNodeId: 'json' },
            { id: 'e7', sourceNodeId: 'py', targetNodeId: 'agent' }
          ]
        } as never)
        await window.api.workflows.runNow(wf.id)
        for (let i = 0; i < 150; i++) {
          const latest = (await window.api.workflows.getRuns(wf.id))[0]
          if (latest && latest.status !== 'running' && latest.status !== 'pending') {
            return latest
          }
          await new Promise((r) => setTimeout(r, 400))
        }
        return null
      },
      { targetId, port: HOST_HTTP_PORT }
    )

    expect(run?.status, run?.error ?? 'run did not finish').toBe('completed')
    const node = (id: string) => run!.nodeRuns.find((n) => n.nodeId === id)!
    const hostname = execDockerSshHostTargetControlCommand(target, 'hostname').trim()

    expect(node('shell').stdout).toBe(`${hostname}:/root/wf-work`)
    expect(JSON.parse(node('py').stdout ?? '')).toEqual({
      shell: `${hostname}:/root/wf-work`,
      os: 'Linux'
    })
    expect(
      JSON.parse(execDockerSshHostTargetControlCommand(target, 'cat /root/wf-out/result.json'))
    ).toEqual({ shell: `${hostname}:/root/wf-work`, os: 'Linux' })
    expect(JSON.parse(node('read').stdout ?? '')).toMatchObject({ os: 'Linux' })
    expect(node('http').outputValue).toMatchObject({
      path: '/ping?os=Linux',
      ua: expect.stringMatching(/^curl\//)
    })
    expect(node('json').outputValue).toBe('/ping?os=Linux')
    expect(node('agent').stdout?.trim()).toBe('host-claude cwd=/root/wf-work args=-p from Linux')
  } finally {
    if (app) {
      await session.close(app)
    }
    await session.dispose()
    cleanupDockerSshHostTarget(target)
    rmSync(scratch, { recursive: true, force: true })
  }
})
