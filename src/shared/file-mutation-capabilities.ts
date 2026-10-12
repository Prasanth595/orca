// Older runtimes strip mutation owner fields, so clients must fence writes before RPC.
export const FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY = 'files.mutation-ownership.v1' as const
// Older hosts create upload parents even when the destination was removed.
export const FILE_UPLOAD_EXISTING_PARENT_RUNTIME_CAPABILITY =
  'files.upload-existing-parent.v1' as const
export const FILE_MUTATION_OWNERSHIP_UPDATE_REQUIRED_MESSAGE =
  'Remote file changes require a newer Orca server. Update the HUB and try again.'

export const FILE_MUTATION_RUNTIME_CAPABILITIES = [
  FILE_MUTATION_OWNERSHIP_RUNTIME_CAPABILITY,
  FILE_UPLOAD_EXISTING_PARENT_RUNTIME_CAPABILITY
] as const
