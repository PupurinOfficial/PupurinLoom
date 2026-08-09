import { useState, useMemo, useEffect, useRef } from 'react'
import type { BlockType } from '../utils/dialogueParser'

interface CommandItem {
  type: BlockType
  label: string
  description: string
  icon: JSX.Element
  keywords: string[]
}

interface CommandCategory {
  id: string
  label: string
  icon: JSX.Element
  items: CommandItem[]
}

const CATEGORIES: CommandCategory[] = [
  {
    id: 'all',
    label: '全部',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
    items: [],
  },
  {
    id: 'character',
    label: '角色',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
      </svg>
    ),
    items: [
      {
        type: 'show',
        label: '显示',
        description: '显示角色或舞台对象',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        ),
        keywords: ['show', '显示', '立绘', '角色'],
      },
      {
        type: 'hide',
        label: '隐藏',
        description: '隐藏角色或舞台对象',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M17.94 17.94A10.07 10.07 0 0112 20c-7 0-11-8-11-8a18.45 18.45 0 015.06-5.94M9.9 4.24A9.12 9.12 0 0112 4c7 0 11 8 11 8a18.5 18.5 0 01-2.16 3.19m-6.72-1.07a3 3 0 11-4.24-4.24" />
            <line x1="1" y1="1" x2="23" y2="23" />
          </svg>
        ),
        keywords: ['hide', '隐藏', '立绘', '角色'],
      },
    ],
  },
  {
    id: 'dialogue',
    label: '对话',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
        <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
      </svg>
    ),
    items: [
      {
        type: 'dialogue',
        label: '角色对话',
        description: '角色说一句话',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        ),
        keywords: ['dialogue', '对话', '说话', '角色'],
      },
      {
        type: 'narration',
        label: '旁白',
        description: '叙述性文字',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M4 6h16M4 12h10M4 18h16" />
          </svg>
        ),
        keywords: ['narration', '旁白', '叙述', 'narrator'],
      },
    ],
  },
  {
    id: 'scene',
    label: '场景',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
        <rect x="3" y="3" width="18" height="18" rx="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <path d="M21 15l-5-5L5 21" />
      </svg>
    ),
    items: [
      {
        type: 'scene',
        label: '背景',
        description: '切换场景背景',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        ),
        keywords: ['scene', '背景', '场景', 'background'],
      },
    ],
  },
  {
    id: 'flow',
    label: '流程',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
        <path d="M5 12h14M13 5l7 7-7 7" />
      </svg>
    ),
    items: [
      {
        type: 'label',
        label: '场景',
        description: '定义剧情场景标签',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M4 4h16v16H4z" />
            <path d="M4 9h16M9 4v16" />
          </svg>
        ),
        keywords: ['label', '场景', '标签', 'scene', 'label'],
      },
      {
        type: 'jump',
        label: '跳转',
        description: '跳转到指定标签',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        ),
        keywords: ['jump', '跳转', 'goto'],
      },
      {
        type: 'call',
        label: '调用',
        description: '调用指定标签',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M5 12h14M13 5l7 7-7 7" />
          </svg>
        ),
        keywords: ['call', '调用', 'gosub'],
      },
      {
        type: 'menu',
        label: '选项',
        description: '分支选择菜单',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        ),
        keywords: ['menu', '选项', 'choice', '分支'],
      },
    ],
  },
  {
    id: 'data',
    label: '数据',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    ),
    items: [
      {
        type: 'save',
        label: '存档',
        description: '保存游戏到存档位',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
            <path d="M17 21v-8H7v8M7 3v5h8" />
          </svg>
        ),
        keywords: ['save', '存档', '保存'],
      },
      {
        type: 'modify_var',
        label: '修改变量',
        description: '修改游戏变量值',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <text x="12" y="16" textAnchor="middle" fontSize="16" fontWeight="600" stroke="none" fill="currentColor">x</text>
          </svg>
        ),
        keywords: ['modify_var', '修改变量', 'variable', '变量'],
      },
      {
        type: 'if',
        label: '如果',
        description: '条件判断分支',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M6 3v12M18 9l-6 6-6-6" />
          </svg>
        ),
        keywords: ['if', '条件', '判断', '分支'],
      },
    ],
  },
  {
    id: 'media',
    label: '媒体',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
        <rect x="2" y="4" width="20" height="16" rx="2" />
        <polygon points="10,8 16,12 10,16" />
      </svg>
    ),
    items: [
      {
        type: 'movie_cutscene',
        label: '过场动画',
        description: '播放过场视频',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <rect x="2" y="4" width="20" height="16" rx="2" />
            <polygon points="10,8 16,12 10,16" />
          </svg>
        ),
        keywords: ['movie', 'cutscene', '过场', '视频'],
      },
    ],
  },
  {
    id: 'tools',
    label: '工具',
    icon: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="16" height="16">
        <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z" />
      </svg>
    ),
    items: [
      {
        type: 'open_url',
        label: '跳转网站',
        description: '打开外部链接',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        ),
        keywords: ['open_url', '跳转', '网站', 'url', 'link', '链接'],
      },
      {
        type: 'comment',
        label: '注释',
        description: '添加代码注释',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z" />
          </svg>
        ),
        keywords: ['comment', '注释', 'comment'],
      },
      {
        type: 'blank',
        label: '空行',
        description: '添加空行',
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="18" height="18">
            <rect x="3" y="11" width="18" height="2" />
          </svg>
        ),
        keywords: ['blank', '空行', 'empty', 'space'],
      },
    ],
  },
]

interface CommandPaletteProps {
  open: boolean
  onClose: () => void
  onSelect: (type: BlockType) => void
  anchorRect?: DOMRect | null
}

export default function CommandPalette({ open, onClose, onSelect, anchorRect }: CommandPaletteProps) {
  const [activeCategory, setActiveCategory] = useState('all')
  const [search, setSearch] = useState('')
  const [selectedIdx, setSelectedIdx] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // 合并所有 items（all 类别）
  const allItems = useMemo(() => {
    const items: CommandItem[] = []
    for (const cat of CATEGORIES) {
      if (cat.id !== 'all') {
        items.push(...cat.items)
      }
    }
    return items
  }, [])

  // 当前显示的 items
  const filteredItems = useMemo(() => {
    let items: CommandItem[]
    if (activeCategory === 'all') {
      items = allItems
    } else {
      const cat = CATEGORIES.find((c) => c.id === activeCategory)
      items = cat?.items ?? []
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      items = items.filter(
        (it) =>
          it.label.toLowerCase().includes(q) ||
          it.description.toLowerCase().includes(q) ||
          it.keywords.some((k) => k.toLowerCase().includes(q))
      )
    }
    return items
  }, [activeCategory, search, allItems])

  // 重置选择
  useEffect(() => {
    setSelectedIdx(0)
  }, [activeCategory, search, open])

  // 聚焦搜索框
  useEffect(() => {
    if (open) {
      setTimeout(() => searchInputRef.current?.focus(), 50)
    }
  }, [open])

  // 键盘导航
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        onClose()
      } else if (e.key === 'ArrowDown') {
        e.preventDefault()
        setSelectedIdx((i) => Math.min(i + 1, filteredItems.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setSelectedIdx((i) => Math.max(i - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const item = filteredItems[selectedIdx]
        if (item) {
          onSelect(item.type)
          onClose()
        }
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, filteredItems, selectedIdx, onSelect, onClose])

  if (!open) return null

  // 计算位置
  const style: React.CSSProperties = {}
  const PALETTE_H = 380
  const PALETTE_W = 420
  if (anchorRect) {
    style.position = 'fixed'
    // 确保不超出视口
    const top = Math.min(anchorRect.bottom + 4, window.innerHeight - PALETTE_H - 10)
    const left = Math.min(anchorRect.left, window.innerWidth - PALETTE_W - 10)
    style.top = Math.max(10, top) + 'px'
    style.left = Math.max(10, left) + 'px'
  } else {
    style.position = 'fixed'
    style.top = '50%'
    style.left = '50%'
    style.transform = 'translate(-50%, -50%)'
  }

  return (
    <>
      <div className="fixed inset-0 z-[90]" onClick={onClose} />
      <div
        className="z-[91] w-[420px] h-[380px] bg-loom-panel2 border border-loom-border rounded-lg shadow-2xl flex flex-col overflow-hidden"
        style={style}
      >
        {/* 搜索框 */}
        <div className="px-3 py-2 border-b border-loom-border">
          <input
            ref={searchInputRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索命令…"
            className="w-full bg-loom-bg border border-loom-border rounded px-3 py-1.5 text-sm text-loom-text focus:outline-none focus:border-loom-accent"
          />
        </div>

        <div className="flex flex-1 min-h-0">
          {/* 分类 */}
          <div className="w-28 border-r border-loom-border bg-loom-bg/50 flex flex-col py-1">
            {CATEGORIES.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={[
                  'flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors',
                  activeCategory === cat.id
                    ? 'bg-loom-accent/20 text-loom-accent font-semibold'
                    : 'text-loom-muted hover:text-loom-text hover:bg-loom-panel',
                ].join(' ')}
              >
                <span className={activeCategory === cat.id ? 'text-loom-accent' : ''}>{cat.icon}</span>
                <span>{cat.label}</span>
              </button>
            ))}
          </div>

          {/* 命令列表 */}
          <div ref={listRef} className="flex-1 overflow-auto py-1">
            {filteredItems.length === 0 && (
              <div className="px-3 py-4 text-center text-loom-muted text-xs">未找到匹配命令</div>
            )}
            {filteredItems.map((item, i) => (
              <button
                key={item.type}
                onMouseEnter={() => setSelectedIdx(i)}
                onClick={() => {
                  onSelect(item.type)
                  onClose()
                }}
                className={[
                  'w-full flex items-center gap-3 px-3 py-2 text-left transition-colors',
                  i === selectedIdx
                    ? 'bg-loom-accent/20 text-loom-text'
                    : 'text-loom-text hover:bg-loom-panel',
                ].join(' ')}
              >
                <span className="flex-shrink-0 text-loom-muted">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{item.label}</div>
                  <div className="text-[11px] text-loom-muted truncate">{item.description}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  )
}
