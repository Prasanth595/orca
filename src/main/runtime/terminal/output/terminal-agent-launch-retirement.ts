import { isShellProcess } from '../../../../shared/shell-process-detection'
import { OrcaRuntimeWithVerifyOrchestrationCompatibilityCaller } from '../../orchestration/terminal-authority/verify-orchestration-compatibility-caller'
import { captureAgentHookRetirementFence } from '../../runtime-agent-hook-retirement-fence'
import type { PtyForegroundProcessRead } from '../../runtime-terminal-contracts'

export abstract class OrcaRuntimeWithAgentLaunchRetirement extends OrcaRuntimeWithVerifyOrchestrationCompatibilityCaller {
  protected abstract collectPaneKeysForPty(ptyId: string): Set<string>
  protected abstract retirePtyAgentLaunchAuthority(ptyId: string): void
  protected abstract readPtyForegroundProcessFromController(
    ptyId: string,
    afterTitleObservation?: number
  ): Promise<PtyForegroundProcessRead> | null

  protected async retirePtyAgentLaunchAuthorityAfterCommandFinished(ptyId: string): Promise<void> {
    const pty = this.ptysById.get(ptyId)
    if (!pty?.connected) {
      return
    }
    pty.launchNeedsHookAttestation = true
    const receipt = this.restoredOrchestrationAuthorityByPtyId.get(ptyId)
    const { launchToken, launchAgent, incarnationId } = pty
    if (!launchToken && !receipt && !launchAgent) {
      return
    }
    const generation = this.getPtyLifecycleGeneration(ptyId)
    const hookObservationsUnchanged = captureAgentHookRetirementFence(
      this.collectPaneKeysForPty(ptyId),
      this.getAgentProviderSessionRowsForPaneFn,
      this.getAgentProviderSessionSnapshotFn ?? this.getAgentStatusSnapshotFn
    )
    const result = await this.readPtyForegroundProcessFromController(ptyId, pty.lastOscTitleAt ?? 0)
    // OMP emits command-finished markers during live TUI redraws, not only on process exit.
    if (
      !result?.available ||
      result.controller !== this.ptyController ||
      !result.process ||
      !isShellProcess(result.process)
    ) {
      return
    }
    if (
      this.ptysById.get(ptyId) !== pty ||
      !pty.connected ||
      pty.incarnationId !== incarnationId ||
      this.getPtyLifecycleGeneration(ptyId) !== generation ||
      pty.launchToken !== launchToken ||
      pty.launchAgent !== launchAgent ||
      this.restoredOrchestrationAuthorityByPtyId.get(ptyId) !== receipt
    ) {
      return
    }
    if (!hookObservationsUnchanged()) {
      return
    }
    this.retirePtyAgentLaunchAuthority(ptyId)
  }
}
