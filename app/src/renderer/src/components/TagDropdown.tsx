// 版本标签下拉选择器（可复用）：
// 弹出面板列出项目里所有已知版本标签（带颜色），点击切换选中；
// 支持键盘：↑/↓ 移动高亮、Enter 确认选中（不关闭面板）、Esc 关闭。
// 面板底部可直接新建标签（自动分配/注册颜色）。
// 用于：方案面板的标签编辑、织机块编辑表单、menu 选项行。
import { useEffect, useMemo, useRef, useState } from 'react'
import { useVersionSchemes } from '../store/versionSchemes'

const FALLBACK_COLOR = '#8a8a8a'

interface TagDropdownProps {
  value: string[]
  onChange: (next: string[]) => void
  placeholder?: string
  /** 紧凑模式：已选标签只显示色点（menu 选项行等空间有限场景） */
  compact?: boolean
}

export default function TagDropdown({ value, onChange, placeholder = '添加标签', compact = false }: TagDropdownProps) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState('')
  const [highlight, setHighlight] = useState(-1)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const vs = useVersionSchemes()
  const { tagColors } = vs

  // 已知标签集合：标签颜色注册表 + 已选标签（块上已用但未注册的也列出，保证选中态可见）
  const known = useMemo(() => {
    const set = new Set<string>()
    for (const k of Object.keys(tagColors)) set.add(k)
    for (const v of value) set.add(v)
    return [...set].sort((a, b) => a.localeCompare(b))
  }, [tagColors, value])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  // 打开时聚焦新建输入框并重置高亮
  useEffect(() => {
    if (open) {
      setHighlight(-1)
      setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [open])

  // 高亮项滚入可视区
  useEffect(() => {
    if (highlight < 0) return
    listRef.current?.querySelector(`[data-tagidx="${highlight}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [highlight])

  const toggle = (t: string): void => {
    onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t])
  }

  const moveHighlight = (dir: number): void => {
    if (known.length === 0) return
    setHighlight((h) => {
      if (h === -1) return dir > 0 ? 0 : known.length - 1
      return (h + dir + known.length) % known.length
    })
  }

  const createTag = (): void => {
    const t = draft.trim()
    if (!t) return
    if (!value.includes(t)) {
      vs.ensureTagColor(t)
      onChange([...value, t])
    }
    setDraft('')
    inputRef.current?.focus()
  }

  const draftExists = known.includes(draft.trim())

  return (
    <div
      ref={rootRef}
      className="relative"
      onKeyDown={(e) => {
        if (!open) return
        if (e.key === 'ArrowDown') {
          e.preventDefault()
          moveHighlight(1)
        } else if (e.key === 'ArrowUp') {
          e.preventDefault()
          moveHighlight(-1)
        } else if (e.key === 'Enter') {
          e.preventDefault()
          // 新建输入框有内容 → 创建新标签；否则确认高亮项（均不关闭面板）
          if (draft.trim()) createTag()
          else if (highlight >= 0) toggle(known[highlight])
        } else if (e.key === 'Escape') {
          e.preventDefault()
          setOpen(false)
        }
      }}
    >
      {/* 触发器：已选标签 chips + 展开按钮 */}
      <div className="flex items-center gap-1 min-w-0">
        {value.map((t) => {
          const color = tagColors[t] ?? FALLBACK_COLOR
          if (compact) {
            return (
              <span
                key={t}
                title={t}
                className="w-2 h-2 rounded-full flex-shrink-0"
                style={{ background: color }}
              />
            )
          }
          return (
            <span
              key={t}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono select-none"
              style={{ background: color + '22', border: `1px solid ${color}55`, color }}
            >
              <label className="relative w-2.5 h-2.5 rounded-full cursor-pointer flex-shrink-0" title="自定义标签颜色">
                <span className="absolute inset-0 rounded-full" style={{ background: color }} />
                <input
                  type="color"
                  value={color}
                  onChange={(e) => vs.setTagColor(t, e.target.value)}
                  className="absolute inset-0 opacity-0 cursor-pointer"
                />
              </label>
              {t}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onChange(value.filter((x) => x !== t))
                }}
                className="px-1 py-0.5 relative z-10 rounded hover:bg-loom-bg transition-colors"
                title="移除版本标签"
              >
                ✕
              </button>
            </span>
          )
        })}
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className={[
            'flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] text-loom-muted',
            'border border-loom-border/70 hover:border-loom-accent hover:text-loom-accent transition-colors flex-shrink-0',
          ].join(' ')}
          title={placeholder}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" width="10" height="10">
            <path d="M12 5v14M5 12h14" strokeLinecap="round" />
          </svg>
          {!compact && <span>{placeholder}</span>}
        </button>
      </div>

      {/* 下拉面板 */}
      {open && (
        <div className="absolute left-0 top-full mt-1 z-50 w-48 rounded-lg border border-loom-border bg-loom-panel shadow-lg p-1.5">
          <div ref={listRef} className="max-h-40 overflow-auto space-y-0.5">
            {known.length === 0 && (
              <p className="text-[10px] text-loom-muted px-1 py-1">还没有版本标签，在下方输入新建。</p>
            )}
            {known.map((t, idx) => {
              const color = tagColors[t] ?? FALLBACK_COLOR
              const selected = value.includes(t)
              const active = highlight === idx
              return (
                <button
                  key={t}
                  type="button"
                  data-tagidx={idx}
                  onClick={() => toggle(t)}
                  onMouseEnter={() => setHighlight(idx)}
                  className={[
                    'w-full flex items-center gap-2 px-1.5 py-1 rounded text-[11px] text-left transition-colors',
                    selected ? 'bg-loom-accent/10 text-loom-text' : 'text-loom-text/90 hover:bg-loom-bg',
                    active ? 'outline outline-1 outline-loom-accent -outline-offset-1' : '',
                  ].join(' ')}
                >
                  <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: color }} />
                  <span className="flex-1 font-mono truncate">{t}</span>
                  {selected && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" width="12" height="12" className="text-loom-accent flex-shrink-0">
                      <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  )}
                </button>
              )
            })}
          </div>
          {/* 新建标签 */}
          <div className="mt-1 pt-1 border-t border-loom-border flex items-center gap-1">
            <input
              ref={inputRef}
              type="text"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="新建标签名"
              className="flex-1 bg-loom-bg border border-loom-border rounded px-1.5 py-1 text-[10px] font-mono text-loom-text focus:outline-none focus:border-loom-accent min-w-0"
            />
            <button
              type="button"
              onClick={createTag}
              disabled={!draft.trim() || draftExists}
              className="px-1.5 py-1 rounded bg-loom-accent text-loom-bg text-[10px] font-semibold disabled:opacity-40 transition-colors"
            >
              创建
            </button>
          </div>
          {draft.trim() && draftExists && (
            <p className="text-[9px] text-loom-warn mt-0.5 px-0.5">该标签已存在，直接点击选择</p>
          )}
        </div>
      )}
    </div>
  )
}
