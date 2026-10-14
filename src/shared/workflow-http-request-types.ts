// Mirrors the n8n HTTP Request node's parameter surface.

export const HTTP_REQUEST_METHODS = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS'
] as const
export type HttpRequestMethod = (typeof HTTP_REQUEST_METHODS)[number]

export type HttpKeyValue = { name: string; value: string }

/** Multipart form-data parameter; for kind 'file' the value is a file path on the execution host. */
export type HttpFormDataParam = HttpKeyValue & { kind: 'text' | 'file' }

export type HttpAuthType = 'none' | 'basic' | 'digest' | 'bearer' | 'header' | 'query'

export type HttpRequestAuth = {
  type: HttpAuthType
  /** basic / digest */
  username: string
  password: string
  /** bearer */
  token: string
  /** header / query: the header or query parameter name and value */
  name: string
  value: string
}

/** 'fields' = name/value list; 'json' = a JSON object written by hand. */
export type HttpSpecifyMode = 'fields' | 'json'

export type HttpBodyContentType = 'json' | 'form_urlencoded' | 'multipart' | 'raw' | 'binary'

export type HttpQueryArrayFormat = 'noBrackets' | 'brackets' | 'indices'

export type HttpResponseFormat = 'autodetect' | 'json' | 'text' | 'file'

export type HttpPaginationMode = 'off' | 'updateParameter' | 'nextUrl'

export type HttpPaginationCompleteWhen = 'emptyResponse' | 'statusCodes' | 'expression'

export type HttpPaginationParam = HttpKeyValue & { location: 'query' | 'body' | 'headers' }

export type HttpPaginationOptions = {
  mode: HttpPaginationMode
  /** updateParameter: values may use {{$pageCount}} and {{$response.body.x}} */
  parameters: HttpPaginationParam[]
  /** nextUrl: expression resolving to the next page URL */
  nextUrl: string
  completeWhen: HttpPaginationCompleteWhen
  /** statusCodes: comma-separated list */
  completeStatusCodes: string
  /** expression: completes when truthy; prefix with ! to negate */
  completeExpression: string
  maxPages: number
  intervalMs: number
}

export type HttpRequestOptions = {
  /** 0 disables the timeout. */
  timeoutMs: number
  followRedirects: boolean
  maxRedirects: number
  ignoreSsl: boolean
  /** e.g. http://user:pass@proxy:8080 */
  proxy: string
  lowercaseHeaders: boolean
  arrayFormat: HttpQueryArrayFormat
  responseFormat: HttpResponseFormat
  /** text format: output key that holds the response text */
  outputField: string
  /** file format: where the response body is written on the execution host */
  responseFilePath: string
  includeResponseMeta: boolean
  neverError: boolean
  pagination: HttpPaginationOptions
}

export type HttpRequestData = {
  method: HttpRequestMethod
  url: string
  auth: HttpRequestAuth
  sendQuery: boolean
  queryMode: HttpSpecifyMode
  queryParameters: HttpKeyValue[]
  queryJson: string
  sendHeaders: boolean
  headerMode: HttpSpecifyMode
  headers: HttpKeyValue[]
  headersJson: string
  sendBody: boolean
  bodyContentType: HttpBodyContentType
  /** json / form_urlencoded only */
  bodyMode: HttpSpecifyMode
  bodyParameters: HttpFormDataParam[]
  bodyJson: string
  rawContentType: string
  rawBody: string
  /** binary: file sent as the body */
  binaryFilePath: string
  options: HttpRequestOptions
}
