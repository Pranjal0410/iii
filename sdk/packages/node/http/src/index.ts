/**
 * Authentication configuration for HTTP-invoked functions.
 *
 * - `hmac` -- HMAC signature verification using a shared secret.
 * - `bearer` -- Bearer token authentication.
 * - `api_key` -- API key sent via a custom header.
 */
export type HttpAuthConfig =
  | { type: 'hmac'; secret_key: string }
  | { type: 'bearer'; token_key: string }
  | { type: 'api_key'; header: string; value_key: string }

/**
 * HTTP method for an HTTP-invoked function.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

/**
 * Configuration for registering an HTTP-invoked function (Lambda, Cloudflare
 * Workers, etc.) instead of a local handler.
 */
export type HttpInvocationConfig = {
  /** URL to invoke. */
  url: string
  /** HTTP method. Defaults to `POST`. */
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  /** Timeout in milliseconds. */
  timeout_ms?: number
  /** Custom headers to send with the request. */
  headers?: Record<string, string>
  /** Authentication configuration. */
  auth?: HttpAuthConfig
}

/**
 * Incoming buffered HTTP request received by an HTTP function handler.
 *
 * @typeParam TBody - Type of the parsed request body.
 */
export type HttpRequest<TBody = unknown> = {
  path_params: Record<string, string>
  query_params: Record<string, string | string[]>
  body: TBody
  headers: Record<string, string | string[]>
  method: string
  request_body: HttpRequestBodyReader
}

/**
 * Structured HTTP response returned from buffered HTTP function handlers.
 *
 * @typeParam TStatus - HTTP status code literal type.
 * @typeParam TBody - Type of the response body.
 *
 * @example
 * ```typescript
 * const response: HttpResponse = {
 *   status_code: 200,
 *   headers: { 'content-type': 'application/json' },
 *   body: { message: 'ok' },
 * }
 * ```
 */
export type HttpResponse<
  TStatus extends number = number,
  TBody = string | Buffer | Record<string, unknown>,
> = {
  /** HTTP status code. */
  status_code: TStatus
  /** Response headers. */
  headers?: Record<string, string>
  /** Response body. */
  body?: TBody
}

/**
 * Minimal read end of a streaming channel, as observed by the `http` helper.
 * Structurally compatible with the SDK's `ChannelReader`.
 */
type HttpRequestBodyReader = {
  readonly stream: NodeJS.ReadableStream
}

/**
 * Minimal write end of a streaming channel, as observed by the `http` helper.
 * Structurally compatible with the SDK's `ChannelWriter`.
 */
type HttpResponseWriter = {
  sendMessage: (msg: string) => void
  readonly stream: NodeJS.WritableStream
  close: () => void
}

/**
 * Internal streaming request shape passed to the raw function handler before
 * the `http` helper splits it into request/response. Structurally compatible
 * with the SDK's `InternalHttpRequest`.
 */
type HttpInternalRequest<TBody = unknown> = {
  path_params: Record<string, string>
  query_params: Record<string, string | string[]>
  body: TBody
  headers: Record<string, string | string[]>
  method: string
  response: HttpResponseWriter
  request_body: HttpRequestBodyReader
}

/**
 * Streaming request passed to the `http` helper callback (the internal request
 * without its `response` writer). Structurally compatible with the SDK's
 * `StreamRequest`.
 */
type HttpStreamRequest<TBody = unknown> = Omit<HttpInternalRequest<TBody>, 'response'>

/**
 * Streaming response passed to the `http` helper callback. Structurally
 * compatible with the SDK's `StreamResponse`.
 */
type HttpStreamResponse = {
  status: (statusCode: number) => void
  headers: (headers: Record<string, string>) => void
  stream: NodeJS.WritableStream
  close: () => void
}

/**
 * Helper that wraps an HTTP-style handler (with separate `req`/`res` arguments)
 * into the function handler format expected by the SDK.
 *
 * @param callback - Async handler receiving the streaming request and response.
 * @returns A function handler compatible with `IIIClient.registerFunction`.
 *
 * @example
 * ```typescript
 * import { http } from '@iii-dev/http'
 *
 * iii.registerFunction(
 *   'my-api',
 *   http(async (req, res) => {
 *     res.status(200)
 *     res.headers({ 'content-type': 'application/json' })
 *     res.stream.end(JSON.stringify({ hello: 'world' }))
 *     res.close()
 *   }),
 * )
 * ```
 */
export const http = <
  Req extends HttpStreamRequest = HttpStreamRequest,
  Res extends HttpStreamResponse = HttpStreamResponse,
>(
  // biome-ignore lint/suspicious/noConfusingVoidType: void is necessary here
  callback: (req: Req, res: Res) => Promise<void | HttpResponse>,
) => {
  return async (req: HttpInternalRequest) => {
    const { response, ...request } = req

    const httpResponse: HttpStreamResponse = {
      status: (status_code: number) =>
        response.sendMessage(JSON.stringify({ type: 'set_status', status_code })),
      headers: (headers: Record<string, string>) =>
        response.sendMessage(JSON.stringify({ type: 'set_headers', headers })),
      stream: response.stream,
      close: () => response.close(),
    }

    return callback(request as unknown as Req, httpResponse as unknown as Res)
  }
}
