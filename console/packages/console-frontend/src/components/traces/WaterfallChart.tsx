/**
 * Waterfall view for a single trace's spans.
 *
 * Data flow:
 *
 *   props.data (WaterfallData)
 *        │
 *        ▼
 *   buildSpanTree(spans)            ← parent/child linking, marks critical path
 *        │
 *        ▼
 *   useReducer<DisplayState>        ← expand/collapse + critical-path toggle
 *        │
 *        ▼
 *   flattenTree(tree, opts)         ← respects expandedIds, hideEngineRouting,
 *        │                            collapseEngineRoutingPairs; emits depth-offset
 *        │                            adjusted rows so hidden parents don't leave gaps
 *        ▼
 *   visibleSpans: FlatSpanRow[]
 *        │
 *        ▼
 *   Per-row render: indent guides, kind indicator, status pill, name,
 *                   duration, bar (status-colored or critical-path orange),
 *                   merged-routing `+1` chip when applicable
 *
 * Persistent state (localStorage):
 *   iii-trace-hide-engine-routing       boolean checkbox
 *   iii-trace-collapse-engine-pairs     boolean checkbox
 *   iii-span-col-width                  resizer position
 *
 * Theming: all colors flow from CSS custom properties defined in
 * `styles/globals.css` (var(--success), var(--error), var(--muted),
 * var(--accent), var(--border-subtle), ...). Only the critical-path
 * orange (#F97316) is a literal — iii-specific signal, not a theme color.
 *
 * Engine-routing heuristics (hide/collapse) live in `lib/spanLabel.ts`.
 * A porter targeting a different trace producer should override that
 * module or pass a `routingConfig` prop (not yet implemented).
 */

import { ChevronRight } from 'lucide-react'
import { useEffect, useMemo, useReducer, useRef, useState } from 'react'
import { formatSpanLabel, getSpanKindIndicator, isEngineRoutingSpan } from '@/lib/spanLabel'
import { buildSpanTree, flattenTree } from '@/lib/spanTree'
import type { VisualizationSpan, WaterfallData } from '@/lib/traceTransform'
import { formatDuration } from '@/lib/traceUtils'

interface WaterfallChartProps {
  data: WaterfallData
  onSpanClick: (span: VisualizationSpan) => void
  selectedSpanId?: string | null
}

interface DisplayState {
  expandedIds: Set<string>
  showCriticalPath: boolean
  hoveredSpanId: string | null
  scrollPosition: number
}

type DisplayAction =
  | { type: 'TOGGLE_SPAN'; spanId: string }
  | { type: 'SET_ALL_EXPANDED'; ids: Set<string> }
  | { type: 'SET_CRITICAL_PATH'; value: boolean }
  | { type: 'SET_HOVERED_SPAN'; spanId: string | null }
  | { type: 'SET_SCROLL'; position: number }

const initialDisplayState: DisplayState = {
  expandedIds: new Set(),
  showCriticalPath: false,
  hoveredSpanId: null,
  scrollPosition: 0,
}

function displayReducer(state: DisplayState, action: DisplayAction): DisplayState {
  switch (action.type) {
    case 'TOGGLE_SPAN': {
      const next = new Set(state.expandedIds)
      next.has(action.spanId) ? next.delete(action.spanId) : next.add(action.spanId)
      return { ...state, expandedIds: next }
    }
    case 'SET_ALL_EXPANDED':
      return { ...state, expandedIds: action.ids }
    case 'SET_CRITICAL_PATH':
      return { ...state, showCriticalPath: action.value }
    case 'SET_HOVERED_SPAN':
      return { ...state, hoveredSpanId: action.spanId }
    case 'SET_SCROLL':
      return { ...state, scrollPosition: action.position }
  }
}

const HIDE_ENGINE_KEY = 'iii-trace-hide-engine-routing'
const COLLAPSE_PAIRS_KEY = 'iii-trace-collapse-engine-pairs'

export function WaterfallChart({ data, onSpanClick, selectedSpanId }: WaterfallChartProps) {
  const [displayState, dispatch] = useReducer(displayReducer, initialDisplayState)
  const { expandedIds, showCriticalPath, hoveredSpanId, scrollPosition } = displayState
  const containerRef = useRef<HTMLDivElement>(null)

  const [hideEngineRouting, setHideEngineRouting] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(HIDE_ENGINE_KEY) === '1'
  })
  const [collapseEngineRoutingPairs, setCollapseEngineRoutingPairs] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false
    return window.localStorage.getItem(COLLAPSE_PAIRS_KEY) === '1'
  })

  useEffect(() => {
    window.localStorage.setItem(HIDE_ENGINE_KEY, hideEngineRouting ? '1' : '0')
  }, [hideEngineRouting])
  useEffect(() => {
    window.localStorage.setItem(COLLAPSE_PAIRS_KEY, collapseEngineRoutingPairs ? '1' : '0')
  }, [collapseEngineRoutingPairs])

  // Span column resize
  const [spanColWidth, setSpanColWidth] = useState(() => {
    const saved = localStorage.getItem('iii-span-col-width')
    return saved ? Number.parseInt(saved, 10) : 300
  })
  const colResizeRef = useRef<{ startX: number; startWidth: number } | null>(null)
  const spanColWidthRef = useRef(spanColWidth)
  spanColWidthRef.current = spanColWidth

  useEffect(() => {
    localStorage.setItem('iii-span-col-width', String(spanColWidth))
  }, [spanColWidth])

  useEffect(() => {
    let rafId: number | null = null
    const onMouseMove = (e: MouseEvent) => {
      if (!colResizeRef.current) return
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        if (!colResizeRef.current) return
        const diff = e.clientX - colResizeRef.current.startX
        setSpanColWidth(Math.min(Math.max(colResizeRef.current.startWidth + diff, 150), 600))
      })
    }
    const onMouseUp = () => {
      if (!colResizeRef.current) return
      colResizeRef.current = null
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
      if (rafId !== null) cancelAnimationFrame(rafId)
    }
  }, [])

  const startColResize = (e: React.MouseEvent) => {
    e.preventDefault()
    colResizeRef.current = { startX: e.clientX, startWidth: spanColWidthRef.current }
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
  }

  const totalMs = data.total_duration_ms || 1
  const rulerMarks = useMemo(
    () =>
      [0, 25, 50, 75, 100].map((pct) => ({
        pct,
        label: formatDuration((totalMs * pct) / 100),
      })),
    [totalMs],
  )

  const spanTree = useMemo(() => buildSpanTree(data.spans), [data.spans])

  useEffect(() => {
    const allIds = new Set(data.spans.map((s) => s.span_id))
    dispatch({ type: 'SET_ALL_EXPANDED', ids: allIds })
  }, [data.spans])

  const visibleSpans = useMemo(
    () =>
      flattenTree(spanTree, {
        expandedIds,
        hideEngineRouting,
        collapseEngineRoutingPairs,
      }),
    [spanTree, expandedIds, hideEngineRouting, collapseEngineRoutingPairs],
  )

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    dispatch({ type: 'SET_SCROLL', position: e.currentTarget.scrollTop })
  }

  const toggleExpand = (spanId: string) => {
    dispatch({ type: 'TOGGLE_SPAN', spanId })
  }

  const expandAll = () => {
    const allIds = new Set(data.spans.map((s) => s.span_id))
    dispatch({ type: 'SET_ALL_EXPANDED', ids: allIds })
  }

  const collapseAll = () => {
    dispatch({ type: 'SET_ALL_EXPANDED', ids: new Set() })
  }

  const miniMapHeight = 80
  const contentHeight = visibleSpans.length * 32
  const viewportRatio = containerRef.current ? containerRef.current.clientHeight / contentHeight : 1
  const thumbHeight = Math.max(20, miniMapHeight * viewportRatio)
  const thumbPosition =
    containerRef.current && contentHeight > 0 ? (scrollPosition / contentHeight) * miniMapHeight : 0

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-subtle bg-elevated/30">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={expandAll}
            className="px-2 py-1 text-xs text-secondary hover:text-foreground hover:bg-border-subtle rounded transition-colors"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="px-2 py-1 text-xs text-secondary hover:text-foreground hover:bg-border-subtle rounded transition-colors"
          >
            Collapse all
          </button>
          <div className="w-px h-4 bg-border-subtle mx-1" />
          <label className="flex items-center gap-2 text-xs text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={showCriticalPath}
              onChange={(e) => dispatch({ type: 'SET_CRITICAL_PATH', value: e.target.checked })}
              className="rounded border-border-subtle bg-elevated text-accent focus:ring-accent/30"
            />
            Show critical path
          </label>
          <label
            className="flex items-center gap-2 text-xs text-secondary cursor-pointer"
            title="Merge each engine handle_invocation+call pair into one row"
          >
            <input
              type="checkbox"
              checked={collapseEngineRoutingPairs}
              onChange={(e) => setCollapseEngineRoutingPairs(e.target.checked)}
              className="rounded border-border-subtle bg-elevated text-accent focus:ring-accent/30"
            />
            Collapse routing pairs
          </label>
          <label
            className="flex items-center gap-2 text-xs text-secondary cursor-pointer"
            title="Hide engine handle_invocation / call spans entirely"
          >
            <input
              type="checkbox"
              checked={hideEngineRouting}
              onChange={(e) => setHideEngineRouting(e.target.checked)}
              className="rounded border-border-subtle bg-elevated text-accent focus:ring-accent/30"
            />
            Hide engine routing
          </label>
        </div>
        <div className="text-xs text-secondary">
          {visibleSpans.length} of {data.span_count} spans
        </div>
      </div>

      <div
        className="grid gap-4 px-3 py-2 text-[11px] font-semibold text-secondary uppercase tracking-wide border-b border-border-subtle bg-elevated/50"
        style={{ gridTemplateColumns: `${spanColWidth}px 1fr` }}
      >
        <div className="flex items-center relative">
          <span>Span</span>
          <div
            role="slider"
            aria-label="Resize span column"
            aria-orientation="horizontal"
            aria-valuemin={150}
            aria-valuemax={600}
            aria-valuenow={spanColWidth}
            tabIndex={0}
            onMouseDown={startColResize}
            onDoubleClick={() => setSpanColWidth(300)}
            className="absolute right-[-11px] top-0 bottom-0 w-[7px] cursor-col-resize z-10 group"
            title="Drag to resize, double-click to reset"
          >
            <div className="absolute left-[3px] top-0 bottom-0 w-[1px] bg-border-subtle group-hover:bg-accent/50 transition-colors" />
          </div>
        </div>
        <div className="flex justify-between">
          {rulerMarks.map(({ pct, label }) => (
            <span key={pct} className="font-mono">
              {label}
            </span>
          ))}
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        <div ref={containerRef} className="flex-1 overflow-y-auto" onScroll={handleScroll}>
          {visibleSpans.map((span) => {
            const effectiveChildren = span.mergedRouting
              ? (span.children[0]?.children ?? [])
              : span.children
            const hasChildren = effectiveChildren.length > 0
            const isExpanded = expandedIds.has(span.span_id)
            const isCritical = showCriticalPath && span.isCriticalPath
            const isSelected = selectedSpanId === span.span_id
            const isHovered = hoveredSpanId === span.span_id
            const isEngineDim = !isSelected && isEngineRoutingSpan(span)
            const kindIndicator = getSpanKindIndicator(span.kind)
            const displayLabel = formatSpanLabel(span)

            // Bar colors flow from the design tokens (`--success`, `--error`,
            // `--muted`) so the waterfall re-themes correctly under
            // [data-theme="light"] or in any host that overrides the
            // CSS custom properties. The critical-path orange is
            // intentionally a literal — it's iii-specific signal, not a
            // theme color, and stays constant across light/dark.
            const getBarStyle = (): React.CSSProperties => {
              if (isCritical) return { background: '#F97316' }
              if (span.status === 'error') return { background: 'var(--error)' }
              if (span.status === 'ok') return { background: 'var(--success)' }
              return { background: 'var(--muted)' }
            }

            const statusColors: Record<typeof span.status, string> = {
              ok: 'var(--success)',
              error: 'var(--error)',
              unset: 'var(--muted)',
            }

            const barStyle = getBarStyle()

            return (
              <button
                key={span.span_id}
                type="button"
                className={`
                  grid gap-4 px-3 py-1 items-center transition-colors cursor-pointer w-full text-left
                  ${isSelected ? 'bg-accent/[0.06] border-l-2 border-l-accent' : isHovered ? 'bg-border-subtle' : 'hover:bg-border-subtle/50'}
                  ${isCritical && !isSelected ? 'bg-orange-500/5' : ''}
                `}
                style={{ gridTemplateColumns: `${spanColWidth}px 1fr` }}
                onClick={() => onSpanClick(span)}
                onMouseEnter={() => dispatch({ type: 'SET_HOVERED_SPAN', spanId: span.span_id })}
                onMouseLeave={() => dispatch({ type: 'SET_HOVERED_SPAN', spanId: null })}
              >
                <div
                  className={`flex items-center gap-1.5 min-w-0 ${isEngineDim ? 'opacity-60' : ''}`}
                >
                  <div className="flex-shrink-0 flex" style={{ width: span.displayDepth * 16 }}>
                    {Array.from({ length: span.displayDepth }).map((_, i) => (
                      <div
                        key={`${span.span_id}-indent-${i}`}
                        className="w-4 h-6 border-l border-border-subtle/50"
                      />
                    ))}
                  </div>

                  {hasChildren ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        toggleExpand(span.span_id)
                      }}
                      className="w-4 h-4 flex items-center justify-center text-secondary hover:text-foreground flex-shrink-0"
                    >
                      <ChevronRight
                        className={`w-3 h-3 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                      />
                    </button>
                  ) : (
                    <div className="w-4 h-4 flex-shrink-0" />
                  )}

                  <div
                    className="w-2 h-2 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: statusColors[span.status] }}
                  />

                  {span.service_name && (
                    <span className="flex-shrink-0 px-1.5 py-0.5 text-[10px] font-medium rounded border border-border-subtle bg-border-subtle/50 text-foreground/80 leading-none">
                      {span.service_name}
                    </span>
                  )}
                  {kindIndicator && (
                    <span
                      className="flex-shrink-0 text-[11px] text-muted leading-none w-3 text-center"
                      title={kindIndicator.label}
                    >
                      {kindIndicator.icon}
                    </span>
                  )}

                  <span
                    className={`text-[13px] font-medium truncate ${isSelected ? 'text-accent' : 'text-foreground'}`}
                    title={span.name}
                  >
                    {displayLabel}
                  </span>
                  {span.mergedRouting && (
                    <span
                      className="flex-shrink-0 px-1 py-0.5 text-[9px] font-medium rounded border border-border-subtle bg-elevated text-muted leading-none"
                      title="Merged: this row hides the engine 'call' child of a handle_invocation pair"
                    >
                      +1
                    </span>
                  )}

                  <span className="font-mono text-[11px] text-secondary flex-shrink-0 ml-auto">
                    {formatDuration(span.duration_ms)}
                  </span>
                </div>

                <div
                  className="relative h-6 rounded"
                  style={{
                    background:
                      'linear-gradient(90deg, transparent 0%, transparent 25%, var(--border-subtle) 25%, var(--border-subtle) 25.1%, transparent 25.1%, transparent 50%, var(--border-subtle) 50%, var(--border-subtle) 50.1%, transparent 50.1%, transparent 75%, var(--border-subtle) 75%, var(--border-subtle) 75.1%, transparent 75.1%)',
                  }}
                >
                  <div
                    className={`
                      absolute h-4 top-1 rounded-[3px] min-w-[3px] transition-all duration-150
                      ${isSelected ? 'scale-y-[1.3]' : isHovered ? 'scale-y-[1.2]' : ''}
                    `}
                    style={{
                      ...barStyle,
                      left: `${span.start_percent}%`,
                      width: `${Math.max(0.5, span.width_percent)}%`,
                      // Accent-tinted shadows via color-mix so they re-theme
                      // under [data-theme="light"]. Modern browsers only;
                      // the console targets the same set as the rest of
                      // the app.
                      boxShadow: isSelected
                        ? '0 0 6px color-mix(in srgb, var(--accent) 40%, transparent)'
                        : isHovered
                          ? '0 0 0 2px color-mix(in srgb, var(--accent) 30%, transparent)'
                          : undefined,
                    }}
                  />
                </div>
              </button>
            )
          })}
        </div>

        {contentHeight > (containerRef.current?.clientHeight || 0) && (
          <div className="w-16 border-l border-border-subtle bg-elevated/50 flex-shrink-0 relative p-2">
            <div className="text-[9px] text-secondary uppercase tracking-wider mb-2">Map</div>
            <div
              className="relative bg-border-subtle rounded overflow-hidden"
              style={{ height: miniMapHeight }}
            >
              {data.spans.map((span, i) => {
                const isError = span.status === 'error'
                const barColor = isError ? 'var(--error)' : 'var(--muted)'

                return (
                  <div
                    key={span.span_id}
                    className="absolute h-[2px]"
                    style={{
                      backgroundColor: barColor,
                      opacity: isError ? 0.7 : 0.5,
                      top: `${(i / data.spans.length) * 100}%`,
                      left: `${span.start_percent}%`,
                      width: `${Math.max(2, span.width_percent)}%`,
                    }}
                  />
                )
              })}
              <div
                className="absolute left-0 right-0 bg-accent/20 border border-accent/40 rounded-sm"
                style={{
                  top: thumbPosition,
                  height: thumbHeight,
                }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
