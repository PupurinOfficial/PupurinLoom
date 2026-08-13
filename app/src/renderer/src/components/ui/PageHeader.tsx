import { type ReactNode } from 'react'

export interface PageTab {
  id: string
  label: string
}

export interface PageHeaderProps {
  /** 页头标题（左侧） */
  title?: string
  /** Tab 切换组（标题右侧） */
  tabs?: PageTab[]
  activeTab?: string
  onTabChange?: (id: string) => void
  /** 标题/Tab 右侧的说明文字 */
  hint?: ReactNode
  /** 右侧操作区 */
  actions?: ReactNode
}

// 统一页头：标题 + Tab + 说明 + 右侧操作区（内容型页面顶部工具条）
export default function PageHeader({ title, tabs, activeTab, onTabChange, hint, actions }: PageHeaderProps) {
  return (
    <div className="flex items-center px-4 h-10 border-b border-loom-border bg-loom-panel2 flex-shrink-0 select-none">
      {title && <h1 className="text-sm font-semibold text-loom-text mr-4">{title}</h1>}
      {tabs && (
        <div className="flex items-center gap-1 mr-3">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => onTabChange?.(t.id)}
              className={[
                'px-3 py-1.5 rounded text-xs font-medium transition-colors',
                activeTab === t.id
                  ? 'bg-loom-accent/20 text-loom-accent'
                  : 'text-loom-muted hover:text-loom-text hover:bg-loom-bg',
              ].join(' ')}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      {hint !== undefined && hint !== null && (
        <span className="text-xs text-loom-muted/70">{hint}</span>
      )}
      {actions && <div className="ml-auto flex items-center gap-2">{actions}</div>}
    </div>
  )
}
