import { createFileRoute } from '@tanstack/react-router'
import { MessageSquare } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  createChatStreamSubscription,
  loadChatHistory,
  saveChatHistory,
  sendChatMessage,
} from '@/api/chat'
import { ChatInput } from '@/components/chat/ChatInput'
import type { ChatMessageData } from '@/components/chat/ChatMessage'
import { ChatThread } from '@/components/chat/ChatThread'
import type { JsonUiElement } from '@/components/chat/JsonUiRenderer'
import { SuggestedPrompts } from '@/components/chat/SuggestedPrompts'
import type { ToolCall } from '@/components/chat/ToolCallBadge'
import { PageHeader } from '@/components/ui/page-header'

export const Route = createFileRoute('/chat')({
  component: ChatPage,
})

interface StreamEvent {
  event?: {
    type?: string
    data?: {
      type?: string
      content?: string
      elements?: JsonUiElement[]
      tool_calls?: ToolCall[]
      tool_call?: ToolCall
      error?: string
    }
  }
}

let persistedSessionId: string | null = null
let persistedMessages: ChatMessageData[] = []

function ChatPage() {
  if (!persistedSessionId) {
    persistedSessionId = crypto.randomUUID()
  }
  const [sessionId] = useState(() => persistedSessionId!)
  const [messages, setMessages] = useState<ChatMessageData[]>(persistedMessages)
  const [isLoading, setIsLoading] = useState(false)

  useEffect(() => {
    persistedMessages = messages
    if (messages.length > 0) {
      saveChatHistory(sessionId, messages)
    }
  }, [messages, sessionId])

  useEffect(() => {
    loadChatHistory(sessionId).then((saved) => {
      if (saved.length > 0 && messages.length === 0) {
        setMessages(saved)
        persistedMessages = saved
      }
    })
  }, [sessionId])
  const subscriptionRef = useRef<{ disconnect: () => void } | null>(null)
  const pendingAgentRef = useRef<string | null>(null)

  useEffect(() => {
    const subscription = createChatStreamSubscription(sessionId, (raw: unknown) => {
      const event = raw as StreamEvent
      const data = event?.event?.data

      if (!data || !pendingAgentRef.current) return

      const agentId = pendingAgentRef.current

      if (data.type === 'chunk' && data.content) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentId ? { ...m, content: (m.content || '') + data.content } : m,
          ),
        )
      }

      if (data.type === 'elements' && data.elements) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentId ? { ...m, elements: [...(m.elements || []), ...data.elements!] } : m,
          ),
        )
      }

      if (data.type === 'tool_call' && data.tool_call) {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentId ? { ...m, toolCalls: [...(m.toolCalls || []), data.tool_call!] } : m,
          ),
        )
      }

      if (data.type === 'tool_update' && data.tool_call) {
        setMessages((prev) =>
          prev.map((m) => {
            if (m.id !== agentId) return m
            const calls = (m.toolCalls || []).map((tc) =>
              tc.function_id === data.tool_call!.function_id ? data.tool_call! : tc,
            )
            return { ...m, toolCalls: calls }
          }),
        )
      }

      if (data.type === 'done' || data.type === 'error') {
        if (data.type === 'error' && data.error) {
          setMessages((prev) =>
            prev.map((m) => (m.id === agentId && !m.content ? { ...m, content: data.error! } : m)),
          )
        }
        pendingAgentRef.current = null
        setIsLoading(false)
      }
    })

    subscription.connect()
    subscriptionRef.current = subscription

    return () => {
      subscription.disconnect()
    }
  }, [sessionId])

  const handleSend = useCallback(
    async (message: string) => {
      const userMsg: ChatMessageData = {
        id: crypto.randomUUID(),
        role: 'user',
        content: message,
        timestamp: Date.now(),
      }

      const agentId = crypto.randomUUID()
      const agentMsg: ChatMessageData = {
        id: agentId,
        role: 'agent',
        content: '',
        elements: [],
        toolCalls: [],
        timestamp: Date.now(),
      }

      pendingAgentRef.current = agentId
      setMessages((prev) => [...prev, userMsg, agentMsg])
      setIsLoading(true)

      const result = await sendChatMessage(sessionId, message)

      if (!result.success && result.error) {
        setMessages((prev) =>
          prev.map((m) => (m.id === agentId ? { ...m, content: result.error! } : m)),
        )
        pendingAgentRef.current = null
        setIsLoading(false)
        return
      }

      if (result.data && typeof result.data === 'object') {
        const raw = result.data as Record<string, unknown>
        const body = (raw.body && typeof raw.body === 'object' ? raw.body : raw) as Record<
          string,
          unknown
        >

        let content = ''
        const elements: JsonUiElement[] = []
        let toolCalls: ToolCall[] = []

        if (Array.isArray(body.elements)) {
          for (const el of body.elements as JsonUiElement[]) {
            if (el.type === 'text' && 'content' in el) {
              content += (content ? '\n\n' : '') + (el as { content: string }).content
            } else {
              elements.push(el)
            }
          }
        }

        if (typeof body.content === 'string') {
          content = body.content
        }

        if (Array.isArray(body.tool_calls)) {
          toolCalls = body.tool_calls as ToolCall[]
        }

        if (!content && elements.length === 0) {
          content = JSON.stringify(body, null, 2)
        }

        setMessages((prev) =>
          prev.map((m) => (m.id === agentId ? { ...m, content, elements, toolCalls } : m)),
        )
        pendingAgentRef.current = null
        setIsLoading(false)
        return
      }

      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentId && !m.content ? { ...m, content: 'No response received' } : m,
        ),
      )
      pendingAgentRef.current = null
      setIsLoading(false)
    },
    [sessionId],
  )

  const hasMessages = messages.length > 0

  return (
    <div className="flex flex-col h-full bg-background text-foreground">
      <PageHeader icon={MessageSquare} title="Chat">
        <span className="text-[10px] font-mono text-muted truncate hidden md:inline">
          {sessionId}
        </span>
      </PageHeader>

      {hasMessages ? (
        <ChatThread messages={messages} isLoading={isLoading} />
      ) : (
        <div className="flex-1 overflow-y-auto px-3 md:px-5 py-8">
          <div className="max-w-xl mx-auto space-y-8">
            <div className="text-center space-y-2">
              <div className="w-10 h-10 rounded-[var(--radius-lg)] bg-accent/10 flex items-center justify-center mx-auto">
                <MessageSquare className="w-5 h-5 text-accent" />
              </div>
              <h2 className="font-sans font-semibold text-sm text-foreground">Agent Chat</h2>
              <p className="text-xs text-secondary font-sans">
                Ask questions about your system, invoke functions, or explore your data.
              </p>
            </div>
            <SuggestedPrompts onSelect={handleSend} />
          </div>
        </div>
      )}

      <ChatInput onSend={handleSend} disabled={isLoading} />
    </div>
  )
}
