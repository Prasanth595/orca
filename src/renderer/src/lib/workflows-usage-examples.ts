import { translate } from '@/i18n/i18n'
import { createLocalizedCatalog } from '@/i18n/localized-catalog'
import type { SkillUsageExample } from './skill-usage-example'

export const getWorkflowsUsageExamples = createLocalizedCatalog((): SkillUsageExample[] => [
  {
    id: 'disk-space',
    title: translate(
      'auto.lib.workflows.usage.examples.diskSpaceTitle',
      'Turn a chore into a workflow'
    ),
    summary: translate(
      'auto.lib.workflows.usage.examples.diskSpaceSummary',
      'Save a repeated sequence of steps once, then run it whenever you need it.'
    ),
    prompt:
      'Use /workflows to create a workflow that checks how much free disk space my machine has and writes a short report to disk-usage.md.'
  },
  {
    id: 'import-graph',
    title: translate('auto.lib.workflows.usage.examples.importGraphTitle', 'Import a workflow'),
    summary: translate(
      'auto.lib.workflows.usage.examples.importGraphSummary',
      'Author the step graph as workflow JSON and import it through the CLI.'
    ),
    prompt:
      'Use /workflows to import ./deploy-check.workflow.json, then list the steps Orca imported.'
  },
  {
    id: 'run-record',
    title: translate('auto.lib.workflows.usage.examples.runRecordTitle', 'Run and inspect a run'),
    summary: translate(
      'auto.lib.workflows.usage.examples.runRecordSummary',
      'Run a saved workflow and read the step-by-step run record.'
    ),
    prompt:
      "Use /workflows to run my nightly-backup workflow and report each step's output plus anything that failed."
  },
  {
    id: 'remote-host',
    title: translate(
      'auto.lib.workflows.usage.examples.remoteHostTitle',
      'Run the same steps on a remote host'
    ),
    summary: translate(
      'auto.lib.workflows.usage.examples.remoteHostSummary',
      'Pick an execution target so the workflow runs on an SSH server instead of this machine.'
    ),
    prompt:
      'Use /workflows to import the backup workflow onto my SSH server and run it there, then show me the run record.'
  }
])
