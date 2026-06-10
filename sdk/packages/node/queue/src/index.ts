/**
 * Result returned when a function is invoked with `TriggerAction.Enqueue`.
 */
export type EnqueueResult = {
  /** Unique receipt ID for the enqueued message. */
  messageReceiptId: string
}

/**
 * Routes the invocation through a named queue for async processing.
 */
export type TriggerActionEnqueue = { type: 'enqueue'; queue: string }
