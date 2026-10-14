import { useState } from 'react'
import { ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { translate } from '@/i18n/i18n'
import type {
  HttpPaginationCompleteWhen,
  HttpPaginationMode,
  HttpPaginationOptions,
  HttpPaginationParam,
  HttpQueryArrayFormat,
  HttpRequestOptions,
  HttpResponseFormat
} from '../../../../shared/workflow-http-request-types'
import {
  HttpFieldLabel,
  HttpSelectField,
  HttpTextField,
  HttpToggleRow,
  toNonNegativeNumber,
  type ExprHint
} from './WorkflowHttpFieldControls'
import WorkflowHttpKeyValueList from './WorkflowHttpKeyValueList'

type Props = {
  options: HttpRequestOptions
  onChange: (options: HttpRequestOptions) => void
  exprHint: ExprHint
}

function Section({
  title,
  children
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded border border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center gap-1 px-2 py-1.5 text-[12px] hover:bg-muted/50"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        {title}
      </button>
      {open && <div className="px-2 pb-2 space-y-2">{children}</div>}
    </div>
  )
}

export default function WorkflowHttpRequestOptions({
  options,
  onChange,
  exprHint
}: Props): React.JSX.Element {
  const set = (patch: Partial<HttpRequestOptions>): void => onChange({ ...options, ...patch })
  const p = options.pagination
  const setPage = (patch: Partial<HttpPaginationOptions>): void =>
    set({ pagination: { ...p, ...patch } })

  const formats: { value: HttpResponseFormat; label: string }[] = [
    { value: 'autodetect', label: translate('workflows.http.formatAuto', 'Autodetect') },
    { value: 'json', label: 'JSON' },
    { value: 'text', label: translate('workflows.http.formatText', 'Text') },
    { value: 'file', label: translate('workflows.http.formatFile', 'File') }
  ]
  const arrayFormats: { value: HttpQueryArrayFormat; label: string }[] = [
    {
      value: 'noBrackets',
      label: translate('workflows.http.arrayNoBrackets', 'No brackets (ids=1&ids=2)')
    },
    { value: 'brackets', label: translate('workflows.http.arrayBrackets', 'Brackets (ids[]=1)') },
    { value: 'indices', label: translate('workflows.http.arrayIndices', 'Indices (ids[0]=1)') }
  ]
  const modes: { value: HttpPaginationMode; label: string }[] = [
    { value: 'off', label: translate('workflows.http.paginationOff', 'Off') },
    {
      value: 'updateParameter',
      label: translate('workflows.http.paginationUpdate', 'Update a parameter in each request')
    },
    {
      value: 'nextUrl',
      label: translate('workflows.http.paginationNextUrl', 'Response contains next URL')
    }
  ]
  const completeOptions: { value: HttpPaginationCompleteWhen; label: string }[] = [
    {
      value: 'emptyResponse',
      label: translate('workflows.http.completeEmpty', 'Response is empty')
    },
    {
      value: 'statusCodes',
      label: translate('workflows.http.completeStatus', 'Receive specific status codes')
    },
    {
      value: 'expression',
      label: translate('workflows.http.completeExpression', 'Expression is true')
    }
  ]

  return (
    <div className="space-y-2">
      <Section title={translate('workflows.http.response', 'Response')}>
        <HttpSelectField
          label={translate('workflows.http.responseFormat', 'Response format')}
          value={options.responseFormat}
          options={formats}
          onChange={(responseFormat) => set({ responseFormat })}
        />
        {options.responseFormat === 'file' ? (
          <HttpTextField
            label={translate('workflows.http.responseFilePath', 'Save to file path')}
            value={options.responseFilePath}
            onChange={(responseFilePath) => set({ responseFilePath })}
            placeholder="/tmp/download.bin"
            exprHint={exprHint}
          />
        ) : (
          <HttpTextField
            label={translate('workflows.http.outputField', 'Put text output in field')}
            value={options.outputField}
            onChange={(outputField) => set({ outputField })}
          />
        )}
        <HttpToggleRow
          label={translate('workflows.http.includeMeta', 'Include response headers and status')}
          checked={options.includeResponseMeta}
          onChange={(includeResponseMeta) => set({ includeResponseMeta })}
        />
        <HttpToggleRow
          label={translate('workflows.http.neverError', 'Never error (succeed on any status)')}
          checked={options.neverError}
          onChange={(neverError) => set({ neverError })}
        />
      </Section>

      <Section title={translate('workflows.http.connection', 'Connection')}>
        <HttpTextField
          label={translate('workflows.http.timeoutMs', 'Timeout (ms, 0 = none)')}
          type="number"
          value={String(options.timeoutMs)}
          onChange={(v) => set({ timeoutMs: toNonNegativeNumber(v, 0) })}
        />
        <HttpToggleRow
          label={translate('workflows.http.followRedirects', 'Follow redirects')}
          checked={options.followRedirects}
          onChange={(followRedirects) => set({ followRedirects })}
        />
        {options.followRedirects && (
          <HttpTextField
            label={translate('workflows.http.maxRedirects', 'Max redirects')}
            type="number"
            value={String(options.maxRedirects)}
            onChange={(v) => set({ maxRedirects: toNonNegativeNumber(v, 21) })}
          />
        )}
        <HttpTextField
          label={translate('workflows.http.proxy', 'Proxy')}
          value={options.proxy}
          onChange={(proxy) => set({ proxy })}
          placeholder="http://user:pass@proxy:8080"
          exprHint={exprHint}
        />
        <HttpToggleRow
          label={translate('workflows.http.ignoreSsl', 'Ignore SSL issues')}
          checked={options.ignoreSsl}
          onChange={(ignoreSsl) => set({ ignoreSsl })}
        />
        <HttpToggleRow
          label={translate('workflows.http.lowercaseHeaders', 'Lowercase header names')}
          checked={options.lowercaseHeaders}
          onChange={(lowercaseHeaders) => set({ lowercaseHeaders })}
        />
        <HttpSelectField
          label={translate('workflows.http.arrayFormat', 'Array format in query')}
          value={options.arrayFormat}
          options={arrayFormats}
          onChange={(arrayFormat) => set({ arrayFormat })}
        />
      </Section>

      <Section title={translate('workflows.http.pagination', 'Pagination')}>
        <HttpSelectField
          label={translate('workflows.http.paginationMode', 'Mode')}
          value={p.mode}
          options={modes}
          onChange={(mode) => setPage({ mode })}
        />
        {p.mode !== 'off' && (
          <>
            <p className="text-[11px] text-muted-foreground">
              {translate(
                'workflows.http.paginationHint',
                'Use {{pageCount}} (pages fetched so far) and {{body}}, {{headers}} or {{status}} from the previous page.',
                {
                  pageCount: '{{$pageCount}}',
                  body: '{{$response.body.field}}',
                  headers: '{{$response.headers.name}}',
                  status: '{{$response.statusCode}}'
                }
              )}
            </p>
            {p.mode === 'updateParameter' ? (
              <>
                <HttpFieldLabel>
                  {translate('workflows.http.parameters', 'Parameters')}
                </HttpFieldLabel>
                <WorkflowHttpKeyValueList
                  rows={p.parameters}
                  onChange={(parameters) => setPage({ parameters })}
                  newRow={(): HttpPaginationParam => ({
                    name: 'page',
                    value: '{{$pageCount + 1}}',
                    location: 'query'
                  })}
                  exprHint={exprHint}
                  variant={{
                    get: (row) => row.location,
                    set: (row, v): HttpPaginationParam => ({
                      ...row,
                      location: v === 'body' ? 'body' : v === 'headers' ? 'headers' : 'query'
                    }),
                    options: [
                      { value: 'query', label: translate('workflows.http.inQuery', 'Query') },
                      { value: 'body', label: translate('workflows.http.inBody', 'Body') },
                      { value: 'headers', label: translate('workflows.http.inHeaders', 'Headers') }
                    ]
                  }}
                />
              </>
            ) : (
              <HttpTextField
                label={translate('workflows.http.nextUrl', 'Next URL')}
                value={p.nextUrl}
                onChange={(nextUrl) => setPage({ nextUrl })}
                placeholder="{{$response.body.next}}"
              />
            )}
            <HttpSelectField
              label={translate('workflows.http.completeWhen', 'Pagination complete when')}
              value={p.completeWhen}
              options={completeOptions}
              onChange={(completeWhen) => setPage({ completeWhen })}
            />
            {p.completeWhen === 'statusCodes' && (
              <HttpTextField
                label={translate('workflows.http.statusCodes', 'Status codes (comma-separated)')}
                value={p.completeStatusCodes}
                onChange={(completeStatusCodes) => setPage({ completeStatusCodes })}
                placeholder="404, 204"
              />
            )}
            {p.completeWhen === 'expression' && (
              <HttpTextField
                label={translate('workflows.http.completeExpressionLabel', 'Complete expression')}
                value={p.completeExpression}
                onChange={(completeExpression) => setPage({ completeExpression })}
                placeholder="!{{$response.body.hasMore}}"
              />
            )}
            <div className="grid grid-cols-2 gap-2">
              <HttpTextField
                label={translate('workflows.http.maxPages', 'Max pages')}
                type="number"
                value={String(p.maxPages)}
                onChange={(v) => setPage({ maxPages: toNonNegativeNumber(v, 100) })}
              />
              <HttpTextField
                label={translate('workflows.http.intervalMs', 'Interval (ms)')}
                type="number"
                value={String(p.intervalMs)}
                onChange={(v) => setPage({ intervalMs: toNonNegativeNumber(v, 0) })}
              />
            </div>
          </>
        )}
      </Section>
    </div>
  )
}
