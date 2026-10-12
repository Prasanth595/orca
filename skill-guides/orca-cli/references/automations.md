# Automations

An automation is a scheduled Orca prompt run by a chosen provider against either a repo-created worktree or an existing workspace.

```text
ORCA automations list --json
ORCA automations doctor --json
ORCA automations show <automationId> --json
ORCA automations create --name "Daily review" --trigger daily --time 09:00 --prompt "Review open changes" --provider codex --repo id:<repoId> --json
ORCA automations create --name "Weekday triage" --trigger "0 9 * * 1-5" --prompt "Triage issues" --provider claude --repo path:/abs/repo --disabled --json
ORCA automations create --name "Inbox digest" --trigger hourly --prompt "Summarize unread mail" --provider codex --workspace active --reuse-session --json
ORCA automations edit <automationId> --trigger weekdays --time 09:30 --fresh-session --json
ORCA automations run <automationId> --json
ORCA automations run-show <runId> --json
ORCA automations receipt <runId> --outcome passed --summary "Artifact validated" --json
ORCA automations create --name "Memory review" --trigger daily --time 09:00 --prompt "Review customer memory" --provider codex --workspace active --require-receipt --jev-evaluation shadow --jev-rubric .agents/rubrics/customer-memory.json --json
ORCA automations jev-evaluate <runId> --state-file /tmp/customer-memory-evidence.json --json
ORCA automations runs --id <automationId> --limit 25 --json
ORCA automations runs --status dispatch_failed --since 2026-10-01T00:00:00-04:00 --json
ORCA automations remove <automationId> --json
```

Schedules accept `hourly`, `daily`, `weekdays`, `weekly`, 5-field cron, or RRULE. Use `--time <HH:MM>` with `daily`/`weekdays`/`weekly`, and `--day <0-6>` only with `weekly` where Sunday is `0`.

Use `--repo <selector>` for a new worktree per run, or `--workspace <selector>` / `--workspace-mode existing` for an existing Orca worktree. `--repo` and `--workspace` are mutually exclusive. Use `--reuse-session` only for existing-workspace automations; if the previous terminal is gone, Orca falls back to a fresh session. Prefer `--disabled` while testing setup.
Use `--extra-agent-args="--model opus --effort high --add-dir docs"` to add arguments after the host's default agent Arguments on every fresh run (always pass it with `=`, since the value starts with `--`). Only model and effort options, plus Claude's `--add-dir`, are accepted, for `claude`, `codex`, `codebuddy`, `cursor`, `grok`, and `omp`. Model or effort in the extras replaces the default's. Extras can't be combined with `--reuse-session`. `--extra-agent-args=` on edit clears them.

Run history is newest first. Use `--limit` with the returned `nextCursor` and `--cursor` for bounded scans. `--status` filters by process status, and `--since` requires an ISO 8601 timestamp with an explicit UTC offset. Use `run-show` when you already have an exact run id.

`automations doctor` reports one machine-readable verdict per schedule: `healthy`, `disabled`, `overdue`, `failed`, or `unverifiable`. It includes the next due time, latest process status, consecutive failure count, overdue duration, and a remediation when action is required. A host or history read failure is `unverifiable`, never healthy.

Use `--require-receipt` on create or edit when terminal exit is not enough to prove success. Orca supplies the run id to the launched agent and asks it to record `passed`, `failed`, or `blocked` with `automations receipt`. A completed required run without a receipt is `unverifiable`; a `failed` or `blocked` receipt is unhealthy even when the terminal process completed normally. Use `--no-require-receipt` to return a schedule to process-only health.

Use `--jev-evaluation shadow|enforced --jev-rubric <path>` for an independent typed judgment over workflow evidence. The rubric path may be absolute or relative to the automation workspace. Disable it with `--no-jev-evaluation`. Existing automations remain unchanged.

The rubric is versioned JSON with exactly these outcome choices:

```json
{
  "id": "customer-memory-review",
  "version": "1",
  "instructions": "Judge whether the evidence shows the bounded review met every requirement.",
  "criteria": {
    "requirements_satisfied": "Every required item is evidenced and no required check failed.",
    "requirements_not_satisfied": "At least one required check demonstrably failed.",
    "insufficient_evidence": "The supplied evidence cannot establish either result."
  },
  "minimumConfidence": 0.8
}
```

The automation agent writes a temporary JSON state and runs `automations jev-evaluate --state-file <path>`. The state may include `evidenceRefs`, an array of non-secret file, record, or artifact references. Orca sends the state and versioned rubric to `typesafe-ai/jev` through the Vercel AI Gateway. `AI_GATEWAY_API_KEY` must already exist in the evaluator process environment and is never written to automation state, receipts, logs, or prompts.

Shadow results are recorded and displayed but do not change health. In enforced mode, a missing evaluation, low confidence, or `insufficient_evidence` is `unverifiable`; `requirements_not_satisfied` is `failed`. Deterministic checks and agent receipts still run first. Jev does not execute remediations or overwrite either receipt.
