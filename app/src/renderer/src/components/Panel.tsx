import type { ReactNode } from 'react'

interface PanelProps {
  title: string
  children: ReactNode
  height?: number
  collapsed: boolean
  onToggle: () => void
}

export default function Panel({ title, children, height = 220, collapsed, onToggle }: PanelProps) {
  return (
    <div
      className="bg-loom-panel border-t border-loom-border flex flex-col transition-all"
      style={{ height: collapsed ? 28 : height }}
    >
      <button
        onClick={onToggle}
        className="flex items-center gap-2 px-3 h-7 bg-loom-panel2 border-b border-loom-border/50 text-[11px] hover:bg-loom-panel2/80 transition-colors select-none"
      >
        <span className="text-loom-accent font-mono">{title}</span>
        <span className="text-loom-muted">/ws/logs</span>
        <span className="ml-auto text-loom-muted">
          {collapsed ? '▲' : '▼'}
        </span>
      </button>
      {!collapsed && <div className="flex-1 min-h-0 overflow-hidden">{children}</div>}
    </div>
  )
}
