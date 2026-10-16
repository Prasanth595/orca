# Perforce integration

Orca can drive a Perforce (Helix Core) client workspace from the Source Control panel.

## How it is wired

- A Perforce workspace is added as an ordinary **folder** project (Add Project → folder). Orca does not add a new
  repository kind: when a local folder project sits inside a client workspace (`p4 info` reports a client whose
  root contains the folder), the Source Control tab appears and renders the Perforce panel instead of the
  "Git repositories only" message.
- Everything runs the `p4` command-line client on the machine that owns the folder. Install `p4` on `PATH`, or
  point `ORCA_P4_PATH` at the binary. Credentials come from your normal `P4PORT`/`P4USER`/`P4CONFIG`/ticket setup.
- **P4CONFIG is found by default.** Apps launched from the desktop and orcad on an SSH host do not inherit the shell's
  `P4CONFIG`, so when neither Settings > Perforce, the environment, nor `p4 set` (P4ENVIRO) names one, every p4 call
  looks for `.p4config` (then `p4config.txt`, `.p4config.txt`) from the workspace up to the filesystem root and
  uses the nearest (`src/shared/perforce/p4-config-discovery.ts`).
- **SSH-hosted folders work the same way.** An SSH workspace is served by orcad on the remote host, and the client
  sends `perforce.*` RPC methods to it (`src/main/runtime/rpc/methods/perforce.ts`); orcad runs `p4` there, so `p4`
  (and its login ticket) only has to exist on that host. A server that predates these methods answers
  `method_not_found`: detection reports "not Perforce" and other actions ask the user to update the server.

## Concepts mapped to the panel

| Panel section        | Perforce meaning                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default changelist   | Files opened in the default changelist; described and submitted from the box at the top                                                                                            |
| Changelist N         | Collapsible numbered pending changelists: edit description (pencil), Shelve, Unshelve, Revert shelved files, Submit (opened-only or shelved-only, not both), and Delete when empty |
| Modified, not opened | Files changed on disk but not checked out (`p4 reconcile -n`)                                                                                                                      |
| New files            | Files on disk that are not in the depot                                                                                                                                            |

Row actions: click to diff against `#have`; **Open** runs `p4 reconcile` (add/edit/delete as the disk dictates);
**Revert changes** reverts opened files, force-syncs modified ones, and deletes new ones. The header has Refresh and Get Latest (`p4 sync`).

Selection: Cmd/Ctrl-click toggles a row, Shift-click selects a range. Right-clicking a checked-out file (or the
selection) offers **Move to existing changelist** (a list of the other pending changelists, plus Default) and
**Move to new changelist…**, which asks for a description first and only then creates the changelist and moves the
files. The Unshelve button in the panel header restores any changelist's shelf by number (including another user's)
into the default or an existing changelist. The same right-click menu has **Shelf changes** (shelve the files, then
revert them) and **Revert changes**. Shelved files are listed as `S` rows: click diffs the shelf against the
workspace, and right-click offers **Open shelved file** and **Unshelve file**. Right-clicking a changelist offers
**Copy changelist number** and **Delete changelist** (drops the shelf, reverts opened files, deletes it).

Every one of these operations is also a `perforce.*` orcad RPC method, so SSH-hosted workspaces support them all.

Saving a read-only workspace file from Orca's editor first runs `p4 edit` on it (after asking, by default); for an
SSH workspace the client asks and calls `perforce.checkoutIfReadOnly` before `files.write`.

Keyboard chords on the active Perforce file (editor or unstaged-diff tab): **Alt+P, Alt+E** opens it for edit (`p4 edit`),
**Alt+P, Alt+R** reverts its changes. `PerforceChordDetector` (`src/shared/perforce/perforce-file-chord.ts`) is a pure
two-step detector wired by `app-shell/use-perforce-file-chords.ts`; it only claims Alt+P when a Perforce file is active. The
shortcut registry supports single combinations only, so these are fixed rather than remappable.

## Code map

- `src/shared/perforce/` — everything that runs `p4`: runner, tagged-output parser, detection, status/diff,
  mutations, changelists, and `PerforceBackend` (the full operation set). Shared so orcad uses the same code.
- `src/shared/perforce/perforce-operations.ts` — every operation with its argument validation; the desktop IPC
  handlers and the orcad RPC methods both dispatch through it.
- `src/main/runtime/rpc/methods/perforce.ts` — `perforce.*` RPC on orcad: resolves the folder workspace, refuses one
  another host owns, and runs the operation with the caller's settings.
- `src/main/ipc/perforce.ts` + `src/preload/api/perforce-*.ts` — `perforce:*` IPC for local workspaces.
- `src/renderer/src/runtime/runtime-perforce-client.ts` — the panel's client: IPC for local workspaces, `perforce.*`
  RPC to the hosting server for runtime-hosted (SSH) ones.
- `src/renderer/src/components/right-sidebar/perforce/` — panel and detection hook.
- `git:diff` routes to `p4 print` for Perforce folders so the standard diff tabs work, on the desktop and on orcad
  (`src/main/perforce/perforce-hosted-diff.ts`).

## Testing

- `src/main/runtime/rpc/methods/perforce.test.ts` — the RPC methods through a real dispatcher (routing, validation, settings).
- `src/main/runtime/rpc/methods/perforce.real-p4.test.ts` — every operation against a real server in a throwaway
  client: `ORCA_P4_TEST_PORT=localhost:1666 pnpm test src/main/runtime/rpc/methods/perforce.real-p4.test.ts`.
- `pnpm smoke:orcad-perforce --workspace <client root>` — boots the built orcad (`pnpm build:orcad`) and drives the
  methods over the real transport; the only change to the workspace is an `edit` that it reverts.
- `tests/e2e/paired-client-perforce-panel.spec.ts` — a paired client renders the panel for a host-served workspace
  (`ORCA_P4_TEST_WORKSPACE=<client root>`).

## Settings > Perforce

Preferences live in `GlobalSettings.perforce` (`src/shared/perforce/perforce-settings.ts`, always read through
`normalizePerforceSettings`). They cover the p4 path and `P4PORT`/`P4USER`/`P4CLIENT`/`P4CONFIG`/`P4IGNORE` overrides,
timeouts, panel section order and visibility, refresh interval, `#have` vs `#head` diffs, save-time checkout behavior,
the `E` tab marker, new-changelist defaults, submit and destructive-action confirmations, what happens to a shelf on
submit, and the AI description button.

The p4 runner is shared with orcad, so settings reach it through a request-scoped context
(`p4-settings-context.ts`): the desktop wraps local calls, and sends the same object with every `perforce.*` RPC
request (`settings` param). For an SSH workspace, "Generate description" reads the diff on the host
(`perforce.diffText`) and runs the agent on the desktop. "Test connection" runs `p4 info` through
`perforce:info`. "Generate description" (`perforce:generateDescription`) runs the agent, model, and instructions from Settings >
Perforce (independent of Git AI Author), feeding it `p4 diff -du` of the changelist's opened files.
