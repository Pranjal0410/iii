// Session detail panel: stacked vertical view of every trace inside a
// session-level group.
//
// When the user clicks a group row in the TRACES tab (with `Group by`
// active), `TraceGroupsView` previously surfaced only the FIRST trace in
// `group.trace_ids`. That caused a confusing UX: the row would say
// "26 spans" but the right-side detail panel would show 4 (just the
// first trace). This component fixes that by rendering one collapsible
// card per trace in the group; each card fetches its own tree on first
// expand (lazy), so opening a 100-trace session no longer fires 100
// simultaneous WebSocket calls.
//
// Fetch strategy:
//
//   Group click
//        │
//        ▼
//   SessionDetailPanel mounts (no network)
//        │
//        ├── TraceCard #1   open=true ──► useQuery enabled ──► fetchTraceTree
//        ├── TraceCard #2   open=false ─┐
//        ├── TraceCard #3   open=false  ├── idle, no network until user clicks
//        └── ...                        ┘
//
//   On user click → setOpen(true) → useQuery enabled → fetchTraceTree
//   On subsequent re-open → TanStack Query cache (30s staleTime) → instant
//
// Each TraceCard reuses the existing render path
// (`treeToWaterfallData` + `WaterfallChart`) so spans behave identically
// to the single-trace view. Span clicks bubble up via `onSpanClick`,
// keeping the right-side span detail panel working unchanged.

import { useQuery } from '@tanstack/react-query'
import { ChevronDown, ChevronRight, Clock, Loader2, X } from 'lucide-react'
import { useState } from 'react'

import { fetchTraceTree, type TraceGroup, type TraceTreeResponse } from '@/api/observability/traces'
import { useEngineSdk } from '@/api/engine-sdk-provider'
import { WaterfallChart } from '@/components/traces/WaterfallChart'
import {
  treeToWaterfallData,
  type VisualizationSpan,
  type WaterfallData,
} from '@/lib/traceTransform'
import type { ISdk } from 'iii-browser-sdk'

interface SessionDetailPanelProps {
  group: TraceGroup
  onClose: () => void
  onSpanClick: (span: VisualizationSpan) => void
  selectedSpanId?: string
}

export function SessionDetailPanel({
  group,
  onClose,
  onSpanClick,
  selectedSpanId,
}: SessionDetailPanelProps) {
  const sdk = useEngineSdk()

  const totalSpans = group.span_count
  const traceCount = group.trace_ids.length
  const errorCount = group.error_count
  const durationSec = (group.duration_ms / 1000).toFixed(2)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="border-b border-border px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-medium text-foreground truncate">
            session <span className="font-mono">{group.value}</span>
          </div>
          <div className="flex items-center gap-3 mt-0.5 text-[10px] text-muted">
            <span>
              {traceCount} trace{traceCount === 1 ? '' : 's'}
            </span>
            <span>•</span>
            <span>{totalSpans} spans</span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <Clock className="w-3 h-3" />
              {durationSec}s
            </span>
            {errorCount > 0 && (
              <>
                <span>•</span>
                <span className="text-error">
                  {errorCount} error{errorCount === 1 ? '' : 's'}
                </span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close session detail"
          className="text-muted hover:text-foreground transition-colors p-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Stacked trace cards. Each owns its own fetch (lazy, on first
          expand) so opening a session with N traces doesn't fire N
          parallel WebSocket calls. The first card auto-opens so the
          user sees content immediately. */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {group.trace_ids.map((traceId, idx) => (
          <TraceCard
            key={traceId}
            sdk={sdk}
            index={idx + 1}
            traceId={traceId}
            onSpanClick={onSpanClick}
            selectedSpanId={selectedSpanId}
            defaultOpen={idx === 0}
          />
        ))}
      </div>
    </div>
  )
}

interface TraceCardProps {
  sdk: ISdk
  index: number
  traceId: string
  onSpanClick: (span: VisualizationSpan) => void
  selectedSpanId?: string
  defaultOpen: boolean
}

function TraceCard({
  sdk,
  index,
  traceId,
  onSpanClick,
  selectedSpanId,
  defaultOpen,
}: TraceCardProps) {
  const [open, setOpen] = useState(defaultOpen)

  // Lazy fetch: only enabled when the card has been opened at least
  // once. `staleTime: 30s` keeps re-opens instant; TanStack Query's
  // cache also dedupes if the same trace appears in two groups
  // (different attribute values, overlapping trace_ids).
  const { data, isLoading, error } = useQuery({
    queryKey: ['trace-tree', traceId],
    queryFn: () => fetchTraceTree(sdk, traceId),
    staleTime: 30_000,
    enabled: open,
  })

  const waterfall = data ? buildWaterfall(data) : undefined
  const headerLabel = waterfall?.spans[0]?.name ?? (open ? 'loading…' : 'click to load')
  const durationMs = waterfall?.total_duration_ms ?? 0
  const spanCount = waterfall?.span_count ?? 0
  const tracePreview = traceId.slice(0, 12)
  const errorMessage = error instanceof Error ? error.message : error ? 'Failed to load' : null

  return (
    <div className="border-b border-border">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full px-4 py-2.5 flex items-center gap-2 text-left hover:bg-dark-gray/50 transition-colors"
      >
        {open ? (
          <ChevronDown className="w-3.5 h-3.5 text-muted flex-shrink-0" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5 text-muted flex-shrink-0" />
        )}
        <span className="text-[10px] font-mono text-muted w-6 flex-shrink-0">#{index}</span>
        <span className="text-[12px] truncate text-foreground flex-1">{headerLabel}</span>
        <span className="text-[10px] font-mono text-muted flex-shrink-0">{tracePreview}…</span>
        <span className="text-[10px] text-muted flex-shrink-0 w-12 text-right">
          {spanCount > 0 ? `${spanCount} sp` : ''}
        </span>
        <span className="text-[10px] text-muted flex-shrink-0 w-16 text-right">
          {durationMs > 0 ? `${durationMs.toFixed(0)}ms` : ''}
        </span>
      </button>

      {open && (
        <div className="bg-sidebar/40">
          {isLoading && (
            <div className="flex items-center justify-center py-6 gap-2 text-[11px] text-muted">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Loading trace…
            </div>
          )}
          {errorMessage && (
            <div className="px-4 py-3 text-[11px] text-error">{errorMessage}</div>
          )}
          {waterfall && (
            <WaterfallChart
              data={waterfall}
              onSpanClick={onSpanClick}
              selectedSpanId={selectedSpanId}
            />
          )}
        </div>
      )}
    </div>
  )
}

function buildWaterfall(resp: TraceTreeResponse): WaterfallData | undefined {
  if (!resp.roots || resp.roots.length === 0) return undefined
  const wf = treeToWaterfallData(resp.roots)
  return wf ?? undefined
}
