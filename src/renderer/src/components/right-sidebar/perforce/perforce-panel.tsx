import { Fragment, useState } from 'react'
import { FolderPlus, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { detectLanguage } from '@/lib/language-detect'
import { joinPath } from '@/lib/path'
import { useAppStore } from '@/store'
import {
  perforceSectionOrder,
  type PerforcePanelSection
} from '../../../../../shared/perforce/perforce-settings'
import { toShelvedDiffPath } from '../../../../../shared/perforce/perforce-shelved-paths'
import type {
  PerforceEntry,
  PerforceShelvedFile
} from '../../../../../shared/perforce/perforce-types'
import { PerforceChangelistHeader } from './perforce-changelist-section'
import { NewChangelistDialog, UnshelveDialog } from './perforce-dialogs'
import { PerforceFileActions } from './perforce-file-actions'
import { PerforceFileContextMenu } from './perforce-file-context-menu'
import { PerforceFileRow } from './perforce-file-row'
import { PerforcePanelHeader } from './perforce-panel-header'
import { rowKey, usePerforceGroups } from './use-perforce-groups'
import { usePerforceSelection } from './use-perforce-selection'
import { usePerforceDescriptionTemplate } from './use-perforce-description-template'
import { SectionHeader } from './perforce-section-header'
import { usePerforceChangelistActions } from './use-perforce-changelist-actions'
import { usePerforceSettings } from './use-perforce-settings'
import { usePerforceStatus } from './use-perforce-status'
import { PerforceHistorySection } from './perforce-history-section'
import { translate } from '@/i18n/i18n'
import { perforceClient } from '@/runtime/runtime-perforce-client'

export function PerforcePanel({
  worktreeId,
  worktreePath,
  connectionId
}: {
  worktreeId: string
  worktreePath: string
  connectionId?: string
}) {
  const target = { worktreePath, connectionId, worktreeId }
  const settings = usePerforceSettings()
  const { status, error, busy, refresh, run } = usePerforceStatus(
    target,
    settings.refreshIntervalSeconds
  )
  const openDiff = useAppStore((s) => s.openDiff)
  const openFile = useAppStore((s) => s.openFile)
  const [message, setMessage] = useState('')
  const [newChangelistPaths, setNewChangelistPaths] = useState<string[] | null>(null)
  const [unshelveOpen, setUnshelveOpen] = useState(false)
  const [collapsedChangelists, setCollapsedChangelists] = useState<ReadonlySet<number>>(new Set())
  const { selected, select, focusForContextMenu } = usePerforceSelection()
  const api = perforceClient
  const template = usePerforceDescriptionTemplate(settings, status, setMessage)

  const { groups, orderedKeys } = usePerforceGroups(status)

  const openEntryDiff = (entry: PerforceEntry): void => {
    openDiff(
      worktreeId,
      joinPath(worktreePath, entry.path),
      entry.path,
      detectLanguage(entry.path),
      false
    )
  }
  // Why: shelved views reuse the read-only "staged" diff tab, keyed by a shelf-suffixed path.
  const openShelvedFile = (
    file: PerforceShelvedFile,
    changelist: number,
    viewOnly: boolean
  ): void => {
    if (!file.path) {
      return
    }
    openDiff(
      worktreeId,
      joinPath(worktreePath, file.path),
      toShelvedDiffPath(file.path, changelist, viewOnly),
      detectLanguage(file.path),
      true
    )
  }
  const paths = (entries: PerforceEntry[]): string[] => entries.map((entry) => entry.path)
  const { ask, generateDescription, shelveChanges, buildActions, unshelve, unshelveIntoNew } =
    usePerforceChangelistActions({ target, run, busy, settings, openShelvedFile })

  const submitDefault = async (): Promise<void> => {
    const ok = await run(
      () => api.submit({ ...target, changelist: 'default', message }),
      'Submitted change'
    )
    if (ok) {
      setMessage(template)
    }
  }

  const confirmDiscard = (entries: PerforceEntry[]): void => {
    const noun = entries.length === 1 ? entries[0]?.path : `${entries.length} files`
    if (
      ask(`Revert changes to ${noun}? This cannot be undone.`, settings.confirmDestructiveActions)
    ) {
      void run(() => api.discard({ ...target, entries }))
    }
  }

  const openedTargets = (clicked: PerforceEntry): PerforceEntry[] => {
    const picked = (status?.entries ?? []).filter(
      (entry) => entry.group === 'opened' && selected.has(rowKey(entry))
    )
    return picked.some((entry) => entry.path === clicked.path) ? picked : [clicked]
  }

  const renderRows = (entries: PerforceEntry[]) =>
    entries.map((entry) => {
      const row = (
        <PerforceFileRow
          key={rowKey(entry)}
          entry={entry}
          fullPath={joinPath(worktreePath, entry.path)}
          selected={selected.has(rowKey(entry))}
          onSelect={(event) => {
            if (select(rowKey(entry), event, orderedKeys) === 'plain') {
              openEntryDiff(entry)
            }
          }}
          onContextMenu={() => focusForContextMenu(rowKey(entry))}
          actions={
            <PerforceFileActions
              entry={entry}
              busy={busy}
              onOpen={() => void run(() => api.open({ ...target, filePaths: [entry.path] }))}
              onDiscard={() => confirmDiscard([entry])}
            />
          }
        />
      )
      if (entry.group !== 'opened') {
        return row
      }
      const targets = openedTargets(entry)
      return (
        <PerforceFileContextMenu
          key={rowKey(entry)}
          targets={targets}
          changelists={status?.changelists ?? []}
          onOpen={() =>
            openFile({
              filePath: joinPath(worktreePath, entry.path),
              relativePath: entry.path,
              worktreeId,
              language: detectLanguage(entry.path),
              mode: 'edit'
            })
          }
          onMoveToChangelist={(changelist) =>
            void run(() =>
              api.moveToChangelist({
                ...target,
                filePaths: paths(targets),
                changelist
              })
            )
          }
          onMoveToNewChangelist={() => setNewChangelistPaths(paths(targets))}
          onRevert={() => confirmDiscard(targets)}
          onShelveChanges={() => shelveChanges(targets)}
        >
          {row}
        </PerforceFileContextMenu>
      )
    })

  if (!status) {
    return (
      <div className="flex h-full items-center justify-center px-4 text-center text-xs text-muted-foreground">
        {error ?? translate('perforce.ui.loadingPerforceWorkspace', 'Loading Perforce workspace…')}
      </div>
    )
  }

  const { info } = status
  const nothingPending =
    groups.defaultList.length + groups.modified.length + groups.fresh.length === 0 &&
    groups.numbered.length === 0
  const canSubmit = message.trim().length > 0 && groups.defaultList.length > 0
  const createFilePaths = (files: PerforceEntry[]): string[] =>
    settings.newChangelistMode === 'empty' ? [] : paths(files)

  const sections: Record<PerforcePanelSection, React.ReactNode> = {
    default:
      groups.defaultList.length > 0 ? (
        <>
          <SectionHeader
            title={translate('perforce.ui.defaultChangelist', 'Default changelist')}
            count={groups.defaultList.length}
          >
            <Button
              variant="ghost"
              size="icon-xs"
              title={
                settings.newChangelistMode === 'empty'
                  ? translate(
                      'perforce.ui.createAnEmptyChangelistUsesThe',
                      'Create an empty changelist (uses the description above)'
                    )
                  : translate(
                      'perforce.ui.moveToANewChangelistUses',
                      'Move to a new changelist (uses the description above)'
                    )
              }
              disabled={busy || message.trim().length === 0}
              onClick={() =>
                void run(
                  () =>
                    api.createChangelist({
                      ...target,
                      description: message,
                      filePaths: createFilePaths(groups.defaultList)
                    }),
                  'Created changelist'
                ).then((ok) => ok && setMessage(template))
              }
            >
              <FolderPlus />
            </Button>
          </SectionHeader>
          {renderRows(groups.defaultList)}
        </>
      ) : null,
    numbered: (
      <>
        {groups.numbered.map(({ changelist, files }) => (
          <div key={changelist.id}>
            <PerforceChangelistHeader
              changelist={changelist}
              fileCount={files.length}
              collapsed={collapsedChangelists.has(changelist.id)}
              aiEnabled={settings.aiDescriptionEnabled}
              onToggle={() =>
                setCollapsedChangelists((prev) => {
                  const next = new Set(prev)
                  if (!next.delete(changelist.id)) {
                    next.add(changelist.id)
                  }
                  return next
                })
              }
              actions={buildActions(changelist, files)}
            />
            {collapsedChangelists.has(changelist.id) ? null : renderRows(files)}
          </div>
        ))}
      </>
    ),
    modified:
      groups.modified.length > 0 ? (
        <>
          <SectionHeader
            title={translate('perforce.ui.modifiedNotOpened', 'Modified, not opened')}
            count={groups.modified.length}
          >
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() =>
                void run(() => api.open({ ...target, filePaths: paths(groups.modified) }))
              }
            >
              {translate('perforce.ui.openAll', 'Open all')}
            </Button>
          </SectionHeader>
          {renderRows(groups.modified)}
        </>
      ) : null,
    new:
      groups.fresh.length > 0 ? (
        <>
          <SectionHeader
            title={translate('perforce.ui.newFiles', 'New files')}
            count={groups.fresh.length}
          >
            <Button
              variant="ghost"
              size="xs"
              disabled={busy}
              onClick={() =>
                void run(() => api.open({ ...target, filePaths: paths(groups.fresh) }))
              }
            >
              {translate('perforce.ui.addAll', 'Add all')}
            </Button>
          </SectionHeader>
          {renderRows(groups.fresh)}
        </>
      ) : null
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PerforcePanelHeader
        info={info}
        busy={busy}
        onRefresh={() => void refresh()}
        onSync={() => void run(() => api.sync(target), 'Workspace synced')}
        onUnshelve={() => setUnshelveOpen(true)}
      />
      {error ? <div className="px-2 py-1 text-xs text-destructive">{error}</div> : null}
      <div className="flex flex-col gap-2 border-b border-border p-2">
        <Textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder={translate('perforce.ui.changelistDescription', 'Changelist description')}
          rows={3}
          className="min-h-0"
        />
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            className="flex-1"
            disabled={busy || !canSubmit}
            onClick={() => {
              if (ask('Submit the default changelist?', settings.confirmSubmit)) {
                void submitDefault()
              }
            }}
          >
            {translate('perforce.ui.submitChange2', 'Submit Change')}
          </Button>
          {settings.aiDescriptionEnabled ? (
            <Button
              size="icon-sm"
              variant="outline"
              title={translate(
                'perforce.ui.generateDescriptionWithAi',
                'Generate description with AI'
              )}
              disabled={busy || groups.defaultList.length === 0}
              onClick={() =>
                void generateDescription('default', paths(groups.defaultList)).then(
                  (text) => text && setMessage(text)
                )
              }
            >
              <Sparkles />
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pb-2 scrollbar-sleek">
        {nothingPending ? (
          <div className="px-4 py-6 text-center text-xs text-muted-foreground">
            {translate('perforce.ui.noPendingChanges', 'No pending changes')}
          </div>
        ) : null}
        {perforceSectionOrder(settings.groupOrder).map((id) => (
          <Fragment key={id}>{sections[id]}</Fragment>
        ))}
        {/* Why: dock the history at the bottom of the pane scroll like the git COMMITS panel. */}
        <div className="sticky bottom-0 z-10 mt-auto shrink-0 border-t border-border bg-sidebar/95 backdrop-blur-sm">
          <PerforceHistorySection target={target} worktreeId={worktreeId} />
        </div>
      </div>
      {newChangelistPaths ? (
        <NewChangelistDialog
          fileCount={settings.newChangelistMode === 'empty' ? 0 : newChangelistPaths.length}
          initialDescription={template}
          onGenerate={
            settings.aiDescriptionEnabled
              ? () => generateDescription('new', newChangelistPaths)
              : undefined
          }
          onCancel={() => setNewChangelistPaths(null)}
          onCreate={(description) =>
            run(
              () =>
                api.createChangelist({
                  ...target,
                  description,
                  filePaths: settings.newChangelistMode === 'empty' ? [] : newChangelistPaths
                }),
              'Created changelist'
            )
          }
        />
      ) : null}
      {unshelveOpen ? (
        <UnshelveDialog
          changelists={status.changelists}
          onCancel={() => setUnshelveOpen(false)}
          onUnshelve={unshelve}
          onUnshelveIntoNew={unshelveIntoNew}
        />
      ) : null}
    </div>
  )
}
