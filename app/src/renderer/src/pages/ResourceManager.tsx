import { useEffect, useState, useCallback, useRef, Fragment } from 'react'
import { useStore } from '../store/useStore'
import { useResourcePreview } from '../store/resourcePreview'
import NonAsciiRenameDialog from '../components/NonAsciiRenameDialog'
import PromptDialog from '../components/ui/PromptDialog'
import type { NonAsciiRenameItem } from '../types'

interface FileEntry {
  name: string
  isDir: boolean
  path: string
  size: number
  isStoryFile: boolean
}

interface TreeNode extends FileEntry {
  children?: TreeNode[]
  loaded?: boolean
}

const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']
const TEXT_EXTS = ['rpy', 'txt', 'md', 'json', 'xml', 'rpyc']

function getFileExt(name: string): string {
  return name.split('.').pop()?.toLowerCase() ?? ''
}

function isImage(name: string): boolean {
  return IMAGE_EXTS.includes(getFileExt(name))
}

function isText(name: string): boolean {
  return TEXT_EXTS.includes(getFileExt(name))
}

function isRpy(name: string): boolean {
  return name.toLowerCase().endsWith('.rpy')
}

// 自定义 prompt 模态框（替代被 Electron 禁用的 window.prompt）
interface PromptConfig {
  title: string
  placeholder: string
  defaultValue: string
  onSubmit: (value: string) => void | Promise<void>
  onCancel?: () => void
}

export default function ResourceManager() {
  const currentProject = useStore((s) => s.currentProject)
  const setActiveView = useStore((s) => s.setActiveView)
  const setPendingOpenFile = useStore((s) => s.setPendingOpenFile)
  const pendingRevealFile = useStore((s) => s.pendingRevealFile)
  const setPendingRevealFile = useStore((s) => s.setPendingRevealFile)
  const [tree, setTree] = useState<TreeNode[]>([])
  const [currentDir, setCurrentDir] = useState('') // 当前浏览目录（相对 game/，'' = 根）
  const [entries, setEntries] = useState<TreeNode[]>([])
  const [selectedFile, setSelectedFile] = useState<TreeNode | null>(null)
  // 放大预览（双击非剧本文件时覆盖中间区域）
  const [zoomNode, setZoomNode] = useState<TreeNode | null>(null)
  const [zoomPreview, setZoomPreview] = useState<{ type: 'image' | 'text' | 'binary'; content: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; node: TreeNode } | null>(null)
  const [renaming, setRenaming] = useState<TreeNode | null>(null)
  const [renameValue, setRenameValue] = useState('')
  const projectPath = currentProject?.path ?? ''
  // 树的展开状态（用户手动展开/折叠；当前浏览路径自动展开）
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())

  const [promptCfg, setPromptCfg] = useState<PromptConfig | null>(null)
  // 非 ASCII 文件名检查弹窗
  const [nonAsciiItems, setNonAsciiItems] = useState<NonAsciiRenameItem[] | null>(null)
  const [nonAsciiOpen, setNonAsciiOpen] = useState(false)
  // 检测到的不合规文件数（>0 时「检查文件名」按钮显示浅红色警示）
  const [nonAsciiCount, setNonAsciiCount] = useState(0)

  function openPrompt(cfg: PromptConfig): void {
    setPromptCfg(cfg)
  }

  function cancelPrompt(): void {
    if (promptCfg?.onCancel) promptCfg.onCancel()
    setPromptCfg(null)
  }

  // 加载树根目录
  const loadTree = useCallback(async () => {
    if (!projectPath) return
    setErr(null)
    try {
      const entries_ = await window.pupurin.listFiles(projectPath, '')
      const nodes: TreeNode[] = entries_.map((e) => ({ ...e, loaded: !e.isDir }))
      setTree(nodes)
    } catch (e) {
      setErr(String(e))
    }
  }, [projectPath])

  // 加载当前浏览目录内容
  const loadDir = useCallback(async (dir: string) => {
    if (!projectPath) return
    setLoading(true)
    setErr(null)
    try {
      const entries_ = await window.pupurin.listFiles(projectPath, dir)
      setEntries(entries_)
      setCurrentDir(dir)
    } catch (e) {
      setErr(String(e))
    } finally {
      setLoading(false)
    }
  }, [projectPath])

  // 加载子目录（树展开）
  const loadChildren = useCallback(async (node: TreeNode) => {
    if (node.loaded || !node.isDir) return
    try {
      const entries_ = await window.pupurin.listFiles(projectPath, node.path)
      node.children = entries_.map((e) => ({ ...e, loaded: !e.isDir }))
      node.loaded = true
      setTree([...tree])
    } catch (e) {
      setErr(String(e))
    }
  }, [projectPath, tree])

  // 预览文件（写入右侧功能栏「详情」侧边栏，选中文件自动展开）
  const previewFile = useCallback(async (node: TreeNode) => {
    const rp = useResourcePreview.getState()
    if (node.isDir) {
      rp.clear()
      return
    }
    rp.setLoading(true)
    try {
      let type: 'image' | 'text' | 'binary'
      let content = ''
      if (isImage(node.name)) {
        type = 'image'
        content = await window.pupurin.readImageBase64(projectPath, node.path)
      } else if (isText(node.name)) {
        type = 'text'
        content = await window.pupurin.readFile(projectPath, node.path)
      } else {
        type = 'binary'
      }
      rp.show({ name: node.name, path: node.path, isStoryFile: node.isStoryFile, isDir: false, type, content })
      useStore.getState().openSidebar('resource-detail')
    } catch (e) {
      rp.setLoading(false)
      setErr(String(e))
    }
  }, [projectPath])

  // 首次加载：加载文件列表 + 自动扫描不合规文件名（按钮直接显示警示状态）
  useEffect(() => {
    void loadTree()
    void loadDir('')
    void refreshNonAsciiCount()
  }, [loadTree, loadDir])

  // 全局搜索 → 定位文件：切到父目录、选中并预览（非剧本/代码文件）
  useEffect(() => {
    if (!pendingRevealFile || !projectPath) return
    const target = pendingRevealFile
    setPendingRevealFile(null)
    void (async () => {
      setLoading(true)
      setErr(null)
      try {
        const dir = target.path.includes('/') ? target.path.slice(0, target.path.lastIndexOf('/')) : ''
        const entries_ = await window.pupurin.listFiles(projectPath, dir)
        setEntries(entries_)
        setCurrentDir(dir)
        const node = entries_.find((e) => !e.isDir && e.path === target.path)
        if (node) {
          setSelectedFile(node)
          await previewFile(node)
        }
      } catch (e) {
        setErr(String(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [pendingRevealFile, projectPath, previewFile, setPendingRevealFile])

  // currentDir 变化时，自动展开其路径上的所有目录（可手动折叠）
  useEffect(() => {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      let dir = currentDir
      while (dir) {
        next.add(dir)
        const idx = dir.lastIndexOf('/')
        dir = idx >= 0 ? dir.slice(0, idx) : ''
      }
      return next
    })
  }, [currentDir])

  // 切换目录展开/折叠（仅影响树，不导航）
  function toggleDir(node: TreeNode): void {
    setExpandedPaths((prev) => {
      const next = new Set(prev)
      if (next.has(node.path)) next.delete(node.path)
      else next.add(node.path)
      return next
    })
  }

  // 加载放大预览内容
  const loadZoomPreview = useCallback(async (node: TreeNode): Promise<void> => {
    try {
      if (isImage(node.name)) {
        const base64 = await window.pupurin.readImageBase64(projectPath, node.path)
        setZoomPreview({ type: 'image', content: base64 })
      } else if (isText(node.name)) {
        const content = await window.pupurin.readFile(projectPath, node.path)
        setZoomPreview({ type: 'text', content })
      } else {
        setZoomPreview({ type: 'binary', content: '' })
      }
    } catch (e) {
      setErr(String(e))
    }
  }, [projectPath])

  // 双击文件：故事/代码(.rpy) → 前往织机打开；其他文件 → 放大预览
  function handleFileOpen(node: TreeNode): void {
    if (node.isDir) return
    if (isRpy(node.name)) {
      setPendingOpenFile({ path: node.path, isStoryFile: node.isStoryFile })
      setActiveView('script')
    } else {
      setZoomNode(node)
      setZoomPreview(null)
      void loadZoomPreview(node)
    }
  }

  // 关闭放大预览
  function closeZoom(): void {
    setZoomNode(null)
    setZoomPreview(null)
  }

  // 右键菜单
  function onContextMenu(e: React.MouseEvent, node: TreeNode): void {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, node })
  }

  // 关闭右键菜单
  useEffect(() => {
    const close = (): void => setContextMenu(null)
    window.addEventListener('click', close)
    return () => window.removeEventListener('click', close)
  }, [])

  // 刷新树 + 当前目录
  function refreshAll(): Promise<void> {
    return Promise.all([loadTree(), loadDir(currentDir)]).then(() => undefined)
  }

  // 新建文件/文件夹
  function handleCreate(parentDir: string, type: 'file' | 'folder'): void {
    openPrompt({
      title: type === 'file' ? '新建文件' : '新建文件夹',
      placeholder: type === 'file' ? '文件名（可含后缀）' : '文件夹名',
      defaultValue: type === 'file' ? 'newfile.txt' : 'newfolder',
      onSubmit: async (name) => {
        try {
          const subPath = parentDir ? `${parentDir}/${name}` : name
          if (type === 'file') {
            await window.pupurin.createFile(projectPath, subPath, '')
          } else {
            await window.pupurin.createDir(projectPath, subPath)
          }
          await refreshAll()
        } catch (e) {
          setErr(String(e))
        }
      },
    })
  }

  // 导入文件
  async function handleImport(destDir: string): Promise<void> {
    try {
      const files = await window.pupurin.pickFiles()
      if (files.length === 0) return
      for (const f of files) {
        await window.pupurin.importFile(projectPath, destDir, f)
      }
      await refreshAll()
    } catch (e) {
      setErr(String(e))
    }
  }

  // 重命名
  function handleRename(): void {
    if (!renaming) return
    openPrompt({
      title: '重命名',
      placeholder: '新名称',
      defaultValue: renaming.name,
      onSubmit: async (newName) => {
        if (newName === renaming.name) {
          setRenaming(null)
          return
        }
        try {
          await window.pupurin.renameFile(projectPath, renaming.path, newName)
          setRenaming(null)
          await refreshAll()
          if (selectedFile?.path === renaming.path) {
            setSelectedFile(null)
            useResourcePreview.getState().clear()
          }
        } catch (e) {
          setErr(String(e))
        }
      },
      onCancel: () => setRenaming(null),
    })
  }

  // 删除
  async function handleDelete(node: TreeNode): Promise<void> {
    if (!confirm(`确认删除「${node.name}」？${node.isDir ? '（文件夹下所有内容将被删除）' : ''}`)) return
    try {
      await window.pupurin.deleteFile(projectPath, node.path)
      await refreshAll()
      if (selectedFile?.path === node.path) {
        setSelectedFile(null)
        useResourcePreview.getState().clear()
      }
    } catch (e) {
      setErr(String(e))
    }
  }

  // 标记为故事/代码
  async function handleSetStoryMark(node: TreeNode, mark: 'story' | 'code'): Promise<void> {
    try {
      await window.pupurin.setStoryMark(projectPath, node.path, mark)
      setContextMenu(null)
      await refreshAll()
      if (selectedFile?.path === node.path) {
        setSelectedFile({ ...selectedFile, isStoryFile: mark === 'story' })
      }
    } catch (e) {
      setErr(String(e))
    }
  }

  // 检查非 ASCII 文件名（Ren'Py 要求 ASCII，否则安卓加载失败）
  async function handleCheckNonAscii(): Promise<void> {
    if (!projectPath) return
    setErr(null)
    try {
      const items = await window.pupurin.scanNonAsciiFiles(projectPath)
      setNonAsciiCount(items.length)
      if (items.length === 0) {
        alert('未发现非 ASCII 文件名，项目已兼容安卓等移动平台。')
        return
      }
      setNonAsciiItems(items)
      setNonAsciiOpen(true)
    } catch (e) {
      setErr(String(e))
    }
  }

  // 重命名应用后重新扫描，刷新按钮的警示状态
  async function refreshNonAsciiCount(): Promise<void> {
    if (!projectPath) return
    try {
      const items = await window.pupurin.scanNonAsciiFiles(projectPath)
      setNonAsciiCount(items.length)
    } catch {
      /* ignore */
    }
  }

  // ---- 拖拽 ----
  const dragNode = useRef<TreeNode | null>(null)
  const [dragOverPath, setDragOverPath] = useState<string | null>(null)
  const treeRef = useRef<HTMLDivElement>(null)
  const browserRef = useRef<HTMLDivElement>(null)

  function onDragStart(e: React.DragEvent, node: TreeNode): void {
    dragNode.current = node
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', node.path)
  }

  // 绑定拖拽事件到区域：getDefaultDest 表示拖到空白处时的目标目录
  function bindDnD(el: HTMLElement, getDefaultDest: () => string): () => void {
    const handleOver = (e: DragEvent): void => {
      const dt = e.dataTransfer
      if (!dt) return
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-dir-path]')
      const src = dragNode.current
      if (src) {
        // 项目内移动：允许拖到任意非自身文件夹，或拖到空白处（默认目录）
        e.preventDefault()
        const dest = row ? row.dataset.dirPath ?? '' : getDefaultDest()
        if (dest !== src.path && !dest.startsWith(src.path + '/')) {
          dt.dropEffect = 'move'
          setDragOverPath(dest)
        } else {
          setDragOverPath(null)
        }
      } else {
        // 外部文件导入
        e.preventDefault()
        dt.dropEffect = 'copy'
      }
    }

    const handleLeave = (e: DragEvent): void => {
      if (!el.contains(e.relatedTarget as Node)) setDragOverPath(null)
    }

    const handleDrop = (e: DragEvent): void => {
      const dt = e.dataTransfer
      if (!dt) return
      const row = (e.target as HTMLElement).closest<HTMLElement>('[data-dir-path]')
      setDragOverPath(null)
      const src = dragNode.current
      dragNode.current = null
      if (src) {
        // 项目内移动：无目标行时视为移动到默认目录
        const dest = row ? row.dataset.dirPath ?? '' : getDefaultDest()
        if (dest === src.path || dest.startsWith(src.path + '/')) return
        e.preventDefault()
        void (async () => {
          try {
            await window.pupurin.moveFile(projectPath, src.path, dest)
            await refreshAll()
          } catch (e2) {
            setErr(String(e2))
          }
        })()
      } else {
        // 外部文件导入到目标文件夹（无目标则导入默认目录）
        const files = Array.from(dt.files)
        if (files.length === 0) return
        e.preventDefault()
        const destDir = row ? row.dataset.dirPath ?? '' : getDefaultDest()
        void (async () => {
          try {
            for (const f of files) {
              await window.pupurin.importFile(projectPath, destDir, (f as unknown as { path: string }).path)
            }
            await refreshAll()
          } catch (e2) {
            setErr(String(e2))
          }
        })()
      }
    }

    el.addEventListener('dragover', handleOver)
    el.addEventListener('dragleave', handleLeave)
    el.addEventListener('drop', handleDrop)
    return () => {
      el.removeEventListener('dragover', handleOver)
      el.removeEventListener('dragleave', handleLeave)
      el.removeEventListener('drop', handleDrop)
    }
  }

  useEffect(() => {
    const cleanup: Array<() => void> = []
    if (treeRef.current) cleanup.push(bindDnD(treeRef.current, () => ''))
    if (browserRef.current) cleanup.push(bindDnD(browserRef.current, () => currentDir))
    return () => cleanup.forEach((fn) => fn())
  }, [projectPath, currentDir, tree, loadTree, loadDir])

  // 面包屑路径
  const crumbs = currentDir ? currentDir.split('/').filter(Boolean) : []

  return (
    <div className="flex h-full" onClick={() => setContextMenu(null)}>
      {/* 左侧：目录树 */}
      <aside className="w-56 flex-shrink-0 border-r border-loom-border flex flex-col">
        <div className="flex items-center justify-between px-3 h-8 border-b border-loom-border bg-loom-panel2">
          <span className="text-xs font-semibold text-loom-text">目录</span>
          <button
            onClick={refreshAll}
            title="刷新"
            className="p-1 rounded text-loom-muted hover:text-loom-accent hover:bg-loom-panel"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <path d="M23 4v6h-6M1 20v-6h6" />
              <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
            </svg>
          </button>
        </div>

        {err && (
          <div className="px-3 py-2 bg-loom-err/10 text-loom-err text-xs">{err}</div>
        )}

        <div ref={treeRef} className="flex-1 overflow-auto py-1">
          {tree.length === 0 && (
            <div className="text-loom-muted/60 text-xs px-3 py-4 text-center">空目录</div>
          )}
          {tree.map((node) => (
            <TreeItem
              key={node.path}
              node={node}
              depth={0}
              selectedFile={selectedFile}
              expanded={expandedPaths.has(node.path)}
              onToggleDir={toggleDir}
              onSelect={(n) => { setSelectedFile(n); void previewFile(n) }}
              onToggle={loadChildren}
              onNavigate={(n) => void loadDir(n.path)}
              onOpen={handleFileOpen}
              onContextMenu={onContextMenu}
              onDragStart={onDragStart}
              onRename={(n) => { setRenaming(n); handleRename() }}
              dragOverPath={dragOverPath}
            />
          ))}
        </div>
      </aside>

      {/* 右侧：文件浏览器（放大预览覆盖此区域，左栏目录树保持可见） */}
      <div className="flex-1 min-w-0 flex flex-col relative">
        {/* 工具栏：面包屑 + 操作 */}
        <div className="flex items-center gap-1 px-2 h-10 border-b border-loom-border bg-loom-panel2 text-xs">
          <button
            onClick={() => { if (currentDir) void loadDir(currentDir.split('/').slice(0, -1).join('/')) }}
            disabled={!currentDir}
            title="上一级"
            className="p-1 rounded text-loom-muted hover:text-loom-accent hover:bg-loom-panel disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-loom-muted"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
              <path d="M19 12H5M12 19l-7-7 7-7" />
            </svg>
          </button>

          <button
            onClick={() => void loadDir('')}
            className={[
              'px-1.5 py-0.5 rounded font-mono transition-colors',
              currentDir === '' ? 'text-loom-accent' : 'text-loom-muted hover:text-loom-text'
            ].join(' ')}
          >
            game
          </button>
          {crumbs.map((c, i) => (
            <Fragment key={i}>
              <span className="text-loom-muted/50">/</span>
              <button
                onClick={() => void loadDir(crumbs.slice(0, i + 1).join('/'))}
                className="px-1.5 py-0.5 rounded font-mono text-loom-muted hover:text-loom-text transition-colors max-w-[140px] truncate"
                title={crumbs.slice(0, i + 1).join('/')}
              >
                {c}
              </button>
            </Fragment>
          ))}

          <div className="ml-auto flex items-center gap-0.5">
            <button
              onClick={() => handleCreate(currentDir, 'file')}
              title="新建文件"
              className="p-1 rounded text-loom-muted hover:text-loom-accent hover:bg-loom-panel"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6" />
              </svg>
            </button>
            <button
              onClick={() => handleCreate(currentDir, 'folder')}
              title="新建文件夹"
              className="p-1 rounded text-loom-muted hover:text-loom-accent hover:bg-loom-panel"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
              </svg>
            </button>
            <button
              onClick={() => void handleImport(currentDir)}
              title="导入文件"
              className="p-1 rounded text-loom-muted hover:text-loom-accent hover:bg-loom-panel"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12" />
              </svg>
            </button>
            <button
              onClick={() => void handleCheckNonAscii()}
              title={
                nonAsciiCount > 0
                  ? `发现 ${nonAsciiCount} 个不合规文件名，点击检查并修复`
                  : '检查文件名（非 ASCII 文件名会导致安卓加载失败）'
              }
              className={`p-1 rounded transition-colors ${
                nonAsciiCount > 0
                  ? 'text-loom-err hover:bg-loom-err/10'
                  : 'text-loom-muted hover:text-loom-accent hover:bg-loom-panel'
              }`}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M9 15l2 2 4-4" />
              </svg>
            </button>
            <button
              onClick={refreshAll}
              title="刷新"
              className="p-1 rounded text-loom-muted hover:text-loom-accent hover:bg-loom-panel"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="13" height="13">
                <path d="M23 4v6h-6M1 20v-6h6" />
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" />
              </svg>
            </button>
          </div>
        </div>

        {/* 内容区：文件网格 + 预览 */}
        <div className="flex flex-1 min-h-0">
          <div ref={browserRef} className="flex-1 overflow-auto p-3">
            {loading && <div className="text-loom-muted text-xs">加载中…</div>}
            {!loading && entries.length === 0 && (
              <div className="text-loom-muted/60 text-xs flex flex-col items-center justify-center h-full gap-1">
                <span>空文件夹</span>
                <span className="text-[10px]">可右键新建，或拖拽文件到此处导入</span>
              </div>
            )}
            {!loading && entries.length > 0 && (
              <div className="flex flex-wrap gap-2 content-start">
                {entries.map((node) => {
                  const isSelected = selectedFile?.path === node.path
                  const isDragOver = node.isDir && dragOverPath === node.path
                  return (
                    <button
                      key={node.path}
                      data-dir-path={node.isDir ? node.path : undefined}
                      draggable
                      onDragStart={(e) => onDragStart(e, node)}
                      onClick={() => { setSelectedFile(node); if (!node.isDir) void previewFile(node) }}
                      onDoubleClick={() => { if (node.isDir) void loadDir(node.path); else handleFileOpen(node) }}
                      onContextMenu={(e) => onContextMenu(e, node)}
                      className={[
                        'flex flex-col items-center gap-1.5 w-[86px] p-2 rounded border transition-colors text-left',
                        isSelected ? 'bg-loom-accent/15 border-loom-accent/50' : 'border-transparent hover:bg-loom-panel2',
                        isDragOver ? 'bg-loom-accent/20 ring-1 ring-loom-accent' : '',
                      ].join(' ')}
                      title={`${node.path}${isRpy(node.name) ? (node.isStoryFile ? ' · 故事文件' : ' · 代码文件') : ''}`}
                    >
                      <FileIcon node={node} size={30} />
                      <span className="text-[11px] text-loom-text truncate w-full text-center">{node.name}</span>
                      {isRpy(node.name) && (
                        <span
                          className={[
                            'px-1 py-px rounded text-[9px] font-mono leading-none',
                            node.isStoryFile ? 'bg-loom-accent/15 text-loom-accent' : 'bg-loom-border/40 text-loom-muted'
                          ].join(' ')}
                        >
                          {node.isStoryFile ? '故事' : '代码'}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* 放大预览（覆盖右区，保留左栏目录树） */}
        {zoomNode && (
          <div className="absolute inset-0 z-40 bg-loom-bg/95 flex flex-col">
            <div className="flex items-center gap-2 px-3 h-10 bg-loom-panel2 border-b border-loom-border">
              <span className="text-xs text-loom-accent font-mono truncate">{zoomNode.path}</span>
              <button
                onClick={closeZoom}
                title="关闭"
                className="ml-auto p-1 rounded text-loom-muted hover:text-loom-err hover:bg-loom-err/10 transition-colors"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="flex-1 overflow-auto p-4 flex items-start justify-center">
              {!zoomPreview && <div className="text-loom-muted text-xs mt-4">加载中…</div>}
              {zoomPreview?.type === 'image' && (
                <img
                  src={zoomPreview.content}
                  alt={zoomNode.name}
                  className="max-w-full object-contain rounded border border-loom-border"
                />
              )}
              {zoomPreview?.type === 'text' && (
                <pre className="text-sm text-loom-text font-mono whitespace-pre-wrap break-all w-full">
                  {zoomPreview.content}
                </pre>
              )}
              {zoomPreview?.type === 'binary' && (
                <div className="text-loom-muted text-sm mt-4">二进制文件，无法预览</div>
              )}
            </div>
          </div>
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
              >新建文件</button>
              <button
                onClick={() => { handleCreate(contextMenu.node.path, 'folder'); setContextMenu(null) }}
                className="block w-full text-left px-3 py-1.5 hover:bg-loom-panel text-loom-text"
              >新建文件夹</button>
              <button
                onClick={() => { void handleImport(contextMenu.node.path); setContextMenu(null) }}
                className="block w-full text-left px-3 py-1.5 hover:bg-loom-panel text-loom-text"
              >导入文件</button>
              <div className="border-t border-loom-border my-1" />
            </>
          )}
          {!contextMenu.node.isDir && isRpy(contextMenu.node.name) && (
            <>
              <button
                onClick={() => { void handleSetStoryMark(contextMenu.node, 'story') }}
                className={[
                  'block w-full text-left px-3 py-1.5 hover:bg-loom-panel',
                  contextMenu.node.isStoryFile ? 'text-loom-accent' : 'text-loom-text'
                ].join(' ')}
              >
                {contextMenu.node.isStoryFile ? '✓ ' : ''}标记为故事
              </button>
              <button
                onClick={() => { void handleSetStoryMark(contextMenu.node, 'code') }}
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
            onClick={() => {
              setRenaming(contextMenu.node)
              setRenameValue(contextMenu.node.name)
              setContextMenu(null)
              handleRename()
            }}
            className="block w-full text-left px-3 py-1.5 hover:bg-loom-panel text-loom-text"
          >重命名</button>
          <button
            onClick={() => { void handleDelete(contextMenu.node); setContextMenu(null) }}
            className="block w-full text-left px-3 py-1.5 hover:bg-loom-err/20 text-loom-err"
          >删除</button>
        </div>
      )}

      {/* 统一输入弹窗（替代 window.prompt） */}
      <PromptDialog
        open={!!promptCfg}
        title={promptCfg?.title ?? ''}
        placeholder={promptCfg?.placeholder}
        defaultValue={promptCfg?.defaultValue}
        monospace
        onConfirm={async (v) => {
          const cfg = promptCfg
          const t = v.trim()
          if (t && cfg) {
            setPromptCfg(null)
            await cfg.onSubmit(t)
          }
        }}
        onCancel={cancelPrompt}
      />

      {/* 非 ASCII 文件名检查/修复弹窗 */}
      {nonAsciiOpen && nonAsciiItems && (
        <NonAsciiRenameDialog
          projectPath={projectPath}
          items={nonAsciiItems}
          onClose={() => setNonAsciiOpen(false)}
          onApplied={() => {
            void refreshAll()
            void refreshNonAsciiCount()
          }}
        />
      )}
    </div>
  )
}

// 文件/文件夹图标（区分故事文件 / 代码文件）
function FileIcon({ node, size }: { node: TreeNode; size: number }): JSX.Element {
  if (node.isDir) {
    return (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width={size} height={size} className="text-loom-accent flex-shrink-0">
        <path d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V7z" />
      </svg>
    )
  }
  if (isRpy(node.name)) {
    return node.isStoryFile ? (
      // 故事文件：书页 + 文本行
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width={size} height={size} className="text-loom-accent flex-shrink-0">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M8 13h8M8 17h5" strokeWidth="1.4" />
      </svg>
    ) : (
      // 代码文件：书页 + 尖括号
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width={size} height={size} className="text-loom-muted flex-shrink-0">
        <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
        <path d="M14 2v6h6" />
        <path d="M9 13l-2 2 2 2M15 13l2 2-2 2" strokeWidth="1.4" />
      </svg>
    )
  }
  // 其他文件
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width={size} height={size} className="text-loom-muted flex-shrink-0">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

interface TreeItemProps {
  node: TreeNode
  depth: number
  selectedFile: TreeNode | null
  expanded: boolean
  onToggleDir: (n: TreeNode) => void
  onSelect: (n: TreeNode) => void
  onToggle: (n: TreeNode) => void
  onNavigate: (n: TreeNode) => void
  onOpen: (n: TreeNode) => void
  onContextMenu: (e: React.MouseEvent, n: TreeNode) => void
  onDragStart: (e: React.DragEvent, n: TreeNode) => void
  onRename: (n: TreeNode) => void
  dragOverPath: string | null
}

function TreeItem(props: TreeItemProps): JSX.Element {
  const { node, depth, selectedFile, expanded, onToggleDir, onSelect, onToggle, onNavigate, onOpen, onContextMenu, onDragStart, onRename, dragOverPath } = props
  const isSelected = selectedFile?.path === node.path
  const isDragOver = node.isDir && dragOverPath === node.path

  useEffect(() => {
    if (node.isDir && expanded && !node.loaded) void onToggle(node)
  }, [expanded, node.isDir, node.loaded, onToggle])

  function handleClick(): void {
    if (node.isDir) {
      // 点击文件夹：切换展开 + 导航到该目录
      onToggleDir(node)
      onNavigate(node)
    } else {
      onSelect(node)
    }
  }

  return (
    <>
      <div
        data-dir-path={node.isDir ? node.path : undefined}
        className={[
          'flex items-center gap-1.5 px-2 py-1 cursor-pointer text-sm',
          isSelected ? 'bg-loom-accent/15 text-loom-accent' : 'text-loom-text hover:bg-loom-panel2',
          isDragOver ? 'bg-loom-accent/20 ring-1 ring-loom-accent' : '',
        ].join(' ')}
        style={{ paddingLeft: depth * 14 + 8 }}
        onClick={handleClick}
        onDoubleClick={() => { if (!node.isDir) onOpen(node) }}
        onContextMenu={(e) => onContextMenu(e, node)}
        draggable
        onDragStart={(e) => onDragStart(e, node)}
      >
        {node.isDir ? (
          <svg
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            width="10"
            height="10"
            className={`text-loom-muted transition-transform flex-shrink-0 ${expanded ? 'rotate-90' : ''}`}
            onClick={(e) => { e.stopPropagation(); onToggleDir(node) }}
          >
            <path d="M6 3l5 5-5 5" />
          </svg>
        ) : (
          <span className="w-[10px] flex-shrink-0" />
        )}
        <FileIcon node={node} size={14} />
        <span className="truncate flex-1">{node.name}</span>
        {node.isDir && node.children && node.children.length > 0 && (
          <span className="text-[10px] text-loom-muted font-mono">{node.children.length}</span>
        )}
      </div>
      {node.isDir && expanded && node.children && node.children.map((child) => (
        <TreeItem key={child.path} {...props} node={child} depth={depth + 1} />
      ))}
    </>
  )
}
