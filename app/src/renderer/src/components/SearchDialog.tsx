import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { usePlugins } from '../store/plugins'
import PluginIcon from './PluginIcon'

// 全局搜索（类 macOS 聚焦搜索）：搜索项目内文件、代码/剧本文本、插件与命令
interface SearchFile {
  name: string
  path: string
  isStoryFile: boolean
  size: number
}

interface CodeHit {
  file: string
  line: number
  col: number
  text: string
  snippet: string
}

type Result =
  | { kind: 'file'; file: SearchFile }
  | { kind: 'code'; hit: CodeHit; isStoryFile: boolean }
  | { kind: 'command'; pluginId: string; pluginName: string; id: string; title: string }
  | { kind: 'plugin'; id: string; name: string }

const TEXT_EXTS = /\.(rpy|py|txt|md)$/i
const MAX_STORY_HITS = 60
const MAX_CODE_HITS = 60

interface SearchDialogProps {
  open: boolean
  onClose: () => void
}

export default function SearchDialog({ open, onClose }: SearchDialogProps) {
  const projectPath = useStore((s) => s.currentProject?.path ?? '')
  const setActiveView = useStore((s) => s.setActiveView)
  const setSearchNav = useStore((s) => s.setSearchNav)
  const setPendingOpenFile = useStore((s) => s.setPendingOpenFile)
  const setPendingRevealFile = useStore((s) => s.setPendingRevealFile)
  const plugins = usePlugins((s) => s.plugins)
  const commands = usePlugins((s) => s.commands)
  const runCommand = usePlugins((s) => s.runCommand)

  const [query, setQuery] = useState('')
  const [files, setFiles] = useState<SearchFile[]>([])
  const [contents, setContents] = useState<Map<string, string>>(new Map())
  const [indexing, setIndexing] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  // 打开时重建索引：递归文件列表 + 预读文本类文件内容（保留上次搜索词与访问项）
  useEffect(() => {
    if (!open || !projectPath) return
    setIndexing(true)
    let cancelled = false
    void (async () => {
      const fileList: SearchFile[] = []
      const cache = new Map<string, string>()
      async function walk(dir: string): Promise<void> {
        try {
          const entries = await window.pupurin.listFiles(projectPath, dir)
          for (const e of entries) {
            if (cancelled) return
            if (e.isDir) await walk(e.path)
            else fileList.push({ name: e.name, path: e.path, isStoryFile: e.isStoryFile, size: e.size })
          }
        } catch {
          /* 目录不可读则跳过 */
        }
      }
      await walk('')
      await Promise.all(
        fileList
          .filter((f) => TEXT_EXTS.test(f.name))
          .map(async (f) => {
            if (cancelled) return
            try {
              const content = await window.pupurin.readFile(projectPath, f.path)
              if (!cancelled) cache.set(f.path, content)
            } catch {
              /* 二进制或读取失败，跳过 */
            }
          })
      )
      if (!cancelled) {
        setFiles(fileList)
        setContents(cache)
        setIndexing(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [open, projectPath])

  // 打开后自动聚焦输入框
  useEffect(() => {
    if (open) {
      const t = window.setTimeout(() => inputRef.current?.focus(), 30)
      return () => window.clearTimeout(t)
    }
  }, [open])

  // 分组结果：文件 / 剧本 / 代码 / 插件命令 / 插件
  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const fileHits: Result[] = []
    const storyHits: Result[] = []
    const codeHits: Result[] = []
    const cmdHits: Result[] = []
    const pluginHits: Result[] = []
    const storyOf = (path: string): boolean => files.find((f) => f.path === path)?.isStoryFile ?? false

    if (!q) {
      for (const f of files) {
        if (TEXT_EXTS.test(f.name)) fileHits.push({ kind: 'file', file: f })
      }
      for (const c of commands) {
        const p = plugins.find((x) => x.id === c.pluginId)
        cmdHits.push({ kind: 'command', pluginId: c.pluginId, pluginName: p?.name ?? c.pluginId, id: c.id, title: c.title })
      }
      for (const p of plugins) pluginHits.push({ kind: 'plugin', id: p.id, name: p.name })
    } else {
      for (const f of files) {
        if (f.name.toLowerCase().includes(q)) fileHits.push({ kind: 'file', file: f })
      }
      outer: for (const [path, content] of contents) {
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i++) {
          const idx = lines[i].toLowerCase().indexOf(q)
          if (idx === -1) continue
          const hit: Result = {
            kind: 'code',
            hit: {
              file: path,
              line: i + 1,
              col: idx + 1,
              text: lines[i].slice(idx, idx + q.length),
              snippet: lines[i].trim().slice(0, 140),
            },
            isStoryFile: storyOf(path),
          }
          // 剧本（故事文件）与代码分开分组
          if (hit.isStoryFile) storyHits.push(hit)
          else codeHits.push(hit)
          if (storyHits.length >= MAX_STORY_HITS && codeHits.length >= MAX_CODE_HITS) break outer
        }
      }
      for (const c of commands) {
        if (c.title.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)) {
          const p = plugins.find((x) => x.id === c.pluginId)
          cmdHits.push({ kind: 'command', pluginId: c.pluginId, pluginName: p?.name ?? c.pluginId, id: c.id, title: c.title })
        }
      }
      for (const p of plugins) {
        if (p.name.toLowerCase().includes(q) || p.id.toLowerCase().includes(q)) {
          pluginHits.push({ kind: 'plugin', id: p.id, name: p.name })
        }
      }
    }

    return [
      { label: '文件', items: fileHits },
      { label: '剧本', items: storyHits },
      { label: '代码', items: codeHits },
      { label: '插件命令', items: cmdHits },
      { label: '插件', items: pluginHits },
    ].filter((g) => g.items.length > 0)
  }, [query, files, contents, plugins, commands])

  const allItems = useMemo(() => groups.flatMap((g) => g.items), [groups])

  function execute(item: Result): void {
    // 剧本/代码（.rpy）→ 织机；其他文件 → 资源管理器定位并预览
    if (item.kind === 'file') {
      if (/\.rpy$/i.test(item.file.name)) {
        setPendingOpenFile({ path: item.file.path, isStoryFile: item.file.isStoryFile })
        setActiveView('script')
      } else {
        setPendingRevealFile({ path: item.file.path })
        setActiveView('resources')
      }
    } else if (item.kind === 'code') {
      if (/\.rpy$/i.test(item.hit.file)) {
        setSearchNav({
          file: item.hit.file,
          line: item.hit.line,
          col: item.hit.col,
          text: item.hit.text,
          isStoryFile: item.isStoryFile,
        })
        setActiveView('script')
      } else {
        setPendingRevealFile({ path: item.hit.file })
        setActiveView('resources')
      }
    } else if (item.kind === 'command') {
      const cmd = commands.find((c) => c.pluginId === item.pluginId && c.id === item.id)
      if (cmd) runCommand(cmd)
      onClose()
      return
    } else {
      setActiveView('plugins')
    }
    onClose()
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    if (e.key === 'Escape') {
      e.preventDefault()
      onClose()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => (allItems.length ? (i + 1) % allItems.length : 0))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => (allItems.length ? (i - 1 + allItems.length) % allItems.length : 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (allItems[activeIdx]) execute(allItems[activeIdx])
    }
  }

  // 当前激活项对应的全局索引
  let globalIdx = -1

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-[70] bg-black/40 flex items-start justify-center pt-[12vh]"
      onMouseDown={onClose}
    >
      <div
        className="w-[600px] max-w-[90vw] rounded-xl border border-loom-border bg-loom-panel shadow-2xl overflow-hidden"
        onMouseDown={(e) => e.stopPropagation()}
      >
        {/* 输入区 */}
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-loom-border">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16" className="text-loom-muted flex-shrink-0">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4.35-4.35" />
          </svg>
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setActiveIdx(0)
            }}
            onKeyDown={handleKeyDown}
            placeholder={indexing ? '正在索引项目文件…' : '搜索文件、代码、插件命令…'}
            className="flex-1 bg-transparent text-sm text-loom-text placeholder:text-loom-muted/60 outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-loom-panel2 border border-loom-border text-loom-muted font-mono flex-shrink-0">
            ⌘P
          </kbd>
        </div>

        {/* 结果区 */}
        <div className="max-h-[46vh] overflow-y-auto">
          {indexing && allItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-loom-muted">正在索引项目文件…</div>
          ) : allItems.length === 0 ? (
            <div className="px-4 py-8 text-center text-xs text-loom-muted">
              {query.trim() ? '未找到匹配结果' : '项目中没有可搜索的文件'}
            </div>
          ) : (
            groups.map((g) => (
              <div key={g.label}>
                <div className="px-4 pt-2.5 pb-1 text-[10px] font-semibold tracking-wider text-loom-muted uppercase flex-shrink-0">
                  {g.label}
                </div>
                {g.items.map((item) => {
                  globalIdx += 1
                  const idx = globalIdx
                  const active = idx === activeIdx
                  return (
                    <button
                      key={
                        item.kind === 'file'
                          ? `f:${item.file.path}`
                          : item.kind === 'code'
                            ? `c:${item.hit.file}:${item.hit.line}:${item.hit.col}`
                            : item.kind === 'command'
                              ? `cmd:${item.pluginId}:${item.id}`
                              : `p:${item.id}`
                      }
                      onMouseEnter={() => setActiveIdx(idx)}
                      onClick={() => execute(item)}
                      className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                        active ? 'bg-loom-accent/10' : 'hover:bg-loom-panel2'
                      }`}
                    >
                      {/* 图标 */}
                      <span className={`flex-shrink-0 ${active ? 'text-loom-accent' : 'text-loom-muted'}`}>
                        {item.kind === 'file' && (
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
                            <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                          </svg>
                        )}
                        {item.kind === 'code' &&
                          (item.isStoryFile ? (
                            // 剧本：书页 + 文本行
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
                              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                              <path d="M14 2v6h6" />
                              <path d="M8 13h8M8 17h5" strokeWidth="1.4" />
                            </svg>
                          ) : (
                            // 代码：书页 + 尖括号
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="14" height="14">
                              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                              <path d="M14 2v6h6" />
                              <path d="M9 13l-2 2 2 2M15 13l2 2-2 2" strokeWidth="1.4" />
                            </svg>
                          ))}
                        {item.kind === 'command' && (
                          <PluginIcon pluginId={item.pluginId} icon={plugins.find((x) => x.id === item.pluginId)?.icon} size={14} />
                        )}
                        {item.kind === 'plugin' && (
                          <PluginIcon pluginId={item.id} icon={plugins.find((x) => x.id === item.id)?.icon} size={14} />
                        )}
                      </span>
                      {/* 主文本 + 副文本 */}
                      <span className="flex-1 min-w-0">
                        {item.kind === 'file' && (
                          <>
                            <span className={`block text-xs truncate ${active ? 'text-loom-accent' : 'text-loom-text'}`}>{item.file.name}</span>
                            <span className="block text-[10px] text-loom-muted truncate">{item.file.path}</span>
                          </>
                        )}
                        {item.kind === 'code' && (
                          <>
                            <span className={`block text-xs truncate ${active ? 'text-loom-accent' : 'text-loom-text'}`}>
                              {item.hit.file.split('/').pop()}：第 {item.hit.line} 行
                            </span>
                            <span className="block text-[10px] text-loom-muted font-mono truncate">{item.hit.snippet}</span>
                          </>
                        )}
                        {item.kind === 'command' && (
                          <>
                            <span className={`block text-xs truncate ${active ? 'text-loom-accent' : 'text-loom-text'}`}>{item.title}</span>
                            <span className="block text-[10px] text-loom-muted truncate">来自插件「{item.pluginName}」</span>
                          </>
                        )}
                        {item.kind === 'plugin' && (
                          <span className={`block text-xs truncate ${active ? 'text-loom-accent' : 'text-loom-text'}`}>{item.name}</span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))
          )}
        </div>

        {/* 底部提示 */}
        <div className="flex items-center gap-3 px-4 py-2 border-t border-loom-border text-[10px] text-loom-muted">
          <span>↑↓ 导航</span>
          <span>Enter 打开</span>
          <span>Esc 关闭</span>
        </div>
      </div>
    </div>
  )
}
