import { useEffect, useState } from 'react'
import { usePreferences, THEME_PRESETS, DEFAULT_PRESET_ID } from '../store/preferences'
import { usePlugins } from '../store/plugins'
import PluginIcon from './PluginIcon'
import ReleaseNotes from './ReleaseNotes'
import type { UpdateCheckResult } from '../types'

interface Props {
  open: boolean
  onClose: () => void
}

// 应用设置弹窗（项目选择页与 IDE 共用）
// 主题/字号即时生效并持久化；SDK 路径为显式保存/应用。
export default function SettingsDialog({ open, onClose }: Props) {
  const mode = usePreferences((s) => s.mode)
  const presetId = usePreferences((s) => s.presetId)
  const customAccent = usePreferences((s) => s.customAccent)
  const editorFontSize = usePreferences((s) => s.editorFontSize)
  const setMode = usePreferences((s) => s.setMode)
  const setPreset = usePreferences((s) => s.setPreset)
  const setCustomAccent = usePreferences((s) => s.setCustomAccent)
  const setEditorFontSize = usePreferences((s) => s.setEditorFontSize)

  // 更新检查（官方 GitHub Releases 源）
  const [checkingUpdate, setCheckingUpdate] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)

  // SDK 路径（浏览/恢复时立即应用）
  const [sdkPath, setSdkPath] = useState('')
  const [sdkErr, setSdkErr] = useState<string | null>(null)
  const [savingSdk, setSavingSdk] = useState(false)

  // 插件中心
  const plugins = usePlugins((s) => s.plugins)
  const pluginsLoading = usePlugins((s) => s.loading)
  const loadPlugins = usePlugins((s) => s.loadPlugins)
  const toggleEnabled = usePlugins((s) => s.toggleEnabled)
  const trustAndEnable = usePlugins((s) => s.trustAndEnable)

  useEffect(() => {
    if (!open) return
    setUpdateResult(null)
    setSdkErr(null)
    void window.pupurin
      .getSettings()
      .then((s) => {
        if (typeof s.sdkPath === 'string') setSdkPath(s.sdkPath)
      })
      .catch(() => {})
    void loadPlugins()
  }, [open, loadPlugins])

  if (!open) return null

  const activeSwatch = (p: (typeof THEME_PRESETS)[number]): string =>
    mode === 'dark' ? p.darkAccent : p.lightAccent

  async function saveSdkPath(value: string): Promise<void> {
    setSavingSdk(true)
    setSdkErr(null)
    try {
      await window.pupurin.setSetting('sdkPath', value.trim())
      setSdkPath(value.trim())
    } catch (e) {
      setSdkErr(String(e))
    } finally {
      setSavingSdk(false)
    }
  }

  async function handleBrowseSdk(): Promise<void> {
    const dir = await window.pupurin.pickDirectory()
    if (dir) await saveSdkPath(dir)
  }

  async function handleCheckUpdate(): Promise<void> {
    setCheckingUpdate(true)
    setUpdateResult(null)
    try {
      setUpdateResult(await window.pupurin.checkUpdate())
    } catch (e) {
      setUpdateResult({ configured: true, current: '', error: String(e) })
    } finally {
      setCheckingUpdate(false)
    }
  }

  const sectionTitle = 'text-[11px] font-semibold tracking-wider text-loom-muted uppercase mb-2'
  const inputCls =
    'w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-loom-accent'
  const btnCls =
    'px-3 py-2 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors whitespace-nowrap disabled:opacity-50'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-[600px] max-w-[94vw] max-h-[84vh] flex flex-col rounded-lg bg-loom-panel border border-loom-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="px-4 py-3 border-b border-loom-border flex items-center flex-shrink-0">
          <h3 className="text-sm font-semibold">设置</h3>
          <span className="ml-2 text-xs text-loom-muted/70">即时生效并自动保存</span>
          <button
            onClick={onClose}
            className="ml-auto p-1 rounded text-loom-muted hover:text-loom-text hover:bg-loom-border/30 transition-colors"
            title="关闭"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-4 py-4 space-y-6">
          {/* 外观：明暗模式 + 配色 */}
          <section>
            <div className={sectionTitle}>外观</div>
            <div className="flex items-center gap-2 mb-3">
              {(['dark', 'light'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`flex-1 flex items-center justify-center gap-1.5 rounded border px-3 py-2 text-xs transition-colors ${
                    mode === m
                      ? 'border-loom-accent bg-loom-accent/10 text-loom-accent'
                      : 'border-loom-border bg-loom-bg text-loom-muted hover:border-loom-border/70'
                  }`}
                >
                  {m === 'dark' ? (
                    <span className="inline-block w-3 h-3 rounded-full bg-[#1f1d1a] border border-loom-border" />
                  ) : (
                    <span className="inline-block w-3 h-3 rounded-full bg-[#f7f5f0] border border-loom-border" />
                  )}
                  {m === 'dark' ? '深色' : '浅色'}
                </button>
              ))}
            </div>

            <div className="text-xs text-loom-muted mb-1.5">配色</div>
            <div className="grid grid-cols-3 gap-2">
              {THEME_PRESETS.map((p) => {
                const active = !customAccent && presetId === p.id
                return (
                  <button
                    key={p.id}
                    onClick={() => {
                      setPreset(p.id)
                      if (customAccent) setCustomAccent(null)
                    }}
                    className={`flex items-center gap-2 rounded border px-2.5 py-2 text-left transition-colors ${
                      active
                        ? 'border-loom-accent bg-loom-accent/10'
                        : 'border-loom-border bg-loom-bg hover:border-loom-border/70'
                    }`}
                  >
                    <span
                      className="w-4 h-4 rounded-full border border-loom-border flex-shrink-0"
                      style={{ background: activeSwatch(p) }}
                    />
                    <span className="text-xs truncate">{p.name}</span>
                  </button>
                )
              })}
              {/* 自定义配色 */}
              <button
                onClick={() => {
                  document.getElementById('loom-custom-accent')?.click()
                }}
                className={`flex items-center gap-2 rounded border px-2.5 py-2 text-left transition-colors ${
                  customAccent
                    ? 'border-loom-accent bg-loom-accent/10'
                    : 'border-loom-border bg-loom-bg hover:border-loom-border/70'
                }`}
                title="自定义强调色"
              >
                <span
                  className="w-4 h-4 rounded-full border border-loom-border flex-shrink-0"
                  style={{ background: customAccent ?? 'conic-gradient(#f66,#ff0,#0c6,#06f,#f0f,#f66)' }}
                />
                <span className="text-xs truncate">自定义</span>
              </button>
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                id="loom-custom-accent"
                type="color"
                value={customAccent && /^#[0-9a-f]{6}$/i.test(customAccent) ? customAccent : '#FFE4A6'}
                onChange={(e) => setCustomAccent(e.target.value.toUpperCase())}
                className="w-9 h-7"
                title="选择自定义强调色"
              />
              <span className="text-xs text-loom-muted">
                自定义强调色{customAccent ? `：${customAccent}` : '（点击色块或从预设选择）'}
              </span>
              <div className="flex-1" />
              <button
                onClick={() => {
                  setMode('dark')
                  setPreset(DEFAULT_PRESET_ID)
                  setCustomAccent(null)
                }}
                className={btnCls}
              >
                恢复默认配色
              </button>
            </div>
          </section>

          {/* 编辑器：字号 */}
          <section>
            <div className={sectionTitle}>编辑器</div>
            <div className="flex items-center gap-3">
              <span className="text-xs text-loom-muted w-16 flex-shrink-0">字号</span>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => setEditorFontSize(editorFontSize - 1)}
                  disabled={editorFontSize <= 10}
                  className="w-7 h-7 rounded bg-loom-panel2 border border-loom-border text-sm hover:bg-loom-border/30 disabled:opacity-40 transition-colors"
                  title="减小字号"
                >
                  −
                </button>
                <span className="w-12 text-center text-sm font-mono text-loom-text">{editorFontSize}px</span>
                <button
                  onClick={() => setEditorFontSize(editorFontSize + 1)}
                  disabled={editorFontSize >= 24}
                  className="w-7 h-7 rounded bg-loom-panel2 border border-loom-border text-sm hover:bg-loom-border/30 disabled:opacity-40 transition-colors"
                  title="增大字号"
                >
                  +
                </button>
              </div>
              <span className="text-[11px] text-loom-muted/70">应用于代码编辑器与流程图（10–24px）</span>
            </div>
          </section>

          {/* 打包：Ren'Py SDK 路径 */}
          <section>
            <div className={sectionTitle}>打包</div>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={sdkPath}
                onChange={(e) => setSdkPath(e.target.value)}
                onBlur={() => {
                  if (sdkPath.trim()) void saveSdkPath(sdkPath)
                }}
                placeholder="留空则自动检测常见位置（如 /Applications/renpy-8.5.2-sdk）"
                className={inputCls}
              />
              <button onClick={() => void handleBrowseSdk()} disabled={savingSdk} className={btnCls}>
                {savingSdk ? '应用…' : '浏览…'}
              </button>
              <button
                onClick={() => void saveSdkPath('')}
                disabled={savingSdk || !sdkPath}
                className={btnCls}
                title="清除手动指定，恢复自动检测"
              >
                恢复自动检测
              </button>
            </div>
            <p className="text-[11px] text-loom-muted/70 mt-1">
              选择 Ren'Py SDK 根目录（macOS 含 renpy.app，Windows 含 renpy.exe），用于运行与打包游戏
            </p>
            {sdkErr && (
              <div className="mt-1 px-3 py-2 rounded bg-loom-err/15 border border-loom-err/40 text-loom-err text-xs">
                {sdkErr}
              </div>
            )}
          </section>

          {/* 更新 */}
          <section>
            <div className={sectionTitle}>更新</div>
            <div className="flex items-center gap-2">
              <button onClick={() => void handleCheckUpdate()} disabled={checkingUpdate} className={btnCls}>
                {checkingUpdate ? '检查中…' : '检查更新'}
              </button>
              <button
                onClick={() => void window.pupurin.openExternal('https://github.com/PupurinOfficial/PupurinLoom/releases')}
                className={btnCls}
              >
                在 GitHub 中查看
              </button>
            </div>
            <p className="text-[11px] text-loom-muted/70 mt-1">
              更新源为官方 GitHub Releases（PupurinLoom 仓库），发现新版本后自行下载安装。
            </p>
            {updateResult?.error && (
              <div className="mt-1 px-3 py-2 rounded bg-loom-err/15 border border-loom-err/40 text-loom-err text-xs">
                {updateResult.error}
              </div>
            )}
            {updateResult && !updateResult.error && (
              <div className="mt-2 px-3 py-2 rounded bg-loom-bg border border-loom-border text-xs leading-relaxed">
                {updateResult.hasUpdate ? (
                  <>
                    <div className="flex items-center gap-2 flex-wrap">
                      <span>
                        发现新版本 <span className="font-mono text-loom-accent">v{updateResult.latest}</span>
                        （当前 v{updateResult.current}）
                      </span>
                      <div className="flex-1" />
                      {updateResult.url && (
                        <button
                          onClick={() => void window.pupurin.openExternal(updateResult.url!)}
                          className="px-2.5 py-1 rounded bg-loom-accent text-loom-bg font-semibold"
                        >
                          下载安装
                        </button>
                      )}
                    </div>
                    {updateResult.notes && (
                      <div className="mt-2 pt-2 border-t border-loom-border">
                        <div className="text-[11px] font-semibold text-loom-muted mb-1">更新详情</div>
                        <ReleaseNotes notes={updateResult.notes} className="max-h-44 overflow-auto" />
                      </div>
                    )}
                  </>
                ) : (
                  <span>
                    已是最新版本（v{updateResult.current}）
                  </span>
                )}
              </div>
            )}
          </section>

          {/* 插件中心 */}
          <section>
            <div className="flex items-center justify-between mb-2">
              <div className={sectionTitle} style={{ marginBottom: 0 }}>插件</div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => void loadPlugins({ force: true })}
                  disabled={pluginsLoading}
                  className={btnCls + ' !py-1 !text-[11px]'}
                >
                  {pluginsLoading ? '加载中…' : '刷新'}
                </button>
                <button
                  onClick={() => void window.pupurin.openPluginsDir()}
                  className={btnCls + ' !py-1 !text-[11px]'}
                >
                  打开插件目录
                </button>
              </div>
            </div>
            <p className="text-[11px] text-loom-muted/70 mb-2">
              将插件放入插件目录（每插件一个文件夹，含 manifest.json 与 main.js），点「刷新」即可加载。插件来源请务必可信。
            </p>
            {plugins.length === 0 ? (
              <div className="rounded border border-loom-border bg-loom-bg px-3 py-4 text-xs text-loom-muted text-center">
                {pluginsLoading ? '正在扫描插件…' : '暂无插件，点击「打开插件目录」开始'}
              </div>
            ) : (
              <div className="space-y-2">
                {plugins.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center gap-3 rounded border border-loom-border bg-loom-bg px-3 py-2.5"
                  >
                    <div className="w-8 h-8 rounded-lg bg-loom-accent/15 flex items-center justify-center flex-shrink-0">
                      <PluginIcon pluginId={p.id} icon={p.icon} size={18} className="text-loom-accent" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium truncate">{p.name}</span>
                        <span className="text-[10px] text-loom-muted font-mono flex-shrink-0">v{p.version}</span>
                        {p.builtin && (
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-loom-border/40 text-loom-muted font-mono flex-shrink-0">
                            内置
                          </span>
                        )}
                      </div>
                      {p.description && (
                        <div className="text-xs text-loom-muted truncate">{p.description}</div>
                      )}
                    </div>
                    {!p.trusted && !p.builtin && (
                      <button
                        onClick={() => void trustAndEnable(p.id)}
                        disabled={pluginsLoading}
                        className={btnCls + ' !py-1 !text-[11px] !border-loom-err/50 !text-loom-err hover:!bg-loom-err/10 flex-shrink-0'}
                      >
                        信任并启用
                      </button>
                    )}
                    <button
                      onClick={() => void toggleEnabled(p.id)}
                      disabled={pluginsLoading}
                      className={`flex-shrink-0 w-9 h-5 rounded-full transition-colors relative ${
                        p.enabled ? 'bg-loom-accent' : 'bg-loom-border'
                      }`}
                      title={p.enabled ? '点击禁用' : '点击启用'}
                    >
                      <span
                        className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                          p.enabled ? 'left-[18px]' : 'left-0.5'
                        }`}
                      />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] text-loom-muted/70 mt-2">
              插件为本地扩展，可注册命令与面板视图。管理入口：左侧栏「插件」页。
            </p>
          </section>
        </div>

        {/* 底部 */}
        <div className="px-4 py-3 border-t border-loom-border flex items-center flex-shrink-0">
          <span className="text-[11px] text-loom-muted/60">设置保存在本机，可随时修改</span>
          <div className="flex-1" />
          <button
            onClick={onClose}
            className="px-4 py-2 rounded bg-loom-accent text-loom-bg font-semibold text-xs hover:opacity-90 transition-opacity"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
