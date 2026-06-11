/** @deprecated Import channel symbols from `iii-sdk/channel`. */
export { ChannelReader, ChannelWriter } from './channel'
/** @deprecated Import `Channel` / `StreamChannelRef` from `iii-sdk/channel`. */
export type { Channel, StreamChannelRef } from './channel'

export { InvocationError, type InvocationErrorInit } from './errors'
/** @deprecated Renamed; import `InvocationError` / `InvocationErrorInit` from `iii-sdk/errors`. */
export { IIIInvocationError, type IIIInvocationErrorInit } from './errors'

export { type InitOptions, registerWorker, type TelemetryOptions, TriggerAction } from './iii'

export { EngineFunctions, EngineTriggers } from './iii-constants'

/** @deprecated Import `EnqueueResult` from `@iii-dev/queue`. */
export type { EnqueueResult } from '@iii-dev/queue'

/** Buffered HTTP request/response types. Import from `@iii-dev/http`. */
export type { HttpRequest, HttpResponse } from '@iii-dev/http'

/** @deprecated Import `HttpAuthConfig` from `@iii-dev/http`. */
export type { HttpAuthConfig } from '@iii-dev/http'
/** @deprecated Import `HttpInvocationConfig` from `@iii-dev/http`. */
export type { HttpInvocationConfig } from '@iii-dev/http'
/** @deprecated Import `HttpMethod` from `@iii-dev/http`. */
export type { HttpMethod } from '@iii-dev/http'

export type {
  AuthInput,
  AuthResult,
  MessageType,
  MiddlewareFunctionInput,
  OnFunctionRegistrationInput,
  OnFunctionRegistrationResult,
  OnTriggerRegistrationInput,
  OnTriggerRegistrationResult,
  OnTriggerTypeRegistrationInput,
  OnTriggerTypeRegistrationResult,
  RegisterFunctionMessage,
  RegisterTriggerMessage,
  RegisterTriggerTypeMessage,
  TriggerRequest,
} from './iii-types'

/** @deprecated Import trigger types from `iii-sdk/trigger`. */
export type { Trigger, TriggerConfig, TriggerHandler } from './trigger'

export type {
  IIIClient,
  InternalHttpRequest,
  RegisterFunctionInput,
  RegisterFunctionOptions,
  RegisterTriggerInput,
  RegisterTriggerTypeInput,
  RemoteFunctionHandler,
  StreamRequest,
  StreamResponse,
} from './types'

/** @deprecated Import `HttpRequest` from `@iii-dev/http`. */
export type { ApiRequest } from './types'
/** @deprecated Import `HttpResponse` from `@iii-dev/http`. */
export type { ApiResponse } from './types'

/** @deprecated Renamed to `IIIClient`. */
export type { ISdk } from './types'

/** @deprecated Import runtime types from `iii-sdk/runtime`. */
export type { FunctionRef, TriggerTypeRef } from './runtime'

/** @deprecated Import `http` from `@iii-dev/http`. */
export { http } from '@iii-dev/http'
