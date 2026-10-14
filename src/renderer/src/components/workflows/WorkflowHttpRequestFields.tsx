import { translate } from '@/i18n/i18n'
import {
  HTTP_REQUEST_METHODS,
  type HttpAuthType,
  type HttpBodyContentType,
  type HttpFormDataParam,
  type HttpKeyValue,
  type HttpRequestData,
  type HttpSpecifyMode
} from '../../../../shared/workflow-http-request-types'
import {
  HttpFieldLabel,
  HttpSelectField,
  HttpTextField,
  HttpToggleRow,
  type ExprHint
} from './WorkflowHttpFieldControls'
import WorkflowHttpKeyValueList from './WorkflowHttpKeyValueList'
import WorkflowHttpRequestOptions from './WorkflowHttpRequestOptions'
import WorkflowHttpCurlImportDialog from './WorkflowHttpCurlImportDialog'

type Props = {
  data: HttpRequestData
  onChange: (data: HttpRequestData) => void
  exprHint: ExprHint
}

function authOptions(): { value: HttpAuthType; label: string }[] {
  return [
    { value: 'none', label: translate('workflows.http.authNone', 'None') },
    { value: 'basic', label: translate('workflows.http.authBasic', 'Basic Auth') },
    { value: 'digest', label: translate('workflows.http.authDigest', 'Digest Auth') },
    { value: 'bearer', label: translate('workflows.http.authBearer', 'Bearer Token') },
    { value: 'header', label: translate('workflows.http.authHeader', 'Header Auth') },
    { value: 'query', label: translate('workflows.http.authQuery', 'Query Auth') }
  ]
}

function specifyOptions(jsonLabel?: string): { value: HttpSpecifyMode; label: string }[] {
  return [
    { value: 'fields', label: translate('workflows.http.specifyFields', 'Using fields below') },
    { value: 'json', label: jsonLabel ?? translate('workflows.http.specifyJson', 'Using JSON') }
  ]
}

function bodyTypeOptions(): { value: HttpBodyContentType; label: string }[] {
  return [
    { value: 'json', label: 'JSON' },
    { value: 'form_urlencoded', label: translate('workflows.http.bodyForm', 'Form URL-encoded') },
    {
      value: 'multipart',
      label: translate('workflows.http.bodyMultipart', 'Form-Data (multipart)')
    },
    { value: 'raw', label: translate('workflows.http.bodyRaw', 'Raw') },
    { value: 'binary', label: translate('workflows.http.bodyBinary', 'Binary file') }
  ]
}

const newKeyValue = (): HttpKeyValue => ({ name: '', value: '' })

export default function WorkflowHttpRequestFields({
  data,
  onChange,
  exprHint
}: Props): React.JSX.Element {
  const set = (patch: Partial<HttpRequestData>): void => onChange({ ...data, ...patch })
  const setAuth = (patch: Partial<HttpRequestData['auth']>): void =>
    set({ auth: { ...data.auth, ...patch } })
  const { auth } = data

  return (
    <div className="space-y-3">
      <WorkflowHttpCurlImportDialog onImport={onChange} />

      <HttpSelectField
        label={translate('workflows.http.method', 'Method')}
        value={data.method}
        options={HTTP_REQUEST_METHODS.map((m) => ({ value: m, label: m }))}
        onChange={(method) => set({ method })}
      />
      <HttpTextField
        label="URL"
        value={data.url}
        onChange={(url) => set({ url })}
        placeholder="https://api.example.com/items/{{steps.node.json.id}}"
        exprHint={exprHint}
      />

      <HttpSelectField
        label={translate('workflows.http.authentication', 'Authentication')}
        value={auth.type}
        options={authOptions()}
        onChange={(type) => setAuth({ type })}
      />
      {(auth.type === 'basic' || auth.type === 'digest') && (
        <>
          <HttpTextField
            label={translate('workflows.http.username', 'Username')}
            value={auth.username}
            onChange={(username) => setAuth({ username })}
            exprHint={exprHint}
          />
          <HttpTextField
            label={translate('workflows.http.password', 'Password')}
            type="password"
            value={auth.password}
            onChange={(password) => setAuth({ password })}
          />
        </>
      )}
      {auth.type === 'bearer' && (
        <HttpTextField
          label={translate('workflows.http.token', 'Token')}
          type="password"
          value={auth.token}
          onChange={(token) => setAuth({ token })}
        />
      )}
      {(auth.type === 'header' || auth.type === 'query') && (
        <>
          <HttpTextField
            label={
              auth.type === 'header'
                ? translate('workflows.http.headerName', 'Header name')
                : translate('workflows.http.paramName', 'Parameter name')
            }
            value={auth.name}
            onChange={(name) => setAuth({ name })}
          />
          <HttpTextField
            label={translate('workflows.http.value', 'Value')}
            type="password"
            value={auth.value}
            onChange={(value) => setAuth({ value })}
          />
        </>
      )}

      <div className="space-y-2 pt-1 border-t border-border">
        <HttpToggleRow
          label={translate('workflows.http.sendQuery', 'Send query parameters')}
          checked={data.sendQuery}
          onChange={(sendQuery) => set({ sendQuery })}
        />
        {data.sendQuery && (
          <>
            <HttpSelectField
              value={data.queryMode}
              options={specifyOptions()}
              onChange={(queryMode) => set({ queryMode })}
            />
            {data.queryMode === 'fields' ? (
              <WorkflowHttpKeyValueList
                rows={data.queryParameters}
                onChange={(queryParameters) => set({ queryParameters })}
                newRow={newKeyValue}
                exprHint={exprHint}
              />
            ) : (
              <HttpTextField
                label="JSON"
                multiline
                value={data.queryJson}
                onChange={(queryJson) => set({ queryJson })}
                placeholder='{"limit": 10, "ids": [1, 2]}'
                exprHint={exprHint}
              />
            )}
          </>
        )}
      </div>

      <div className="space-y-2 pt-1 border-t border-border">
        <HttpToggleRow
          label={translate('workflows.http.sendHeaders', 'Send headers')}
          checked={data.sendHeaders}
          onChange={(sendHeaders) => set({ sendHeaders })}
        />
        {data.sendHeaders && (
          <>
            <HttpSelectField
              value={data.headerMode}
              options={specifyOptions()}
              onChange={(headerMode) => set({ headerMode })}
            />
            {data.headerMode === 'fields' ? (
              <WorkflowHttpKeyValueList
                rows={data.headers}
                onChange={(headers) => set({ headers })}
                newRow={newKeyValue}
                exprHint={exprHint}
              />
            ) : (
              <HttpTextField
                label="JSON"
                multiline
                value={data.headersJson}
                onChange={(headersJson) => set({ headersJson })}
                placeholder='{"Accept": "application/json"}'
                exprHint={exprHint}
              />
            )}
          </>
        )}
      </div>

      <div className="space-y-2 pt-1 border-t border-border">
        <HttpToggleRow
          label={translate('workflows.http.sendBody', 'Send body')}
          checked={data.sendBody}
          onChange={(sendBody) => set({ sendBody })}
        />
        {data.sendBody && (data.method === 'GET' || data.method === 'HEAD') && (
          <p className="text-[11px] text-muted-foreground">
            {translate(
              'workflows.http.bodyIgnored',
              'GET and HEAD requests are sent without a body.'
            )}
          </p>
        )}
        {data.sendBody && (
          <>
            <HttpSelectField
              label={translate('workflows.http.bodyContentType', 'Body content type')}
              value={data.bodyContentType}
              options={bodyTypeOptions()}
              onChange={(bodyContentType) => set({ bodyContentType })}
            />
            {(data.bodyContentType === 'json' || data.bodyContentType === 'form_urlencoded') && (
              <HttpSelectField
                value={data.bodyMode}
                options={specifyOptions(
                  data.bodyContentType === 'form_urlencoded'
                    ? translate('workflows.http.specifySingle', 'Using a single field')
                    : undefined
                )}
                onChange={(bodyMode) => set({ bodyMode })}
              />
            )}
            {(data.bodyContentType === 'multipart' ||
              ((data.bodyContentType === 'json' || data.bodyContentType === 'form_urlencoded') &&
                data.bodyMode === 'fields')) && (
              <WorkflowHttpKeyValueList
                rows={data.bodyParameters}
                onChange={(bodyParameters) => set({ bodyParameters })}
                newRow={(): HttpFormDataParam => ({ name: '', value: '', kind: 'text' })}
                exprHint={exprHint}
                variant={
                  data.bodyContentType === 'multipart'
                    ? {
                        get: (row) => row.kind,
                        set: (row, v): HttpFormDataParam => ({
                          ...row,
                          kind: v === 'file' ? 'file' : 'text'
                        }),
                        options: [
                          { value: 'text', label: translate('workflows.http.partText', 'Text') },
                          { value: 'file', label: translate('workflows.http.partFile', 'File') }
                        ]
                      }
                    : undefined
                }
                valuePlaceholder={(row) =>
                  row.kind === 'file' && data.bodyContentType === 'multipart'
                    ? translate('workflows.http.filePathPlaceholder', '/path/to/file')
                    : translate('workflows.http.value', 'Value')
                }
              />
            )}
            {(data.bodyContentType === 'json' || data.bodyContentType === 'form_urlencoded') &&
              data.bodyMode === 'json' && (
                <HttpTextField
                  label={
                    data.bodyContentType === 'json'
                      ? 'JSON'
                      : translate('workflows.http.body', 'Body')
                  }
                  multiline
                  value={data.bodyJson}
                  onChange={(bodyJson) => set({ bodyJson })}
                  placeholder={
                    data.bodyContentType === 'json'
                      ? '{"name": "{{steps.node.json.name}}"}'
                      : 'a=1&b=2'
                  }
                  exprHint={exprHint}
                />
              )}
            {data.bodyContentType === 'raw' && (
              <>
                <HttpTextField
                  label={translate('workflows.http.contentType', 'Content type')}
                  value={data.rawContentType}
                  onChange={(rawContentType) => set({ rawContentType })}
                  placeholder="text/plain"
                />
                <HttpTextField
                  label={translate('workflows.http.body', 'Body')}
                  multiline
                  value={data.rawBody}
                  onChange={(rawBody) => set({ rawBody })}
                  exprHint={exprHint}
                />
              </>
            )}
            {data.bodyContentType === 'binary' && (
              <HttpTextField
                label={translate('workflows.http.filePath', 'File path')}
                value={data.binaryFilePath}
                onChange={(binaryFilePath) => set({ binaryFilePath })}
                placeholder="/path/to/file"
                exprHint={exprHint}
              />
            )}
          </>
        )}
      </div>

      <div className="space-y-2 pt-1 border-t border-border">
        <HttpFieldLabel>{translate('workflows.http.options', 'Options')}</HttpFieldLabel>
        <WorkflowHttpRequestOptions
          options={data.options}
          onChange={(options) => set({ options })}
          exprHint={exprHint}
        />
      </div>
    </div>
  )
}
