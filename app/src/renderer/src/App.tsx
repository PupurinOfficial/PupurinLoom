import { useEffect, useRef, useState } from 'react'
import { useStore, type ViewId } from './store/useStore'
import { usePreferences } from './store/preferences'
import { usePlugins } from './store/plugins'
import { useSidebarPrefs } from './store/sidebarPrefs'
import { fetchScript, parseSource, openLogSocket, parseProject } from './api/client'
import ActivityBar from './components/ActivityBar'
import FunctionBar from './components/FunctionBar'
import StatusBar from './components/StatusBar'
import ErrorBoundary from './components/ErrorBoundary'
import SettingsDialog from './components/SettingsDialog'
import HomePage from './pages/HomePage'
import ScriptEditorPage from './pages/ScriptEditorPage'
import CharacterPage from './pages/CharacterPage'
import VariablePage from './pages/VariablePage'
import ResourceManager from './pages/ResourceManager'
import PackagePage from './pages/PackagePage'
import PluginsPage from './pages/PluginsPage'
import UiDesignerPage from './pages/UiDesignerPage'
import ProjectPicker from './pages/ProjectPicker'
import ToastHost from './components/ToastHost'
import SearchDialog from './components/SearchDialog'
import { useUiDesigner } from './uiDesigner/uiDesignerStore'
import type { LogEntry } from './types'
import logoUrl from './assets/pupurin-logo.png'

const PAGE_TITLES: Record<ViewId, string> = {
  home: '主页',
  flowchart: '流程图',
  script: '织机',
  characters: '角色',
  variables: '变量',
  package: '打包',
  resources: '资源管理器',
  plugins: '插件',
  ui: 'UI 设计器',
}

// IDE 主界面（选中项目后渲染）。用 key={project.id} 强制 remount，切项目时彻底重置。
function Ide({ projectPath }: { projectPath: string }) {
  const activeView = useStore((s) => s.activeView)
  const setActiveView = useStore((s) => s.setActiveView)
  const currentProject = useStore((s) => s.currentProject)
  const setCurrentProject = useStore((s) => s.setCurrentProject)
  const isFullscreen = useStore((s) => s.isFullscreen)

  const setParse = useStore((s) => s.setParse)
  const setSource = useStore((s) => s.setSource)
  const setSourceModified = useStore((s) => s.setSourceModified)
  const setProjectParse = useStore((s) => s.setProjectParse)
  const setVariableUsages = useStore((s) => s.setVariableUsages)
  // 项目级脏状态：任一模块（剧本/角色/变量/UI 设计器）有未保存改动即显示红点
  const isProjectDirty = useStore(
    (s) => s.sourceModified || s.charactersDirty || s.variablesDirty || s.uiDirty
  )
  const source = useStore((s) => s.source)
  const currentFilePath = useStore((s) => s.currentFilePath)
  const addLog = useStore((s) => s.addLog)
  const setStatus = useStore((s) => s.setStatus)
  const setLoading = useStore((s) => s.setLoading)
  const setError = useStore((s) => s.setError)
  const error = useStore((s) => s.error)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [runError, setRunError] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  // 未保存确认弹窗：'close' = 关窗口 / 'back' = 返回项目列表
  const [closePrompt, setClosePrompt] = useState<'close' | 'back' | null>(null)
  // 防重入：弹窗已打开时忽略重复的关闭/返回请求
  const closingRef = useRef(false)

  async function loadAll(): Promise<void> {
    setLoading(true)
    setError(null)
    try {
      const source = await fetchScript(projectPath)
      setSource(source)
      const r = await parseSource(source)
      setParse(r)
      // 聚合解析全项目（跨文件导航 / 悬空跳转 / 条件变量引用）
      try {
        const pr = await parseProject(projectPath)
        setProjectParse(pr)
        setVariableUsages(pr.variable_usages)
      } catch (e) {
        console.error('parseProject failed:', e)
      }
      setSourceModified(false)
      // 通知插件：项目已打开（事件钩子）
      usePlugins.getState().emitHook('app:projectOpened', { projectPath })
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  // 进行中的保存任务（防并发：⌘S 与「保存并关闭」同时触发时共用同一 Promise）
  const savePromiseRef = useRef<Promise<boolean> | null>(null)

  // 统一保存入口：顶栏按钮 / ⌘S / 菜单「保存」都走这里，
  // 按顺序落盘所有脏模块（剧本 → 角色 → 变量 → UI 设计器）；返回是否全部保存成功
  function saveAll(): Promise<boolean> {
    if (savePromiseRef.current) return savePromiseRef.current
    const p = doSaveAll()
    savePromiseRef.current = p
    void p.finally(() => {
      if (savePromiseRef.current === p) savePromiseRef.current = null
    })
    return p
  }

  async function doSaveAll(): Promise<boolean> {
    if (!isProjectDirty) return true
    setSaving(true)
    setError(null)
    let ok = true
    try {
      const st = useStore.getState()
      // 1. 剧本文件（先落盘，变量保存会基于磁盘上的 script.rpy 补 default 语句）
      if (st.sourceModified) {
        await window.pupurin.saveRpyFile(projectPath, currentFilePath, source)
        setSourceModified(false)
        // 通知插件：剧本已保存（事件钩子）
        usePlugins.getState().emitHook('app:saved', { file: currentFilePath, projectPath })
      }
      // 2. 角色
      if (st.charactersDirty) await st.saveCharactersNow()
      // 3. 变量（主进程同步写回 script.rpy）
      if (st.variablesDirty) await st.saveVariablesNow()
      // 4. UI 设计器（写 gui.rpy / screens.rpy）
      if (st.uiDirty) await useUiDesigner.getState().save()
    } catch (e) {
      ok = false
      setError('保存失败：' + String(e))
    } finally {
      setSaving(false)
    }
    return ok
  }

  // 返回项目列表：有未保存更改先弹窗确认
  function handleBackToProjects(): void {
    if (closingRef.current) return
    if (isProjectDirty) {
      closingRef.current = true
      setClosePrompt('back')
    } else {
      setCurrentProject(null)
    }
  }

  // 确认弹窗 → 保存并继续
  async function handlePromptSave(): Promise<void> {
    const action = closePrompt
    setClosePrompt(null)
    // 保存期间保持防重入锁；只有失败（留在当前界面）时才解锁
    const ok = await saveAll()
    if (!ok) {
      closingRef.current = false
      return // 保存失败则不继续（避免丢稿）
    }
    if (action === 'close') void window.pupurin.confirmClose()
    else setCurrentProject(null)
  }

  // 确认弹窗 → 不保存直接继续
  function handlePromptDiscard(): void {
    const action = closePrompt
    setClosePrompt(null)
    closingRef.current = false
    if (action === 'close') void window.pupurin.confirmClose()
    else setCurrentProject(null)
  }

  // 确认弹窗 → 取消
  function handlePromptCancel(): void {
    setClosePrompt(null)
    closingRef.current = false
    // 复位主进程退出流程状态（Cmd+Q 取消后，红绿灯关窗应回到「隐藏」而非继续退出）
    void window.pupurin.cancelClose()
  }

  // 运行 Ren'Py 游戏
  async function runGame(): Promise<void> {
    if (running) return // 防重入：双击「运行」不会启动第二个游戏进程
    setRunning(true)
    setRunError(null)
    try {
      const result = await window.pupurin.runGame(projectPath)
      if (!result.success) {
        setRunError(result.error ?? '启动失败')
      }
    } catch (e) {
      setRunError(String(e))
    } finally {
      setRunning(false)
    }
  }

  useEffect(() => {
    void (async () => {
      // 重新进入项目 = 全新会话：重置所有模块脏标记与编辑器状态
      // （useStore 是全局单例，不重置会导致上次会话的 currentFilePath 等残留，
      //   出现「文件树选中的文件 ≠ 编辑器展示的内容」）
      useStore.getState().setCharactersDirty(false)
      useStore.getState().setVariablesDirty(false)
      useStore.getState().setUiDirty(false)
      useStore.getState().setSourceModified(false)
      // fetchScript 固定加载 script.rpy，此处同步打开文件与选中项
      useStore.getState().setCurrentFilePath('script.rpy')
      useStore.getState().setIsStoryFile(true)
      // 清除上次会话的场景选中/滚动定位
      useStore.getState().selectLabel(null)
      useStore.getState().setSelection({ type: null, id: null })
      try {
        const st = await window.pupurin.getBackendStatus()
        setStatus(st)
      } catch {
        /* ignore */
      }
      await loadAll()
      try {
        await openLogSocket((msg) => addLog(msg as LogEntry))
      } catch (e) {
        setError('ws: ' + String(e))
      }
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // UI 设计器 store 的 modified 桥接到全局 uiDirty（顶栏红点/保存统一感知）
  useEffect(() => {
    const unsub = useUiDesigner.subscribe((s, prev) => {
      if (s.modified !== prev.modified) useStore.getState().setUiDirty(s.modified)
    })
    return unsub
  }, [])

  // 窗口关闭保护：主进程拦截 close 后询问；有未保存则弹窗确认，否则直接放行
  useEffect(() => {
    const unsub = window.pupurin.onBeforeClose(() => {
      if (closingRef.current) return // 弹窗已打开，忽略重复请求
      if (isProjectDirty) {
        closingRef.current = true
        setClosePrompt('close')
      } else {
        void window.pupurin.confirmClose()
      }
    })
    return unsub
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProjectDirty])

  // ⌘+S / Ctrl+S 保存快捷键
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault()
        void saveAll()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isProjectDirty, saving, source, currentFilePath])

  // ⌘+P / Ctrl+P 打开全局搜索
  useEffect(() => {
    const handler = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        setShowSearch(true)
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [])

  // macOS 系统菜单栏：动作分发 + 视图菜单 radio 同步
  // 用 ref 持有最新处理器，避免因闭包 state（source/saving…）频繁重注册
  const menuHandlerRef = useRef<(action: { id: string }) => void>(() => {})
  menuHandlerRef.current = ({ id }: { id: string }): void => {
    switch (id) {
      case 'backToProjects':
        handleBackToProjects()
        break
      case 'save':
        void saveAll()
        break
      case 'showInFinder':
        if (currentProject) void window.pupurin.showProjectInFinder(currentProject.path)
        break
      case 'runGame':
        void runGame()
        break
      case 'reparse':
        void loadAll()
        break
      case 'toggleTheme': {
        const m = usePreferences.getState().mode
        usePreferences.getState().setMode(m === 'dark' ? 'light' : 'dark')
        break
      }
      case 'openPluginsDir':
        void window.pupurin.openPluginsDir()
        break
      case 'openStore':
        setActiveView('plugins')
        useStore.getState().bumpStoreTab()
        break
      default:
        if (id.startsWith('view:')) setActiveView(id.slice(5) as ViewId)
    }
  }
  useEffect(() => {
    window.pupurin.setMenuView(activeView)
    return window.pupurin.onMenuAction((action) => menuHandlerRef.current(action))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeView])

  // 非全屏时给 macOS 红绿灯留出空间；全屏时红绿灯隐藏，LOGO 靠左（状态在 useStore 中跨页面共享）
  const headerPad = isFullscreen ? 'px-3' : 'pl-[80px] pr-3'

  return (
    <div className="flex flex-col h-screen bg-loom-bg">
      {/* 顶部标题栏 */}
      <header className={`flex items-center h-9 ${headerPad} bg-loom-bg border-b border-loom-border select-none`}>
        <img src={logoUrl} alt="Pupurin° Loom" className="h-6 w-auto" />
        <button
          onClick={handleBackToProjects}
          title="返回项目选择"
          className="ml-2 p-1.5 rounded text-loom-muted hover:text-loom-accent hover:bg-loom-accent/10 transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
            <path d="M19 12H5M12 19l-7-7 7-7" />
          </svg>
        </button>
        <span className="ml-1 text-xs text-loom-text font-mono truncate max-w-[200px]">
          {currentProject?.name}
          {isProjectDirty && <span className="text-loom-err ml-0.5">●</span>}
        </span>
        <span className="ml-3 text-xs text-loom-muted font-mono">
          {PAGE_TITLES[activeView]}
        </span>
        {error && (
          <span className="ml-3 text-xs text-loom-err font-mono truncate max-w-md">
            {error}
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          {/* 运行游戏 */}
          <button
            onClick={() => void runGame()}
            disabled={running}
            title="运行游戏"
            className={[
              'flex items-center gap-1 px-2 py-1 text-[11px] rounded font-medium transition-opacity',
              running
                ? 'bg-loom-panel2 text-loom-muted cursor-wait'
                : 'bg-loom-accent text-loom-bg hover:opacity-90'
            ].join(' ')}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="12" height="12">
              <polygon points="5,3 19,12 5,21" />
            </svg>
            {running ? '启动中…' : '运行'}
          </button>
          {runError && (
            <span className="text-[10px] text-loom-err px-1.5 py-0.5 rounded bg-loom-err/10">
              {runError}
            </span>
          )}
          {/* 全局搜索 */}
          <button
            onClick={() => setShowSearch(true)}
            title="搜索 (⌘+P)"
            className="p-1.5 rounded text-loom-muted hover:text-loom-accent hover:bg-loom-accent/10 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="14" height="14">
              <circle cx="11" cy="11" r="7" />
              <path d="M21 21l-4.35-4.35" />
            </svg>
          </button>
          <button
            onClick={() => void saveAll()}
            disabled={!isProjectDirty || saving}
            title="保存 (⌘+S)"
            className={[
              'px-2.5 py-1 text-[11px] rounded font-semibold transition-opacity',
              isProjectDirty
                ? 'bg-loom-accent text-loom-bg hover:opacity-90'
                : 'bg-loom-panel2 text-loom-muted cursor-not-allowed'
            ].join(' ')}
          >
            {saving ? '保存中…' : '保存'}
          </button>
          {/* 设置 */}
          <button
            onClick={() => setShowSettings(true)}
            title="设置"
            className="p-1.5 rounded text-loom-muted hover:text-loom-accent hover:bg-loom-accent/10 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      {/* 主体：ActivityBar + 视图 + 右侧功能栏 + 持久化 Console */}
      <div className="flex flex-1 min-h-0">
        <ActivityBar active={activeView} onChange={setActiveView} />

        <div className="flex-1 min-w-0 flex flex-col">
          {/* 视图容器：所有页面常驻挂载，用 display 切换可见性
              React Flow 有 ResizeObserver、Monaco 有 automaticLayout，切回时自动重新计算尺寸 */}
          <div className="flex-1 min-h-0 relative">
            {(
              [
                ['home', <HomePage key="home" />],
                ['script', <ScriptEditorPage key="script" />],
                ['characters', <CharacterPage key="characters" />],
                ['variables', <VariablePage key="variables" />],
                ['resources', <ResourceManager key="resources" />],
                ['package', <PackagePage key="package" />],
                ['plugins', <PluginsPage key="plugins" />],
                ['ui', <UiDesignerPage key="ui" />]
              ] as const
            ).map(([id, el]) => {
              const active = activeView === id
              return (
                <div
                  key={id}
                  className={active ? 'absolute inset-0' : 'hidden'}
                  aria-hidden={!active}
                >
                  <ErrorBoundary>{el}</ErrorBoundary>
                </div>
              )
            })}
          </div>
        </div>

        {/* 右侧功能栏（图标常驻，侧边栏展开在图标栏左侧） */}
        <FunctionBar />
      </div>

      <StatusBar />
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />
      <SearchDialog open={showSearch} onClose={() => setShowSearch(false)} />

      {/* 未保存确认弹窗（关窗口 / 返回项目列表共用） */}
      {closePrompt && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-xl border border-loom-border bg-loom-panel shadow-2xl p-5">
            <h3 className="text-sm font-semibold text-loom-text">有未保存的更改</h3>
            <p className="mt-2 text-xs text-loom-muted leading-relaxed">
              {closePrompt === 'close'
                ? '关闭窗口前是否保存当前项目的更改？'
                : '返回项目列表前是否保存当前项目的更改？'}
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <button
                onClick={handlePromptCancel}
                className="px-3 py-1.5 text-[12px] rounded bg-loom-panel2 text-loom-muted hover:text-loom-text transition-colors"
              >
                取消
              </button>
              <button
                onClick={handlePromptDiscard}
                className="px-3 py-1.5 text-[12px] rounded bg-loom-err/20 text-loom-err hover:bg-loom-err/30 transition-colors"
              >
                不保存
              </button>
              <button
                onClick={() => void handlePromptSave()}
                disabled={saving}
                className="px-3 py-1.5 text-[12px] rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
              >
                {saving ? '保存中…' : `保存并${closePrompt === 'close' ? '关闭' : '返回'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default function App() {
  const currentProject = useStore((s) => s.currentProject)

  // 启动时加载偏好（主题/字号）并应用到 DOM；同时加载插件（命令/面板/钩子/全局喵语启动即生效）
  useEffect(() => {
    void usePreferences.getState().load()
    void usePlugins.getState().loadPlugins()
  }, [])

  // 功能栏偏好（插件面板加入/不加入）
  useEffect(() => {
    void useSidebarPrefs.getState().load()
  }, [])

  // 窗口全屏状态：初始查询真实状态 + 订阅变化 → 写入 useStore（切换页面/组件重挂载不丢失）
  useEffect(() => {
    let disposed = false
    void window.pupurin.getIsFullscreen().then((v) => {
      if (!disposed) useStore.getState().setIsFullscreen(v)
    })
    const off = window.pupurin.onFullscreenChange((v) => useStore.getState().setIsFullscreen(v))
    return () => {
      disposed = true
      off()
    }
  }, [])

  // 未选项目 → ProjectPicker；选中 → IDE（key 强制 remount）
  return (
    <>
      {currentProject ? (
        <Ide key={currentProject.id} projectPath={currentProject.path} />
      ) : (
        <ProjectPicker />
      )}
      <ToastHost />
    </>
  )
}
