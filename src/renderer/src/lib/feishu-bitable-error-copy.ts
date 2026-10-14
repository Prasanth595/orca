import { translate } from '@/i18n/i18n'

export function formatFeishuBitableError(cause: unknown): string {
  const message = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : ''
  switch (message) {
    case 'The record does not belong to this connection.':
      return translate(
        'feishu.errors.identityMismatch',
        'The record does not belong to this connection.'
      )
    case 'Configure a status field and completion value in Settings → Tasks.':
      return translate(
        'feishu.errors.configureCompletion',
        'Configure a status field and completion value in Settings → Tasks.'
      )
    case 'The saved Feishu Bitable app secret is missing. Reconnect the connection.':
      return translate(
        'feishu.errors.missingSecret',
        'The saved Feishu Bitable app secret is missing. Reconnect the connection.'
      )
    case 'The mapped status field no longer exists. Update the mapping.':
      return translate(
        'feishu.errors.missingStatusField',
        'The mapped status field no longer exists. Update the mapping.'
      )
    case 'Completion requires a text or single-select status field.':
      return translate(
        'feishu.errors.unsupportedStatusType',
        'Completion requires a text or single-select status field.'
      )
    case 'The completion value is not an existing status option. Update the mapping.':
      return translate(
        'feishu.errors.missingCompletedOption',
        'The completion value is not an existing status option. Update the mapping.'
      )
    case 'The Feishu record no longer exists.':
      return translate('feishu.errors.missingRecord', 'The Feishu record no longer exists.')
    case 'Could not verify the saved status. Refresh the record before retrying.':
      return translate(
        'feishu.errors.unverifiedWrite',
        'Could not verify the saved status. Refresh the record before retrying.'
      )
    case 'The app needs record write permission and access to this status field. Reading remains available.':
      return translate(
        'feishu.errors.writePermission',
        'The app needs record write permission and access to this status field. Reading remains available.'
      )
    case 'Could not update the Feishu status. Refresh the record and check app access before retrying.':
      return translate(
        'feishu.errors.writeFailed',
        'Could not update the Feishu status. Refresh the record and check app access before retrying.'
      )
    case 'App ID and app secret are required.':
      return translate('feishu.errors.appCredentials', 'App ID and app secret are required.')
    case 'Feishu returned an invalid table ID.':
      return translate('feishu.errors.invalidTable', 'Feishu returned an invalid table ID.')
    case 'Feishu returned an invalid table pagination token.':
      return translate(
        'feishu.errors.invalidPagination',
        'Feishu returned an invalid table pagination token.'
      )
    case 'Too many data tables. Enter the table ID manually.':
      return translate(
        'feishu.errors.tooManyTables',
        'Too many data tables. Enter the table ID manually.'
      )
    case 'Could not load tables.':
      return translate('feishu.errors.loadTables', 'Could not load tables.')
    case 'Could not load data tables.':
      return translate('feishu.errors.loadDataTables', 'Could not load data tables.')
    case 'Could not load fields.':
      return translate('feishu.errors.loadFields', 'Could not load fields.')
    case 'Could not save mapping.':
      return translate('feishu.errors.saveMapping', 'Could not save mapping.')
    case 'No Feishu Bitable connection is configured.':
      return translate('feishu.errors.noConnection', 'No Feishu Bitable connection is configured.')
    case 'Unknown Feishu Bitable connection.':
      return translate('feishu.errors.unknownConnection', 'Unknown Feishu Bitable connection.')
    case 'A record ID is required.':
      return translate('feishu.errors.recordId', 'A record ID is required.')
    case 'A complete record reference is required.':
      return translate(
        'feishu.errors.completeReference',
        'A complete record reference is required.'
      )
    case 'A connection ID and field mapping are required.':
      return translate(
        'feishu.errors.mappingRequired',
        'A connection ID and field mapping are required.'
      )
    case 'App ID, app secret, Bitable app token, and table ID are required.':
      return translate(
        'feishu.errors.credentialsRequired',
        'App ID, app secret, Bitable app token, and table ID are required.'
      )
    case 'App ID, app secret, app token, and table ID are required.':
      return translate(
        'feishu.errors.connectRequired',
        'App ID, app secret, app token, and table ID are required.'
      )
    case 'App ID, app secret, and Bitable link are required.':
      return translate(
        'feishu.errors.discoverRequired',
        'App ID, app secret, and Bitable link are required.'
      )
    case 'Enter a Feishu Bitable link or app token.':
      return translate('feishu.errors.baseLink', 'Enter a Feishu Bitable link or app token.')
    case 'Use a Feishu Bitable link containing /base/, or enter its app token.':
      return translate(
        'feishu.errors.baseFormat',
        'Use a Feishu Bitable link containing /base/, or enter its app token.'
      )
    case 'Feishu did not return a tenant access token.':
      return translate('feishu.errors.missingToken', 'Feishu did not return a tenant access token.')
    case 'Too many fields. Cannot verify the table schema.':
      return translate(
        'feishu.errors.fieldLimit',
        'Too many fields. Cannot verify the table schema.'
      )
    case 'Feishu Bitable is not available on this Orca host. Update Orca on the remote host first.':
      return translate(
        'feishu.errors.oldHost',
        'Feishu Bitable is not available on this Orca host. Update Orca on the remote host first.'
      )
    case 'Feishu connection check failed.':
      return translate('feishu.errors.connectionCheck', 'Feishu connection check failed.')
    case 'Could not update connection.':
      return translate('feishu.errors.connectionUpdate', 'Could not update connection.')
    case 'Feishu Bitable read failed.':
      return translate('feishu.errors.readFailed', 'Feishu Bitable read failed.')
    case 'Connection failed':
      return translate('feishu.errors.connectionFailed', 'Connection failed')
  }
  if (/Update Orca.*remote host/i.test(message)) {
    return translate(
      'feishu.errors.oldHost',
      'Feishu Bitable is not available on this Orca host. Update Orca on the remote host first.'
    )
  }
  if (/permission|access denied|scope|forbidden/i.test(message)) {
    return translate(
      'feishu.errors.access',
      'Feishu denied access. Check the app permissions and sharing settings for this base.'
    )
  }
  if (/decrypt|credential|keychain/i.test(message)) {
    return translate(
      'feishu.errors.credential',
      'The host could not read the saved app secret. Reconnect Feishu on this host.'
    )
  }
  return translate(
    'feishu.errors.request',
    'Feishu request failed. Check the connection and app access, then retry.'
  )
}
