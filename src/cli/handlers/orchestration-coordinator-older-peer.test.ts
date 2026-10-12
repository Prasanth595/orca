import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer, type Socket } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { RuntimeClient } from '../runtime-client'
import { ORCHESTRATION_HANDLERS } from './orchestration'

vi.mock('../format', () => ({ printResult: vi.fn() }))

it.each([
  {
    command: 'run-create',
    policy: 'coordination',
    code: 'incompatible_runtime',
    expectedMethods: ['status.get']
  },
  {
    command: 'request-pass',
    policy: 'coordination',
    code: 'incompatible_runtime',
    expectedMethods: ['status.get']
  },
  { command: 'run-create', policy: 'quiet', code: 'invalid_argument', expectedMethods: [] }
])(
  'refuses $command policy=$policy through real transport to a contract-v1-only peer',
  async ({ command, policy, code, expectedMethods }) => {
    const directory = mkdtempSync(join(tmpdir(), 'orca-coordinator-peer-'))
    const endpoint =
      process.platform === 'win32'
        ? `\\\\.\\pipe\\orca-coordinator-${randomUUID()}`
        : join(directory, 'runtime.sock')
    const sockets = new Set<Socket>()
    const methods: string[] = []
    const server = createServer((socket) => {
      sockets.add(socket)
      socket.once('close', () => sockets.delete(socket))
      let buffer = ''
      socket.on('data', (bytes) => {
        buffer += bytes.toString()
        if (!buffer.includes('\n')) {
          return
        }
        const request: unknown = JSON.parse(buffer.trim())
        if (
          typeof request !== 'object' ||
          request === null ||
          !('id' in request) ||
          typeof request.id !== 'string' ||
          !('method' in request) ||
          typeof request.method !== 'string'
        ) {
          return
        }
        methods.push(request.method)
        // Older schemas strip optional fields and accept their previous default behavior.
        const result =
          request.method === 'status.get'
            ? { capabilities: ['orchestration.contract.v1'] }
            : { run: { id: 'old-run', objective: 'Hub', notification_policy: 'all' }, queued: true }
        socket.end(
          `${JSON.stringify({
            id: request.id,
            ok: true,
            result,
            _meta: { runtimeId: 'old-runtime' }
          })}\n`
        )
      })
    })
    try {
      await new Promise<void>((resolve) => server.listen(endpoint, resolve))
      writeFileSync(
        join(directory, 'orca-runtime.json'),
        JSON.stringify({
          runtimeId: 'old-runtime',
          pid: process.pid,
          transports: [{ kind: process.platform === 'win32' ? 'named-pipe' : 'unix', endpoint }],
          authToken: 'test-only-token',
          startedAt: 1
        })
      )
      const client = new RuntimeClient(directory, 5_000, null, null)
      await expect(
        ORCHESTRATION_HANDLERS[`orchestration ${command}`]({
          client,
          cwd: directory,
          json: true,
          flags: new Map([
            ['objective', 'Hub'],
            ['from', 'term_test'],
            ['notification-policy', policy],
            ['run', 'old-run'],
            ['owner', 'term_hub'],
            ['consumer-generation', '1'],
            ['process-incarnation', 'inc']
          ])
        })
      ).rejects.toMatchObject({ code })
      expect(methods).toEqual(expectedMethods)
    } finally {
      for (const socket of sockets) {
        socket.destroy()
      }
      if (server.listening) {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
      rmSync(directory, { recursive: true, force: true })
    }
  }
)
