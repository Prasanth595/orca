export const GITHUB_MARK_PR_READY_RUNTIME_CAPABILITY = 'github.markPRReadyForReview' as const
export const GITHUB_MARK_PR_READY_UPDATE_REQUIRED_MESSAGE =
  'Marking a pull request ready requires a newer Orca server. Update the server and try again.'
export const GITLAB_READY_FOR_REVIEW_RUNTIME_CAPABILITY =
  'gitlab.updateMR.readyForReview.v1' as const
export const GITLAB_READY_FOR_REVIEW_UPDATE_REQUIRED_MESSAGE =
  'Marking a merge request ready requires a newer Orca server. Update the server and try again.'

export const HOSTED_REVIEW_READY_RUNTIME_CAPABILITIES = [
  GITHUB_MARK_PR_READY_RUNTIME_CAPABILITY,
  GITLAB_READY_FOR_REVIEW_RUNTIME_CAPABILITY
] as const
