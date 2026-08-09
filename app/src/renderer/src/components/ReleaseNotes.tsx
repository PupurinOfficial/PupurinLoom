// 轻量 Markdown 渲染（GitHub Release 更新说明专用）
// 无第三方依赖；全部走 React 文本节点渲染，天然转义，不引入 innerHTML
// 支持：## / ### 标题、- 无序列表、1. 有序列表、**加粗**、`行内代码`、[文本](链接)
import { memo, type ReactNode } from 'react'

// 行内解析：[文本](链接) / `代码` / **加粗**（链接优先，避免被代码/加粗规则吞掉）
function inline(text: string, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = []
  const re = /(\[([^\]]+)\]\(([^)\s]+)\))|(`([^`]+)`)|(\*\*([^*]+)\*\*)/g
  let last = 0
  let i = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m.index > last) nodes.push(text.slice(last, m.index))
    if (m[1]) {
      const url = m[3]
      nodes.push(
        <button
          key={`${keyBase}${i++}`}
          type="button"
          onClick={() => void window.pupurin.openExternal(url)}
          className="text-loom-accent hover:underline"
        >
          {m[2]}
        </button>
      )
    } else if (m[4]) {
      nodes.push(
        <code key={`${keyBase}${i++}`} className="font-mono bg-loom-border/40 rounded px-1">
          {m[5]}
        </code>
      )
    } else if (m[6]) {
      nodes.push(
        <strong key={`${keyBase}${i++}`} className="font-semibold text-loom-text">
          {m[7]}
        </strong>
      )
    }
    last = re.lastIndex
  }
  if (last < text.length) nodes.push(text.slice(last))
  return nodes
}

interface ReleaseNotesProps {
  notes: string
  className?: string
}

function ReleaseNotes({ notes, className = '' }: ReleaseNotesProps) {
  const items: ReactNode[] = []
  notes.split('\n').forEach((raw, idx) => {
    const t = raw.trimEnd()
    const key = idx
    if (!t.trim()) {
      items.push(<div key={key} className="h-2" />)
      return
    }
    const h2 = t.match(/^##\s+(.*)/)
    const h3 = t.match(/^###\s+(.*)/)
    const ul = t.match(/^\s*[-*]\s+(.*)/)
    const ol = t.match(/^\s*(\d+)[.)]\s+(.*)/)
    if (h2) {
      items.push(
        <div key={key} className="text-sm font-bold text-loom-text mt-2 mb-1">
          {inline(h2[1], `${key}-`)}
        </div>
      )
    } else if (h3) {
      items.push(
        <div key={key} className="text-sm font-semibold text-loom-text mt-1 mb-0.5">
          {inline(h3[1], `${key}-`)}
        </div>
      )
    } else if (ul) {
      items.push(
        <div key={key} className="pl-4 relative">
          <span className="absolute left-0 text-loom-accent">•</span>
          <span>{inline(ul[1], `${key}-`)}</span>
        </div>
      )
    } else if (ol) {
      items.push(
        <div key={key} className="pl-4">
          <span className="text-loom-accent mr-1">{ol[1]}.</span>
          <span>{inline(ol[2], `${key}-`)}</span>
        </div>
      )
    } else {
      items.push(<div key={key}>{inline(t, `${key}-`)}</div>)
    }
  })
  return <div className={`text-xs leading-relaxed text-loom-text/90 ${className}`}>{items}</div>
}

export default memo(ReleaseNotes)
