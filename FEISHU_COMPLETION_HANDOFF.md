# Feishu records and manual completion

This branch includes the integrated source implementation and the handed-off discovery/table patch. The list displays only original table columns, in schema order, including empty columns. Its actions column offers a new workspace for every row and opens an existing linked worktree or folder workspace. A native button in an original cell opens the detail view.

Other task providers update state through user actions (for example Linear's state picker, Jira transitions, and GitHub/GitLab issue close). Feishu follows that timing: after reviewing the work, the user clicks **Mark complete** in the record detail. Agent idle, process exit, and remote contact loss never trigger writeback.

In **Settings → Tasks → Feishu Bitable → Field mapping**, optionally select a text or single-select status field and a completion value. Single-select values must already exist; Orca does not add options or guess a column. An unmapped title does not prevent saving a completion mapping. No mapping means completion is disabled, while reading and workspace actions continue to work.

The execution host stores the app secret and handles the write. `feishuBitable.completeRecord` (remote RPC) and `feishuBitable:completeRecord` (local IPC) accept only the full connection/app/table/record reference. The host rechecks the connection, current schema and record before sending a single-field PUT. The mapped status must be present in the successful response before the UI reports completion. A write denial or unverified response leaves completion retryable and does not disable reads. See the [Feishu update-record API](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/update).

Bitable read access remains sufficient for discovery, listing and mapping. Completing a record additionally needs the app's record-update permission and access to the base, record and mapped field, including any advanced permission restrictions. The app's published permission changes must be effective before retrying. No real Feishu records were written in validation.

New mapping, schema, and row fields are optional. An older remote host can continue serving reads; `method_not_found` for completion displays an upgrade message and never falls back to a local write. Explicit task-source host routing also supports SSH and folder workspaces. In-flight results are fenced by host context, connection and full record identity.

Feishu UI copy uses the existing extraction/catalog flow. Simplified Chinese translations cover the added messages. Other maintained target catalogs remain sparse and fall back to English, rather than receiving copied-English or fabricated translations. Provider-supplied field names, options and record values remain unchanged.

## Running locally

From this worktree, `pnpm start` runs the compiled desktop and `pnpm dev` runs development mode. Use `ORCA_DEV_USER_DATA_PATH=/tmp/orca-feishu-execution-profile` on this Linux host to keep the app profile separate from the already-running checkout; the short path also avoids Unix socket path limits. For agent-driven validation use `ORCA_BACKGROUND_LAUNCH=1`; the window stays hidden and can be inspected with Playwright CDP. In the app, open Settings → Tasks, add an enterprise app, paste a Bitable link, load/select its table (or enter the table ID manually), then view the Feishu task source.

Build outputs are `out/main`, `out/preload`, `out/renderer`, `out/cli`, `out/web` and `out/mobile-web`. Local validation logs and hidden-renderer screenshots are under `node_modules/.cache/feishu-validation`. The machine-readable final handoff is `/tmp/orca-feishu-execution-handoff.md`.
