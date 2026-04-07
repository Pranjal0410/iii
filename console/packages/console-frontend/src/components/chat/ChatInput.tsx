import { clsx } from 'clsx'
import { ArrowUp } from 'lucide-react'
import { useCallback, useRef, useState } from 'react'

export function ChatInput({
  onSend,
  disabled,
}: {
  onSend: (message: string) => void
  disabled?: boolean
}) {
  const [value, setValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSubmit = useCallback(() => {
    const trimmed = value.trim()
    if (!trimmed || disabled) return
    onSend(trimmed)
    setValue('')
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
    }
  }, [value, disabled, onSend])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit],
  )

  const handleInput = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`
  }, [])

  return (
    <div className="px-3 md:px-5 py-3 border-t border-border bg-background flex-shrink-0">
      <div className="flex items-end gap-2 bg-elevated border border-border-subtle rounded-[var(--radius-lg)] px-3 py-2 focus-within:border-muted transition-colors">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          disabled={disabled}
          placeholder="Ask the agent..."
          rows={1}
          className={clsx(
            'flex-1 bg-transparent text-[13px] font-mono text-foreground placeholder:text-muted resize-none focus:outline-none min-h-[24px] max-h-[160px] py-0.5',
            disabled && 'opacity-50',
          )}
        />
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!value.trim() || disabled}
          className={clsx(
            'flex-shrink-0 w-7 h-7 rounded-[var(--radius-md)] flex items-center justify-center transition-all duration-150 cursor-pointer',
            value.trim() && !disabled
              ? 'bg-foreground text-background hover:bg-foreground/90'
              : 'bg-border-subtle text-muted',
          )}
        >
          <ArrowUp className="w-4 h-4" />
        </button>
      </div>
      <div className="flex items-center justify-between mt-1.5 px-1">
        <span className="text-[10px] text-muted font-mono">
          Enter to send, Shift+Enter for newline
        </span>
      </div>
    </div>
  )
}
