/**
 * The managed account whose folder holds a Claude transcript, or null for the user's own folder
 * (System default). Each account runs with CLAUDE_CONFIG_DIR at `<data>/claude-profiles/<id>/home`,
 * and Claude writes its transcripts under that folder's `projects/`.
 */
export function claudeAccountIdFromTranscriptPath(transcriptPath: string): string | null {
  const segments = transcriptPath.split(/[\\/]/)
  for (let index = 0; index + 3 < segments.length; index += 1) {
    if (
      segments[index] === 'claude-profiles' &&
      segments[index + 2] === 'home' &&
      segments[index + 3] === 'projects'
    ) {
      return segments[index + 1] || null
    }
  }
  return null
}
