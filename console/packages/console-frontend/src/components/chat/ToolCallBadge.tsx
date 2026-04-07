import { clsx } from 'clsx'
import { CheckCircle, Loader2, XCircle } from 'lucide-react'

export interface ToolCall {
  function_id: string
  duration_ms?: number
  status: 'running' | 'done' | 'error'
}

export function ToolCallBadge({ call }: { call: ToolCall }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-mono tracking-wide border',
        call.status === 'running' && 'border-accent/30 text-accent bg-accent/5',
        call.status === 'done' && 'border-success/30 text-success bg-success/5',
        call.status === 'error' && 'border-error/30 text-error bg-error/5',
      )}
    >
      {call.status === 'running' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
      {call.status === 'done' && <CheckCircle className="w-2.5 h-2.5" />}
      {call.status === 'error' && <XCircle className="w-2.5 h-2.5" />}
      {call.function_id}
      {call.duration_ms !== undefined && call.status !== 'running' && (
        <span className="text-muted">{call.duration_ms}ms</span>
      )}
    </span>
  )
}
