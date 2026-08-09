import { useEffect, useRef, useState } from 'react'
import type { RpyFileNode } from '../types'

interface StoryFileTreeProps {
  files: RpyFileNode[]
  selectedPath: string
  projectPath: string
  onSelect: (node: RpyFileNode) => void
  onNewChapter?: () => void
  onRefresh: () => Promise<void>
}

function isRpy(name: string): boolean {
  return name.toLowerCase().endsWith('.rpy')
}

// 简易 prompt 模态框（新建/重命名）
interface PromptConfig {
  title: string
  placeholder: string
  defaultValue: string
  desc?: string
  onSubmit: (value: string) => void | Promise<void>
}

function FileNode({
  node,
  depth,
  selectedPath,
  onSelect,
  storyOnly,
  onContextMenu,
  onDragStart,
  dragOverPath,
}: {
  node: RpyFileNode
  depth: number
  selectedPath: string
  onSelect: (node: RpyFileNode) => void
  storyOnly: boolean
  onContextMenu: (e: React.MouseEvent, node: RpyFileNode) => void
  onDragStart: (e: React.DragEvent, node: RpyFileNode) => void
  dragOverPath: string | null
}) {
  const [expanded, setExpanded] = useState(depth < 1)
  const isSelected = selectedPath === node.path
  const isFolder = node.isDir
  const isDragOver = isFolder && dragOverPath === node.path

  // 过滤：只看故事文件时，隐藏非故事文件（含非 .rpy 文件）
  if (storyOnly && !isFolder && !node.isStoryFile) return null

  const visibleChildren = storyOnly
    ? node.children?.filter((c) => c.isDir || c.isStoryFile)
    : node.children
  // 不含 .rpy 子文件的文件夹不显示
  if (isFolder && (!visibleChildren || visibleChildren.length === 0)) return null

  return (
    <div>
      <div
        data-dir-path={isFolder ? node.path : undefined}
        className={[
          'flex items-center gap-1.5 px-2 py-1 text-sm cursor-pointer transition-colors',
          isSelected
            ? 'bg-loom-accent/15 text-loom-accent'
            : 'text-loom-text hover:bg-loom-panel2',
          isDragOver ? 'bg-loom-accent/20 ring-1 ring-loom-accent' : '',
        ].join(' ')}
        style={{ paddingLeft: `${depth * 14 + 8}px` }}
        onClick={() => {
          if (isFolder) setExpanded(!expanded)
          else onSelect(node)
        }}
        onContextMenu={(e) => onContextMenu(e, node)}
        draggable
        onDragStart={(e) => onDragStart(e, node)}
      >
        {isFolder ? (
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="12"
            height="12"
            className={`text-loom-muted transition-transform ${expanded ? 'rotate-90' : ''}`}
          >
            <path d="M6 3l5 5-5 5" />
          </svg>
        ) : (
          <span className="w-3" />
        )}

        {isFolder ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" className="text-loom-accent flex-shrink-0">
            <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
          </svg>
        ) : isRpy(node.name) && node.isStoryFile ? (
          // 故事文件图标
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" className="text-loom-accent flex-shrink-0">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M8 13h8M8 17h5" strokeWidth="1.5" />
          </svg>
        ) : isRpy(node.name) ? (
          // 代码文件图标
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" className="text-loom-muted flex-shrink-0">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
            <path d="M9 13l-2 2 2 2M15 13l2 2-2 2" strokeWidth="1.5" />
          </svg>
        ) : (
          // 其他文件
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" className="text-loom-muted flex-shrink-0">
            <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
            <path d="M14 2v6h6" />
          </svg>
        )}

        <span className="truncate flex-1">{node.name}</span>

        {isFolder && visibleChildren && visibleChildren.length > 0 && (
          <span className="text-[10px] text-loom-muted font-mono">
            {visibleChildren.length}
          </span>
        )}
      </div>

      {isFolder && expanded && visibleChildren && (
        <div>
          {visibleChildren.map((child) => (
            <FileNode
              key={child.path}
              node={child}
              depth={depth + 1}
              selectedPath={selectedPath}
              onSelect={onSelect}
              storyOnly={storyOnly}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              dragOverPath={dragOverPath}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function StoryFileTree({
  files,
  selectedPath,
  projectPath,
  onSelect,
  onNewChapter,
  onRefresh,
}: StoryFileTreeProps) {
  const [storyOnly, setStoryOnly] = useState(false)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: RpyFileNode } | null>(null)
  const [promptCfg, setPromptCfg] = useState<PromptConfig | null>(null)
  const [promptValue, setPromptValue] = useState('')

  // 拖拽
  const treeRef = useRef<HTMLDivElement>(null)
  const dragNodeRef = useRef<RpyFileNode | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)

  function onDragStart(e: React.DragEvent, node: RpyFileNode): void {
    dragNodeRef.current = node
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.path)
  }

  useEffect(() => {
    const close = (): void => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  useEffect(() => {
    const el = treeRef.current
    if (!el || !projectPath) return

    const handleOver = (e: DragEvent): void => {
      const dt = e.dataTransfer
      if (!dt) return
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-dir-path]')
      const src = dragNodeRef.current
      if (src) {
        e.preventDefault()
        const dest = row ? row.dataset.dirPath ?? '' : ''
        if (dest !== src.path && !dest.startsWith(src.path + '/')) {
          dt.dropEffect = 'move'
          setDragOverPath(dest)
        } else {
          setDragOverPath(null)
        }
      }
    }
    const handleLeave = (e: DragEvent): void => {
      if (!el.contains(e.relatedTarget as Node)) setDragOverPath(null)
    }
    const handleDrop = (e: DragEvent): void => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-dir-path]')
      const src = dragNodeRef.current
      dragNodeRef.current = null
      setDragOverPath(null)
      if (!src) return
      const dest = row ? row.dataset.dirPath ?? '' : ''
      if (dest === src.path || dest.startsWith(src.path + '/')) return
      e.preventDefault()
      void (async () => {
        try {
          await window.pupurin.moveFile(projectPath, src.path, dest)
          await onRefresh()
        } catch (e2) {
          console.error('move failed:', e2)
        }
      })()
    }
    el.addEventListener('dragover', handleOver)
    el.addEventListener('dragleave', handleLeave)
    el.addEventListener('drop', handleDrop)
    return () => {
      el.removeEventListener('dragover', handleOver)
      el.removeEventListener('dragleave', handleLeave)
      el.removeEventListener('drop', handleDrop)
    }
  }, [projectPath, onRefresh])

  function openPrompt(cfg: PromptConfig): void {
    setPromptValue(cfg.defaultValue)
    setPromptCfg(cfg)
  }

  async function confirmPrompt(): Promise<void> {
    if (!promptCfg) return
    const cfg = promptCfg
    const v = promptValue.trim()
    setPromptCfg(null)
    setPromptValue('')
    if (!v) return
    await cfg.onSubmit(v)
  }

  // 新建文件/文件夹
  function handleCreate(parentDir: string, type: 'file' | 'folder'): void {
    const isCode = type === 'file'
    openPrompt({
      title: isCode ? '新建代码文件' : '新建文件夹',
      placeholder: isCode ? '文件名（.rpy）' : '文件夹名',
      defaultValue: isCode ? 'newcode.rpy' : 'newfolder',
      desc: isCode
        ? '将创建 .rpy 代码文件，不参与剧情解析（如需剧情请使用「新建章节」）。'
        : '将创建文件夹，可把 .rpy 文件拖入其中归类。',
      onSubmit: async (name) => {
        try {
          const subPath = parentDir ? `${parentDir}/${name}` : name
          if (type === 'file') {
            await window.pupurin.createFile(projectPath, subPath, '')
          } else {
            await window.pupurin.createDir(projectPath, subPath)
          }
          await onRefresh()
        } catch (e) {
          console.error('create failed:', e)
        }
      },
    })
  }

  // 重命名
  function handleRename(node: RpyFileNode): void {
    openPrompt({
      title: '重命名',
      placeholder: '新名称',
      defaultValue: node.name,
      onSubmit: async (newName) => {
        if (newName === node.name) return
        try {
          await window.pupurin.renameFile(projectPath, node.path, newName)
          await onRefresh()
        } catch (e) {
          console.error('rename failed:', e)
        }
      },
    })
  }

  // 删除
  async function handleDelete(node: RpyFileNode): Promise<void> {
    if (!confirm(`确认删除「${node.name}」？${node.isDir ? '（文件夹下所有内容将被删除）' : ''}`)) return
    try {
      await window.pupurin.deleteFile(projectPath, node.path)
      await onRefresh()
    } catch (e) {
      console.error('delete failed:', e)
    }
  }

  // 标记为故事/代码
  async function handleSetStoryMark(node: RpyFileNode, mark: 'story' | 'code'): Promise<void> {
    try {
      await window.pupurin.setStoryMark(projectPath, node.path, mark)
      await onRefresh()
    } catch (e) {
      console.error('setStoryMark failed:', e)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 h-8 bg-loom-panel2 border-b border-loom-border">
        <span className="text-xs font-semibold text-loom-text">文件</span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => handleCreate('', 'file')}
            title="新建代码文件 (.rpy)"
            className="w-5 h-5 flex items-center justify-center rounded text-loom-muted hover:text-loom-accent hover:bg-loom-accent/10 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
              <path d="M9 13l-2 2 2 2M15 13l2 2-2 2" strokeWidth="1.5" />
            </svg>
          </button>
          <button
            onClick={() => handleCreate('', 'folder')}
            title="新建文件夹"
            className="w-5 h-5 flex items-center justify-center rounded text-loom-muted hover:text-loom-accent hover:bg-loom-accent/10 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
          </button>
          {onNewChapter && (
            <button
              onClick={onNewChapter}
              title="新建章节（故事文件，含 label 场景）"
              className="w-5 h-5 flex items-center justify-center rounded text-loom-accent hover:bg-loom-accent/10 transition-colors text-xs"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M8 13h8M8 17h5" strokeWidth="1.5" />
                <path d="M12 10v3M10.5 11.5h3" strokeWidth="1.8" />
              </svg>
            </button>
          )}
          <button
            onClick={() => setStoryOnly(!storyOnly)}
            title="只显示包含 label 的故事文件"
            className={[
              'flex items-center gap-1 px-2 py-0.5 rounded text-[10px] transition-colors',
              storyOnly
                ? 'bg-loom-accent/20 text-loom-accent'
                : 'text-loom-muted hover:text-loom-text hover:bg-loom-border/30'
            ].join(' ')}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
              <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
              <path d="M14 2v6h6" />
            </svg>
            故事
          </button>
        </div>
      </div>

      <div ref={treeRef} className="flex-1 overflow-auto py-1">
        {files.length === 0 ? (
          <div className="px-3 py-4 text-center text-xs text-loom-muted">
            暂无文件
          </div>
        ) : (
          files.map((node) => (
            <FileNode
              key={node.path}
              node={node}
              depth={0}
              selectedPath={selectedPath}
              onSelect={onSelect}
              storyOnly={storyOnly}
              onContextMenu={(e, n) => {
                e.preventDefault()
                e.stopPropagation()
                setContextMenu({ x: e.clientX, y: e.clientY, node: n })
              }}
              onDragStart={onDragStart}
              dragOverPath={dragOverPath}
            />
          ))
        )}
      </div>

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-loom-panel2 border border-loom-border rounded shadow-lg py-1 text-xs"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {contextMenu.node.isDir && (
            <>
              <button
                onClick={() => { handleCreate(contextMenu.node.path, 'file'); setContextMenu(null) }}
                className="block w-full text-left px-3 py-1.5 hover:bg-loom-panel text-loom-text"
              >新建代码文件</button>
              <button
                onClick={() => { handleCreate(contextMenu.node.path, 'folder'); setContextMenu(null) }}
                className="block w-full text-left px-3 py-1.5 hover:bg-loom-panel text-loom-text"
              >新建文件夹</button>
              <div className="border-t border-loom-border my-1" />
            </>
          )}
          {!contextMenu.node.isDir && isRpy(contextMenu.node.name) && (
            <>
              <button
                onClick={() => { void handleSetStoryMark(contextMenu.node, 'story'); setContextMenu(null) }}
                className={[
                  'block w-full text-left px-3 py-1.5 hover:bg-loom-panel',
                  contextMenu.node.isStoryFile ? 'text-loom-accent' : 'text-loom-text'
                ].join(' ')}
              >
                {contextMenu.node.isStoryFile ? '✓ ' : ''}标记为故事
              </button>
              <button
                onClick={() => { void handleSetStoryMark(contextMenu.node, 'code'); setContextMenu(null) }}
                className={[
                  'block w-full text-left px-3 py-1.5 hover:bg-loom-panel',
                  !contextMenu.node.isStoryFile ? 'text-loom-accent' : 'text-loom-text'
                ].join(' ')}
              >
                {!contextMenu.node.isStoryFile ? '✓ ' : ''}标记为代码
              </button>
              <div className="border-t border-loom-border my-1" />
            </>
          )}
          <button
            onClick={() => { handleRename(contextMenu.node); setContextMenu(null) }}
            className="block w-full text-left px-3 py-1.5 hover:bg-loom-panel text-loom-text"
          >重命名</button>
          <button
            onClick={() => { void handleDelete(contextMenu.node); setContextMenu(null) }}
            className="block w-full text-left px-3 py-1.5 hover:bg-loom-err/20 text-loom-err"
          >删除</button>
        </div>
      )}

      {/* 输入弹窗 */}
      {promptCfg && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50"
          onClick={() => { setPromptCfg(null); setPromptValue('') }}
        >
          <div
            className="bg-loom-panel2 border border-loom-border rounded-lg shadow-xl w-80 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-loom-text mb-3">{promptCfg.title}</h3>
            {promptCfg.desc && (
              <p className="text-[11px] text-loom-muted mb-2 leading-relaxed">{promptCfg.desc}</p>
            )}
            <input
              autoFocus
              type="text"
              value={promptValue}
              onChange={(e) => setPromptValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void confirmPrompt()
                if (e.key === 'Escape') { setPromptCfg(null); setPromptValue('') }
              }}
              placeholder={promptCfg.placeholder}
              className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm text-loom-text focus:outline-none focus:border-loom-accent font-mono"
            />
            <div className="flex justify-end gap-2 mt-4">
              <button
                onClick={() => { setPromptCfg(null); setPromptValue('') }}
                className="px-3 py-1 text-xs rounded bg-loom-panel border border-loom-border text-loom-muted hover:text-loom-text transition-colors"
              >取消</button>
              <button
                onClick={() => void confirmPrompt()}
                className="px-3 py-1 text-xs rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 transition-opacity"
              >确定</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
