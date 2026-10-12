# Mosh for long lived Orca terminal sessions

This proposal covers long lived interactive terminal views that need to survive a short network outage or a client IP change. It does not replace SSH file transfer, Git, RPC, or the Orca terminal host process.

## Current boundary

Orca already owns the PTY on the execution host. Clients receive terminal output through `terminal.subscribe` and send input through the terminal RPC methods. Depending on the connection mode, Orca control and terminal streams use its runtime connection or an SSH relay. A Mosh client cannot be dropped in as a transport switch: Mosh starts an interactive command over SSH, then moves the terminal to its own UDP protocol. Mosh also does not provide SSH port forwarding or `sshfs`.

The long lived process therefore remains an Orca PTY. A new view attachment must hydrate from the host PTY with a bounded, sequence-aware snapshot. Mosh itself synchronizes terminal screen state; it is not an arbitrary byte stream. Losing a client connection must produce `unverifiable` transport state; it must never be treated as process exit.

## Proposed phases

1. **Capability and policy.** The execution host advertises `terminal.mosh.v1` only when a compatible `mosh-server` is installed, UDP policy is allowed, and the host can map a Mosh channel to an Orca terminal owner. Settings would select `ssh` or `mosh` for long lived interactive terminal views; SSH remains the bootstrap path. Falling back after a failed Mosh attempt requires the user to choose SSH and release the previous input lease.
2. **Host bridge.** The host starts a Mosh server with a restricted command that identifies an existing Orca terminal lease. It must not create a second shell, bypass workspace ownership, or expose a free standing server process. The bridge translates Mosh input, resize, and lifecycle events into the existing terminal subscription and input lease APIs.
3. **Reconnect and replay.** A surviving mosh-client/server pair handles IP changes using Mosh state synchronization. Recreating a client or server requires a new authenticated attachment to the same host PTY; it is a different path from roaming. At that boundary, the bridge hydrates from an Orca snapshot and follows only subsequent output. A missing or stale lease refuses attachment. Process verdicts remain host-owned: `live`, `unverifiable`, or `exited`.
4. **Client integration.** The mobile/desktop terminal view requests Mosh only after capability negotiation. It keeps the existing SSH/RPC path for file, Git, agent, and control operations. The view must show the same terminal owner and avoid duplicate input while a previous lease is unverifiable.

## Security and compatibility requirements

- Never accept a client supplied shell command, credential directory, or terminal path as the bridge target.
- Keep the terminal owner and input lease on the execution host; a reconnect cannot claim another workspace by knowing a Mosh port.
- Mosh UDP ports must be explicitly configured or allocated by the host policy. Do not assume that a firewall or NAT permits the default range.
- Older clients ignore the capability and continue using SSH. Older hosts reject the optional request before starting Mosh.
- SSH worktrees, local folders, WSL, and runtime hosts must each resolve ownership on the host that owns the PTY. A local client must not interpret a remote path.
- Do not expose Mosh's predictive echo as confirmed terminal output; the Orca host remains authoritative for transcript reads and agent status.

## Acceptance matrix

| Scenario | Expected result |
| --- | --- |
| Wi-Fi/cellular handoff during an idle PTY | Surviving Mosh endpoints synchronize the screen; the same host PTY remains live. |
| Brief outage while output is produced | Screen converges without duplicate input; host transcript retains output Mosh screen updates omit. |
| Client reconnects with a stale lease | Host refuses with an ownership error; the PTY continues running. |
| Host process exits | Confirmed PTY child exit reports `exited`; runtime contact loss alone is `unverifiable`. |
| UDP blocked | Connection reports failure; explicit SSH fallback attaches the same PTY after lease handover. |
| File/Git/RPC operation | Continues on existing SSH/RPC transport; Mosh is not selected. |
| Two clients send input | Existing input lease rules decide ownership; Mosh cannot bypass them. |

## Open implementation decisions

A stock Mosh terminal renders screen updates, not Orca binary stream frames, OSC metadata, or full scrollback. The bridge-to-PTY snapshot boundary must be separate from Mosh screen synchronization. A prototype must demonstrate alternate-screen, Unicode, resize, input lease renewal, and shell integration behavior before claiming parity. Agent status and transcripts must keep reading the original host PTY, never the predicted client screen.

A disconnected client must not silently lose its input lease while Mosh continues accepting keystrokes. Decide whether the bridge maintains the existing lease locally, how another client takes over, and how stale input is rejected. All require tests against real Mosh behavior as well as fakes.

Windows native client support, WSL client routing, mobile native library integration, secret-key retention/redaction, and terminal feature compatibility remain unresolved. Unsupported combinations must retain SSH. No platform support is promised by this document.

## Prototype boundary

The first implementation should be a host bridge and one terminal subscription integration behind the capability. It should include a fake Mosh transport for sequence, reconnect, lease, and UDP-policy tests. A real mosh-server/client integration test belongs in platform CI before enabling the setting. No real Mosh end-to-end test has been run for this proposal. UI settings and mobile pairing should be added only after the bridge can prove ownership and replay behavior.

Related issue: [#10426](https://github.com/stablyai/orca/issues/10426).

## Sources and code anchors

- [Mosh manual](https://github.com/mobile-shell/mosh/blob/master/man/mosh.1): SSH bootstrap, UDP, roaming, and non-interactive limitations.
- [Terminal subscription](../../src/main/runtime/rpc/methods/terminal/terminal-subscribe-method.ts): existing registration and input/view ownership boundary.
- [Snapshot publication](../../src/main/runtime/rpc/methods/terminal/terminal-subscribe-binary-snapshot.ts): output sequence and layout replay boundary.
