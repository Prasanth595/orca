# Feishu Bitable task integration

Base branch: `feat/feishu-bitable-task-integration`. Both implementation branches start from the same contract commit.

## Shared contract

`src/shared/feishu-bitable-task-contract.ts` is coordinator-owned. Do not change it independently. Report proposed changes in your final handoff. No secrets belong in the snapshot or execution input. Record identity is the complete connection/app/table/record tuple, never a title, row number, or numeric placeholder.

The source adapter produces `FeishuBitableTaskSnapshot`. The execution adapter exports `buildFeishuBitableExecutionPlan(input: FeishuBitableExecutionInput): FeishuBitableExecutionPlan` from `src/shared/feishu-bitable-execution-plan.ts`. This function is synchronous, deterministic, and has no network, UI, filesystem, or credential dependencies.

## Source worktree ownership

- Own Feishu connection, credentials, API requests, field mapping, pagination, record conversion, settings, task-list/detail UI, and source metadata persistence.
- Own changes to provider enums/identity validation, existing shared workspace linkage types, desktop IPC/preload/runtime RPC, task-page/store wiring, and existing workspace composer files.
- Own record-to-workspace deduplication and choosing repository/host/agent through the existing composer. Support folder workspaces and preserve remote-host boundaries.
- Do not author prompt text, orchestration specs, or modify execution-owned files.
- Add the final call to the execution adapter in source-owned composer wiring. The execution module arrives when branches are integrated: validate source-specific modules independently and report any full-build dependency honestly. Do not add a temporary competing implementation or claim full-build success without the module.

## Execution worktree ownership

- Own only new `src/shared/feishu-bitable-execution-*` files (except the coordinator-owned contract), new `src/main/runtime/orchestration/feishu-bitable-*` files, and colocated tests for these new modules.
- Implement the execution-plan function above, converting a snapshot and explicit user instruction into bounded, delimited task context, a safe workspace-name suggestion, and a self-contained orchestration task spec.
- Add a narrow orchestration adapter accepting explicit placement/agent choices and an injected existing dispatch operation. Do not perform HTTP requests, select credentials, invent source status, or introduce a second worktree-creation mechanism.
- Do not edit existing provider/source/composer/store/RPC registries or UI files. Export the integration entry points for the source owner or coordinator to wire.
- Treat third-party record text as untrusted data. Escape delimiters/control characters, cap context without dropping stable identity, and keep instruction text distinct from record prose.

## Initial scope and acceptance

Implement record reading, viewing, workspace association, and agent execution integration. Do not write to real Feishu records, add automatic polling-to-dispatch, or implement status/result writeback in this wave. No real credentials are available; use fixtures and mocked HTTP for meaningful tests and document that live integration remains unverified.

Each worker follows AGENTS.md, reads the design guide before UI changes, installs dependencies locally when necessary, and does not share a writable node_modules tree. Never read/edit the parent checkout to bypass worktree isolation. Do not merge, push, publish, or modify the other worktree. Commit your scoped implementation and finish with changed files, validation results, commit ID, integration instructions, and blockers. Keep the worktree and terminal for later tasks.

Integration order: source changes, execution changes, then source-owned composer integration and combined validation on `feat/feishu-bitable-task-integration`. This document defines ownership, not a claim that either capability is already implemented.

## Contribution requirements

Follow `.github/CONTRIBUTING.md` and `.github/pull_request_template.md` for implementation and handoff. Use descriptive implementation branch names such as `feat/feishu-bitable-task-source` and `feat/feishu-bitable-task-execution`.

- Keep the change focused; reuse existing implementations and preserve macOS, Linux, Windows, local, SSH/remote, folder-workspace, and supported agent/provider compatibility. Keep project-owned type declarations in `.ts` files. Do not change release versions or tags.
- Add regression tests for behavior changes. Before opening the combined PR, run `pnpm lint`, `pnpm typecheck`, `pnpm test`, and `pnpm build`; record actual results and any blockers. Run tests and agent-launched apps with `ORCA_BACKGROUND_LAUNCH=1` and keep native-focus tests on an isolated display or CI.
- Use the PR template to explain the user-facing before/after, mechanism, and why this approach was chosen. Outside contributors must link the issue addressed. Attach before/after screenshots or videos for UI or interaction changes; otherwise write `N/A` with the reason.
- Include an AI review summary covering cross-platform support, local/SSH/remote behavior, supported agents and integrations, performance, UI quality when applicable, and basic security. Document platform/provider-specific behavior, unverified live Feishu integration, and any mixed-version compatibility considerations.
- Include AI disclosure when applicable and the contributor's X handle in the Author section as requested by the guide; obtain these details from the contributor rather than inventing them.
