import { useEffect, useState } from 'react'
import { usePlugins } from '../store/plugins'
import { useSidebarPrefs } from '../store/sidebarPrefs'
import { useStore } from '../store/useStore'
import PluginPanelView from '../components/PluginPanelView'
import PluginIcon from '../components/PluginIcon'
import CreatePluginDialog from '../components/CreatePluginDialog'
import type { StorePlugin } from '../types'

// 插件商城索引地址（官方索引仓库，PR 收录）
const STORE_INDEX_URL = 'https://raw.githubusercontent.com/PupurinOfficial/Loom-PluginStore/main/plugins.json'
// 插件提交指南（PR 收录制，任何人都可贡献）
const SUBMIT_URL = 'https://github.com/PupurinOfficial/Loom-PluginStore/blob/main/CONTRIBUTING.md'

// 插件商城视图：拉取索引 → 插件卡片 → 一键安装（安装后默认未信任/未启用）
function StoreView({ refreshSignal = 0 }: { refreshSignal: number }) {
  const plugins = usePlugins((s) => s.plugins)
  const loadPlugins = usePlugins((s) => s.loadPlugins)
  const [items, setItems] = useState<StorePlugin[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState<string | null>(null)
  const [installing, setInstalling] = useState<string | null>(null)

  const fetchIndex = async (): Promise<void> => {
    setLoading(true)
    setError(null)
    setStale(null)
    try {
      // 时间戳参数绕过 HTTP 缓存，确保每次真实拉取（网差时会看到加载态）
      const r = await window.pupurin.storeFetchIndex(STORE_INDEX_URL + '?t=' + Date.now())
      if (!r.ok || !r.index) {
        setError(r.error ?? '拉取索引失败')
        setItems([])
        return
      }
      setItems(r.index.plugins)
      if (r.stale) setStale(r.error ?? '网络不佳，已显示上次缓存内容')
    } catch (e) {
      setError('拉取索引失败：' + String(e))
      setItems([])
    } finally {
      setLoading(false)
    }
  }

  // 挂载即拉取默认官方索引；refreshSignal 变化时（头部「刷新」）重新拉取
  useEffect(() => {
    void fetchIndex()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshSignal])

  const installedIds = new Set(plugins.map((p) => p.id))

  const install = async (entry: StorePlugin): Promise<void> => {
    setInstalling(entry.id)
    setError(null)
    try {
      const r = await window.pupurin.storeInstall(entry)
      if (!r.ok) {
        setError(`安装「${entry.name}」失败：${r.error ?? '未知错误'}`)
        return
      }
      await loadPlugins({ force: true })
    } catch (e) {
      setError('安装「' + entry.name + '」失败：' + String(e))
    } finally {
      setInstalling(null)
    }
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded bg-loom-err/15 border border-loom-err/40 text-loom-err text-xs flex-shrink-0">
          {error}
        </div>
      )}
      {stale && (
        <div className="mx-4 mt-3 px-3 py-2 rounded bg-loom-panel2 border border-loom-border text-loom-muted text-xs flex-shrink-0">
          {stale}（点击「刷新」可重试）
        </div>
      )}

      {/* 提交入口：PR 收录制 */}
      <div className="mx-4 mt-3 flex items-center justify-between flex-shrink-0">
        <span className="text-[11px] text-loom-muted/70">插件由社区通过 GitHub PR 收录</span>
        <button
          onClick={() => void window.pupurin.openExternal(SUBMIT_URL)}
          className="text-xs text-loom-accent hover:underline font-medium"
        >
          我要提交插件 →
        </button>
      </div>

      {/* 插件卡片列表 */}
      <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-3">
        {loading && items.length === 0 && !error && (
          <div className="flex flex-col items-center justify-center py-16 text-loom-muted gap-3">
            <div className="w-6 h-6 border-2 border-loom-border border-t-loom-accent rounded-full animate-spin" />
            <span className="text-xs">正在加载插件商城…</span>
          </div>
        )}
        {!loading && items.length === 0 && !error && (
          <div className="text-sm text-loom-muted py-10 text-center">
            没有获取到插件。请检查网络后点击右上角「刷新」重试。
          </div>
        )}
        {items.map((p) => {
          const done = installedIds.has(p.id)
          return (
            <div
              key={p.id}
              className="rounded-lg border border-loom-border bg-loom-panel p-3 flex items-start gap-3"
            >
              <div className="w-10 h-10 rounded-lg bg-loom-accent/15 flex items-center justify-center flex-shrink-0">
                <PluginIcon pluginId={p.id} icon={p.icon} size={22} className="text-loom-accent" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-semibold">{p.name}</span>
                  <span className="text-xs text-loom-muted font-mono">v{p.version}</span>
                  {p.author && <span className="text-xs text-loom-muted truncate">by {p.author}</span>}
                </div>
                {p.description && (
                  <p className="text-xs text-loom-muted mt-1 line-clamp-2">{p.description}</p>
                )}
                <div className="flex items-center gap-2 mt-1.5 text-[10px] text-loom-muted/70">
                  <span className="font-mono">{p.repo.replace(/^https?:\/\/(github\.com\/)?/, '')}</span>
                  {p.subpath && <span className="font-mono">/ {p.subpath}</span>}
                </div>
              </div>
              <button
                onClick={() => void install(p)}
                disabled={done || installing === p.id}
                className={`px-3 py-1.5 rounded text-xs font-semibold transition-colors flex-shrink-0 disabled:opacity-60 ${
                  done
                    ? 'bg-loom-accent/10 text-loom-accent border border-loom-accent/40'
                    : 'bg-loom-accent text-loom-bg hover:opacity-90'
                }`}
              >
                {done ? '已安装' : installing === p.id ? '安装中…' : '安装'}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function PluginsPage() {
  const plugins = usePlugins((s) => s.plugins)
  const commands = usePlugins((s) => s.commands)
  const panels = usePlugins((s) => s.panels)
  const loading = usePlugins((s) => s.loading)
  const error = usePlugins((s) => s.error)
  const loadPlugins = usePlugins((s) => s.loadPlugins)
  const toggleEnabled = usePlugins((s) => s.toggleEnabled)
  const trustAndEnable = usePlugins((s) => s.trustAndEnable)
  const runCommand = usePlugins((s) => s.runCommand)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tab, setTab] = useState<'local' | 'store'>('local')
  const [storeRefresh, setStoreRefresh] = useState(0)
  const [createOpen, setCreateOpen] = useState(false)
  const sidebarPrefs = useSidebarPrefs()
  const pendingPluginId = useStore((s) => s.pendingPluginId)

  useEffect(() => {
    void loadPlugins()
  }, [loadPlugins])

  // 功能栏右键「前往插件」→ 选中对应插件
  useEffect(() => {
    if (pendingPluginId) {
      setSelectedId(pendingPluginId)
      useStore.getState().setPendingPluginId(null)
    }
  }, [pendingPluginId])

  // 选中第一个插件（或当前选中的仍然存在）
  const selected = plugins.find((p) => p.id === selectedId) ?? plugins[0] ?? null
  const selCommands = selected ? commands.filter((c) => c.pluginId === selected.id) : []
  const selPanels = selected ? panels.filter((p) => p.pluginId === selected.id) : []

  return (
    <div className="flex flex-col h-full bg-loom-bg">
      {/* 页头 */}
      <div className="flex items-center px-4 py-2 border-b border-loom-border select-none flex-shrink-0">
        <div className="flex items-center gap-1">
          {(
            [
              ['local', '本地插件'],
              ['store', '插件商城'],
            ] as const
          ).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                tab === k
                  ? 'bg-loom-accent/10 text-loom-accent'
                  : 'text-loom-muted hover:text-loom-text hover:bg-loom-panel2'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <span className="ml-3 text-xs text-loom-muted/70">
          {tab === 'local'
            ? loading
              ? '加载中…'
              : `共 ${plugins.length} 个插件 · ${commands.length} 条命令 · ${panels.length} 个面板`
            : '从 GitHub 安装插件'}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => setCreateOpen(true)}
            className="px-3 py-1.5 rounded bg-loom-panel2 border border-loom-border text-xs hover:border-loom-accent/60 hover:text-loom-accent transition-colors"
            title="从官方模板创建一个新插件"
          >
            创建插件
          </button>
          <button
            onClick={() => {
              if (tab === 'local') void loadPlugins({ force: true })
              else setStoreRefresh((x) => x + 1)
            }}
            disabled={tab === 'local' && loading}
            className="px-3 py-1.5 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors disabled:opacity-50"
          >
            刷新
          </button>
          <button
            onClick={() => void window.pupurin.openPluginsDir()}
            className="px-3 py-1.5 rounded bg-loom-accent text-loom-bg text-xs font-semibold hover:opacity-90 transition-opacity"
          >
            打开插件目录
          </button>
        </div>
      </div>

      {tab === 'store' && <StoreView refreshSignal={storeRefresh} />}

      {tab === 'local' && (
      <>
      {error && (
        <div className="mx-4 mt-3 px-3 py-2 rounded bg-loom-err/15 border border-loom-err/40 text-loom-err text-xs flex-shrink-0">
          插件加载失败：{error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        {/* 插件列表 */}
        <div className="w-56 border-r border-loom-border overflow-y-auto flex-shrink-0">
          {plugins.length === 0 && (
            <div className="p-4 text-xs text-loom-muted leading-relaxed">
              <p className="font-semibold mb-1">还没有插件</p>
              <p>点击右上角「打开插件目录」，在目录中新建「插件id」文件夹，放入 manifest.json 与 main.js 即可。</p>
            </div>
          )}
          {plugins.map((p) => {
            const active = selected?.id === p.id
            return (
              <div
                key={p.id}
                onClick={() => setSelectedId(p.id)}
                className={`px-3 py-2.5 border-b border-loom-border/50 cursor-pointer transition-colors ${
                  active ? 'bg-loom-accent/10 border-l border-l-loom-accent' : 'hover:bg-loom-panel'
                }`}
              >
                <div className="flex items-center gap-2">
                  <PluginIcon pluginId={p.id} icon={p.icon} size={16} className="text-loom-accent flex-shrink-0" />
                  <span className={`text-xs font-semibold truncate ${active ? 'text-loom-accent' : 'text-loom-text'}`}>
                    {p.name}
                  </span>
                  <span className="text-[10px] text-loom-muted font-mono flex-shrink-0">{p.version}</span>
                </div>
                {p.description && <div className="text-[11px] text-loom-muted mt-0.5 line-clamp-2">{p.description}</div>}
                <div className="flex items-center gap-2 mt-1.5">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      void toggleEnabled(p.id)
                    }}
                    disabled={loading}
                    className={`text-[10px] px-2 py-0.5 rounded border transition-colors disabled:opacity-50 ${
                      p.enabled
                        ? 'border-loom-accent/40 text-loom-accent bg-loom-accent/10'
                        : 'border-loom-border text-loom-muted hover:text-loom-text'
                    }`}
                  >
                    {p.enabled ? '已启用' : '已禁用'}
                  </button>
                  {p.builtin && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-loom-border/40 text-loom-muted font-mono">内置</span>
                  )}
                  {!p.trusted && !p.builtin && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        void trustAndEnable(p.id)
                      }}
                      className="text-[10px] px-2 py-0.5 rounded border border-loom-err/50 text-loom-err hover:bg-loom-err/10 transition-colors"
                    >
                      信任并启用
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* 右侧：选中插件的命令 + 面板 */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-5">
          {!selected && (
            <div className="text-sm text-loom-muted py-10 text-center">
              {loading ? '正在加载插件…' : '未选择插件'}
            </div>
          )}

          {selected && (
            <>
              {/* 插件信息 */}
              <section>
                <div className="flex items-center gap-2 mb-2">
                  <PluginIcon pluginId={selected.id} icon={selected.icon} size={18} className="text-loom-accent flex-shrink-0" />
                  <h3 className="text-sm font-semibold">{selected.name}</h3>
                  <span className="text-xs text-loom-muted font-mono">v{selected.version}</span>
                  {selected.author && <span className="text-xs text-loom-muted">by {selected.author}</span>}
                  {!selected.hasMain && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-loom-err/15 text-loom-err">
                      缺少 {selected.main}，无法执行
                    </span>
                  )}
                </div>
                {selected.description && (
                  <p className="text-xs text-loom-muted mb-2">{selected.description}</p>
                )}
                {!selected.enabled && (
                  <p className="text-xs text-loom-muted/80 bg-loom-panel2 border border-loom-border rounded px-3 py-2">
                    该插件已禁用，命令与面板不会加载。可在左侧点击「已禁用」重新启用。
                  </p>
                )}
              </section>

              {/* 模板创建的新手引导：告诉创作者接下来干什么 */}
              {selected.scaffolded && (
                <section className="rounded-lg border border-loom-accent/30 bg-loom-accent/5 p-4">
                  <div className="text-xs font-semibold text-loom-accent mb-2">你的插件已创建，接下来：</div>
                  <ol className="text-xs text-loom-text/90 space-y-1.5 leading-relaxed">
                    <li>1. 用系统编辑器打开 <span className="font-mono">main.js</span>——里面有完整的 loom API 注释与示例（命令 / 面板 / 事件 / fs）</li>
                    <li>2. 按你的想法修改代码（比如改命令文案、加自己的面板）</li>
                    <li>3. 保存后回这里点右上角「刷新」，改动立即生效</li>
                    <li>4. 在下方「命令」区点一下执行、在「面板」里交互来测试</li>
                    <li>5. 想分享 / 上架商城：点下方「提交指南」查看完整流程——官方代管或自托管都行，发一条 Pull Request，CI 自动校验、审核合并后即可被所有人安装</li>
                  </ol>
                  <div className="flex items-center gap-2 mt-3 flex-wrap">
                    <button
                      onClick={() => void window.pupurin.openPluginMain(selected.id)}
                      className="px-3 py-1.5 rounded bg-loom-accent text-loom-bg text-xs font-semibold hover:opacity-90 transition-opacity"
                    >
                      用编辑器打开 main.js
                    </button>
                    <button
                      onClick={() => void window.pupurin.openPluginsDir()}
                      className="px-3 py-1.5 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors"
                    >
                      打开插件目录
                    </button>
                    <button
                      onClick={() => void window.pupurin.openExternal(SUBMIT_URL)}
                      className="px-3 py-1.5 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors"
                    >
                      提交指南
                    </button>
                    <button
                      onClick={() => void window.pupurin.openExternal('https://github.com/PupurinOfficial/Loom-PluginStore')}
                      className="px-3 py-1.5 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors"
                    >
                      打开 GitHub 仓库
                    </button>
                  </div>
                </section>
              )}

              {/* 命令 */}
              <section>
                <div className="text-[11px] font-semibold tracking-wider text-loom-muted uppercase mb-2">命令</div>
                {selCommands.length === 0 ? (
                  <p className="text-xs text-loom-muted/70">该插件未注册命令</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {selCommands.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => runCommand(c)}
                        disabled={!selected.enabled}
                        className="px-3 py-1.5 rounded bg-loom-panel2 border border-loom-border text-xs hover:border-loom-accent hover:text-loom-accent transition-colors disabled:opacity-50"
                      >
                        {c.title}
                      </button>
                    ))}
                  </div>
                )}
              </section>

              {/* 面板 */}
              <section>
                <div className="flex items-center justify-between mb-2">
                  <div className="text-[11px] font-semibold tracking-wider text-loom-muted uppercase">面板</div>
                  {selPanels.some((p) => p.sidebar) && selected.enabled && (
                    <label className="flex items-center gap-1.5 text-[11px] text-loom-muted select-none cursor-pointer">
                      <input
                        type="checkbox"
                        checked={sidebarPrefs.enabled[selected.id] !== false}
                        onChange={(e) => void sidebarPrefs.setPluginEnabled(selected.id, e.target.checked)}
                        className="accent-loom-accent"
                      />
                      加入右侧功能栏
                    </label>
                  )}
                </div>
                {selPanels.length === 0 ? (
                  <p className="text-xs text-loom-muted/70">该插件未注册面板</p>
                ) : (
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-3">
                    {selPanels.map((p) => (
                      <div
                        key={p.id}
                        className="rounded-lg border border-loom-border bg-loom-panel overflow-hidden"
                      >
                        <div className="px-3 py-2 border-b border-loom-border bg-loom-panel2 flex items-center">
                          <span className="text-xs font-semibold">{p.title}</span>
                        </div>
                        <div className="p-3 min-h-[80px]">
                          {selected.enabled ? (
                            <PluginPanelView panel={p} />
                          ) : (
                            <p className="text-xs text-loom-muted/70">插件已禁用</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </>
          )}
        </div>
      </div>
      </>
      )}

      {/* 从官方模板创建插件 */}
      <CreatePluginDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        onCreated={(meta) => {
          setCreateOpen(false)
          setSelectedId(meta.id)
          void loadPlugins({ force: true })
        }}
      />
    </div>
  )
}
