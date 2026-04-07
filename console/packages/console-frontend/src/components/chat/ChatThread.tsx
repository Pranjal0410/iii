import { Loader2 } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { ChatMessageData } from './ChatMessage'
import { ChatMessage } from './ChatMessage'

export function ChatThread({
  messages,
  isLoading,
}: {
  messages: ChatMessageData[]
  isLoading: boolean
}) {
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  return (
    <div className="flex-1 overflow-y-auto px-3 md:px-5 py-4 space-y-2">
      {messages
        .filter(
          (msg) => msg.role === 'user' || msg.content || (msg.elements && msg.elements.length > 0),
        )
        .map((msg) => (
          <ChatMessage key={msg.id} message={msg} />
        ))}

      {isLoading && (
        <div className="flex gap-3 px-4 py-3 rounded-[var(--radius-lg)] bg-elevated border border-border-subtle">
          <div className="w-6 h-6 rounded-[var(--radius-md)] flex items-center justify-center flex-shrink-0 bg-accent/10">
            <Loader2 className="w-3.5 h-3.5 text-accent animate-spin" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-sans font-semibold text-muted uppercase tracking-[0.04em]">
              Agent
            </span>
            <div className="flex gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse" />
              <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse [animation-delay:150ms]" />
              <span className="w-1.5 h-1.5 rounded-full bg-muted animate-pulse [animation-delay:300ms]" />
            </div>
          </div>
        </div>
      )}

      <div ref={endRef} />
    </div>
  )
}
