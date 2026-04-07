import { clsx } from 'clsx'
import { Play } from 'lucide-react'
import { useCallback, useState } from 'react'
import { invokeFunction } from '@/api'

export type JsonUiElement =
  | { type: 'text'; content: string }
  | { type: 'table'; headers: string[]; rows: string[][] }
  | {
      type: 'chart'
      chart_type: 'bar' | 'line'
      title?: string
      data: { label: string; value: number; color?: string }[]
    }
  | { type: 'diagram'; format: 'mermaid'; content: string }
  | { type: 'action'; label: string; function_id: string; payload: Record<string, unknown> }
  | { type: 'code'; language: string; content: string }

function TextBlock({ content }: { content: string }) {
  return <p className="text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">{content}</p>
}

function TableBlock({ headers, rows }: { headers: string[]; rows: string[][] }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-md)] border border-border-subtle">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-border-subtle bg-dark-gray/30">
            {headers.map((h, i) => (
              <th
                key={i}
                className="text-left py-2 px-3 font-sans font-semibold text-[10px] uppercase tracking-[0.04em] text-muted"
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, ri) => (
            <tr
              key={ri}
              className="border-b border-border-subtle/60 transition-colors hover:bg-white/[0.02]"
            >
              {row.map((cell, ci) => (
                <td key={ci} className="py-2 px-3 font-mono text-[12px] text-foreground">
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function BarChart({
  title,
  data,
}: {
  title?: string
  data: { label: string; value: number; color?: string }[]
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  const barWidth = Math.max(Math.floor(280 / data.length) - 8, 16)
  const chartWidth = data.length * (barWidth + 8) + 40
  const chartHeight = 140
  const barAreaHeight = 100

  return (
    <div className="space-y-1.5">
      {title && (
        <span className="text-[10px] font-sans font-semibold text-muted uppercase tracking-[0.04em]">
          {title}
        </span>
      )}
      <div className="overflow-x-auto">
        <svg
          width={chartWidth}
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="block"
        >
          <line
            x1="30"
            y1={barAreaHeight + 5}
            x2={chartWidth}
            y2={barAreaHeight + 5}
            stroke="var(--border-subtle)"
            strokeWidth="1"
          />
          {data.map((d, i) => {
            const barHeight = (d.value / max) * barAreaHeight
            const x = 35 + i * (barWidth + 8)
            const y = barAreaHeight + 5 - barHeight
            const color = d.color || 'var(--accent)'

            return (
              <g key={i}>
                <rect
                  x={x}
                  y={y}
                  width={barWidth}
                  height={barHeight}
                  rx={2}
                  fill={color}
                  opacity={0.85}
                />
                <text
                  x={x + barWidth / 2}
                  y={y - 4}
                  textAnchor="middle"
                  className="fill-secondary"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                >
                  {d.value}
                </text>
                <text
                  x={x + barWidth / 2}
                  y={barAreaHeight + 20}
                  textAnchor="middle"
                  className="fill-muted"
                  fontSize="9"
                  fontFamily="var(--font-mono)"
                >
                  {d.label.length > 8 ? `${d.label.slice(0, 7)}..` : d.label}
                </text>
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function LineChart({
  title,
  data,
}: {
  title?: string
  data: { label: string; value: number; color?: string }[]
}) {
  const max = Math.max(...data.map((d) => d.value), 1)
  const chartWidth = Math.max(data.length * 40 + 40, 200)
  const chartHeight = 140
  const plotHeight = 100
  const color = data[0]?.color || 'var(--accent)'

  const points = data
    .map((d, i) => {
      const x = 35 + (i / Math.max(data.length - 1, 1)) * (chartWidth - 70)
      const y = 10 + plotHeight - (d.value / max) * plotHeight
      return `${x},${y}`
    })
    .join(' ')

  const areaPoints = data.length
    ? `35,${10 + plotHeight} ${points} ${35 + ((data.length - 1) / Math.max(data.length - 1, 1)) * (chartWidth - 70)},${10 + plotHeight}`
    : ''

  return (
    <div className="space-y-1.5">
      {title && (
        <span className="text-[10px] font-sans font-semibold text-muted uppercase tracking-[0.04em]">
          {title}
        </span>
      )}
      <div className="overflow-x-auto">
        <svg
          width={chartWidth}
          height={chartHeight}
          viewBox={`0 0 ${chartWidth} ${chartHeight}`}
          className="block"
        >
          <line
            x1="30"
            y1={10 + plotHeight}
            x2={chartWidth - 5}
            y2={10 + plotHeight}
            stroke="var(--border-subtle)"
            strokeWidth="1"
          />
          {areaPoints && (
            <polygon points={areaPoints} fill={color} opacity={0.1} />
          )}
          {points && (
            <polyline
              points={points}
              fill="none"
              stroke={color}
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}
          {data.map((d, i) => {
            const x = 35 + (i / Math.max(data.length - 1, 1)) * (chartWidth - 70)
            const y = 10 + plotHeight - (d.value / max) * plotHeight
            return (
              <circle key={i} cx={x} cy={y} r="3" fill={color} />
            )
          })}
          {data.map((d, i) => {
            const x = 35 + (i / Math.max(data.length - 1, 1)) * (chartWidth - 70)
            return (
              <text
                key={i}
                x={x}
                y={10 + plotHeight + 16}
                textAnchor="middle"
                className="fill-muted"
                fontSize="9"
                fontFamily="var(--font-mono)"
              >
                {d.label.length > 6 ? `${d.label.slice(0, 5)}..` : d.label}
              </text>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

function DiagramBlock({ content }: { content: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border-subtle bg-black/40 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border-subtle flex items-center gap-2">
        <span className="text-[10px] font-sans font-semibold text-muted uppercase tracking-[0.04em]">
          Mermaid
        </span>
      </div>
      <pre className="p-3 text-[11px] font-mono text-secondary overflow-x-auto whitespace-pre">
        {content}
      </pre>
    </div>
  )
}

function CodeBlock({ language, content }: { language: string; content: string }) {
  return (
    <div className="rounded-[var(--radius-md)] border border-border-subtle bg-black/40 overflow-hidden">
      <div className="px-3 py-1.5 border-b border-border-subtle flex items-center gap-2">
        <span className="text-[10px] font-sans font-semibold text-muted uppercase tracking-[0.04em]">
          {language}
        </span>
      </div>
      <pre className="p-3 text-[11px] font-mono text-foreground overflow-x-auto whitespace-pre">
        {content}
      </pre>
    </div>
  )
}

function ActionButton({
  label,
  function_id,
  payload,
}: {
  label: string
  function_id: string
  payload: Record<string, unknown>
}) {
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<{ success: boolean; error?: string } | null>(null)

  const handleClick = useCallback(async () => {
    setLoading(true)
    setResult(null)
    try {
      const res = await invokeFunction(function_id, payload)
      setResult({ success: res.success, error: res.error })
    } catch (err) {
      setResult({ success: false, error: err instanceof Error ? err.message : 'Failed' })
    } finally {
      setLoading(false)
    }
  }, [function_id, payload])

  return (
    <div className="inline-flex items-center gap-2">
      <button
        type="button"
        onClick={handleClick}
        disabled={loading}
        className={clsx(
          'inline-flex items-center gap-1.5 px-3 py-1.5 text-[10px] font-sans font-medium tracking-wider uppercase rounded-[var(--radius-md)] border transition-all duration-150 cursor-pointer',
          loading
            ? 'border-border-subtle text-muted'
            : 'border-accent/40 text-accent hover:bg-accent/10',
        )}
      >
        <Play className="w-3 h-3" />
        {label}
      </button>
      {result && (
        <span
          className={clsx(
            'text-[10px] font-mono',
            result.success ? 'text-success' : 'text-error',
          )}
        >
          {result.success ? 'done' : result.error}
        </span>
      )}
    </div>
  )
}

export function JsonUiRenderer({ elements }: { elements: JsonUiElement[] }) {
  return (
    <div className="space-y-3">
      {elements.map((el, i) => {
        switch (el.type) {
          case 'text':
            return <TextBlock key={i} content={el.content} />
          case 'table':
            return <TableBlock key={i} headers={el.headers} rows={el.rows} />
          case 'chart':
            return el.chart_type === 'line' ? (
              <LineChart key={i} title={el.title} data={el.data} />
            ) : (
              <BarChart key={i} title={el.title} data={el.data} />
            )
          case 'diagram':
            return <DiagramBlock key={i} content={el.content} />
          case 'code':
            return <CodeBlock key={i} language={el.language} content={el.content} />
          case 'action':
            return (
              <ActionButton
                key={i}
                label={el.label}
                function_id={el.function_id}
                payload={el.payload}
              />
            )
          default:
            return null
        }
      })}
    </div>
  )
}
