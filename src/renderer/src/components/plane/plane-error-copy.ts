import { translate } from '@/i18n/i18n'
import type { PlaneConnectErrorKind, PlaneOperationErrorKind } from '../../../../shared/plane-types'
import type { PlaneClientErrorKind } from '@/store/slices/plane-slice-contract'

export type PlaneErrorKind = PlaneConnectErrorKind | PlaneOperationErrorKind | PlaneClientErrorKind

// Why copy by kind: host messages are English and may name internals; the kind is stable
// across versions, and network/TLS failures must say which host could not reach Plane.
export function getPlaneErrorCopy(kind: PlaneErrorKind, hostLabel: string): string {
  switch (kind) {
    case 'auth':
      return translate(
        'plane.error.auth',
        'Plane rejected this token. Create a new one and try again.'
      )
    case 'forbidden':
      return translate('plane.error.forbidden', 'This token cannot access that Plane workspace.')
    case 'not_found':
      return translate(
        'plane.error.notFound',
        'Plane could not find that item. It may have been moved or deleted.'
      )
    case 'workspace_not_found':
      return translate(
        'plane.error.workspaceNotFound',
        'No Plane workspace with that slug is available to this token.'
      )
    case 'rate_limited':
      return translate(
        'plane.error.rateLimited',
        'Plane is rate limiting requests. Wait a minute and try again.'
      )
    case 'network':
      return translate(
        'plane.error.network',
        '{{host}} could not reach the Plane server. Check the URL and that {{host}} can reach it.',
        { host: hostLabel }
      )
    case 'tls':
      return translate(
        'plane.error.tls',
        "The Orca runtime on {{host}} doesn't trust this server's certificate.",
        { host: hostLabel }
      )
    case 'redirect':
      return translate(
        'plane.error.redirect',
        'The Plane server answered with a redirect. Use the final URL, including https.'
      )
    case 'invalid_response':
      return translate(
        'plane.error.invalidResponse',
        'This URL serves the Plane web app, not its API. Set the API base URL in Advanced.'
      )
    case 'rejected':
      return translate('plane.error.rejected', 'Plane rejected the request.')
    case 'empty':
      return translate('plane.error.urlEmpty', 'Enter the URL of your Plane server.')
    case 'invalid_url':
      return translate(
        'plane.error.urlInvalid',
        'Enter a valid URL, like https://plane.example.com.'
      )
    case 'unsupported_protocol':
      return translate('plane.error.urlProtocol', 'Use an http or https URL.')
    case 'credentials_in_url':
      return translate(
        'plane.error.urlCredentials',
        'Remove the username and password from the URL.'
      )
    case 'insecure_http_unconfirmed':
      return translate(
        'plane.error.insecureHttp',
        'Confirm that the token may be sent over unencrypted HTTP.'
      )
    case 'not_connected':
      return translate('plane.error.notConnected', 'Plane is not connected on {{host}}.', {
        host: hostLabel
      })
    case 'credential_unreadable':
      return translate(
        'plane.error.credentialUnreadable',
        '{{host}} could not read the saved Plane token. Reconnect Plane to save it again.',
        { host: hostLabel }
      )
    case 'update_required':
      return translate(
        'plane.error.updateRequired',
        'Update the Orca server on {{host}} to use Plane.',
        { host: hostLabel }
      )
    case 'runtime_error':
      return translate(
        'plane.error.runtime',
        'Orca could not reach {{host}}. Check the connection and try again.',
        { host: hostLabel }
      )
  }
}
