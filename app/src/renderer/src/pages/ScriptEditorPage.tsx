import { useEffect, useState, useCallback, useRef } from 'react'
import Editor from '@monaco-editor/react'
import { useStore } from '../store/useStore'
import { usePreferences } from '../store/preferences'
import { beforeMount as registerRenpy } from '../monaco-renpy'
import DialogueView from '../components/DialogueView'
import StoryFileTree from '../components/StoryFileTree'
import { parseSource } from '../api/client'
import type { RpyFileNode } from '../types'

// 对话行角色名：行首缩进 + 角色名（标识符 或 带引号的显示名）+ 引号开头的对话内容
const DIALOG_NAME_RE = /^(\s*)(?:"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([A-Za-z_]\w*))(\s*)(["'])/
// Ren'Py 语句关键字（后跟字符串但不是角色名），不参与角色着色
const NON_CHAR_KEYWORDS = new Set(['voice', 'play', 'queue', 'stop', 'extend', 'centered'])

export default function ScriptEditorPage() {
  const labels = useStore((s) => s.labels)
  const themeMode = usePreferences((s) => s.mode)
  const editorFontSize = usePreferences((s) => s.editorFontSize)
  const source = useStore((s) => s.source)
  const setSource = useStore((s) => s.setSource)
  const editorViewMode = useStore((s) => s.editorViewMode)
  const setEditorViewMode = useStore((s) => s.setEditorViewMode)
  const selectedLabelId = useStore((s) => s.selectedLabelId)
  const setSourceModified = useStore((s) => s.setSourceModified)
  const sourceModified = useStore((s) => s.sourceModified)
  const currentFilePath = useStore((s) => s.currentFilePath)
  const setCurrentFilePath = useStore((s) => s.setCurrentFilePath)
  const setParse = useStore((s) => s.setParse)
  const currentProject = useStore((s) => s.currentProject)
  const pendingNav = useStore((s) => s.pendingNav)
  const setPendingNav = useStore((s) => s.setPendingNav)
  const pendingOpenFile = useStore((s) => s.pendingOpenFile)
  const setPendingOpenFile = useStore((s) => s.setPendingOpenFile)
  const selectLabel = useStore((s) => s.selectLabel)
  const setSelection = useStore((s) => s.setSelection)
  const searchNav = useStore((s) => s.searchNav)
  const setSearchNav = useStore((s) => s.setSearchNav)

  const [rpyFiles, setRpyFiles] = useState<RpyFileNode[]>([])
  const [currentIsStory, setCurrentIsStory] = useState(true)
  const [loading, setLoading] = useState(false)
  // 新建章节弹窗
  const [newChapterOpen, setNewChapterOpen] = useState(false)
  const [newChapterName, setNewChapterName] = useState('')

  const projectPath = currentProject?.path ?? ''

  // 对话角色名着色（Monaco decorations，统一白色）
  const editorRef = useRef<any>(null)
  const decorationsRef = useRef<any>(null)
  const contentDisposableRef = useRef<any>(null)
  const applyRef = useRef<() => void>(() => {})
  const applyTimerRef = useRef<number | null>(null)
  // 全局搜索高亮（独立 decorations collection）
  const searchDecosRef = useRef<any>(null)
  // 编辑器尚未挂载时的待处理搜索高亮（切视图后 Monaco 异步挂载）
  const pendingSearchRef = useRef<{ line: number; col: number; text: string } | null>(null)
  const searchTimerRef = useRef<number | null>(null)

  // 加载文件树
  const refreshFiles = useCallback(async () => {
    if (!projectPath) return
    try {
      const files = await window.pupurin.listRpyFiles(projectPath)
      setRpyFiles(files)
    } catch (e) {
      console.error('listRpyFiles failed:', e)
    }
  }, [projectPath])

  useEffect(() => {
    void refreshFiles()
  }, [refreshFiles])

  // 切换文件：加载内容 → 解析（如果是故事文件）→ 更新状态
  const handleSelectFile = useCallback(
    async (node: RpyFileNode) => {
      if (node.path === currentFilePath) return
      if (!projectPath) return

      setLoading(true)
      try {
        // 加载文件内容
        const content = await window.pupurin.readFile(projectPath, node.path)
        setSource(content)
        setCurrentFilePath(node.path)
        setSourceModified(false)
        setCurrentIsStory(node.isStoryFile)
        useStore.getState().setIsStoryFile(node.isStoryFile)

        if (node.isStoryFile) {
          // 故事文件：解析 label
          const r = await parseSource(content)
          setParse(r)
          // 保持当前视图模式（或默认图形）
          if (editorViewMode !== 'graphical' && editorViewMode !== 'code') {
            setEditorViewMode('graphical')
          }
        } else {
          // 代码文件：强制代码视图
          setParse({ labels: [], edges: [], full_source: content, dialogue_chars: 0 })
          setEditorViewMode('code')
        }
      } catch (e) {
        console.error('load file failed:', e)
      } finally {
        setLoading(false)
      }
    },
    [projectPath, currentFilePath, setSource, setCurrentFilePath, setSourceModified, setCurrentIsStory, setParse, setEditorViewMode, editorViewMode]
  )

  // 从资源管理器打开文件：加载并选中
  useEffect(() => {
    if (!pendingOpenFile || !projectPath) return
    const f = pendingOpenFile
    setPendingOpenFile(null)
    void handleSelectFile({ name: f.path.split('/').pop() ?? f.path, path: f.path, isDir: false, isStoryFile: f.isStoryFile })
  }, [pendingOpenFile, projectPath, setPendingOpenFile, handleSelectFile])

  // 进入织机-故事文件时自动展开右侧「属性」功能栏（切到代码文件时由功能栏隐藏图标并自动收起）
  useEffect(() => {
    if (currentIsStory) {
      useStore.getState().openSidebar('script-props')
    }
  }, [currentIsStory])

  // 全局搜索跳转：高亮目标行文本（Monaco 未挂载时暂存，挂载后再执行）
  const applySearchHighlight = useCallback((line: number, col: number, text: string): void => {
    const editor = editorRef.current
    const model = editor?.getModel?.()
    if (!editor || !model) {
      pendingSearchRef.current = { line, col, text }
      return
    }
    pendingSearchRef.current = null
    const range = {
      startLineNumber: line,
      startColumn: col,
      endLineNumber: line,
      endColumn: Math.max(col + 1, col + (text?.length || 1)),
    }
    searchDecosRef.current?.clear()
    searchDecosRef.current?.set([{ range, options: { inlineClassName: 'loom-search-match' } }])
    editor.setSelection(range)
    editor.revealLineInCenter(line)
    editor.focus()
    // 高亮 3 秒后自动清除（选区保留）
    if (searchTimerRef.current) window.clearTimeout(searchTimerRef.current)
    searchTimerRef.current = window.setTimeout(() => {
      searchDecosRef.current?.clear()
      searchTimerRef.current = null
    }, 3000)
  }, [])

  useEffect(() => {
    if (!searchNav || !projectPath) return
    const nav = searchNav
    setSearchNav(null)
    void (async () => {
      try {
        if (nav.file !== currentFilePath) {
          const content = await window.pupurin.readFile(projectPath, nav.file)
          setSource(content)
          setCurrentFilePath(nav.file)
          setSourceModified(false)
          setCurrentIsStory(nav.isStoryFile)
          if (nav.isStoryFile) {
            const r = await parseSource(content)
            setParse(r)
          } else {
            setParse({ labels: [], edges: [], full_source: content, dialogue_chars: 0 })
          }
        }
        setEditorViewMode('code')
        applySearchHighlight(nav.line, nav.col, nav.text)
      } catch (e) {
        console.error('搜索跳转失败:', e)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchNav, projectPath])

  // 图形视图的滚动定位目标（文件绝对行号 + 时间戳，重复点击同场景也能重新滚动）。
  // 选中场景 / 跨文件跳转时设置，DialogueView 收到后会滚动到对应块。
  const [focusLine, setFocusLine] = useState<{ line: number; ts: number } | null>(null)

  // 选中场景（右侧列表 / 流程图点击 / 跨文件定位）时滚动到该 label 行
  useEffect(() => {
    if (!selectedLabelId) return
    const l = labels.find((x) => x.id === selectedLabelId)
    if (l) setFocusLine({ line: l.line, ts: Date.now() })
  }, [selectedLabelId, labels])

  // 跨文件导航：从右侧场景列表 / 变量反向引用发起，自动切换文件并定位 label
  useEffect(() => {
    if (!pendingNav || !projectPath) return
    const { file, line } = pendingNav
    setPendingNav(null)
    void (async () => {
      try {
        if (file !== currentFilePath) {
          const content = await window.pupurin.readFile(projectPath, file)
          setSource(content)
          setCurrentFilePath(file)
          setSourceModified(false)
          setCurrentIsStory(true)
          const r = await parseSource(content)
          setParse(r)
          setEditorViewMode('graphical')
        }
        // 定位到包含目标行的 label（zustand set 同步生效，getState 拿到的即最新）
        const currentLabels = useStore.getState().labels
        const target = currentLabels.find((l) => l.line <= line && line <= l.end_line)
        if (target) {
          selectLabel(target.id)
          setSelection({ type: 'label', id: target.id })
        } else {
          selectLabel(null)
          setSelection({ type: null, id: null })
        }
        // 滚动到目标行（可能是 label 行，也可能是 label 内的某一行）
        setFocusLine({ line, ts: Date.now() })
      } catch (e) {
        console.error('跨文件导航失败:', e)
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingNav])

  // 从这里开始玩：先强制保存（行号才准确），再以 --warp 从指定行启动
  const playFromLine = useCallback(
    async (absLine: number): Promise<void> => {
      if (!projectPath || !currentFilePath) return
      try {
        if (sourceModified) {
          await window.pupurin.saveRpyFile(projectPath, currentFilePath, source)
          setSourceModified(false)
        }
        const result = await window.pupurin.runGameFromLine(projectPath, currentFilePath, absLine)
        if (!result.success) {
          useStore.getState().setError(result.error ?? '启动失败')
        }
      } catch (e) {
        useStore.getState().setError('从这里开始玩失败：' + String(e))
      }
    },
    [projectPath, currentFilePath, source, sourceModified]
  )

  // 新建章节文件
  const handleNewChapter = useCallback(async (): Promise<void> => {
    const name = newChapterName.trim()
    if (!name || !projectPath) return
    setNewChapterOpen(false)
    setNewChapterName('')

    // 文件名/label 名只保留 ASCII 标识符字符
    const safe = name.replace(/[^A-Za-z0-9_]/g, '') || 'chapter'
    const base = /^[0-9]/.test(safe) ? `c_${safe}` : safe
    // 避免重名：追加序号
    const taken = new Set<string>()
    const collect = (nodes: RpyFileNode[]): void => {
      for (const n of nodes) {
        taken.add(n.path)
        if (n.children) collect(n.children)
      }
    }
    collect(rpyFiles)
    let fileName = `${base}.rpy`
    let counter = 2
    while (taken.has(fileName)) {
      fileName = `${base}${counter}.rpy`
      counter++
    }

    const content = [
      `# ${name} — 新章节`,
      '',
      `label ${base}:`,
      '',
      '    "这里是新章节的开始。"',
      '    jump start',
      '',
    ].join('\n')

    await window.pupurin.createFile(projectPath, fileName, content)
    await refreshFiles()
    // 直接打开新章节
    await handleSelectFile({ name: fileName, path: fileName, isDir: false, isStoryFile: true })
  }, [newChapterName, projectPath, rpyFiles, refreshFiles, handleSelectFile])

  // 代码编辑器内容变化
  function handleEditorChange(value: string | undefined): void {
    if (value === undefined) return
    if (value !== source) {
      setSource(value)
      setSourceModified(true)
    }
  }

  // === 对话角色名着色（统一白色）===
  // 根据当前编辑器内容重建装饰：所有对话行角色名均显示白色
  const buildCharDecorations = useCallback((): void => {
    const editor = editorRef.current
    const model = editor?.getModel?.()
    if (!editor || !model || !decorationsRef.current) return

    const decos: any[] = []
    const lines = model.getLinesContent()
    for (let i = 0; i < lines.length; i++) {
      const m = DIALOG_NAME_RE.exec(lines[i])
      if (!m) continue
      const key = (m[2] ?? m[3] ?? m[4]).toLowerCase()
      if (NON_CHAR_KEYWORDS.has(key)) continue
      const nameText = m[2] !== undefined ? `"${m[2]}"` : m[3] !== undefined ? `'${m[3]}'` : m[4]
      const nameStart = m[1].length
      decos.push({
        // 用纯 IRange 对象，不依赖 monaco 命名空间
        range: {
          startLineNumber: i + 1,
          startColumn: nameStart + 1,
          endLineNumber: i + 1,
          endColumn: nameStart + 1 + nameText.length,
        },
        options: { inlineClassName: 'loom-cc-unknown' }
      })
    }
    decorationsRef.current.set(decos)
  }, [])

  // 保持最新构建函数引用，供内容变化回调调用
  applyRef.current = buildCharDecorations

  const scheduleApply = useCallback((): void => {
    if (applyTimerRef.current) window.clearTimeout(applyTimerRef.current)
    applyTimerRef.current = window.setTimeout(() => {
      applyTimerRef.current = null
      applyRef.current()
    }, 100)
  }, [])

  // 编辑器挂载：记录实例并订阅内容变化
  function handleEditorMount(editor: any): void {
    editorRef.current = editor
    const model = editor.getModel()
    contentDisposableRef.current?.dispose()
    contentDisposableRef.current = model.onDidChangeContent(() => scheduleApply())
    if (!decorationsRef.current) {
      // monaco 0.55+ 中 createDecorationsCollection 是编辑器实例方法（单参数），
      // 命名空间上的静态版本已不存在
      decorationsRef.current = editor.createDecorationsCollection([])
    }
    if (!searchDecosRef.current) {
      searchDecosRef.current = editor.createDecorationsCollection([])
    }
    applyRef.current()
    // 若有待处理的搜索高亮（从图形视图切到代码视图，Monaco 异步挂载完成），立即执行
    if (pendingSearchRef.current) {
      const p = pendingSearchRef.current
      pendingSearchRef.current = null
      applySearchHighlight(p.line, p.col, p.text)
    }
  }

  // 挂载时写入白色样式规则 + 初次重算装饰
  useEffect(() => {
    let styleEl = document.getElementById('loom-char-color-styles') as HTMLStyleElement | null
    if (!styleEl) {
      styleEl = document.createElement('style')
      styleEl.id = 'loom-char-color-styles'
      document.head.appendChild(styleEl)
    }
    styleEl.textContent = '.loom-cc-unknown { color: #ffffff !important; }'
    applyRef.current()
    return () => {
      styleEl?.remove()
    }
  }, [])

  // 卸载清理：编辑器与 model 由 @monaco-editor/react 卸载时自动销毁，
  // decorations collection（无 dispose 方法）与内容订阅随之释放，仅清空引用
  useEffect(() => {
    return () => {
      contentDisposableRef.current?.dispose()
      contentDisposableRef.current = null
      decorationsRef.current = null
    }
  }, [])

  return (
    <div className="flex h-full">
      {/* 左侧：文件树 */}
      <aside className="w-56 flex-shrink-0 border-r border-loom-border">
        <StoryFileTree
          files={rpyFiles}
          selectedPath={currentFilePath}
          projectPath={projectPath}
          onSelect={(node) => void handleSelectFile(node)}
          onNewChapter={() => setNewChapterOpen(true)}
          onRefresh={refreshFiles}
        />
      </aside>

      {/* 中间：编辑区 */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* 工具栏 */}
        <div className="flex items-center gap-2 px-3 h-10 bg-loom-panel2 border-b border-loom-border text-xs">
          <span className="text-loom-accent font-mono truncate max-w-[200px]">
            {currentFilePath}
          </span>
          {currentIsStory && (
            <>
              <span className="text-loom-muted">·</span>
              <span className="text-loom-muted">{labels.length} 场景</span>
            </>
          )}
          {!currentIsStory && (
            <span className="text-loom-muted text-[10px] px-1.5 py-0.5 rounded bg-loom-bg border border-loom-border">
              代码文件
            </span>
          )}

          <div className="ml-auto flex items-center gap-1">
            {loading && (
              <span className="text-[10px] text-loom-muted font-mono">加载中…</span>
            )}
            {sourceModified && (
              <span className="px-1.5 py-0.5 rounded bg-loom-err/20 text-loom-err text-[10px] font-mono">
                ● 未保存
              </span>
            )}
            {/* 视图切换：仅故事文件显示 */}
            {currentIsStory && (
              <div className="flex items-center rounded bg-loom-bg border border-loom-border overflow-hidden">
                <button
                  onClick={() => setEditorViewMode('graphical')}
                  className={[
                    'px-2.5 py-1 text-[11px] transition-colors',
                    editorViewMode === 'graphical'
                      ? 'bg-loom-accent text-loom-bg font-semibold'
                      : 'text-loom-muted hover:text-loom-text'
                  ].join(' ')}
                >
                  图形
                </button>
                <button
                  onClick={() => setEditorViewMode('code')}
                  className={[
                    'px-2.5 py-1 text-[11px] transition-colors',
                    editorViewMode === 'code'
                      ? 'bg-loom-accent text-loom-bg font-semibold'
                      : 'text-loom-muted hover:text-loom-text'
                  ].join(' ')}
                >
                  代码
                </button>
              </div>
            )}
            <span className="text-loom-muted">L{source.split('\n').length}</span>
          </div>
        </div>

        {/* 编辑器主体 */}
        <div className="flex-1 min-h-0 relative">
          {/* 图形视图（仅故事文件） */}
          {currentIsStory && (
            <div
              className={editorViewMode === 'graphical' ? 'absolute inset-0' : 'hidden'}
            >
              <DialogueView
                source={source}
                onChange={(newSource) => {
                  // 图形视图编辑的是整个文件内容，直接回写即可
                  setSource(newSource)
                  setSourceModified(true)
                }}
                focusLine={focusLine}
                onPlayFromLine={(absLine) => void playFromLine(absLine)}
              />
            </div>
          )}

          {/* 代码视图 */}
          <div
            className={
              currentIsStory
                ? editorViewMode === 'code' ? 'absolute inset-0' : 'hidden'
                : 'absolute inset-0'
            }
          >
            <Editor
              height="100%"
              language="renpy"
              theme={themeMode === 'light' ? 'loom-light' : 'loom-dark'}
              beforeMount={registerRenpy}
              value={source}
              onChange={handleEditorChange}
              onMount={handleEditorMount}
              options={{
                readOnly: false,
                minimap: { enabled: true },
                fontSize: editorFontSize,
                lineNumbers: 'on',
                scrollBeyondLastLine: false,
                smoothScrolling: true,
                fontFamily: 'SF Mono, Menlo, Consolas, monospace',
                renderLineHighlight: 'line',
                padding: { top: 8 },
                wordWrap: 'on'
              }}
            />
          </div>
        </div>
      </div>

      {/* 新建章节弹窗 */}
      {newChapterOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => { setNewChapterOpen(false); setNewChapterName('') }}
        >
          <div
            className="w-80 rounded-lg bg-loom-panel border border-loom-border shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-loom-border">
              <span className="text-sm font-semibold text-loom-text">新建章节</span>
            </div>
            <div className="p-4">
              <input
                type="text"
                value={newChapterName}
                onChange={(e) => setNewChapterName(e.target.value)}
                placeholder="如：第一章 / 雨天事件（将生成 .rpy 文件）"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleNewChapter()
                  if (e.key === 'Escape') { setNewChapterOpen(false); setNewChapterName('') }
                }}
                className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm focus:outline-none focus:border-loom-accent"
              />
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-loom-border">
              <button
                onClick={() => { setNewChapterOpen(false); setNewChapterName('') }}
                className="px-3 py-1 text-xs rounded text-loom-muted hover:text-loom-text transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => void handleNewChapter()}
                className="px-3 py-1 text-xs rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 transition-opacity"
              >
                创建
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
