import { useEffect, useState, useRef } from 'react'
import { useStore } from '../store/useStore'
import NonAsciiRenameDialog from '../components/NonAsciiRenameDialog'
import PageHeader from '../components/ui/PageHeader'
import type { NonAsciiRenameItem } from '../types'

interface SdkStatus {
  found: boolean
  exe: string | null
  sdkDir: string | null
  platform: string
  downloadUrl: string
  webOk: boolean
  androidOk: boolean
  iosOk: boolean
  androidSdkOk: boolean
  jdkOk: boolean
  xcodeOk: boolean
  sdkWritable: boolean
}

// 网页应用表单配置（localStorage 记录，下次打开默认填好）
interface WebPkgConfig {
  version: string
  iconPath: string | null
  autoPreview: boolean
}

// 移动端打包表单配置
interface MobilePkgConfig {
  target: 'android' | 'ios'
  bundle: boolean // Android：true=AAB（Google Play），false=APK
  version: string
  packageName: string // Android 包名（com.xxx.yyy）
}

type PackageTab = 'app' | 'web' | 'mobile'

const DEFAULT_WEB_CFG: WebPkgConfig = { version: '1.0', iconPath: null, autoPreview: true }
const DEFAULT_MOBILE_CFG: MobilePkgConfig = { target: 'android', bundle: false, version: '1.0', packageName: '' }

function loadWebCfg(projectPath: string): WebPkgConfig {
  try {
    const raw = localStorage.getItem(`loom-webpkg:${projectPath}`)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<WebPkgConfig>
      return { ...DEFAULT_WEB_CFG, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_WEB_CFG }
}

function loadMobileCfg(projectPath: string): MobilePkgConfig {
  try {
    const raw = localStorage.getItem(`loom-mobilepkg:${projectPath}`)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<MobilePkgConfig>
      return { ...DEFAULT_MOBILE_CFG, ...parsed }
    }
  } catch { /* ignore */ }
  return { ...DEFAULT_MOBILE_CFG }
}

// 工具链缺失引导卡：分步骤说明 + 「程序自动打开」按钮 + 重新检测
function ToolchainCard({ title, why, steps, actionLabel, onAction }: {
  title: string
  why: string
  steps: string[]
  actionLabel: string
  onAction: () => void
}) {
  return (
    <div className="rounded-lg bg-loom-bg border border-loom-err/30 p-3">
      <div className="flex items-baseline gap-2 mb-1.5">
        <span className="text-loom-err text-[11px] font-mono flex-shrink-0">✗ 未安装</span>
        <span className="text-xs font-semibold text-loom-text">{title}</span>
        <span className="text-[11px] text-loom-muted">{why}</span>
      </div>
      <ol className="text-[11px] text-loom-muted/80 list-decimal list-inside space-y-1 leading-relaxed">
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <div className="flex gap-2 mt-2.5">
        <button
          onClick={onAction}
          className="px-3 py-1.5 rounded bg-loom-accent text-loom-bg text-[11px] font-semibold hover:bg-loom-accent/90 transition-colors"
        >
          {actionLabel}
        </button>
        <button
          onClick={() => void checkSdkForRetest()}
          className="px-3 py-1.5 rounded border border-loom-border text-[11px] text-loom-muted hover:text-loom-text hover:border-loom-accent/50 transition-colors"
        >
          重新检测
        </button>
      </div>
    </div>
  )
}

// 让组件外也能访问的检测回调（由 PackagePage 注入）
let retestFn: (() => void) | null = null
function checkSdkForRetest(): void {
  retestFn?.()
}

export default function PackagePage() {
  const currentProject = useStore((s) => s.currentProject)
  const [tab, setTab] = useState<PackageTab>('app')
  const [packaging, setPackaging] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [buildsDir, setBuildsDir] = useState<string | null>(null)
  const [sdk, setSdk] = useState<SdkStatus | null>(null)
  const [checking, setChecking] = useState(true)

  // ---- 网页应用表单状态 ----
  const projectPath = currentProject?.path ?? ''
  const [webStep, setWebStep] = useState(1)
  const [webCfg, setWebCfg] = useState<WebPkgConfig>(() => loadWebCfg(projectPath))
  const [webPackaging, setWebPackaging] = useState(false)
  const [webError, setWebError] = useState<string | null>(null)
  const [webLogs, setWebLogs] = useState<string[] | null>(null)
  const [webResult, setWebResult] = useState<{ webDir: string; previewUrl: string | null; logs: string[] } | null>(null)
  const [showLogs, setShowLogs] = useState(false)

  // ---- 移动端打包表单状态 ----
  const [mobileStep, setMobileStep] = useState(1)
  const [mobileCfg, setMobileCfg] = useState<MobilePkgConfig>(() => loadMobileCfg(projectPath))
  const [mobilePackaging, setMobilePackaging] = useState(false)
  const [mobileError, setMobileError] = useState<string | null>(null)
  const [mobileLogs, setMobileLogs] = useState<string[] | null>(null)
  const [mobileResult, setMobileResult] = useState<{ outDir: string; logs: string[] } | null>(null)
  // 工具链引导面板默认折叠，避免页面过长
  const [guideOpen, setGuideOpen] = useState(false)
  // 非 ASCII 文件名预检（安卓加载失败根因之一）
  const [nonAsciiItems, setNonAsciiItems] = useState<NonAsciiRenameItem[] | null>(null)
  const [nonAsciiOpen, setNonAsciiOpen] = useState(false)
  // 预检拦截时是否来自「开始打包」点击（应用重命名后继续打包）
  const nonAsciiPendingPackage = useRef(false)

  function updateMobileCfg(patch: Partial<MobilePkgConfig>): void {
    setMobileCfg((prev) => {
      const next = { ...prev, ...patch }
      if (projectPath) {
        try {
          localStorage.setItem(`loom-mobilepkg:${projectPath}`, JSON.stringify(next))
        } catch { /* ignore */ }
      }
      return next
    })
  }

  function updateWebCfg(patch: Partial<WebPkgConfig>): void {
    setWebCfg((prev) => {
      const next = { ...prev, ...patch }
      if (projectPath) {
        try {
          localStorage.setItem(`loom-webpkg:${projectPath}`, JSON.stringify(next))
        } catch { /* ignore */ }
      }
      return next
    })
  }

  async function checkSdk() {
    retestFn = () => void checkSdk()
    setChecking(true)
    try {
      setSdk(await window.pupurin.sdkStatus())
    } catch (e) {
      setSdk({ found: false, exe: null, sdkDir: null, platform: '', downloadUrl: '', webOk: false, androidOk: false, iosOk: false, androidSdkOk: false, jdkOk: false, xcodeOk: false, sdkWritable: false })
      setError('SDK 检测失败：' + String(e))
    } finally {
      setChecking(false)
    }
  }

  useEffect(() => {
    void checkSdk()
  }, [])

  async function handlePackage() {
    if (!currentProject?.path) return
    setPackaging(true)
    setError(null)
    setBuildsDir(null)
    try {
      const result = await window.pupurin.packageGame(currentProject.path, 'all')
      if (result.buildsDir) {
        setBuildsDir(result.buildsDir)
      }
    } catch (e) {
      setError(String(e))
    } finally {
      setPackaging(false)
    }
  }

  async function handlePickIcon(): Promise<void> {
    const path = await window.pupurin.pickImageFile()
    if (path) updateWebCfg({ iconPath: path })
  }

  async function handleWebPackage(): Promise<void> {
    if (!projectPath) return
    setWebPackaging(true)
    setWebError(null)
    setWebResult(null)
    setWebLogs(null)
    try {
      const result = await window.pupurin.packageWeb(projectPath, {
        version: webCfg.version,
        iconPath: webCfg.iconPath,
        preview: webCfg.autoPreview,
      })
      // 无论成败都保留完整日志，便于排查
      setWebLogs(result.logs)
      if (result.webDir) {
        setWebResult({
          webDir: result.webDir,
          previewUrl: result.previewUrl ?? null,
          logs: result.logs,
        })
      } else if (result.logs.some((l) => l.includes('错误'))) {
        setWebError(result.logs.find((l) => l.includes('错误')) ?? '打包失败')
      } else {
        setWebError('打包失败，未生成产物')
      }
    } catch (e) {
      setWebError(String(e))
    } finally {
      setWebPackaging(false)
    }
  }

  function handleOpenDir(dir: string): void {
    window.pupurin.showProjectInFinder(dir)
  }

  // 实际执行移动端打包
  async function runMobilePackage(): Promise<void> {
    if (!projectPath) return
    setMobilePackaging(true)
    setMobileError(null)
    setMobileResult(null)
    setMobileLogs(null)
    try {
      const result = await window.pupurin.packageMobile(projectPath, {
        target: mobileCfg.target,
        bundle: mobileCfg.bundle,
        version: mobileCfg.version,
        packageName: mobileCfg.packageName,
      })
      setMobileLogs(result.logs)
      if (result.outDir) {
        setMobileResult({ outDir: result.outDir, logs: result.logs })
      } else if (result.logs.some((l) => l.includes('错误'))) {
        setMobileError(result.logs.find((l) => l.includes('错误')) ?? '打包失败')
      } else {
        setMobileError('打包失败，未生成产物')
      }
    } catch (e) {
      setMobileError(String(e))
    } finally {
      setMobilePackaging(false)
    }
  }

  async function handleMobilePackage(): Promise<void> {
    if (!projectPath) return
    // 预检：非 ASCII 文件名会打进安卓 APK 后乱码、无法加载（字体/影片/图片）。
    // 发现则拦截并弹窗让用户确认重命名，应用后再继续打包。
    try {
      const items = await window.pupurin.scanNonAsciiFiles(projectPath)
      if (items.length > 0) {
        nonAsciiPendingPackage.current = true
        setNonAsciiItems(items)
        setNonAsciiOpen(true)
        return
      }
    } catch (e) {
      // 扫描失败不阻塞打包，实际打包流程会给出明确错误
      console.error('[package] scan non-ascii failed:', e)
    }
    await runMobilePackage()
  }

  const sdkReady = sdk?.found ?? false
  // 环境依赖清单：按当前打包目标汇总需要检查的项
  const deps: { label: string; ok: boolean }[] = [{ label: "Ren'Py SDK", ok: sdkReady }]
  if (tab === 'web') deps.push({ label: 'Web 平台包', ok: !!sdk?.webOk })
  if (tab === 'mobile') {
    deps.push({ label: 'Android 平台包', ok: !!sdk?.androidOk })
    deps.push({ label: 'iOS 平台包', ok: !!sdk?.iosOk })
    deps.push({ label: 'Java (JDK 21)', ok: !!sdk?.jdkOk })
    deps.push({ label: 'Xcode', ok: !!sdk?.xcodeOk })
    if (mobileCfg.target === 'android') deps.push({ label: 'Android SDK 已安装', ok: !!sdk?.androidSdkOk })
    deps.push({ label: 'SDK 目录可写（文件权限）', ok: !!sdk?.sdkWritable })
  }
  const missingCount = deps.filter((d) => !d.ok).length
  const allReady = missingCount === 0
  const iconName = webCfg.iconPath ? webCfg.iconPath.split(/[\\/]/).pop() : null

  return (
    <div className="flex flex-col h-full">
      {/* 页头 + Tab 切换 */}
      <PageHeader
        title="打包发布"
        tabs={[
          { id: 'app', label: '桌面应用' },
          { id: 'web', label: '网页应用' },
          { id: 'mobile', label: '移动应用' },
        ]}
        activeTab={tab}
        onTabChange={(id) => setTab(id as PackageTab)}
      />

      {/* 主内容 */}
      <div className="flex-1 p-6 overflow-auto">
        <div className="max-w-2xl mx-auto space-y-6">
          {/* SDK 状态 / 首次使用引导（两种打包共用） */}
          {checking ? (
            <div className="rounded-lg bg-loom-panel border border-loom-border p-4">
              <div className="flex items-center gap-3">
                <svg className="animate-spin w-5 h-5 text-loom-muted" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                </svg>
                <span className="text-sm text-loom-muted">正在检测 Ren'Py SDK…</span>
              </div>
            </div>
          ) : (
            <div className={['rounded-lg border p-4', allReady ? 'bg-loom-ok/10 border-loom-ok/30' : 'bg-loom-err/5 border-loom-err/30'].join(' ')}>
              {/* 标题：环境依赖就绪 / 未就绪 */}
              <div className="flex items-center gap-2 mb-2">
                {allReady ? (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="text-loom-ok">
                    <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                ) : (
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="text-loom-err">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                )}
                <span className={['text-sm font-semibold', allReady ? 'text-loom-ok' : 'text-loom-err'].join(' ')}>
                  {allReady ? '环境依赖就绪' : `环境依赖未就绪（${missingCount} 项缺失）`}
                </span>
                <button
                  onClick={() => void checkSdk()}
                  className="ml-auto text-[11px] text-loom-muted hover:text-loom-text transition-colors"
                  title="重新检测"
                >
                  重新检测
                </button>
              </div>

              {/* 依赖项列表 */}
              <div className="space-y-1">
                {deps.map((d) => (
                  <div key={d.label} className="flex items-center gap-2 text-[11px]">
                    <span className={d.ok ? 'text-loom-ok' : 'text-loom-err'}>{d.ok ? '✓' : '✗'}</span>
                    <span className={d.ok ? 'text-loom-text' : 'text-loom-err'}>{d.label}</span>
                    {!d.ok && <span className="text-loom-muted/60">— 需要安装</span>}
                  </div>
                ))}
              </div>
              {sdk?.sdkDir && (
                <p className="mt-1.5 text-[11px] text-loom-muted font-mono truncate">SDK 目录：{sdk.sdkDir}</p>
              )}

              {/* 缺失时：折叠的解决方案 */}
              {!allReady && (
                <div className="mt-3">
                  <button
                    onClick={() => setGuideOpen(!guideOpen)}
                    className="w-full flex items-center justify-between px-3 py-2 rounded-lg bg-loom-bg border border-loom-border text-[11px] text-loom-muted hover:text-loom-text hover:border-loom-accent/50 transition-colors"
                  >
                    <span className="flex items-center gap-2">
                      <span className="text-loom-err font-mono">✗</span>
                      查看解决方案（{missingCount} 项缺失）
                    </span>
                    <span>{guideOpen ? '收起 ▲' : '展开 ▼'}</span>
                  </button>
                  {guideOpen && (
                    <div className="mt-2 space-y-2">
                      {/* SDK 未安装 */}
                      {!sdkReady && (
                        <div className="rounded-lg bg-loom-panel border border-loom-accent/40 p-4 space-y-3">
                          <div className="flex items-center gap-2">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18" className="text-loom-accent">
                              <circle cx="12" cy="12" r="10" />
                              <line x1="12" y1="16" x2="12" y2="12" />
                              <line x1="12" y1="8" x2="12.01" y2="8" />
                            </svg>
                            <h2 className="text-sm font-semibold text-loom-text">请先安装 Ren'Py SDK</h2>
                          </div>
                          <p className="text-xs text-loom-muted leading-relaxed">
                            Ren'Py SDK（约 1GB）是运行与打包游戏的引擎，安装一次即可。铃言织机° 会自动检测以下位置：
                          </p>
                          <ul className="text-[11px] text-loom-muted/80 font-mono space-y-1 bg-loom-bg rounded p-3">
                            {sdk?.platform === 'win32' ? (
                              <>
                                <li>%USERPROFILE%\RenPy\renpy-8.5.2-sdk\renpy.exe</li>
                                <li>C:\RenPy\renpy-8.5.2-sdk\renpy.exe</li>
                              </>
                            ) : (
                              <>
                                <li>/Applications/renpy-8.5.2-sdk/renpy.app</li>
                                <li>~/Applications/renpy-8.5.2-sdk/renpy.app</li>
                              </>
                            )}
                          </ul>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => void window.pupurin.openSdkDownload()}
                              className="flex items-center gap-2 px-4 py-2 rounded-lg bg-loom-accent text-loom-bg text-xs font-semibold hover:bg-loom-accent/90 transition-colors"
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14">
                                <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                              </svg>
                              打开官方下载页
                            </button>
                            <button
                              onClick={() => void checkSdk()}
                              className="px-4 py-2 rounded-lg border border-loom-border text-xs text-loom-muted hover:text-loom-text hover:border-loom-accent/50 transition-colors"
                            >
                              我已安装，重新检测
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Web 平台包缺失 */}
                      {tab === 'web' && sdkReady && !sdk?.webOk && (
                        <div className="rounded-lg bg-loom-accent/10 border border-loom-accent/30 p-3 text-[11px] text-loom-accent leading-relaxed">
                          ⚠ Web 打包需要 SDK 内置 Web 平台包（SDK 根目录的 <code className="font-mono">web/</code> 文件夹）。
                          若打包报错，请到官方下载页获取 Web 平台包并解压进 SDK 目录后重新检测。
                        </div>
                      )}

                      {/* 移动端工具链 */}
                      {tab === 'mobile' && sdkReady && (
                        <>
                          {!sdk?.jdkOk && (
                            <ToolchainCard
                              title="JDK 21（Java）"
                              why="Android 打包需要 Java 21 编译 APK / AAB"
                              steps={[
                                '点击下方按钮，程序会为你打开 Adoptium 官方下载页',
                                '选择 macOS 版本、JDK 21，下载安装包（.pkg / .dmg）',
                                '双击安装（macOS 会自动注册，无需配置环境变量）',
                                '装好后回到这里，点击「重新检测」',
                              ]}
                              actionLabel="打开 JDK 下载页"
                              onAction={() => void window.pupurin.openExternal('https://adoptium.net/temurin/releases/?version=21&os=mac')}
                            />
                          )}
                          {!sdk?.xcodeOk && (
                            <ToolchainCard
                              title="Xcode"
                              why="iOS 打包只能在 Mac 上进行，需要 Xcode 编译工具链"
                              steps={[
                                '点击下方按钮，程序会为你打开 App Store 的 Xcode 页面',
                                '安装 Xcode（体积较大，请耐心等待）',
                                '首次打开 Xcode，同意许可协议（会安装额外组件）',
                                '完成后回到这里，点击「重新检测」',
                              ]}
                              actionLabel="打开 App Store"
                              onAction={() => void window.pupurin.openExternal('https://apps.apple.com/cn/app/xcode/id497799835')}
                            />
                          )}

                          {/* Android SDK 说明（由 Ren'Py launcher 管理，无法自动检测） */}
                          <div className="rounded bg-loom-bg border border-loom-border p-3">
                            <p className="text-[11px] font-semibold text-loom-muted">Android SDK（首次打包 Android 前准备一次）</p>
                            <ol className="mt-1.5 text-[11px] text-loom-muted/80 list-decimal list-inside space-y-1 leading-relaxed">
                              <li>点击下方按钮，程序会为你启动 Ren'Py launcher</li>
                              <li>在 launcher 中选择项目，进入 Android 页面</li>
                              <li>点击 Install SDK 等待下载（约数 GB，需网络）</li>
                              <li>按 launcher 引导配置包名与签名密钥</li>
                            </ol>
                            <button
                              onClick={() => void window.pupurin.sdkOpenLauncher()}
                              className="mt-2.5 px-3 py-1.5 rounded bg-loom-panel2 border border-loom-border text-[11px] text-loom-text hover:border-loom-accent/50 transition-colors"
                            >
                              启动 Ren'Py launcher
                            </button>
                          </div>

                          {/* macOS 文件权限（Operation not permitted） */}
                          {!sdk?.sdkWritable && (
                            <div className="rounded bg-loom-bg border border-loom-err/30 p-3">
                              <p className="text-[11px] font-semibold text-loom-err">macOS 文件权限（Operation not permitted）</p>
                              <p className="mt-1 text-[11px] text-loom-muted/80 leading-relaxed">
                                Android 打包需要把编译中间文件写入 Ren'Py SDK 目录，但 macOS 会拦截未获授权的应用
                                （报 <code className="font-mono">Operation not permitted</code>）。请给当前应用授权「完全磁盘访问权限」。
                              </p>
                              <ol className="mt-1.5 text-[11px] text-loom-muted/80 list-decimal list-inside space-y-1 leading-relaxed">
                                <li>点击下方按钮，程序会为你打开「隐私与安全性 → 完全磁盘访问权限」设置页</li>
                                <li>点击左下角 +，在应用程序中选择并添加「Electron」（当前运行的应用）</li>
                                <li>若列表里已有 Electron，请勾选启用开关</li>
                                <li>完成后回到这里，点击「重新检测」</li>
                              </ol>
                              <div className="flex gap-2 mt-2.5">
                                <button
                                  onClick={() => void window.pupurin.openPrivacySettings()}
                                  className="px-3 py-1.5 rounded bg-loom-accent text-loom-bg text-[11px] font-semibold hover:bg-loom-accent/90 transition-colors"
                                >
                                  打开系统设置
                                </button>
                                <button
                                  onClick={() => void checkSdk()}
                                  className="px-3 py-1.5 rounded border border-loom-border text-[11px] text-loom-muted hover:text-loom-text hover:border-loom-accent/50 transition-colors"
                                >
                                  重新检测
                                </button>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === 'app' ? (
            <>
              {/* ============ 应用打包 ============ */}
              <div className="rounded-lg bg-loom-panel border border-loom-border p-4">
                <h2 className="text-sm font-semibold text-loom-text mb-2">打包说明</h2>
                <p className="text-xs text-loom-muted leading-relaxed">
                  使用 Ren'Py SDK 一键打包桌面应用（Windows / macOS / Linux），
                  打包完成后，输出文件位于项目目录下的 <code className="px-1 py-0.5 bg-loom-bg rounded text-loom-accent">builds/</code> 文件夹。
                </p>
              </div>

              {/* 支持打包平台 */}
              <div className="rounded-lg bg-loom-panel border border-loom-border p-4">
                <h2 className="text-sm font-semibold text-loom-text mb-4">支持打包平台</h2>
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col items-center gap-2 p-3 rounded-lg border border-loom-border/50">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24" className="text-loom-muted">
                      <rect x="2" y="3" width="20" height="14" rx="2" />
                      <path d="M8 21h8M12 17v4" />
                    </svg>
                    <div className="text-xs text-loom-muted">Windows</div>
                  </div>
                  <div className="flex flex-col items-center gap-2 p-3 rounded-lg border border-loom-border/50">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24" className="text-loom-muted">
                      <path d="M12 2a10 10 0 1010 10A10 10 0 0012 2z" />
                      <path d="M12 2a10 10 0 0110 10" />
                    </svg>
                    <div className="text-xs text-loom-muted">macOS</div>
                  </div>
                  <div className="flex flex-col items-center gap-2 p-3 rounded-lg border border-loom-border/50">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="24" height="24" className="text-loom-muted">
                      <circle cx="12" cy="12" r="10" />
                      <path d="M8 12h8M12 8v8" />
                    </svg>
                    <div className="text-xs text-loom-muted">Linux</div>
                  </div>
                </div>
              </div>

              {/* 一键打包按钮 */}
              <div className="flex flex-col items-center gap-2">
                <button
                  onClick={() => void handlePackage()}
                  disabled={packaging || !sdkReady}
                  title={sdkReady ? undefined : '请先安装 RenPy SDK'}
                  className={[
                    'flex items-center gap-3 px-8 py-4 rounded-lg font-semibold transition-colors',
                    packaging || !sdkReady
                      ? 'bg-loom-muted/20 text-loom-muted cursor-not-allowed'
                      : 'bg-loom-accent text-loom-bg hover:bg-loom-accent/90',
                  ].join(' ')}
                >
                  {packaging ? (
                    <>
                      <svg className="animate-spin w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                      </svg>
                      <span>正在打包…</span>
                    </>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
                        <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
                        <polyline points="7 10 12 15 17 10" />
                        <line x1="12" y1="15" x2="12" y2="3" />
                      </svg>
                      <span>开始打包</span>
                    </>
                  )}
                </button>
              </div>

              {/* 错误提示 */}
              {error && (
                <div className="rounded-lg bg-loom-err/10 border border-loom-err/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="text-loom-err">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    <span className="text-sm font-semibold text-loom-err">打包失败</span>
                  </div>
                  <p className="text-xs text-loom-err/80">{error}</p>
                </div>
              )}

              {/* 打包完成 */}
              {buildsDir && (
                <div className="rounded-lg bg-loom-accent/10 border border-loom-accent/30 p-6">
                  <div className="flex flex-col items-center gap-4">
                    <div className="w-16 h-16 rounded-full bg-loom-accent/20 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="32" height="32" className="text-loom-accent">
                        <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    </div>
                    <div className="text-center">
                      <h3 className="text-lg font-semibold text-loom-text mb-1">打包完成</h3>
                      <p className="text-xs text-loom-muted">桌面平台的可分发文件已生成</p>
                    </div>
                    <button
                      onClick={() => handleOpenDir(buildsDir)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-loom-accent text-loom-bg font-medium hover:bg-loom-accent/90 transition-colors"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      </svg>
                      <span>使用 Finder 打开</span>
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : tab === 'web' ? (
            <>
              {/* ============ 网页应用 ============ */}
              <div className="rounded-lg bg-loom-panel border border-loom-border p-4">
                <h2 className="text-sm font-semibold text-loom-text mb-2">网页应用说明</h2>
                <p className="text-xs text-loom-muted leading-relaxed">
                  将游戏导出为 HTML5 / WebAssembly，一份产物可在桌面与移动设备的浏览器中直接游玩
                  （itch.io、Netlify、Vercel、GitHub Pages 等均可托管）。网页版为 Ren'Py 官方 Beta 功能。
                </p>
              </div>

              {/* 步骤指示器 */}
              <div className="flex items-center gap-2">
                {[
                  { n: 1, label: '项目信息' },
                  { n: 2, label: 'Web 外观' },
                  { n: 3, label: '打包选项' },
                ].map((s) => (
                  <div key={s.n} className="flex items-center gap-2">
                    <div
                      className={[
                        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] transition-colors',
                        webStep === s.n
                          ? 'bg-loom-accent/20 text-loom-accent'
                          : webStep > s.n
                            ? 'bg-loom-ok/10 text-loom-ok'
                            : 'bg-loom-panel2 text-loom-muted',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono',
                          webStep === s.n ? 'bg-loom-accent text-loom-bg' : webStep > s.n ? 'bg-loom-ok/40' : 'bg-loom-border/50',
                        ].join(' ')}
                      >
                        {webStep > s.n ? '✓' : s.n}
                      </span>
                      {s.label}
                    </div>
                    {s.n < 3 && <div className="w-6 h-px bg-loom-border" />}
                  </div>
                ))}
              </div>

              {/* 步骤 1：项目信息 */}
              {webStep === 1 && (
                <div className="rounded-lg bg-loom-panel border border-loom-border p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-loom-text">1 · 项目信息</h3>
                  <div>
                    <label className="block text-xs text-loom-muted mb-1">游戏名称</label>
                    <input
                      type="text"
                      value={currentProject?.name ?? ''}
                      readOnly
                      className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm text-loom-text focus:outline-none cursor-not-allowed"
                    />
                    <p className="text-[11px] text-loom-muted/70 mt-1">名称来自项目本身，打包产物将使用它命名。</p>
                  </div>
                  <div>
                    <label className="block text-xs text-loom-muted mb-1">版本号</label>
                    <input
                      type="text"
                      value={webCfg.version}
                      onChange={(e) => updateWebCfg({ version: e.target.value })}
                      placeholder="1.0"
                      className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm text-loom-text focus:outline-none focus:border-loom-accent"
                    />
                    <p className="text-[11px] text-loom-muted/70 mt-1">
                      会写入 <code className="font-mono">options.rpy</code> 的 <code className="font-mono">build.version</code>，用于产物与存档命名。
                    </p>
                  </div>
                </div>
              )}

              {/* 步骤 2：Web 外观 */}
              {webStep === 2 && (
                <div className="rounded-lg bg-loom-panel border border-loom-border p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-loom-text">2 · Web 外观</h3>
                  <div>
                    <label className="block text-xs text-loom-muted mb-1.5">网页图标（可选）</label>
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-lg border border-loom-border overflow-hidden bg-loom-bg flex items-center justify-center flex-shrink-0">
                        {webCfg.iconPath ? (
                          <img src={`file://${webCfg.iconPath}`} alt="icon" className="w-full h-full object-contain" />
                        ) : (
                          <svg viewBox="0 0 24 24" fill="none" stroke="#9a948a" strokeWidth="1.8" width="18" height="18">
                            <rect x="3" y="3" width="18" height="18" rx="3" />
                            <circle cx="8.5" cy="8.5" r="1.5" />
                            <path d="M21 15l-5-5L5 21" />
                          </svg>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-loom-text truncate">{iconName ?? '未选择图标（使用默认）'}</p>
                        <div className="flex gap-2 mt-1.5">
                          <button
                            onClick={() => void handlePickIcon()}
                            className="px-2.5 py-1 rounded bg-loom-panel2 border border-loom-border text-[11px] hover:border-loom-accent/50 transition-colors"
                          >
                            选择图片…
                          </button>
                          {webCfg.iconPath && (
                            <button
                              onClick={() => updateWebCfg({ iconPath: null })}
                              className="px-2.5 py-1 rounded text-[11px] text-loom-muted hover:text-loom-text transition-colors"
                            >
                              清除
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="text-[11px] text-loom-muted/70 mt-2">
                      将生成 <code className="font-mono">web-icon.png</code>。要求 512×512 正方形 PNG/JPG/WebP，会显示在浏览器标签页与收藏夹。
                    </p>
                  </div>
                  <div className="rounded bg-loom-bg border border-loom-border p-3">
                    <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                      加载画面默认使用引擎自带图；如需自定义，可将命名为 <code className="font-mono">web-presplash.png/.jpg/.webp</code> 的图片放入项目根目录
                      （.webp 支持动图）。首次打包会在项目根目录自动生成 <code className="font-mono">progressive_download.txt</code> 渐进下载配置，可自行调整。
                    </p>
                  </div>
                </div>
              )}

              {/* 步骤 3：打包选项 */}
              {webStep === 3 && (
                <div className="rounded-lg bg-loom-panel border border-loom-border p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-loom-text">3 · 打包选项</h3>
                  <label className="flex items-center gap-2.5 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={webCfg.autoPreview}
                      onChange={(e) => updateWebCfg({ autoPreview: e.target.checked })}
                      className="accent-loom-accent w-4 h-4"
                    />
                    <span className="text-xs text-loom-text">打包完成后在本地浏览器中预览</span>
                  </label>
                  <div className="rounded bg-loom-bg border border-loom-border p-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-loom-muted">打包后如何发布：</p>
                    <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                      · itch.io 等游戏平台：上传 <code className="font-mono">web.zip</code>（位于 builds/web/ 下）
                    </p>
                    <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                      · 自托管（Netlify / Vercel / GitHub Pages / 自有服务器）：上传整个 web 产物文件夹，
                      需确保服务器将 <code className="font-mono">.wasm</code> 以 <code className="font-mono">application/wasm</code> MIME 提供
                    </p>
                    <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                      · 网页版不支持：多线程、网络请求、Live2D；视频建议 WebM（Safari 自动回退 MP4）
                    </p>
                  </div>
                </div>
              )}

              {/* 步骤导航 + 开始打包 */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setWebStep((s) => Math.max(1, s - 1))}
                  disabled={webStep === 1 || webPackaging}
                  className="px-4 py-2 rounded-lg border border-loom-border text-xs text-loom-muted hover:text-loom-text transition-colors disabled:opacity-40"
                >
                  上一步
                </button>
                {webStep < 3 ? (
                  <button
                    onClick={() => setWebStep((s) => Math.min(3, s + 1))}
                    className="px-6 py-2 rounded-lg bg-loom-accent text-loom-bg text-xs font-semibold hover:bg-loom-accent/90 transition-colors"
                  >
                    下一步
                  </button>
                ) : (
                  <button
                    onClick={() => void handleWebPackage()}
                    disabled={webPackaging || !sdkReady}
                    title={sdkReady ? undefined : '请先安装 RenPy SDK'}
                    className={[
                      'flex items-center gap-2 px-8 py-2.5 rounded-lg font-semibold transition-colors text-sm',
                      webPackaging || !sdkReady
                        ? 'bg-loom-muted/20 text-loom-muted cursor-not-allowed'
                        : 'bg-loom-accent text-loom-bg hover:bg-loom-accent/90',
                    ].join(' ')}
                  >
                    {webPackaging ? (
                      <>
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                        </svg>
                        <span>正在打包网页应用…</span>
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                          <circle cx="12" cy="12" r="10" />
                          <line x1="2" y1="12" x2="22" y2="12" />
                          <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                        </svg>
                        <span>开始打包</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* 网页应用错误（含完整日志，便于排查） */}
              {webError && (
                <div className="rounded-lg bg-loom-err/10 border border-loom-err/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="text-loom-err">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    <span className="text-sm font-semibold text-loom-err">打包失败</span>
                  </div>
                  <p className="text-xs text-loom-err/80 whitespace-pre-wrap">{webError}</p>
                  {webLogs && (
                    <pre className="mt-3 text-[11px] font-mono text-loom-muted/80 whitespace-pre-wrap break-all bg-loom-bg rounded p-3 max-h-48 overflow-auto">
                      {webLogs.join('')}
                    </pre>
                  )}
                </div>
              )}

              {/* 网页应用完成 */}
              {webResult && (
                <div className="rounded-lg bg-loom-accent/10 border border-loom-accent/30 p-6 space-y-4">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-full bg-loom-accent/20 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="28" height="28" className="text-loom-accent">
                        <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    </div>
                    <div className="text-center">
                      <h3 className="text-lg font-semibold text-loom-text mb-1">网页应用打包完成</h3>
                      <p className="text-xs text-loom-muted">产物位于 builds/web/ 文件夹，上传 web.zip 或整个文件夹即可发布</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {webResult.previewUrl && (
                        <button
                          onClick={() => void window.pupurin.openExternal(webResult.previewUrl!)}
                          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-loom-accent text-loom-bg font-medium hover:bg-loom-accent/90 transition-colors"
                        >
                          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                            <circle cx="12" cy="12" r="10" />
                            <line x1="2" y1="12" x2="22" y2="12" />
                            <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
                          </svg>
                          <span>浏览器预览</span>
                        </button>
                      )}
                      <button
                        onClick={() => handleOpenDir(webResult.webDir)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-loom-panel2 border border-loom-border font-medium hover:border-loom-accent/50 transition-colors text-xs"
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                          <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                        </svg>
                        <span>打开产物文件夹</span>
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowLogs(!showLogs)}
                    className="w-full text-[11px] text-loom-muted hover:text-loom-text transition-colors"
                  >
                    {showLogs ? '收起打包日志 ▲' : '查看打包日志 ▼'}
                  </button>
                  {showLogs && (
                    <pre className="text-[11px] font-mono text-loom-muted/80 whitespace-pre-wrap break-all bg-loom-bg rounded p-3 max-h-48 overflow-auto">
                      {webResult.logs.join('')}
                    </pre>
                  )}
                </div>
              )}
            </>
          ) : (
            <>
              {/* ============ 移动应用 ============ */}
              <div className="rounded-lg bg-loom-panel border border-loom-border p-4">
                <h2 className="text-sm font-semibold text-loom-text mb-2">移动应用打包说明</h2>
                <p className="text-xs text-loom-muted leading-relaxed">
                  Android 使用 Ren'Py 官方 RAPT 工具打包 APK / AAB；iOS 使用 renios 在 macOS 上打包 IPA。
                  首次打包前请确认 SDK 状态卡片中的平台包与工具链是否就绪（Android 需 JDK 21 + Android SDK；
                  iOS 仅限 macOS + Xcode）。
                </p>
              </div>

              {/* 推荐提示：优先网页打包 */}
              <div className="rounded-lg bg-loom-accent/10 border border-loom-accent/30 p-4">
                <div className="flex items-start gap-3">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#FFE4A6" strokeWidth="2" width="18" height="18" className="flex-shrink-0 mt-0.5">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="16" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12.01" y2="8" />
                  </svg>
                  <div className="flex-1">
                    <p className="text-xs font-semibold text-loom-text">
                      想先让手机能玩？推荐优先使用「网页应用」
                    </p>
                    <p className="text-[11px] text-loom-muted/80 leading-relaxed mt-1">
                      一份网页产物，桌面与手机浏览器直接打开就能玩，无需签名、证书，也不用
                      Apple 开发者账号（$99/年）或 Google Play 审核。移动应用打包适合后续正式上架
                      应用商店时再考虑（尤其 iOS 还需要 Xcode 签名配置）。
                    </p>
                    <button
                      onClick={() => setTab('web')}
                      className="mt-2.5 px-3 py-1.5 rounded bg-loom-accent text-loom-bg text-[11px] font-semibold hover:bg-loom-accent/90 transition-colors"
                    >
                      前往网页应用 →
                    </button>
                  </div>
                </div>
              </div>

              {/* 步骤指示器 */}
              <div className="flex items-center gap-2">
                {[
                  { n: 1, label: '目标平台' },
                  { n: 2, label: '版本与包名' },
                  { n: 3, label: '打包选项' },
                ].map((s) => (
                  <div key={s.n} className="flex items-center gap-2">
                    <div
                      className={[
                        'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] transition-colors',
                        mobileStep === s.n
                          ? 'bg-loom-accent/20 text-loom-accent'
                          : mobileStep > s.n
                            ? 'bg-loom-ok/10 text-loom-ok'
                            : 'bg-loom-panel2 text-loom-muted',
                      ].join(' ')}
                    >
                      <span
                        className={[
                          'w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono',
                          mobileStep === s.n ? 'bg-loom-accent text-loom-bg' : mobileStep > s.n ? 'bg-loom-ok/40' : 'bg-loom-border/50',
                        ].join(' ')}
                      >
                        {mobileStep > s.n ? '✓' : s.n}
                      </span>
                      {s.label}
                    </div>
                    {s.n < 3 && <div className="w-6 h-px bg-loom-border" />}
                  </div>
                ))}
              </div>

              {/* 步骤 1：目标平台 */}
              {mobileStep === 1 && (
                <div className="rounded-lg bg-loom-panel border border-loom-border p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-loom-text">1 · 目标平台</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <button
                      onClick={() => updateMobileCfg({ target: 'android' })}
                      className={[
                        'flex flex-col items-center gap-2 p-4 rounded-lg border transition-colors',
                        mobileCfg.target === 'android'
                          ? 'border-loom-accent bg-loom-accent/10'
                          : 'border-loom-border bg-loom-bg hover:border-loom-accent/40',
                      ].join(' ')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26" className={mobileCfg.target === 'android' ? 'text-loom-accent' : 'text-loom-muted'}>
                        <rect x="7" y="2" width="10" height="18" rx="2" />
                        <line x1="10" y1="4" x2="14" y2="4" />
                        <line x1="10" y1="16" x2="14" y2="16" />
                      </svg>
                      <span className={['text-sm font-medium', mobileCfg.target === 'android' ? 'text-loom-accent' : 'text-loom-text'].join(' ')}>Android</span>
                      <span className="text-[11px] text-loom-muted">APK / AAB · RAPT</span>
                    </button>
                    <button
                      onClick={() => updateMobileCfg({ target: 'ios' })}
                      disabled={sdk?.platform !== 'darwin'}
                      title={sdk?.platform !== 'darwin' ? 'iOS 打包仅支持 macOS' : undefined}
                      className={[
                        'flex flex-col items-center gap-2 p-4 rounded-lg border transition-colors',
                        mobileCfg.target === 'ios'
                          ? 'border-loom-accent bg-loom-accent/10'
                          : 'border-loom-border bg-loom-bg hover:border-loom-accent/40',
                        sdk?.platform !== 'darwin' ? 'opacity-40 cursor-not-allowed' : '',
                      ].join(' ')}
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="26" height="26" className={mobileCfg.target === 'ios' ? 'text-loom-accent' : 'text-loom-muted'}>
                        <rect x="7" y="2" width="10" height="18" rx="2" />
                        <line x1="10" y1="4" x2="14" y2="4" />
                        <path d="M9 20l1.5 2h3l1.5-2" />
                      </svg>
                      <span className={['text-sm font-medium', mobileCfg.target === 'ios' ? 'text-loom-accent' : 'text-loom-text'].join(' ')}>iOS</span>
                      <span className="text-[11px] text-loom-muted">IPA · renios（需 macOS）</span>
                    </button>
                  </div>
                  {mobileCfg.target === 'android' && (
                    <div className="rounded bg-loom-bg border border-loom-border p-3">
                      <label className="block text-xs text-loom-muted mb-2">产物格式</label>
                      <div className="flex gap-3">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="android-format"
                            checked={!mobileCfg.bundle}
                            onChange={() => updateMobileCfg({ bundle: false })}
                            className="accent-loom-accent"
                          />
                          <span className="text-xs text-loom-text">
                            APK<span className="text-loom-muted/70"> — 可直接安装、分享</span>
                          </span>
                        </label>
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="radio"
                            name="android-format"
                            checked={mobileCfg.bundle}
                            onChange={() => updateMobileCfg({ bundle: true })}
                            className="accent-loom-accent"
                          />
                          <span className="text-xs text-loom-text">
                            AAB<span className="text-loom-muted/70"> — Google Play 上架用</span>
                          </span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* 步骤 2：版本号与包名 */}
              {mobileStep === 2 && (
                <div className="rounded-lg bg-loom-panel border border-loom-border p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-loom-text">2 · 版本号与包名</h3>
                  <div>
                    <label className="block text-xs text-loom-muted mb-1">版本号</label>
                    <input
                      type="text"
                      value={mobileCfg.version}
                      onChange={(e) => updateMobileCfg({ version: e.target.value })}
                      placeholder="1.0"
                      className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm text-loom-text focus:outline-none focus:border-loom-accent"
                    />
                    <p className="text-[11px] text-loom-muted/70 mt-1">
                      会写入 <code className="font-mono">options.rpy</code> 的 <code className="font-mono">build.version</code>，
                      用于产物命名与版本识别。
                    </p>
                  </div>
                  {mobileCfg.target === 'android' && (
                    <div>
                      <label className="block text-xs text-loom-muted mb-1">Android 包名</label>
                      <input
                        type="text"
                        value={mobileCfg.packageName}
                        onChange={(e) => updateMobileCfg({ packageName: e.target.value })}
                        placeholder="com.pupurin.loom.game"
                        className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm text-loom-text focus:outline-none focus:border-loom-accent font-mono"
                      />
                      <p className="text-[11px] text-loom-muted/70 mt-1">
                        应用唯一标识，如 <code className="font-mono">com.域名.项目名</code>。仅限小写字母、数字与点，
                        至少包含一个点。留空则使用默认值 <code className="font-mono">com.pupurin.loom.game</code>。
                        将自动写入项目的 <code className="font-mono">android.json</code>。
                      </p>
                    </div>
                  )}
                  <div className="rounded bg-loom-bg border border-loom-border p-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-loom-muted">首次打包前请确认：</p>
                    {mobileCfg.target === 'android' ? (
                      <>
                        <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                          · 安装 JDK 21（Adoptium Temurin）并配置 <code className="font-mono">JAVA_HOME</code>
                        </p>
                        <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                          · 若未检测到 Android SDK，请先打开 Ren'Py launcher 的 Android 页完成 SDK 下载
                        </p>
                        <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                          · 包名与签名配置由程序自动写入 <code className="font-mono">android.json</code>，无需手动操作
                        </p>
                      </>
                    ) : (
                      <>
                        <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                          · iOS 打包仅在 macOS 上进行，需要安装完整 Xcode（含 iOS SDK）
                        </p>
                        <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                          · iOS 平台包（renios）首次打包时自动下载安装，无需手动操作
                        </p>
                        <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                          · 上架 App Store 需要 Apple Developer 账号（$99/年）与签名证书
                        </p>
                      </>
                    )}
                  </div>
                </div>
              )}

              {/* 步骤 3：打包选项 */}
              {mobileStep === 3 && (
                <div className="rounded-lg bg-loom-panel border border-loom-border p-4 space-y-3">
                  <h3 className="text-sm font-semibold text-loom-text">3 · 打包选项</h3>
                  <div className="rounded bg-loom-bg border border-loom-border p-3 space-y-1.5">
                    <p className="text-[11px] font-semibold text-loom-muted">打包完成后：</p>
                    <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                      · Android 产物为 <code className="font-mono">.apk</code>（直接安装）或 <code className="font-mono">.aab</code>（Google Play），位于 builds/android/
                    </p>
                    <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                      · iOS 生成 Xcode 工程并编译真机 <code className="font-mono">.app</code>（未签名），位于 builds/ios/；安装真机 / 上架需在 Xcode 中配置签名后重新构建
                    </p>
                    <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                      · 移动端建议：屏幕适配使用 Ren'Py 内置 phone 布局；音频推荐 MP3；文本输入（input）对中文支持有限
                    </p>
                  </div>
                </div>
              )}

              {/* 步骤导航 + 开始打包 */}
              <div className="flex items-center justify-between">
                <button
                  onClick={() => setMobileStep((s) => Math.max(1, s - 1))}
                  disabled={mobileStep === 1 || mobilePackaging}
                  className="px-4 py-2 rounded-lg border border-loom-border text-xs text-loom-muted hover:text-loom-text transition-colors disabled:opacity-40"
                >
                  上一步
                </button>
                {mobileStep < 3 ? (
                  <button
                    onClick={() => setMobileStep((s) => Math.min(3, s + 1))}
                    className="px-6 py-2 rounded-lg bg-loom-accent text-loom-bg text-xs font-semibold hover:bg-loom-accent/90 transition-colors"
                  >
                    下一步
                  </button>
                ) : (
                  <button
                    onClick={() => void handleMobilePackage()}
                    disabled={mobilePackaging || !sdkReady}
                    title={sdkReady ? undefined : '请先安装 RenPy SDK'}
                    className={[
                      'flex items-center gap-2 px-8 py-2.5 rounded-lg font-semibold transition-colors text-sm',
                      mobilePackaging || !sdkReady
                        ? 'bg-loom-muted/20 text-loom-muted cursor-not-allowed'
                        : 'bg-loom-accent text-loom-bg hover:bg-loom-accent/90',
                    ].join(' ')}
                  >
                    {mobilePackaging ? (
                      <>
                        <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                        </svg>
                        <span>正在移动端打包…</span>
                      </>
                    ) : (
                      <>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
                          <rect x="7" y="2" width="10" height="18" rx="2" />
                          <line x1="10" y1="4" x2="14" y2="4" />
                          <line x1="10" y1="16" x2="14" y2="16" />
                        </svg>
                        <span>开始打包</span>
                      </>
                    )}
                  </button>
                )}
              </div>

              {/* 移动端打包错误 */}
              {mobileError && (
                <div className="rounded-lg bg-loom-err/10 border border-loom-err/30 p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="16" height="16" className="text-loom-err">
                      <circle cx="12" cy="12" r="10" />
                      <line x1="15" y1="9" x2="9" y2="15" />
                      <line x1="9" y1="9" x2="15" y2="15" />
                    </svg>
                    <span className="text-sm font-semibold text-loom-err">打包失败</span>
                  </div>
                  <p className="text-xs text-loom-err/80 whitespace-pre-wrap">{mobileError}</p>
                </div>
              )}

              {/* 移动端打包日志 */}
              {mobileLogs && !mobileResult && (
                <div className="rounded-lg bg-loom-panel border border-loom-border overflow-hidden">
                  <button
                    onClick={() => setShowLogs(!showLogs)}
                    className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-loom-muted hover:text-loom-text transition-colors"
                  >
                    <span>打包日志</span>
                    <span>{showLogs ? '收起 ▲' : '展开 ▼'}</span>
                  </button>
                  {showLogs && (
                    <pre className="text-[11px] font-mono text-loom-muted/80 whitespace-pre-wrap break-all bg-loom-bg border-t border-loom-border p-3 max-h-64 overflow-auto">
                      {mobileLogs.join('')}
                    </pre>
                  )}
                </div>
              )}

              {/* 移动端打包完成 */}
              {mobileResult && (
                <div className="rounded-lg bg-loom-accent/10 border border-loom-accent/30 p-6 space-y-4">
                  <div className="flex flex-col items-center gap-3">
                    <div className="w-14 h-14 rounded-full bg-loom-accent/20 flex items-center justify-center">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="28" height="28" className="text-loom-accent">
                        <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    </div>
                    <div className="text-center">
                      <h3 className="text-lg font-semibold text-loom-text mb-1">
                        {mobileCfg.target === 'ios' ? 'iOS' : mobileCfg.bundle ? 'Android (AAB)' : 'Android (APK)'} 打包完成
                      </h3>
                      <p className="text-xs text-loom-muted">
                        产物位于 builds/{mobileCfg.target}/ 文件夹
                      </p>
                    </div>
                    <button
                      onClick={() => handleOpenDir(mobileResult.outDir)}
                      className="flex items-center gap-2 px-4 py-2 rounded-lg bg-loom-accent text-loom-bg font-medium hover:bg-loom-accent/90 transition-colors"
                    >
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="15" height="15">
                        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
                      </svg>
                      <span>打开产物文件夹</span>
                    </button>
                  </div>
                  <button
                    onClick={() => setShowLogs(!showLogs)}
                    className="w-full text-[11px] text-loom-muted hover:text-loom-text transition-colors"
                  >
                    {showLogs ? '收起打包日志 ▲' : '查看打包日志 ▼'}
                  </button>
                  {showLogs && (
                    <pre className="text-[11px] font-mono text-loom-muted/80 whitespace-pre-wrap break-all bg-loom-bg rounded p-3 max-h-48 overflow-auto">
                      {mobileResult.logs.join('')}
                    </pre>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* 非 ASCII 文件名检查/修复弹窗（移动端打包预检拦截） */}
      {nonAsciiOpen && nonAsciiItems && (
        <NonAsciiRenameDialog
          projectPath={projectPath}
          items={nonAsciiItems}
          onClose={() => {
            nonAsciiPendingPackage.current = false
            setNonAsciiOpen(false)
          }}
          onApplied={() => {
            // 用户确认重命名后，若本次点击来自「开始打包」则继续打包
            if (nonAsciiPendingPackage.current) {
              nonAsciiPendingPackage.current = false
              void runMobilePackage()
            }
          }}
          onSkipConfirm={() => {
            // 用户取消改名但确认仍要继续 → 继续打包（明知可能加载失败）
            nonAsciiPendingPackage.current = false
            void runMobilePackage()
          }}
        />
      )}
    </div>
  )
}
