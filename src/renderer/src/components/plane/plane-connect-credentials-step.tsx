import { useId } from 'react'
import { ExternalLink, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { translate } from '@/i18n/i18n'
import type { PlaneHostKind } from '../../../../shared/plane-types'
import {
  getPlaneTokenSettingsUrl,
  isCloudUrlInSelfHostedForm,
  needsInsecureHttpConsent,
  type PlaneConnectField,
  type PlaneConnectFormAction,
  type PlaneConnectFormState
} from './plane-connect-form-model'
import { getPlaneErrorCopy } from './plane-error-copy'
import { PlaneOptionGroup } from './PlaneOptionGroup'

function PlaneTextField({
  field,
  label,
  description,
  placeholder,
  type = 'text',
  state,
  dispatch,
  autoFocus = false
}: {
  field: PlaneConnectField
  label: string
  description?: string
  placeholder?: string
  type?: 'text' | 'password' | 'url'
  state: PlaneConnectFormState
  dispatch: (action: PlaneConnectFormAction) => void
  autoFocus?: boolean
}): React.JSX.Element {
  const id = useId()
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        placeholder={placeholder}
        value={state[field]}
        disabled={state.submitting}
        aria-invalid={state.error?.field === field || undefined}
        onChange={(event) => dispatch({ type: 'setField', field, value: event.target.value })}
      />
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
    </div>
  )
}

export function PlaneConnectCredentialsStep({
  state,
  dispatch,
  hostLabel,
  remoteRuntime
}: {
  state: PlaneConnectFormState
  dispatch: (action: PlaneConnectFormAction) => void
  hostLabel: string
  remoteRuntime: boolean
}): React.JSX.Element {
  const consentId = useId()
  const tokenSettingsUrl = getPlaneTokenSettingsUrl(state)
  const selfHosted = state.hostKind === 'self-hosted'

  return (
    <div className="flex flex-col gap-3">
      <PlaneOptionGroup<PlaneHostKind>
        label={translate('plane.connect.hostGroupLabel', 'Where your Plane workspace runs')}
        value={state.hostKind}
        disabled={state.submitting}
        onChange={(hostKind) => dispatch({ type: 'selectHost', hostKind })}
        options={[
          {
            value: 'cloud',
            title: translate('plane.connect.cloudTitle', 'Plane Cloud'),
            description: translate(
              'plane.connect.cloudDescription',
              'A workspace hosted by Plane at app.plane.so.'
            )
          },
          {
            value: 'self-hosted',
            title: translate('plane.connect.selfHostedTitle', 'Self-hosted'),
            description: translate(
              'plane.connect.selfHostedDescription',
              'A Plane server that you or your team run.'
            )
          }
        ]}
      />
      {selfHosted ? (
        <>
          <PlaneTextField
            field="serverUrl"
            type="url"
            autoFocus
            state={state}
            dispatch={dispatch}
            label={translate('plane.connect.serverUrl', 'Server URL')}
            placeholder={translate(
              'plane.connect.serverUrlPlaceholder',
              'https://plane.example.com'
            )}
            description={translate(
              'plane.connect.serverUrlDescription',
              'The address you open Plane at. A path prefix like /plane is kept.'
            )}
          />
          {isCloudUrlInSelfHostedForm(state) ? (
            <p className="text-xs text-muted-foreground">
              {translate('plane.connect.cloudUrlNotice', 'This is a Plane Cloud address.')}{' '}
              <Button
                type="button"
                variant="link"
                size="xs"
                onClick={() => dispatch({ type: 'selectHost', hostKind: 'cloud' })}
              >
                {translate('plane.connect.useCloud', 'Use Plane Cloud')}
              </Button>
            </p>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-expanded={state.advancedOpen}
            onClick={() => dispatch({ type: 'toggleAdvanced' })}
          >
            {translate('plane.connect.advanced', 'Advanced')}
          </Button>
          {state.advancedOpen ? (
            <PlaneTextField
              field="apiBaseUrl"
              type="url"
              state={state}
              dispatch={dispatch}
              label={translate('plane.connect.apiBaseUrl', 'API base URL')}
              placeholder={translate('plane.connect.apiBaseUrlPlaceholder', 'Same as server URL')}
              description={translate(
                'plane.connect.apiBaseUrlDescription',
                'Only needed when the Plane API is served from a different address.'
              )}
            />
          ) : null}
        </>
      ) : null}
      {state.hostKind ? (
        <>
          <PlaneTextField
            field="workspaceSlug"
            state={state}
            dispatch={dispatch}
            autoFocus={!selfHosted}
            label={translate('plane.connect.workspaceSlug', 'Workspace slug')}
            placeholder={translate('plane.connect.workspaceSlugPlaceholder', 'acme')}
            description={translate(
              'plane.connect.workspaceSlugDescription',
              'The first part of the path in your Plane URL, like acme in /acme/projects.'
            )}
          />
          <PlaneTextField
            field="apiToken"
            type="password"
            state={state}
            dispatch={dispatch}
            label={translate('plane.connect.apiToken', 'Personal access token')}
            placeholder={translate('plane.connect.apiTokenPlaceholder', 'plane_api_…')}
          />
          {tokenSettingsUrl ? (
            <Button
              type="button"
              variant="link"
              size="xs"
              onClick={() => void window.api.shell.openUrl(tokenSettingsUrl)}
            >
              <ExternalLink />
              {translate('plane.connect.createToken', 'Create a token in Plane')}
            </Button>
          ) : null}
        </>
      ) : null}
      {needsInsecureHttpConsent(state) ? (
        <div className="flex items-start gap-2">
          <Checkbox
            id={consentId}
            checked={state.insecureHttpAcknowledged}
            disabled={state.submitting}
            onCheckedChange={(checked) =>
              dispatch({ type: 'acknowledgeInsecureHttp', value: checked === true })
            }
          />
          <div className="space-y-1">
            <Label htmlFor={consentId}>
              {translate('plane.connect.insecureConsent', 'Send my token over unencrypted HTTP')}
            </Label>
            <p className="text-xs text-muted-foreground">
              {translate(
                'plane.connect.insecureWarning',
                'Anyone on the network between {{host}} and this server can read the token.',
                { host: hostLabel }
              )}
            </p>
          </div>
        </div>
      ) : null}
      {state.error ? (
        <p role="alert" className="text-xs text-destructive">
          {getPlaneErrorCopy(state.error.kind, hostLabel)}
        </p>
      ) : null}
      {state.hostKind ? (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Lock className="size-3 shrink-0" />
          {remoteRuntime
            ? translate(
                'plane.connect.storageRemote',
                'The token is sent to {{host}} and stored there with the encryption it supports.',
                { host: hostLabel }
              )
            : translate(
                'plane.connect.storageLocal',
                'The token is stored on this computer and encrypted when the system keychain is available.'
              )}
        </p>
      ) : null}
    </div>
  )
}
