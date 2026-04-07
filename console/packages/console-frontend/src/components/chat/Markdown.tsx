import { clsx } from 'clsx'
import { useEffect, useRef } from 'react'

let mermaidLoaded = false
let mermaidReady = false

function loadMermaid() {
  if (mermaidLoaded) return
  mermaidLoaded = true
  const script = document.createElement('script')
  script.src = 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.min.js'
  script.onload = () => {
    ;(window as unknown as Record<string, unknown>).mermaid &&
      (window as unknown as { mermaid: { initialize: (c: unknown) => void } }).mermaid.initialize({
        startOnLoad: false,
        theme: 'dark',
        themeVariables: {
          primaryColor: '#1a1a25',
          primaryTextColor: '#F4F4F4',
          primaryBorderColor: '#F3F724',
          lineColor: '#5B5B5B',
          secondaryColor: '#111111',
          tertiaryColor: '#1a1a25',
          fontFamily: 'JetBrains Mono, monospace',
          fontSize: '12px',
        },
      })
    mermaidReady = true
  }
  document.head.appendChild(script)
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function parseMarkdown(src: string): { html: string; mermaidBlocks: string[] } {
  const lines = src.split('\n')
  const out: string[] = []
  const mermaidBlocks: string[] = []
  let inTable = false
  let inCode = false
  let codeLang = ''
  let codeLines: string[] = []
  let inList = false
  let listType: 'ul' | 'ol' = 'ul'

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]

    if (line.startsWith('```')) {
      if (inCode) {
        if (codeLang === 'mermaid') {
          const idx = mermaidBlocks.length
          mermaidBlocks.push(codeLines.join('\n'))
          out.push(
            `<div class="chat-mermaid" data-mermaid-idx="${idx}"><div class="chat-mermaid-loading">Rendering diagram...</div></div>`,
          )
        } else {
          out.push(
            `<pre class="chat-code"><code class="lang-${escapeHtml(codeLang)}">${escapeHtml(codeLines.join('\n'))}</code></pre>`,
          )
        }
        inCode = false
        codeLines = []
        codeLang = ''
      } else {
        inCode = true
        codeLang = line.slice(3).trim()
      }
      continue
    }

    if (inCode) {
      codeLines.push(line)
      continue
    }

    if (line.startsWith('|') && line.endsWith('|')) {
      const nextLine = lines[i + 1]
      if (!inTable) {
        inTable = true
        const headers = line
          .split('|')
          .filter((c) => c.trim())
          .map((c) => `<th>${inline(c.trim())}</th>`)
          .join('')
        out.push(`<table class="chat-table"><thead><tr>${headers}</tr></thead><tbody>`)
        if (nextLine && /^\|[\s:-]+\|/.test(nextLine)) {
          i++
        }
        continue
      }
      const cells = line
        .split('|')
        .filter((c) => c.trim())
        .map((c) => `<td>${inline(c.trim())}</td>`)
        .join('')
      out.push(`<tr>${cells}</tr>`)
      continue
    }

    if (inTable) {
      inTable = false
      out.push('</tbody></table>')
    }

    if (/^#{1,3}\s/.test(line)) {
      if (inList) {
        out.push(listType === 'ul' ? '</ul>' : '</ol>')
        inList = false
      }
      const level = line.match(/^(#+)/)?.[1].length || 1
      const text = line.replace(/^#+\s*/, '')
      const tag = `h${Math.min(level, 3) + 1}`
      out.push(`<${tag} class="chat-heading chat-h${level}">${inline(text)}</${tag}>`)
      continue
    }

    if (/^[-*]\s/.test(line)) {
      if (!inList || listType !== 'ul') {
        if (inList) out.push(listType === 'ul' ? '</ul>' : '</ol>')
        out.push('<ul class="chat-list">')
        inList = true
        listType = 'ul'
      }
      out.push(`<li>${inline(line.replace(/^[-*]\s*/, ''))}</li>`)
      continue
    }

    if (/^\d+\.\s/.test(line)) {
      if (!inList || listType !== 'ol') {
        if (inList) out.push(listType === 'ul' ? '</ul>' : '</ol>')
        out.push('<ol class="chat-list">')
        inList = true
        listType = 'ol'
      }
      out.push(`<li>${inline(line.replace(/^\d+\.\s*/, ''))}</li>`)
      continue
    }

    if (inList) {
      out.push(listType === 'ul' ? '</ul>' : '</ol>')
      inList = false
    }

    if (line.trim() === '') {
      out.push('<div class="chat-spacer"></div>')
    } else {
      out.push(`<p class="chat-p">${inline(line)}</p>`)
    }
  }

  if (inTable) out.push('</tbody></table>')
  if (inList) out.push(listType === 'ul' ? '</ul>' : '</ol>')
  if (inCode) {
    out.push(`<pre class="chat-code"><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
  }

  return { html: out.join('\n'), mermaidBlocks }
}

function inline(text: string): string {
  let s = escapeHtml(text)
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  s = s.replace(/`([^`]+)`/g, '<code class="chat-inline-code">$1</code>')
  s = s.replace(/\*(.+?)\*/g, '<em>$1</em>')
  return s
}

export function Markdown({ content, className }: { content: string; className?: string }) {
  const { html, mermaidBlocks } = parseMarkdown(content)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (mermaidBlocks.length === 0) return
    loadMermaid()

    const renderMermaid = () => {
      if (!mermaidReady || !containerRef.current) {
        setTimeout(renderMermaid, 200)
        return
      }
      const mermaidApi = (
        window as unknown as {
          mermaid: { render: (id: string, code: string) => Promise<{ svg: string }> }
        }
      ).mermaid
      const divs = containerRef.current.querySelectorAll('[data-mermaid-idx]')
      divs.forEach(async (div) => {
        const idx = parseInt(div.getAttribute('data-mermaid-idx') || '0', 10)
        const code = mermaidBlocks[idx]
        if (!code || div.getAttribute('data-rendered')) return
        div.setAttribute('data-rendered', 'true')
        try {
          const id = `mermaid-${Date.now()}-${idx}`
          const { svg } = await mermaidApi.render(id, code)
          div.innerHTML = svg
          div.classList.add('chat-mermaid-rendered')
        } catch {
          div.innerHTML = `<div class="chat-mermaid-label">Mermaid Diagram</div><pre class="chat-mermaid-code">${code.replace(/</g, '&lt;')}</pre>`
        }
      })
    }
    renderMermaid()
  }, [content, mermaidBlocks])

  return (
    <div
      ref={containerRef}
      className={clsx('chat-markdown', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
