import { useEffect, useMemo, useState } from 'react'
import type { ArchiveProgress, ExportSizeInfo, ProjectExportOptions } from '../types'
import { collectLoomData } from '../store/projectArchiveData'

interface Props {
  projectPath: string
  onClose: () => void
  /** 导出成功后回调（可用于刷新列表） */
  onExported?: (archivePath: string) => void
}

type OptionKey = keyof ProjectExportOptions

interface OptionRow {
  key: OptionKey
  label: string
  desc: string
  /** 对应体积分类 */
  sizeKey: keyof ExportSizeInfo
  /** 默认勾选 */
  on: boolean
}

// 勾选项：素材三类 + Loom 侧数据 + 编译缓存（默认不勾）
const ROWS: OptionRow[] = [
  { key: 'images', label: '图片素材', desc: 'game/images/ 下的图片（立绘、背景、CG 等）', sizeKey: 'images', on: true },
  { key: 'audio', label: '音频素材', desc: 'game/audio/ 下的音乐与音效', sizeKey: 'audio', on: true },
  { key: 'video', label: '视频素材', desc: 'game/video/、game/movies/ 下的影片', sizeKey: 'video', on: true },
  {
    key: 'loomData',
    label: 'Loom 侧数据',
    desc: '版本方案与标签色、项目简介、来点灵感配置、打包设置、分镜标记',
    sizeKey: 'loomData',
    on: true,
  },
  { key: 'rpyc', label: '编译缓存', desc: '*.rpyc 文件（体积大，Ren\'Py 首次运行时会自动重建）', sizeKey: 'rpyc', on: false },
]

function formatBytes(n: number): string {
  if (n <= 0) return '0 B'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`
}

/**
 * 导出项目弹窗（.loom 归档）
 *
 * 勾选要打包的内容 → 主进程弹保存对话框 → 打包（zip，改扩展名为 .loom）。
 * 存档 / 缓存 / 打包产物 / 日志等始终排除，导出后解压即为一个可直接打开的 Ren'Py 项目目录。
 */
export default function ExportProjectDialog({ projectPath, onClose, onExported }: Props): JSX.Element {
  const [opts, setOpts] = useState<ProjectExportOptions>(() => {
    const init = {} as ProjectExportOptions
    for (const r of ROWS) init[r.key] = r.on
    return init
  })
  const [sizes, setSizes] = useState<ExportSizeInfo | null>(null)
  const [sizeErr, setSizeErr] = useState<string | null>(null)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState<ArchiveProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ archivePath: string; bytes: number; files: number } | null>(null)

  // 体积预估（按分类统计，进入弹窗时计算一次）
  useEffect(() => {
    let alive = true
    window.pupurin
      .getExportSize(projectPath)
      .then((s) => {
        if (alive) setSizes(s)
      })
      .catch((e) => {
        if (alive) setSizeErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      alive = false
    }
  }, [projectPath])

  // 打包进度
  useEffect(() => {
    if (!exporting) return
    return window.pupurin.onArchiveProgress((ev) => setProgress(ev))
  }, [exporting])

  // 勾选项体积合计（含必需部分）
  const totalBytes = useMemo(() => {
    if (!sizes) return 0
    let n = sizes.core
    for (const r of ROWS) if (opts[r.key]) n += sizes[r.sizeKey]
    return n
  }, [sizes, opts])

  async function handleExport(): Promise<void> {
    if (exporting) return
    setError(null)
    setExporting(true)
    setProgress(null)
    try {
      const loomData = opts.loomData ? collectLoomData(projectPath) : undefined
      const r = await window.pupurin.exportProject(projectPath, opts, loomData)
      if (r.cancelled) {
        setExporting(false)
        return
      }
      setResult({ archivePath: r.archivePath ?? '', bytes: r.bytes ?? 0, files: r.files ?? 0 })
      if (r.archivePath) onExported?.(r.archivePath)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setExporting(false)
    }
  }

  const pct = progress?.total ? Math.min(100, Math.round(((progress.done ?? 0) / progress.total) * 100)) : null

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50" onClick={exporting ? undefined : onClose}>
      <div
        className="bg-loom-panel2 border border-loom-border rounded-lg shadow-xl w-[560px] max-h-[82vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4 pb-3 border-b border-loom-border">
          <h3 className="text-sm font-semibold text-loom-text">导出 Loom 项目</h3>
          <p className="text-[11px] text-loom-muted mt-1">
            导出为 <span className="font-mono text-loom-accent">.loom</span> 归档（本质为 zip），可在任意设备的铃言织机中「导入 Loom 项目」恢复。
          </p>
        </div>

        {result ? (
          // 导出完成
          <div className="p-5">
            <div className="flex items-center gap-2 text-loom-ok text-sm font-medium">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="16" height="16">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                <path d="M22 4L12 14.01l-3-3" />
              </svg>
              导出完成
            </div>
            <div className="mt-3 text-xs text-loom-muted leading-relaxed">
              共打包 <span className="text-loom-text font-mono">{result.files}</span> 个文件，归档大小{' '}
              <span className="text-loom-text font-mono">{formatBytes(result.bytes)}</span>。
            </div>
            <div className="mt-3 px-3 py-2 rounded bg-loom-bg border border-loom-border text-[11px] font-mono text-loom-muted break-all">
              {result.archivePath}
            </div>
            <div className="mt-4 flex items-center gap-2">
              <button
                onClick={() => void window.pupurin.revealPath(result.archivePath)}
                className="px-3 py-2 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors"
              >
                在 Finder 中显示
              </button>
              <div className="flex-1" />
              <button
                onClick={onClose}
                className="px-4 py-2 rounded bg-loom-accent text-loom-bg font-semibold text-xs hover:opacity-90 transition-opacity"
              >
                完成
              </button>
            </div>
          </div>
        ) : (
          <>
            <div className="p-5 overflow-auto">
              {sizeErr && (
                <div className="mb-3 px-3 py-2 rounded bg-loom-err/15 border border-loom-err/40 text-loom-err text-xs">
                  {sizeErr}
                </div>
              )}

              {/* 必需部分（不可取消） */}
              <div className="flex items-start gap-3 px-3 py-2.5 rounded bg-loom-bg/60 border border-loom-border/60">
                <span className="mt-0.5 w-3.5 h-3.5 rounded border border-loom-accent bg-loom-accent/70 flex items-center justify-center flex-shrink-0">
                  <svg viewBox="0 0 24 24" fill="none" stroke="#1b1b1b" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" width="9" height="9">
                    <path d="M20 6L9 17l-5-5" />
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-loom-text font-medium">剧本与配置（必需）</div>
                  <div className="text-[11px] text-loom-muted mt-0.5">.rpy 剧本、options.rpy、界面资源（gui/）、字体、翻译等</div>
                </div>
                <div className="text-[11px] text-loom-muted font-mono flex-shrink-0">{sizes ? formatBytes(sizes.core) : '…'}</div>
              </div>

              {/* 勾选项 */}
              <div className="mt-2 space-y-1.5">
                {ROWS.map((r) => {
                  const on = opts[r.key]
                  const size = sizes ? sizes[r.sizeKey] : null
                  return (
                    <label
                      key={r.key}
                      className="flex items-start gap-3 px-3 py-2.5 rounded border border-loom-border bg-loom-bg hover:border-loom-accent/50 transition-colors cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={exporting}
                        onChange={(e) => setOpts((prev) => ({ ...prev, [r.key]: e.target.checked }))}
                        className="mt-0.5 w-3.5 h-3.5 accent-loom-accent flex-shrink-0"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-loom-text font-medium">{r.label}</div>
                        <div className="text-[11px] text-loom-muted mt-0.5 leading-snug">{r.desc}</div>
                      </div>
                      <div className={`text-[11px] font-mono flex-shrink-0 ${on ? 'text-loom-muted' : 'text-loom-muted/40'}`}>
                        {size === null ? '…' : formatBytes(size)}
                      </div>
                    </label>
                  )
                })}
              </div>

              <div className="mt-3 text-[11px] text-loom-muted leading-relaxed">
                始终排除：<span className="font-mono">builds/</span>（打包产物）、
                <span className="font-mono">game/cache/</span>、<span className="font-mono">game/saves/</span>（本地存档）、
                <span className="font-mono">log.txt</span>。
                归档解开后即为一个可直接导入的 Ren'Py 项目目录。
              </div>

              {!opts.images && (
                <div className="mt-2 text-[11px] text-loom-accent/90">提示：未包含图片素材时，导入后的项目将缺少图片，游戏内对应内容无法显示。</div>
              )}

              {/* 进度 */}
              {exporting && (
                <div className="mt-3 px-3 py-2.5 rounded bg-loom-bg border border-loom-border">
                  <div className="flex items-center gap-2 text-[11px] text-loom-muted">
                    <span className="inline-block w-3 h-3 border border-loom-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />
                    <span className="flex-1 truncate font-mono">{progress?.current ?? '正在准备…'}</span>
                    {pct !== null && <span className="font-mono">{pct}%</span>}
                  </div>
                  <div className="mt-2 h-1 rounded-full bg-loom-border overflow-hidden">
                    <div className="h-full bg-loom-accent transition-all" style={{ width: `${pct ?? 8}%` }} />
                  </div>
                </div>
              )}

              {error && (
                <div className="mt-3 px-3 py-2 rounded bg-loom-err/15 border border-loom-err/40 text-loom-err text-xs break-all">
                  {error}
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-loom-border flex items-center gap-2">
              <div className="text-[11px] text-loom-muted">
                预计大小 <span className="text-loom-text font-mono">{sizes ? formatBytes(totalBytes) : '…'}</span>
              </div>
              <div className="flex-1" />
              <button
                onClick={onClose}
                disabled={exporting}
                className="px-3 py-2 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors disabled:opacity-40"
              >
                取消
              </button>
              <button
                onClick={() => void handleExport()}
                disabled={exporting}
                className="px-4 py-2 rounded bg-loom-accent text-loom-bg font-semibold text-xs hover:opacity-90 disabled:opacity-40 transition-opacity"
              >
                {exporting ? '正在导出…' : '导出…'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
