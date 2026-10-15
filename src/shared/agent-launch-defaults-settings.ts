import type { TuiAgent } from './tui-agent'

/** Per-agent launch defaults applied when Orca starts an agent CLI. */
export type AgentLaunchDefaultsGlobalSettings = {
  /** Per-agent CLI command overrides. A missing key means use the catalog default binary name. */
  agentCmdOverrides: Partial<Record<TuiAgent, string>>
  /** Per-agent default CLI arguments appended after the binary/path and before prompts. */
  agentDefaultArgs?: Partial<Record<TuiAgent, string>>
  /** Per-agent launch environment defaults used when yolo mode is exposed as env. */
  agentDefaultEnv?: Partial<Record<TuiAgent, Record<string, string>>>
  /** One-shot guard for adding yolo-mode default args to untouched agent launch profiles. */
  agentYoloDefaultsMigrated?: boolean
}
