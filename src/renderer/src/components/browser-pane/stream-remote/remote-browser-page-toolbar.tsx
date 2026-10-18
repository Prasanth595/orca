import { Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { translate } from '@/i18n/i18n'
import { BrowserNavigationControlRow } from '../assemble-chrome/browser-navigation-control-row'
import BrowserAddressBar from '../assemble-chrome/BrowserAddressBar'
import type { BrowserAddressBarEditSessionBinding } from '../assemble-chrome/use-browser-address-bar-edit-session'
import type { BrowserPageDocLocation } from '../../../../../shared/browser-workspace-types'
import { RemoteRuntimeEgressIndicator } from '../assemble-chrome/browser-egress-indicator'
import { MarkupDrawButton } from '../annotate/MarkupDrawButton'
import type { MarkupModeController } from '../annotate/useMarkupMode'
import {
  BrowserChromeElementToolButtons,
  type BrowserChromeElementTools
} from '../assemble-chrome/browser-chrome-element-tool-buttons'

export function RemoteBrowserPageToolbar({
  runtimeEnvironmentId,
  addressBarValue,
  onAddressBarChange,
  onSubmitAddressBar,
  onNavigateToUrl,
  onOpenWorkspaceDoc,
  addressBarInputRef,
  addressBarEditSession,
  busy,
  loading,
  markup,
  elementTools,
  frameUrl,
  isActive,
  onBack,
  onForward,
  onReload
}: {
  runtimeEnvironmentId: string
  addressBarValue: string
  onAddressBarChange: (value: string) => void
  onSubmitAddressBar: () => void
  onNavigateToUrl: (url: string) => void
  /** A previewed-document suggestion opens on a fresh grant instead of navigating the remote guest. */
  onOpenWorkspaceDoc: (docLocation: BrowserPageDocLocation) => void
  addressBarInputRef: React.RefObject<HTMLInputElement | null>
  addressBarEditSession: BrowserAddressBarEditSessionBinding
  busy: boolean
  loading: boolean
  markup: MarkupModeController
  elementTools: BrowserChromeElementTools
  frameUrl: string | null
  isActive: boolean
  onBack: () => void
  onForward: () => void
  onReload: () => void
}): React.JSX.Element {
  return (
    <BrowserNavigationControlRow
      controls={{
        // Why: remote pages report no history depth, so the arrows stay live and a
        // dead-end back/forward RPC is simply a no-op on the host.
        canGoBack: true,
        canGoForward: true,
        loading: busy || loading,
        goBack: onBack,
        goForward: onForward,
        reload: onReload,
        navigate: onNavigateToUrl
      }}
      addressSlot={
        <BrowserAddressBar
          value={addressBarValue}
          onChange={onAddressBarChange}
          onSubmit={onSubmitAddressBar}
          onNavigate={onNavigateToUrl}
          onOpenWorkspaceDoc={onOpenWorkspaceDoc}
          inputRef={addressBarInputRef}
          editSession={addressBarEditSession}
          leadingIcon={
            <RemoteRuntimeEgressIndicator
              runtimeEnvironmentId={runtimeEnvironmentId}
              presentation="streamed"
            />
          }
        />
      }
      reloadControl={
        // Why: no ignore-cache RPC exists for remote pages, and this pane binds no reload chord, so there is
        // nothing truthful to put in a menu or a shortcut hint here — tooltip only.
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              aria-label={translate(
                'auto.components.browser.pane.BrowserPane.0e080d820e',
                'Reload'
              )}
              onClick={onReload}
            >
              {busy || loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <RefreshCw className="size-4" />
              )}
            </Button>
          </TooltipTrigger>
          <TooltipContent side="bottom" sideOffset={4}>
            {translate('auto.components.browser.pane.BrowserPane.0e080d820e', 'Reload')}
          </TooltipContent>
        </Tooltip>
      }
    >
      <BrowserChromeElementToolButtons
        tools={elementTools}
        showGrab
        showAnnotate
        showTourAnchors={false}
      />
      <MarkupDrawButton
        onClick={() => (markup.isActive ? markup.cancel() : void markup.start())}
        // Why: one picker at a time; the markup canvas would freeze a frame under an armed picker.
        disabled={!frameUrl || elementTools.activeIntent !== null}
        active={markup.isActive}
        surfaceActive={isActive}
        className="h-7 w-7"
      />
    </BrowserNavigationControlRow>
  )
}
