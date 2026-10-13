# Feishu Bitable source handoff

Branch: `feat/feishu-bitable-task-source` (renamed from `strongwood/feishu-source`).
Base contract: `38d2a1d2`. Source changes continue Claude's existing implementation.

## Combined integration validation (2026-10-14)

Source commit `1e9f9dd0` and execution commit `18920b04` are merged into `feat/feishu-bitable-task-integration`. The missing execution module blocker described below is resolved. The following results supersede the earlier source-only build results.

- Full typecheck and desktop build passed, including WSL guest, CLI, Electron main/preload/renderer, web projection and mobile web bundle verification. Mobile dependencies were installed from its existing frozen lockfile.
- 10 targeted test files / 75 tests passed, including source-to-execution composer draft integration and missing-snapshot rejection. The stale-base injection regression assertion now lives in the main-process test, avoiding a shared-to-main test import that broke CLI/Web project boundaries.
- Changed-code quality checks and `git diff --check` passed.
- `ORCA_BACKGROUND_LAUNCH=1 pnpm build` reaches the final native stage but fails because this user cannot access `/var/run/docker.sock`; the Ubuntu 20.04 Wayland clipboard helper cannot be built. Desktop output is available under `out/`; complete native build success is not claimed.
- Logs: `/tmp/orca-feishu-integration-build.log`, `/tmp/orca-feishu-integration-test.log`, `/tmp/orca-feishu-integration-quality.log`. No rendered UI, live Feishu, or real agent execution validation was performed during integration.

## User-facing change

Tasks and Settings now offer Feishu Bitable access through an enterprise app. Users can connect a table, select or disconnect saved connections, map title/description/acceptance/link fields, browse paginated records, read details, and open the existing workspace composer from a record. The composer keeps the source while users choose a project, execution host and agent. Existing Git workspaces and folder workspaces are reused by the complete record tuple and source host.

The implementation extends existing provider, credential storage, IPC, runtime RPC, store, attachment and workspace creation paths. It adds no parallel workspace creator or execution module. Record text is passed as a snapshot to the execution owner's adapter; source code does not construct task instructions or orchestration specs.

## Integration boundary

- Bring in the execution owner's `src/shared/feishu-bitable-execution-plan.ts`, exporting synchronous `buildFeishuBitableExecutionPlan(input: FeishuBitableExecutionInput): FeishuBitableExecutionPlan` from the unchanged coordinator contract.
- `use-feishu-bitable-task-composer.ts` seeds the existing composer with a credential-free snapshot and full record identity.
- `resolveQuickCreateLinkedWorkItemPrompt` in `linked-work-item-context.ts` calls that adapter with the snapshot and the user's composer note. It uses `plan.prompt` as a reviewable agent draft through existing Git and folder startup paths. No automatic polling or dispatch was added. The execution owner's `taskSpec` remains available for its orchestration adapter; this source does not invent orchestration behavior.
- The source uses its own host for credentials and reads. Workspace placement remains an explicit choice in the existing composer, including SSH and folder targets. Deduplication compares the source host, not the placement host.
- New RPC methods use existing runtime routing. An older host's `method_not_found` becomes a visible update-host message. Existing wire opcodes and coordinator-owned types were not changed.
- After integrating the execution module, rerun full typecheck/build and composer/agent startup tests for Git and folder targets, local and remote hosts, all supported agents, and mixed host versions. A persisted Feishu link without its transient record snapshot must be reloaded before starting an agent.

## Validation

All test commands used `ORCA_BACKGROUND_LAUNCH=1`. No real Feishu credentials or record writes were used.

- 17 targeted test files, 212 tests passed: Feishu HTTP/credential/record fixtures; provider settings; IPC registration; workspace source preservation; source identity; attachment and folder projection; read/status races; source summaries; list chrome; Tasks settings.
- `pnpm tc:node` and `pnpm tc:cli` passed.
- `pnpm run check:code-quality:changed` passed with zero new findings across code quality, casting, focused plugins, type-aware checks, React Doctor and design-system checks.
- `pnpm run verify:rpc-params-catalog` and `git diff --check` passed.
- `pnpm tc` / `pnpm tc:web` fail with TS2307 only at the import of the absent execution-plan module. No stub, type shim, substitute plan builder, or max-lines suppression was added.
- Both previously oversized modules were actually split: composer actions now use the Feishu composer hook; source summaries use `task-source-host-availability.ts`.

Full application build and end-to-end agent execution remain blocked by the missing execution module. Rendered Electron checks were not run: the requested `$electron` skill was not available in the session catalog or local skill directory, and the app cannot build with the missing module. No application windows were launched. Linux fixture/unit checks do not establish real macOS/Windows/SSH behavior or live Feishu permissions/connectivity. No full repository test/lint success is claimed.

## Review and remaining work

Cross-platform paths use Node path utilities; no process spawning or new keyboard shortcuts were added. Credentials stay on the selected source host and reuse the existing encrypted credential storage with plaintext/decryption reporting. Snapshots contain no app secret or tenant token. HTTP pagination is bounded, token refresh retries at most once, and stale connection/host responses cannot replace current record state. Empty/error record reads do not trigger an automatic retry loop. Source prose still requires the execution owner's delimiter/control escaping and size bounds before combined validation.

Unrelated pre-existing edits were preserved and excluded from the source commit: `.github/workflows/wsl-orcad-e2e.yml`, `config/reliability-gates.jsonc`, `docs/bug-reproductions/delayed-agent-launch.md`.

No merge, push, release, publication, real record writeback, automatic record-to-agent dispatch, or execution-worktree modification was performed.
