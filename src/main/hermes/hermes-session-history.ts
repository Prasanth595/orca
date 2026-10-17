import {
  resumeInvocationFromOptions,
  sessionFileResumeTargetMatches,
  type StructuredAgentSessionHistory
} from '../native-chat/structured-agent-cli-conversations'

/** A chat's session id is the id Hermes reports for the session it is running. */
export const HERMES_SESSION_HISTORY: StructuredAgentSessionHistory = {
  rowAgents: ['hermes'],
  rowSessionId: (link) => link.handle.nativeId,
  // `--resume <id>` reopens one session; a bare `--resume` opens Hermes's own picker.
  parseResumeArgs: (args) =>
    resumeInvocationFromOptions(args, {
      targetless: ['-c', '--continue'],
      markers: ['-r', '--resume']
    }),
  resumeTargetMatches: sessionFileResumeTargetMatches
}
