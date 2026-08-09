import { useCallback, useEffect, useState } from 'react'
import { useStore, type ViewId } from '../store/useStore'
import { usePlugins } from '../store/plugins'
import { useSidebarPrefs } from '../store/sidebarPrefs'
import { useResourcePreview } from '../store/resourcePreview'
import StoryProperties, { usePropsHeader } from './StoryProperties'
import PluginPanelView from './PluginPanelView'
import PluginIcon from './PluginIcon'

// ---- 右侧「功能栏」----
// 常驻一条小图标栏（所有页面可见），点击图标展开对应侧边栏（至多 1 个），再点收起。
// 功能来源：
//   1. 页面专属内置功能（织机-属性 / 资源-详情，图标仅对应页面显示）
//   2. 插件面板（panel.register 声明 sidebar:true 后加入，插件页可关闭；右键图标可前往插件 / 隐藏）

interface Feature {
  id: string
  title: string
  icon: JSX.Element
  render: () => JSX.Element
  /** 自定义顶栏（默认显示标题），用于内置功能承载动态标题 */
  header?: JSX.Element
  /** 插件功能：内容留白渲染 + 支持右键菜单 */
  plugin?: boolean
  /** 所属插件 id（右键菜单用） */
  pluginId?: string
}

// 织机属性：从这里开始玩（store 版，功能栏与页面解耦）
function usePlayFromLine() {
  return useCallback(async (absLine: number): Promise<void> => {
    const st = useStore.getState()
    const path = st.currentProject?.path
    if (!path || !st.currentFilePath) return
    try {
      if (st.sourceModified) {
        await window.pupurin.saveRpyFile(path, st.currentFilePath, st.source)
        st.setSourceModified(false)
      }
      const result = await window.pupurin.runGameFromLine(path, st.currentFilePath, absLine)
      if (!result.success) st.setError(result.error ?? '启动失败')
    } catch (e) {
      st.setError('从这里开始玩失败：' + String(e))
    }
  }, [])
}

// 资源详情（选中文件后由资源管理器把预览数据写入 store）
function ResourceDetailView() {
  const data = useResourcePreview((s) => s.data)
  const loading = useResourcePreview((s) => s.loading)
  const setPendingOpenFile = useStore((s) => s.setPendingOpenFile)
  const setActiveView = useStore((s) => s.setActiveView)

  if (loading) {
    return <div className="p-4 text-xs text-loom-muted">加载中…</div>
  }
  if (!data) {
    return (
      <div className="p-4 text-xs text-loom-muted leading-relaxed">
        在「资源管理器」中选中文件后，这里会显示文件详情与预览。
      </div>
    )
  }
  const isRpy = data.name.toLowerCase().endsWith('.rpy')
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 h-8 bg-loom-panel2 border-b border-loom-border text-xs flex-shrink-0">
        <span className="text-loom-accent font-mono truncate">{data.name}</span>
        {isRpy && (
          <span
            className={[
              'px-1 py-px rounded text-[9px] font-mono leading-none flex-shrink-0',
              data.isStoryFile ? 'bg-loom-accent/15 text-loom-accent' : 'bg-loom-border/40 text-loom-muted'
            ].join(' ')}
          >
            {data.isStoryFile ? '故事' : '代码'}
          </span>
        )}
        {isRpy && (
          <button
            onClick={() => {
              setPendingOpenFile({ path: data.path, isStoryFile: data.isStoryFile })
              setActiveView('script')
            }}
            title="在织机中打开"
            className="ml-auto p-1 rounded text-loom-muted hover:text-loom-accent hover:bg-loom-accent/10 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
              <path d="M11 5H5v6M13 19h6v-6M5 13h4v4M15 5h4v4" />
            </svg>
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto p-3">
        {data.type === 'image' && (
          <img
            src={data.content}
            alt={data.name}
            className="max-w-full max-h-full object-contain rounded border border-loom-border"
          />
        )}
        {data.type === 'text' && (
          <pre className="text-xs text-loom-text font-mono whitespace-pre-wrap break-all">{data.content}</pre>
        )}
        {data.type === 'binary' && <div className="text-loom-muted text-sm">二进制文件，无法预览</div>}
      </div>
    </div>
  )
}

// 织机属性顶栏：场景/角色选中时显示动态标题（与属性内容一体，避免双层顶栏）
function PropsHeader() {
  const { title, subtitle, hasSelection } = usePropsHeader()
  return (
    <div className="flex items-center gap-2 min-w-0 flex-1">
      <span className="text-xs font-semibold text-loom-text truncate">{title}</span>
      {subtitle && (
        <span className="text-[10px] text-loom-muted truncate">{subtitle}</span>
      )}
      {hasSelection && (
        <button
          onClick={() => useStore.getState().setSelection({ type: null, id: null })}
          title="取消选择"
          className="ml-auto w-5 h-5 flex items-center justify-center rounded hover:bg-loom-border/30 text-loom-muted hover:text-loom-text transition-colors"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
            <path d="M18 6L6 18M6 6l12 12" />
          </svg>
        </button>
      )}
    </div>
  )
}

const iconDetail = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
)

export default function FunctionBar() {
  const activeView = useStore((s) => s.activeView)
  const isStoryFile = useStore((s) => s.isStoryFile)
  const sidebarFeature = useStore((s) => s.sidebarFeature)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const closeSidebar = useStore((s) => s.closeSidebar)
  const plugins = usePlugins((s) => s.plugins)
  const panels = usePlugins((s) => s.panels)
  const prefs = useSidebarPrefs()
  const playFromLine = usePlayFromLine()

  // 右键菜单：插件图标右键 → 前往插件 / 隐藏
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; pluginId: string } | null>(null)

  useEffect(() => {
    if (!ctxMenu) return
    const close = (): void => setCtxMenu(null)
    window.addEventListener('click', close)
    window.addEventListener('contextmenu', close)
    return () => {
      window.removeEventListener('click', close)
      window.removeEventListener('contextmenu', close)
    }
  }, [ctxMenu])

  // 内置功能（页面专属，图标仅对应页面显示）
  const builtins: Feature[] = [
    {
      id: 'script-props',
      title: '属性',
      icon: <PropsIcon />,
      header: <PropsHeader />,
      render: () => <StoryProperties onPlayFromLine={playFromLine} />,
    },
    {
      id: 'resource-detail',
      title: '详情',
      icon: iconDetail,
      render: () => <ResourceDetailView />,
    },
  ]
  const scopes: Record<string, ViewId[]> = {
    'script-props': ['script'],
    'resource-detail': ['resources'],
  }
  // 织机内属性面板仅故事文件显示（代码文件时隐藏图标并自动收起）
  const pageVisible = (id: string): boolean => {
    if (id === 'script-props') return activeView === 'script' && isStoryFile
    return scopes[id]?.includes(activeView) ?? false
  }

  // 插件图标：从插件元数据取 manifest.icon
  const iconOf = (pluginId: string): string | undefined => plugins.find((p) => p.id === pluginId)?.icon

  // 插件面板功能（声明 sidebar + 插件已启用 + 插件页未关闭）
  const enabledIds = new Set(plugins.filter((p) => p.enabled).map((p) => p.id))
  const pluginFeatures: Feature[] = panels
    .filter((p) => p.sidebar && enabledIds.has(p.pluginId) && prefs.enabled[p.pluginId] !== false)
    .map((p) => ({
      id: `plugin:${p.pluginId}:${p.id}`,
      title: p.title,
      icon: <PluginIcon pluginId={p.pluginId} icon={iconOf(p.pluginId)} size={20} />,
      render: () => <PluginPanelView panel={p} />,
      plugin: true,
      pluginId: p.pluginId,
    }))

  const visible = [
    ...builtins.filter((f) => pageVisible(f.id)),
    ...pluginFeatures,
  ]
  const activeFeature = visible.find((f) => f.id === sidebarFeature)

  // 页面/插件状态变化导致当前展开的功能不可见时自动收起（如从资源页切到织机）
  const visibleIds = visible.map((f) => f.id).join(',')
  useEffect(() => {
    if (sidebarFeature && !visibleIds.split(',').includes(sidebarFeature)) closeSidebar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sidebarFeature, visibleIds])

  // 一个功能都没有时整体隐藏（含空图标栏）
  if (visible.length === 0) return null

  return (
    <>
      {/* 侧边栏内容（在图标栏左侧） */}
      {activeFeature && (
        <aside className="w-72 flex-shrink-0 border-l border-loom-border bg-loom-panel flex flex-col min-h-0">
          <div className="flex items-center gap-2 px-3 h-8 bg-loom-panel2 border-b border-loom-border flex-shrink-0">
            {activeFeature.header ?? (
              <span className="text-xs font-semibold text-loom-text truncate">{activeFeature.title}</span>
            )}
            <button
              onClick={closeSidebar}
              title="收起"
              className="ml-auto p-1 rounded text-loom-muted hover:text-loom-err hover:bg-loom-err/10 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="flex-1 min-h-0 overflow-y-auto">
            {activeFeature.plugin ? (
              <div className="p-3">{activeFeature.render()}</div>
            ) : (
              activeFeature.render()
            )}
          </div>
        </aside>
      )}

      {/* 图标栏（常驻最右侧） */}
      <nav className="flex flex-col items-center w-12 bg-loom-bg border-l border-loom-border py-2 gap-1 select-none flex-shrink-0">
        {visible.map((f) => {
          const active = sidebarFeature === f.id
          return (
            <button
              key={f.id}
              onClick={() => toggleSidebar(f.id)}
              onContextMenu={
                f.plugin && f.pluginId
                  ? (e) => {
                      e.preventDefault()
                      e.stopPropagation()
                      setCtxMenu({ x: e.clientX, y: e.clientY, pluginId: f.pluginId! })
                    }
                  : undefined
              }
              title={f.title}
              className={[
                'relative w-10 h-10 flex items-center justify-center rounded-md transition-colors',
                active
                  ? 'text-loom-accent bg-loom-panel2'
                  : 'text-loom-muted hover:text-loom-text hover:bg-loom-panel'
              ].join(' ')}
            >
              {active && <span className="absolute right-0 top-1 bottom-1 w-[2px] bg-loom-accent rounded-l" />}
              {f.icon}
            </button>
          )
        })}
      </nav>

      {/* 插件图标右键菜单 */}
      {ctxMenu && (
        <div
          className="fixed z-[200] min-w-[140px] rounded-lg bg-loom-panel2 border border-loom-border shadow-xl py-1 text-xs"
          style={{ left: Math.min(ctxMenu.x, window.innerWidth - 160), top: Math.min(ctxMenu.y, window.innerHeight - 96) }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const id = ctxMenu.pluginId
              setCtxMenu(null)
              useStore.getState().setActiveView('plugins')
              useStore.getState().setPendingPluginId(id)
            }}
            className="block w-full text-left px-3 py-1.5 hover:bg-loom-panel text-loom-text"
          >
            前往插件
          </button>
          <button
            onClick={() => {
              const id = ctxMenu.pluginId
              setCtxMenu(null)
              void useSidebarPrefs.getState().setPluginEnabled(id, false)
            }}
            className="block w-full text-left px-3 py-1.5 hover:bg-loom-err/20 text-loom-err"
          >
            隐藏（不加入功能栏）
          </button>
        </div>
      )}
    </>
  )
}

// 织机属性图标
function PropsIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h6M7 17h9" />
    </svg>
  )
}
