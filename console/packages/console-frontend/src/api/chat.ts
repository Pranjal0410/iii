import type { ChatMessageData } from '@/components/chat/ChatMessage'
import { getDevtoolsApi, getStreamsWs } from './config'

export async function sendChatMessage(
  sessionId: string,
  message: string,
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const res = await fetch(`${getDevtoolsApi()}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        function_id: 'agent::chat',
        input: { message, session_id: sessionId },
      }),
    })

    if (res.ok) {
      const data = await res.json()
      return { success: true, data }
    } else {
      const error = await res.text()
      return { success: false, error: error || 'Chat invocation failed' }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Network error' }
  }
}

export async function saveChatHistory(
  sessionId: string,
  messages: ChatMessageData[],
): Promise<void> {
  try {
    await fetch(`${getDevtoolsApi()}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        function_id: 'state::set',
        input: {
          scope: 'chat:history',
          key: sessionId,
          data: { messages, updated_at: Date.now() },
        },
      }),
    })
  } catch {
    // best-effort save
  }
}

export async function loadChatHistory(sessionId: string): Promise<ChatMessageData[]> {
  try {
    const res = await fetch(`${getDevtoolsApi()}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        function_id: 'state::get',
        input: { scope: 'chat:history', key: sessionId },
      }),
    })
    if (!res.ok) return []
    const data = await res.json()
    const value = data?.body?.value ?? data?.value
    if (value && Array.isArray(value.messages)) {
      return value.messages
    }
    return []
  } catch {
    return []
  }
}

export async function listChatSessions(): Promise<{ id: string; updated_at: number }[]> {
  try {
    const res = await fetch(`${getDevtoolsApi()}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        function_id: 'state::list',
        input: { scope: 'chat:history' },
      }),
    })
    if (!res.ok) return []
    const data = await res.json()
    const items = data?.body?.items ?? data?.items ?? []
    return items.map((item: Record<string, unknown>) => ({
      id: item.key as string,
      updated_at: ((item.data as Record<string, unknown>)?.updated_at as number) ?? 0,
    }))
  } catch {
    return []
  }
}

export function createChatStreamSubscription(sessionId: string, onEvent: (event: unknown) => void) {
  let ws: WebSocket | null = null
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null
  let isActive = false
  const subscriptionId = `chat-${Date.now()}-${Math.random().toString(36).slice(2)}`
  const streamName = `agent:events:${sessionId}`

  function connect() {
    if (!isActive) return

    try {
      ws = new WebSocket(getStreamsWs())

      ws.onopen = () => {
        ws?.send(
          JSON.stringify({
            type: 'join',
            data: {
              subscriptionId,
              streamName,
              groupId: 'events',
            },
          }),
        )
      }

      ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data)
          onEvent(msg)
        } catch {
          // ignore parse errors
        }
      }

      ws.onerror = () => {}

      ws.onclose = () => {
        if (isActive) {
          reconnectTimer = setTimeout(connect, 3000)
        }
      }
    } catch {
      if (isActive) {
        reconnectTimer = setTimeout(connect, 3000)
      }
    }
  }

  return {
    connect: () => {
      isActive = true
      connect()
    },
    disconnect: () => {
      isActive = false
      if (reconnectTimer) {
        clearTimeout(reconnectTimer)
        reconnectTimer = null
      }
      if (ws) {
        try {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(
              JSON.stringify({
                type: 'leave',
                data: {
                  subscriptionId,
                  streamName,
                  groupId: 'events',
                },
              }),
            )
          }
          ws.close()
        } catch {
          // ignore close errors
        }
        ws = null
      }
    },
  }
}
