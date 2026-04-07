import { clsx } from 'clsx'
import { Bot, User } from 'lucide-react'
import type { JsonUiElement } from './JsonUiRenderer'
import { JsonUiRenderer } from './JsonUiRenderer'
import { Markdown } from './Markdown'
import type { ToolCall } from './ToolCallBadge'
import { ToolCallBadge } from './ToolCallBadge'

export interface ChatMessageData {
  id: string
  role: 'user' | 'agent'
  content?: string
  elements?: JsonUiElement[]
  toolCalls?: ToolCall[]
  timestamp: number
}

export function ChatMessage({ message }: { message: ChatMessageData }) {
  const isUser = message.role === 'user'

  return (
    <div
      className={clsx(
        'flex gap-3 px-4 py-3 rounded-[var(--radius-lg)] transition-colors',
        isUser ? 'bg-transparent' : 'bg-elevated border border-border-subtle',
      )}
    >
      <div
        className={clsx(
          'w-6 h-6 rounded-[var(--radius-md)] flex items-center justify-center flex-shrink-0 mt-0.5',
          isUser ? 'bg-foreground/10' : 'bg-accent/10',
        )}
      >
        {isUser ? (
          <User className="w-3.5 h-3.5 text-foreground" />
        ) : (
          <Bot className="w-3.5 h-3.5 text-accent" />
        )}
      </div>

      <div className="flex-1 min-w-0 space-y-2">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-sans font-semibold text-muted uppercase tracking-[0.04em]">
            {isUser ? 'You' : 'Agent'}
          </span>
          <span className="text-[10px] font-mono text-muted">
            {new Date(message.timestamp).toLocaleTimeString()}
          </span>
        </div>

        {message.content &&
          (isUser ? (
            <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
              {message.content}
            </p>
          ) : (
            <Markdown content={message.content} />
          ))}

        {message.elements && message.elements.length > 0 && (
          <JsonUiRenderer elements={message.elements} />
        )}

        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {message.toolCalls.map((call, i) => (
              <ToolCallBadge key={i} call={call} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
