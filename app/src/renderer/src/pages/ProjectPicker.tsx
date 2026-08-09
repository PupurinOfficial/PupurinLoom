import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import SettingsDialog from '../components/SettingsDialog'
import ReleaseNotes from '../components/ReleaseNotes'
import type { ProjectMeta, UpdateCheckResult } from '../types'
import logoUrl from '../assets/pupurin-logo.png'

// 与 package.json version 保持一致（发版时同步更新）
const APP_VERSION = '0.3.1'

export default function ProjectPicker() {
  const projects = useStore((s) => s.projects)
  const setProjects = useStore((s) => s.setProjects)
  const setCurrentProject = useStore((s) => s.setCurrentProject)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [customDir, setCustomDir] = useState<string | null>(null) // null = 用默认
  const [defaultDir, setDefaultDir] = useState<string>('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [isFullscreen, setIsFullscreen] = useState(false)
  // 新建项目向导状态
  const [wizStep, setWizStep] = useState(1)
  const [wizTitle, setWizTitle] = useState('') // 游戏显示名
  const [wizBuild, setWizBuild] = useState('') // 内部 ASCII 名
  const [wizResolution, setWizResolution] = useState('1280x720')
  const [wizTpl, setWizTpl] = useState<'minimal' | 'basic' | 'branch'>('basic')
  // 应用设置与检查更新状态
  const [showSettings, setShowSettings] = useState(false)
  const [checking, setChecking] = useState(false)
  const [updateResult, setUpdateResult] = useState<UpdateCheckResult | null>(null)
  const [showUpdate, setShowUpdate] = useState(false)

  // 由目录名自动推导的默认内部名（仅 ASCII，用于打包）
  const autoBuild = (newName.trim().replace(/[^a-zA-Z0-9]/g, '') || 'game').toLowerCase()

  const RESOLUTIONS = [
    { id: '1280x720', label: '横屏 · 桌面', desc: '标准视觉小说，适合 PC 与横屏设备' },
    { id: '1920x1080', label: '高清横屏', desc: '1080p 高清，适合精细立绘表现' },
    { id: '1080x1920', label: '竖屏 · 手机', desc: '手机竖屏阅读，适合移动端体验' },
  ] as const

  const TEMPLATES = [
    { id: 'minimal', label: '极简开场', desc: '只有一句开场白，其余全部自己写' },
    { id: 'basic', label: '简单开场', desc: '带一个示例角色与引导对话' },
    { id: 'branch', label: '选项分支', desc: '开场即包含一个 menu 分支示例' },
  ] as const

  async function refresh(): Promise<void> {
    try {
      const [list, d] = await Promise.all([
        window.pupurin.listProjects(),
        window.pupurin.getDefaultDir(),
      ])
      setProjects(list)
      setDefaultDir(d)
    } catch (e) {
      setErr(String(e))
    }
  }

  useEffect(() => {
    const cleanup = window.pupurin.onFullscreenChange(setIsFullscreen)
    void refresh()
    return cleanup
  }, [])

  const headerPad = isFullscreen ? 'px-4' : 'pl-[80px] pr-4'

  async function handleOpen(p: ProjectMeta): Promise<void> {
    if (p._missing) {
      setErr('项目目录已失效，请重新创建')
      return
    }
    setBusy(true)
    try {
      const updated = await window.pupurin.openProject(p.id)
      if (updated) setCurrentProject(updated)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string, name: string): Promise<void> {
    if (!confirm(`从列表移除「${name}」？\n（不会删除磁盘文件）`)) return
    try {
      await window.pupurin.deleteProject(id)
      await refresh()
    } catch (e) {
      setErr(String(e))
    }
  }

  // 在文件管理器（Finder）中显示项目目录
  async function handleReveal(p: ProjectMeta): Promise<void> {
    try {
      await window.pupurin.showProjectInFinder(p.path)
    } catch (e) {
      setErr(String(e))
    }
  }

  async function handlePickDir(): Promise<void> {
    const dir = await window.pupurin.pickDirectory()
    if (dir) setCustomDir(dir)
  }

  async function handleCreate(): Promise<void> {
    if (!newName.trim()) {
      setErr('请填写项目名称')
      return
    }
    setBusy(true)
    setErr(null)
    try {
      // 不选目录时传 undefined，主进程用默认 userData/projects/
      const p = await window.pupurin.createProject(newName.trim(), customDir ?? undefined, {
        title: wizTitle.trim() || newName.trim(),
        buildName: wizBuild.trim() || autoBuild,
        resolution: wizResolution,
        scriptTemplate: wizTpl,
      })
      await refresh()
      setCurrentProject(p)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  // 导入已有 Ren'Py 项目：选择目录 → 注册项目 → 自动解析角色和差分
  async function handleImport(): Promise<void> {
    setBusy(true)
    setErr(null)
    try {
      const dir = await window.pupurin.pickDirectory()
      if (!dir) {
        setBusy(false)
        return
      }
      const project = await window.pupurin.importProject(dir)
      // 自动从 script.rpy 解析角色和差分
      await window.pupurin.parseCharactersFromScript(project.path)
      await refresh()
      setCurrentProject(project)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  // 检查更新
  async function handleCheckUpdate(): Promise<void> {
    setChecking(true)
    try {
      const r = await window.pupurin.checkUpdate()
      setUpdateResult(r)
      setShowUpdate(true)
    } catch (e) {
      setUpdateResult({ configured: true, current: APP_VERSION, error: String(e) })
      setShowUpdate(true)
    } finally {
      setChecking(false)
    }
  }

  // 打开下载地址（系统浏览器）
  function handleOpenUpdateUrl(): void {
    if (updateResult?.url) void window.pupurin.openExternal(updateResult.url)
    setShowUpdate(false)
  }

  const displayDir = customDir ?? defaultDir

  return (
    <div className="relative h-screen w-screen flex flex-col bg-loom-bg text-loom-text">
      {/* 背景织线装饰（经线 / 纬线 / 铃铛） */}
      <ThreadBackdrop />

      {/* 顶部标题栏（拖拽区） */}
      <header
        className={`relative z-10 flex items-center h-9 ${headerPad} bg-loom-bg/95 backdrop-blur border-b border-loom-border select-none`}
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <img src={logoUrl} alt="Pupurin° Loom" className="h-5 w-auto" />
        <span className="ml-2 text-sm font-semibold tracking-wide">铃言织机°</span>
        <span className="ml-1 text-xs text-loom-muted font-mono">Pupurin° Loom</span>
        <span className="ml-3 text-xs text-loom-muted/70 font-mono">项目选择</span>
        <div
          className="ml-auto flex items-center gap-1.5"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <button
            onClick={() => void handleCheckUpdate()}
            disabled={checking}
            className="px-2.5 py-1 rounded text-[11px] font-mono text-loom-muted hover:text-loom-accent hover:bg-loom-accent/10 transition-colors disabled:opacity-50 flex items-center gap-1.5"
            title="检查更新"
          >
            {checking ? (
              <span className="inline-block w-3 h-3 border border-loom-accent border-t-transparent rounded-full animate-spin" />
            ) : (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="11" height="11">
                <path d="M21 3v6h-6" />
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L21 9" />
              </svg>
            )}
            {checking ? '检查中…' : '检查更新'}
          </button>
          <button
            onClick={() => setShowSettings(true)}
            className="p-1.5 rounded text-loom-muted hover:text-loom-accent hover:bg-loom-accent/10 transition-colors"
            title="设置"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="14" height="14">
              <circle cx="12" cy="12" r="3" />
              <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
            </svg>
          </button>
        </div>
      </header>

      <div className="relative z-10 flex-1 min-h-0 overflow-auto p-8">
        <div className="max-w-3xl mx-auto">
          {/* 品牌区：LOGO + Slogan */}
          <div className="pt-10 pb-8 text-center select-none">
            <div className="relative inline-flex items-center justify-center mb-6">
              <div className="absolute -inset-6 rounded-full bg-loom-accent/10 blur-2xl" />
              <div className="relative w-24 h-24 sm:w-28 sm:h-28 rounded-full ring-2 ring-loom-accent/40 shadow-[0_0_32px_rgba(255,228,166,0.22)] bg-loom-panel overflow-hidden flex items-center justify-center">
                <img src={logoUrl} alt="Pupurin° Loom" className="w-4/5 h-4/5 object-contain" />
              </div>
            </div>
            <h1 className="text-2xl font-semibold tracking-[0.25em]">铃言织机°</h1>
            <p className="mt-1.5 text-[11px] text-loom-muted tracking-[0.35em] font-mono">PUPURIN° LOOM</p>
            <div className="mt-6 flex items-center justify-center gap-4">
              <div className="h-px w-14 sm:w-20 bg-gradient-to-r from-transparent to-loom-accent/60" />
              <p className="text-lg sm:text-2xl text-loom-accent font-medium tracking-[0.28em] whitespace-nowrap">
                以言为线，铃织成篇
              </p>
              <div className="h-px w-14 sm:w-20 bg-gradient-to-l from-transparent to-loom-accent/60" />
            </div>
            <p className="mt-5 text-xs text-loom-muted/80">选择已有项目继续编辑，或创建一个新项目。</p>
          </div>

          {err && (
            <div className="mb-4 px-3 py-2 rounded bg-loom-err/15 border border-loom-err/40 text-loom-err text-sm">
              {err}
            </div>
          )}

          {/* 新建项目卡片 */}
          <div className="mb-6 rounded-lg bg-loom-panel border border-loom-border">
            <button
              onClick={() => setCreating(!creating)}
              className="w-full flex items-center gap-3 px-4 py-3 text-left"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <div className="w-9 h-9 rounded-lg bg-loom-accent/20 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="#FFE4A6" strokeWidth="2" strokeLinecap="round" width="20" height="20">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium">新建项目</div>
                <div className="text-xs text-loom-muted">创建一个新的 Ren'Py 项目</div>
              </div>
              <span className="ml-auto text-loom-muted">{creating ? '−' : '+'}</span>
            </button>

            {creating && (
              <div className="px-4 pb-4 pt-3 space-y-3 border-t border-loom-border">
                {/* 步骤指示 */}
                <div className="flex items-center gap-1.5">
                  {[
                    { n: 1, label: '基础信息' },
                    { n: 2, label: '画面与设备' },
                    { n: 3, label: '内容模板' },
                  ].map((s) => (
                    <div key={s.n} className="flex-1">
                      <div className={`h-1 rounded-full ${wizStep >= s.n ? 'bg-loom-accent' : 'bg-loom-border'}`} />
                      <div className={`mt-1 text-[10px] ${wizStep === s.n ? 'text-loom-accent' : 'text-loom-muted/60'}`}>
                        {s.label}
                      </div>
                    </div>
                  ))}
                </div>

                {wizStep === 1 && (
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs text-loom-muted mb-1">项目名称</label>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        placeholder="我的视觉小说"
                        autoFocus
                        className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm focus:outline-none focus:border-loom-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-loom-muted mb-1">游戏显示名</label>
                      <input
                        type="text"
                        value={wizTitle}
                        onChange={(e) => setWizTitle(e.target.value)}
                        placeholder={newName.trim() || '我的视觉小说'}
                        className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm focus:outline-none focus:border-loom-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-loom-muted mb-1">
                        内部名称 <span className="text-loom-muted/60">（打包用，仅限字母数字）</span>
                      </label>
                      <input
                        type="text"
                        value={wizBuild}
                        onChange={(e) => setWizBuild(e.target.value)}
                        placeholder={autoBuild}
                        className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-loom-accent"
                      />
                      <p className="text-[11px] text-loom-muted/70 mt-1">用于文件夹与打包产物命名，根据项目名自动生成，可修改</p>
                    </div>
                    <div>
                      <label className="block text-xs text-loom-muted mb-1">存放位置</label>
                      <div className="flex items-center gap-2">
                        <div className="flex-1 px-3 py-2 rounded bg-loom-bg border border-loom-border text-xs font-mono text-loom-muted truncate">
                          {displayDir || '加载中…'}
                        </div>
                        <button
                          onClick={handlePickDir}
                          className="px-3 py-2 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors whitespace-nowrap"
                        >
                          更改…
                        </button>
                        {customDir && (
                          <button
                            onClick={() => setCustomDir(null)}
                            className="px-2 py-2 rounded text-xs text-loom-muted hover:text-loom-text transition-colors"
                            title="恢复默认"
                          >
                            默认
                          </button>
                        )}
                      </div>
                      <p className="text-[11px] text-loom-muted/70 mt-1">
                        将在 <span className="text-loom-accent font-mono">{displayDir}/{newName.trim() || '项目名'}</span> 下创建 <span className="font-mono">game/script.rpy</span>
                      </p>
                    </div>
                  </div>
                )}

                {wizStep === 2 && (
                  <div>
                    <label className="block text-xs text-loom-muted mb-1.5">画面方向与分辨率</label>
                    <div className="grid grid-cols-3 gap-2">
                      {RESOLUTIONS.map((r) => (
                        <button
                          key={r.id}
                          onClick={() => setWizResolution(r.id)}
                          className={`rounded border p-2.5 text-left transition-colors ${
                            wizResolution === r.id
                              ? 'border-loom-accent bg-loom-accent/10'
                              : 'border-loom-border bg-loom-bg hover:border-loom-border/70'
                          }`}
                        >
                          <div className="text-xs font-medium">{r.label}</div>
                          <div className="text-[10px] text-loom-muted font-mono mt-0.5">{r.id}</div>
                          <div className="text-[10px] text-loom-muted/70 mt-1 leading-snug">{r.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {wizStep === 3 && (
                  <div>
                    <label className="block text-xs text-loom-muted mb-1.5">选择开场脚本模板</label>
                    <div className="space-y-2">
                      {TEMPLATES.map((t) => (
                        <button
                          key={t.id}
                          onClick={() => setWizTpl(t.id)}
                          className={`w-full rounded border px-3 py-2.5 text-left transition-colors ${
                            wizTpl === t.id
                              ? 'border-loom-accent bg-loom-accent/10'
                              : 'border-loom-border bg-loom-bg hover:border-loom-border/70'
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className={`w-3 h-3 rounded-full border ${wizTpl === t.id ? 'border-loom-accent bg-loom-accent' : 'border-loom-border'}`} />
                            <span className="text-xs font-medium">{t.label}</span>
                          </div>
                          <div className="text-[11px] text-loom-muted/70 mt-1 pl-5">{t.desc}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                {/* 底部导航 */}
                <div className="flex items-center gap-2 pt-1">
                  {wizStep > 1 && (
                    <button
                      onClick={() => setWizStep(wizStep - 1)}
                      className="px-3 py-2 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors"
                    >
                      上一步
                    </button>
                  )}
                  <div className="flex-1" />
                  {wizStep < 3 ? (
                    <button
                      onClick={() => {
                        if (!newName.trim()) {
                          setErr('请先填写项目名称')
                          return
                        }
                        setErr(null)
                        setWizStep(wizStep + 1)
                      }}
                      disabled={!newName.trim()}
                      className="px-4 py-2 rounded bg-loom-accent text-loom-bg font-medium text-xs hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                      下一步
                    </button>
                  ) : (
                    <button
                      onClick={handleCreate}
                      disabled={busy}
                      className="px-4 py-2 rounded bg-loom-accent text-loom-bg font-semibold text-sm hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                      {busy ? '创建中…' : '创建并打开'}
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* 导入项目卡片 */}
          <div className="mb-6 rounded-lg bg-loom-panel border border-loom-border">
            <button
              onClick={() => void handleImport()}
              disabled={busy}
              className="w-full flex items-center gap-3 px-4 py-3 text-left disabled:opacity-50"
              style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
            >
              <div className="w-9 h-9 rounded-lg bg-loom-accent/15 flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="#FFE4A6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="20" height="20">
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                  <path d="M7 10l5 5 5-5" />
                  <path d="M12 15V3" />
                </svg>
              </div>
              <div>
                <div className="text-sm font-medium">导入已有项目</div>
                <div className="text-xs text-loom-muted">
                  选择 Ren'Py 项目文件夹，自动解析角色与立绘差分
                </div>
              </div>
              {busy && (
                <span className="ml-auto text-xs text-loom-accent font-mono">导入中…</span>
              )}
            </button>
          </div>

          {/* 已有项目列表 */}
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-loom-text">最近项目</h2>
            <button
              onClick={refresh}
              className="text-xs text-loom-muted hover:text-loom-text transition-colors"
            >
              刷新
            </button>
          </div>

          {projects.length === 0 ? (
            <div className="rounded-lg bg-loom-panel border border-loom-border border-dashed p-8 text-center">
              <div className="text-loom-muted text-sm">暂无项目</div>
              <div className="text-loom-muted/60 text-xs mt-1">点击上方「新建项目」开始</div>
            </div>
          ) : (
            <div className="space-y-2">
              {projects.map((p) => (
                <div
                  key={p.id}
                  className={[
                    'group flex items-center gap-3 px-4 py-3 rounded-lg border transition-all',
                    p._missing
                      ? 'border-loom-err/40 bg-loom-err/5'
                      : 'border-loom-border bg-loom-panel hover:border-loom-accent/60'
                  ].join(' ')}
                >
                  <div className="w-9 h-9 rounded-lg bg-loom-panel2 flex items-center justify-center flex-shrink-0">
                    <svg viewBox="0 0 24 24" fill="none" stroke={p._missing ? '#e06c75' : '#FFE4A6'} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="18" height="18">
                      <path d="M3 7l9-4 9 4-9 4-9-4z" />
                      <path d="M3 7v10l9 4 9-4V7" />
                      <path d="M12 11v10" />
                    </svg>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium truncate">{p.name}</span>
                      {p._missing && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-loom-err/20 text-loom-err font-mono">目录失效</span>
                      )}
                    </div>
                    <div className="text-xs text-loom-muted font-mono truncate">{p.path}</div>
                    <div className="text-[10px] text-loom-muted/70 mt-0.5">
                      创建于 {new Date(p.createdAt).toLocaleString('zh-CN')}
                      {' · '}上次打开 {new Date(p.lastOpenedAt).toLocaleString('zh-CN')}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => handleReveal(p)}
                      disabled={busy || p._missing}
                      title="在 Finder 中显示"
                      className="p-1.5 rounded text-loom-muted hover:text-loom-accent hover:bg-loom-accent/10 transition-colors disabled:opacity-40"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(p.id, p.name)}
                      title="从列表移除"
                      className="px-2 py-1 rounded text-loom-muted hover:text-loom-err hover:bg-loom-err/10 text-xs transition-colors"
                    >
                      删除
                    </button>
                    <button
                      onClick={() => handleOpen(p)}
                      disabled={busy || p._missing}
                      className="px-3 py-1 rounded bg-loom-accent text-loom-bg text-xs font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
                    >
                      打开
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* 品牌区 */}
          <div className="mt-10 pt-6 border-t border-loom-border text-center space-y-2 select-none">
            <div className="text-xs text-loom-muted">
              铃言织机° <span className="text-loom-muted/60">(Pupurin° Loom)</span> · A Pupurin° Project
            </div>
            <div className="text-[11px] text-loom-muted/70">
              仆仆铃°工作室
              <a
                href="https://space.bilibili.com/3546379813129005"
                onClick={(e) => {
                  e.preventDefault()
                  void window.pupurin.openExternal('https://space.bilibili.com/3546379813129005')
                }}
                className="ml-2 text-loom-accent hover:underline"
              >
                Bilibili · 关注我们
              </a>
            </div>
            <div className="text-[10px] text-loom-muted/50">v{APP_VERSION} · 可视化 Ren'Py 开发工具</div>
          </div>
        </div>
      </div>

      {/* 设置弹窗（外观/编辑器/打包/更新/插件） */}
      <SettingsDialog open={showSettings} onClose={() => setShowSettings(false)} />

      {/* 更新结果弹窗 */}
      {showUpdate && updateResult && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={() => setShowUpdate(false)}
        >
          <div
            className="w-[460px] max-w-[92vw] rounded-lg bg-loom-panel border border-loom-border shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-loom-border flex items-center">
              <h3 className="text-sm font-semibold">检查更新</h3>
              <button
                onClick={() => setShowUpdate(false)}
                className="ml-auto p-1 rounded text-loom-muted hover:text-loom-text hover:bg-loom-border/30 transition-colors"
                title="关闭"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16">
                  <path d="M18 6L6 18M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="px-4 py-4">
              {updateResult.error ? (
                <div className="px-3 py-2.5 rounded bg-loom-err/15 border border-loom-err/40 text-loom-err text-sm leading-relaxed">
                  {updateResult.error}
                </div>
              ) : !updateResult.configured ? (
                <div>
                  <div className="text-sm text-loom-text">尚未配置更新源</div>
                  <p className="text-xs text-loom-muted mt-1 leading-relaxed">
                    当前版本 <span className="font-mono text-loom-accent">v{updateResult.current}</span>。
                    请在设置中填写更新源 URL 后重新检查。
                  </p>
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => setShowUpdate(false)}
                      className="px-3 py-2 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors"
                    >
                      关闭
                    </button>
                    <div className="flex-1" />
                    <button
                      onClick={() => {
                        setShowUpdate(false)
                        setShowSettings(true)
                      }}
                      className="px-4 py-2 rounded bg-loom-accent text-loom-bg font-semibold text-xs hover:opacity-90 transition-opacity"
                    >
                      前往设置
                    </button>
                  </div>
                </div>
              ) : updateResult.hasUpdate ? (
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-loom-accent" />
                    <div className="text-sm font-medium">
                      发现新版本 <span className="font-mono text-loom-accent">v{updateResult.latest}</span>
                    </div>
                  </div>
                  <p className="text-xs text-loom-muted mt-1">
                    当前版本 <span className="font-mono text-loom-accent">v{updateResult.current}</span>
                  </p>
                  {updateResult.notes && (
                    <ReleaseNotes
                      notes={updateResult.notes}
                      className="mt-3 px-3 py-2.5 rounded bg-loom-bg border border-loom-border max-h-40 overflow-auto"
                    />
                  )}
                  <div className="mt-4 flex items-center gap-2">
                    <button
                      onClick={() => setShowUpdate(false)}
                      className="px-3 py-2 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors"
                    >
                      稍后再说
                    </button>
                    {updateResult.source === 'github' && updateResult.pageUrl && (
                      <button
                        onClick={() => void window.pupurin.openExternal(updateResult.pageUrl!)}
                        className="px-3 py-2 rounded bg-loom-accent text-loom-bg font-semibold text-xs hover:opacity-90 transition-opacity"
                      >
                        前往下载
                      </button>
                    )}
                    <div className="flex-1" />
                    {updateResult.url && (
                      <button
                        onClick={handleOpenUpdateUrl}
                        className="px-4 py-2 rounded bg-loom-accent text-loom-bg font-semibold text-xs hover:opacity-90 transition-opacity"
                      >
                        下载安装
                      </button>
                    )}
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#8bd3b2" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <path d="M22 4L12 14.01l-3-3" />
                  </svg>
                  <div>
                    <div className="text-sm text-loom-text">已是最新版本</div>
                    <p className="text-xs text-loom-muted mt-0.5">
                      当前版本 <span className="font-mono text-loom-accent">v{updateResult.current}</span>
                    </p>
                  </div>
                  <div className="flex-1" />
                  <button
                    onClick={() => setShowUpdate(false)}
                    className="px-3 py-2 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors"
                  >
                    关闭
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// 背景织线装饰：经线（竖向）与纬线（横向波浪）交织，点缀悬挂的小铃铛
function ThreadBackdrop() {
  return (
    <svg
      className="absolute inset-0 w-full h-full pointer-events-none select-none z-0"
      viewBox="0 0 1200 800"
      preserveAspectRatio="xMidYMid slice"
      fill="none"
      aria-hidden
    >
      <defs>
        <radialGradient id="loom-hero-glow" cx="0.5" cy="0.34" r="0.62">
          <stop offset="0" stopColor="#FFE4A6" stopOpacity="0.10" />
          <stop offset="1" stopColor="#FFE4A6" stopOpacity="0" />
        </radialGradient>
      </defs>
      {/* 顶部品牌区辉光 */}
      <rect x="0" y="0" width="1200" height="800" fill="url(#loom-hero-glow)" />
      {/* 经线（竖向，轻微起伏） */}
      {[150, 300, 480, 620, 780, 950, 1100].map((x, i) => (
        <path
          key={`warp-${i}`}
          d={`M${x} 0 C ${x + (i % 2 ? 45 : -45)} 210, ${x + (i % 2 ? -35 : 35)} 430, ${x + (i % 2 ? 30 : -30)} 800`}
          stroke="#FFE4A6"
          strokeOpacity="0.07"
          strokeWidth="1.2"
        />
      ))}
      {/* 纬线（横向波浪） */}
      {[150, 310, 470, 630].map((y, i) => (
        <path
          key={`weft-${i}`}
          d={`M0 ${y} Q 150 ${y - (i % 2 ? 48 : 40)}, 300 ${y} T 600 ${y} T 900 ${y} T 1200 ${y}`}
          stroke="#FFE4A6"
          strokeOpacity="0.07"
          strokeWidth="1.2"
        />
      ))}
      {/* 悬挂的小铃铛 */}
      {[
        [480, 320], [620, 470], [300, 150], [950, 300]
      ].map(([x, y], i) => (
        <g key={`bell-${i}`} stroke="#FFE4A6" strokeOpacity="0.26" strokeWidth="1.1" strokeLinecap="round">
          <line x1={x} y1={y - 22} x2={x} y2={y - 12} />
          <path d={`M${x - 8} ${y - 3} a 8 8 0 0 1 16 0 v 4 h -16 z`} />
          <circle cx={x} cy={y + 7} r="1.6" fill="#FFE4A6" fillOpacity="0.45" stroke="none" />
        </g>
      ))}
    </svg>
  )
}
