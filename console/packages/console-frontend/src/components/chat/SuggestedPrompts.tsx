import { ArrowRight } from 'lucide-react'

const PROMPTS = [
  { label: 'List all functions', message: 'List all registered functions and their status' },
  { label: 'Show active workers', message: 'Show me the currently active workers' },
  { label: 'Recent errors', message: 'What errors have occurred in the last hour?' },
  { label: 'System health', message: 'Give me an overview of the system health' },
  { label: 'Trigger stats', message: 'Show trigger invocation statistics' },
  { label: 'Stream activity', message: 'What streams are active and what data is flowing?' },
]

export function SuggestedPrompts({ onSelect }: { onSelect: (message: string) => void }) {
  return (
    <div className="space-y-3">
      <span className="text-[10px] font-sans font-semibold text-muted uppercase tracking-[0.04em]">
        Suggested
      </span>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        {PROMPTS.map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            onClick={() => onSelect(prompt.message)}
            className="group flex items-center justify-between gap-2 px-3 py-2.5 text-left rounded-[var(--radius-md)] border border-border-subtle bg-elevated hover:bg-hover hover:border-muted transition-all duration-150 cursor-pointer"
          >
            <span className="text-xs text-secondary group-hover:text-foreground transition-colors font-sans">
              {prompt.label}
            </span>
            <ArrowRight className="w-3 h-3 text-muted group-hover:text-foreground transition-all group-hover:translate-x-0.5 flex-shrink-0" />
          </button>
        ))}
      </div>
    </div>
  )
}
