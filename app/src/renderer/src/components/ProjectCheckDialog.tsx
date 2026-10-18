import { useEffect, useState } from 'react'
import type {
  MediaConvertProgress,
  MediaConvertResult,
  MediaFormatItem,
  MediaKind,
  NonAsciiRenameItem,
  NonAsciiRenameResult,
  ProjectCheckTab,
} from '../types'

interface Props {
  projectPath: string
  /** 非 ASCII 文件名检查结果 */
  asciiItems: NonAsciiRenameItem[]
  /** 不支持的媒体格式检查结果 */
  mediaItems: MediaFormatItem[]
  /** 打开时默认显示的选项卡 */
  initialTab?: ProjectCheckTab
  onClose: () => void
  /** 任一项应用成功后回调（可在此刷新文件列表等） */
  onApplied?: (result: { ascii?: NonAsciiRenameResult; media?: MediaConvertResult }) => void
  /**
   * 用户取消（未处理任何问题）时，先弹「仍要继续吗」确认；确认后调用此回调继续原流程。
   * 仅打包预检等「用户可能明知风险仍要继续」的场景传入；不传则取消直接关闭。
   */
  onSkipConfirm?: () => void
}

// 各类别可选的转换目标（必须是 Ren'Py 支持的格式，与主进程校验保持一致）
const MEDIA_TARGETS: Record<MediaKind, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp'],
  audio: ['ogg', 'opus', 'mp3', 'mp2', 'flac', 'wav'],
  video: ['webm', 'mkv', 'ogv', 'mpg'],
}

const KIND_LABEL: Record<MediaKind, string> = { image: '图片', audio: '音频', video: '视频' }
const KIND_CLS: Record<MediaKind, string> = {
  image: 'bg-loom-accent/15 text-loom-accent border-loom-accent/30',
  audio: 'bg-loom-ok/15 text-loom-ok border-loom-ok/30',
  video: 'bg-loom-border/40 text-loom-text border-loom-border',
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase()
}

/**
 * 项目检查弹窗（两个选项卡，共用红点提示）
 *
 * 1) 非 ASCII 文件名：Ren'Py 要求游戏内文件名必须为 ASCII，否则打进安卓 APK 后乱码、
 *    字体/影片/图片无法加载。列出问题文件，右侧可编辑新名称，应用后重命名并同步 .rpy 引用。
 * 2) 不支持的媒体格式：Ren'Py 只支持特定格式的图片/音频/视频，列出无法播放的文件，
 *    用 ffmpeg 转成受支持格式（目标扩展名可编辑），并同步 .rpy 引用。
 */
export default function ProjectCheckDialog({
  projectPath,
  asciiItems,
  mediaItems,
  initialTab,
  onClose,
  onApplied,
  onSkipConfirm,
}: Props): JSX.Element {
  const [tab, setTab] = useState<ProjectCheckTab>(initialTab ?? (asciiItems.length > 0 ? 'ascii' : 'media'))

  // 非 ASCII 选项卡：可编辑的新名称（key 为扫描结果索引）
  const [asciiNames, setAsciiNames] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {}
    asciiItems.forEach((it, i) => {
      init[i] = it.suggested
    })
    return init
  })
  const [asciiApplying, setAsciiApplying] = useState(false)
  const [asciiError, setAsciiError] = useState<string | null>(null)
  const [asciiResult, setAsciiResult] = useState<NonAsciiRenameResult | null>(null)

  // 媒体格式选项卡
  const [mediaNames, setMediaNames] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {}
    mediaItems.forEach((it, i) => {
      init[i] = it.suggested
    })
    return init
  })
  const [mediaApplying, setMediaApplying] = useState(false)
  const [mediaProgress, setMediaProgress] = useState('')
  const [mediaError, setMediaError] = useState<string | null>(null)
  const [mediaResult, setMediaResult] = useState<MediaConvertResult | null>(null)

  // 用户点击「取消」后是否弹「仍要继续打包吗」确认
  const [confirmSkip, setConfirmSkip] = useState(false)

  // 转换进度（ffmpeg 下载/准备 + 逐文件进度）
  useEffect(() => {
    if (!mediaApplying) return
    setMediaProgress('正在准备 ffmpeg…')
    return window.pupurin.onMediaConvertProgress((ev: MediaConvertProgress) => {
      if (ev.phase === 'ffmpeg') setMediaProgress(ev.message ?? '正在准备 ffmpeg…')
      else if (ev.current) setMediaProgress(`正在转换 (${(ev.done ?? 0) + 1}/${ev.total ?? 0}) ${ev.current}`)
    })
  }, [mediaApplying])

  const applied = Boolean(asciiResult || mediaResult)

  async function applyAscii(): Promise<void> {
    if (asciiApplying) return
    setAsciiError(null)
    setAsciiApplying(true)
    try {
      const res = await window.pupurin.applyNonAsciiRename(
        projectPath,
        asciiItems.map((it, i) => ({
          dir: it.dir,
          oldName: it.oldName,
          newName: asciiNames[i]?.trim() || it.suggested,
          isDir: it.isDir,
        }))
      )
      setAsciiResult(res)
      onApplied?.({ ascii: res })
    } catch (e) {
      setAsciiError(String(e))
    } finally {
      setAsciiApplying(false)
    }
  }

  async function applyMedia(): Promise<void> {
    if (mediaApplying) return
    setMediaError(null)
    setMediaApplying(true)
    try {
      const res = await window.pupurin.applyMediaConvert(
        projectPath,
        mediaItems.map((it, i) => ({
          dir: it.dir,
          name: it.name,
          newName: mediaNames[i]?.trim() || it.suggested,
          kind: it.kind,
        }))
      )
      setMediaResult(res)
      onApplied?.({ media: res })
    } catch (e) {
      setMediaError(String(e))
    } finally {
      setMediaApplying(false)
    }
  }

  // 取消：已应用过则直接关闭；未应用时若场景支持「跳过继续」，先确认再放行
  function handleCancel(): void {
    if (applied || (asciiItems.length === 0 && mediaItems.length === 0)) {
      onClose()
      return
    }
    if (onSkipConfirm) {
      setConfirmSkip(true)
      return
    }
    onClose()
  }

  function confirmSkipAndGo(): void {
    setConfirmSkip(false)
    onClose()
    onSkipConfirm?.()
  }

  const tabBtn = (id: ProjectCheckTab, label: string, count: number): JSX.Element => (
    <button
      onClick={() => setTab(id)}
      className={`relative px-3 py-1.5 text-xs rounded-t border-b-2 transition-colors ${
        tab === id
          ? 'border-loom-accent text-loom-text font-semibold'
          : 'border-transparent text-loom-muted hover:text-loom-text'
      }`}
    >
      {label}
      <span className="ml-1.5 text-[11px] text-loom-muted">{count}</span>
      {count > 0 && <span className="absolute right-1 top-1 w-1.5 h-1.5 rounded-full bg-loom-err" />}
    </button>
  )

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50" onClick={handleCancel}>
      <div
        className="bg-loom-panel2 border border-loom-border rounded-lg shadow-xl w-[620px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 选项卡 */}
        <div className="flex items-end gap-1 px-4 pt-3 border-b border-loom-border">
          {tabBtn('ascii', '非 ASCII 文件名', asciiItems.length)}
          {tabBtn('media', '不支持的媒体格式', mediaItems.length)}
        </div>

        {/* ---- 非 ASCII 文件名 ---- */}
        {tab === 'ascii' && (
          <>
            <div className="p-5 pb-3">
              <h3 className="text-sm font-semibold text-loom-text mb-2">
                {asciiItems.length > 0 ? `发现 ${asciiItems.length} 个非 ASCII 文件名` : '未发现非 ASCII 文件名'}
              </h3>
              <div className="text-xs text-loom-muted leading-relaxed bg-loom-bg border border-loom-border rounded p-3">
                <p className="text-loom-accent font-medium mb-1">
                  ⚠ Ren'Py 要求游戏内所有文件名必须为 ASCII（字母 / 数字 / 下划线 / 连字符）。
                </p>
                <p>
                  非 ASCII 文件名（如中文、特殊符号）在安卓等移动设备上会乱码，导致
                  <b className="text-loom-text">字体、影片、图片无法加载</b>，而在 PC 上却一切正常，难以排查。
                </p>
                <p className="mt-1">
                  <b className="text-loom-text">确认应用后：</b>将会更改原文件名称与代码中对这些文件的引用，请先在下方核对新名称。
                </p>
              </div>
            </div>
            <Body
              empty={asciiItems.length === 0}
              emptyText="所有文件名均为 ASCII，无需处理。"
              result={
                asciiResult && {
                  title: '重命名完成',
                  lines: [
                    `已重命名 ${asciiResult.count} 个文件/目录，同步更新了 ${asciiResult.patchedFiles} 个脚本中的引用。`,
                  ],
                  logs: asciiResult.logs,
                  tail: '请重新打包后在设备上验证。若仍有问题，可在资源管理器中手动改名。',
                }
              }
            >
              <div className="flex items-center text-[11px] text-loom-muted px-2 pb-1">
                <span className="flex-1">原名称</span>
                <span className="w-3 mx-2 text-center">→</span>
                <span className="flex-1">新名称（可修改）</span>
              </div>
              <div className="space-y-1.5">
                {asciiItems.map((it, i) => {
                  const fullOld = it.dir ? `${it.dir}/${it.oldName}` : it.oldName
                  const invalid = !/^[\x00-\x7F]*$/.test(asciiNames[i] ?? '')
                  return (
                    <div key={i} className="flex items-center gap-2">
                      <div
                        className="flex-1 min-w-0 bg-loom-bg border border-loom-border rounded px-2 py-1.5 font-mono text-xs text-loom-muted truncate"
                        title={fullOld}
                      >
                        <span className="text-loom-muted/70">{it.dir ? `${it.dir}/` : ''}</span>
                        <span className="text-loom-err">{it.oldName}</span>
                        {it.isDir && <span className="text-loom-accent ml-1">(目录)</span>}
                      </div>
                      <span className="text-loom-muted text-xs flex-shrink-0">→</span>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center">
                          {it.dir && <span className="text-loom-muted/70 font-mono text-xs mr-0.5">{it.dir}/</span>}
                          <input
                            type="text"
                            value={asciiNames[i] ?? ''}
                            onChange={(e) => setAsciiNames((p) => ({ ...p, [i]: e.target.value }))}
                            disabled={asciiApplying}
                            spellCheck={false}
                            className={`w-full bg-loom-bg border rounded px-2 py-1.5 font-mono text-xs text-loom-text focus:outline-none focus:border-loom-accent ${
                              invalid ? 'border-loom-err' : 'border-loom-border'
                            }`}
                          />
                        </div>
                        {invalid && <div className="text-[10px] text-loom-err mt-0.5">仍含非 ASCII 字符，请改为字母/数字</div>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </Body>
            {asciiError && <ErrorBox text={asciiError} />}
            <Footer
              hint="确认后仅重命名文件并同步更新脚本中的引用，不会改动其他内容"
              busy={asciiApplying}
              done={Boolean(asciiResult)}
              disabled={asciiItems.length === 0 || Object.values(asciiNames).some((n) => !/^[\x00-\x7F]*$/.test(n))}
              applyLabel="应用重命名"
              busyLabel="正在应用…"
              onApply={() => void applyAscii()}
              onCancel={handleCancel}
            />
          </>
        )}

        {/* ---- 不支持的媒体格式 ---- */}
        {tab === 'media' && (
          <>
            <div className="p-5 pb-3">
              <h3 className="text-sm font-semibold text-loom-text mb-2">
                {mediaItems.length > 0 ? `发现 ${mediaItems.length} 个不支持的媒体文件` : '未发现不支持的媒体文件'}
              </h3>
              <div className="text-xs text-loom-muted leading-relaxed bg-loom-bg border border-loom-border rounded p-3">
                <p className="text-loom-accent font-medium mb-1">⚠ Ren'Py 只能播放特定格式的媒体文件。</p>
                <p>
                  图片：PNG / JPG / WEBP / AVIF / SVG；音频：OPUS / OGG / MP3 / MP2 / FLAC / WAV（16 位 PCM）；
                  视频：WebM / Matroska / Ogg / AVI / MPEG，编码限 AV1 / VP9 / VP8 / Theora / MPEG-4 / MPEG-1·2。
                </p>
                <p className="mt-1">
                  <b className="text-loom-text">确认应用后：</b>将用 ffmpeg 转换下列文件（首次会下载 ffmpeg，约 20–30MB），
                  并同步更新代码中的引用，请先在下方核对目标格式。<b className="text-loom-text">视频转换可能耗时较长</b>。
                </p>
              </div>
            </div>
            <Body
              empty={mediaItems.length === 0}
              emptyText="所有媒体格式均受支持，无需处理。"
              result={
                mediaResult && {
                  title: '转换完成',
                  lines: [
                    `已转换 ${mediaResult.count} 个文件，同步更新了 ${mediaResult.patchedFiles} 个脚本中的引用。`,
                    ...(mediaResult.failed.length > 0 ? [`${mediaResult.failed.length} 个文件转换失败。`] : []),
                  ],
                  logs:
                    mediaResult.failed.length > 0
                      ? [...mediaResult.logs, ...mediaResult.failed.map((f) => `✗ ${f.file}: ${f.error}`)]
                      : mediaResult.logs,
                  tail: '建议播放验证转换结果，确认无误后再打包。',
                }
              }
            >
              <div className="space-y-2">
                {mediaItems.map((it, i) => {
                  const newName = mediaNames[i] ?? ''
                  const targetExt = extOf(newName)
                  const invalid = !MEDIA_TARGETS[it.kind].includes(targetExt)
                  return (
                    <div key={i} className="bg-loom-bg border border-loom-border rounded px-3 py-2 space-y-1.5">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded border text-[10px] flex-shrink-0 ${KIND_CLS[it.kind]}`}>
                          {KIND_LABEL[it.kind]}
                        </span>
                        <span className="font-mono text-xs text-loom-err truncate flex-1" title={`${it.dir ? it.dir + '/' : ''}${it.name}`}>
                          {it.dir ? `${it.dir}/` : ''}
                          {it.name}
                        </span>
                      </div>
                      <div className="text-[10px] text-loom-muted leading-relaxed">{it.reason}</div>
                      <div className="flex items-center gap-2">
                        <span className="text-loom-muted text-xs flex-shrink-0">→</span>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center">
                            {it.dir && <span className="text-loom-muted/70 font-mono text-xs mr-0.5">{it.dir}/</span>}
                            <input
                              type="text"
                              value={newName}
                              onChange={(e) => setMediaNames((p) => ({ ...p, [i]: e.target.value }))}
                              disabled={mediaApplying}
                              spellCheck={false}
                              className={`w-full bg-loom-panel border rounded px-2 py-1.5 font-mono text-xs text-loom-text focus:outline-none focus:border-loom-accent ${
                                invalid ? 'border-loom-err' : 'border-loom-border'
                              }`}
                            />
                          </div>
                          {invalid && (
                            <div className="text-[10px] text-loom-err mt-0.5">
                              目标格式 .{targetExt || '?'} 不可用，请改为 {MEDIA_TARGETS[it.kind].map((e) => '.' + e).join(' / ')}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </Body>
            {mediaProgress && mediaApplying && (
              <div className="mx-5 mt-2 text-[11px] text-loom-muted bg-loom-bg border border-loom-border rounded px-3 py-2 font-mono truncate">
                {mediaProgress}
              </div>
            )}
            {mediaError && <ErrorBox text={mediaError} />}
            <Footer
              hint="确认后会用 ffmpeg 转换并同步更新脚本中的引用，原文件将被替换"
              busy={mediaApplying}
              done={Boolean(mediaResult)}
              disabled={mediaItems.length === 0 || Object.values(mediaNames).some((n) => extOf(n) === '')}
              applyLabel="应用转换"
              busyLabel="正在转换…"
              onApply={() => void applyMedia()}
              onCancel={handleCancel}
            />
          </>
        )}
      </div>

      {/* 「仍要继续吗」确认（打包预检场景：用户不处理也允许继续） */}
      {confirmSkip && (
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50" onClick={(e) => e.stopPropagation()}>
          <div className="bg-loom-panel2 border border-loom-border rounded-lg shadow-xl w-[440px] p-5">
            <h3 className="text-sm font-semibold text-loom-text mb-2">您确认要继续打包吗？</h3>
            <p className="text-xs text-loom-muted leading-relaxed mb-4">
              当前仍有
              {asciiItems.length > 0 && (
                <>
                  {' '}
                  <span className="text-loom-err font-semibold">{asciiItems.length}</span> 个不合规文件名
                </>
              )}
              {asciiItems.length > 0 && mediaItems.length > 0 && '、'}
              {mediaItems.length > 0 && (
                <>
                  {' '}
                  <span className="text-loom-err font-semibold">{mediaItems.length}</span> 个不支持的媒体文件
                </>
              )}
              {' '}未处理。它们可能在安卓等移动设备上<b className="text-loom-text">无法加载</b>（字体、影片、图片乱码或无法播放）。
              若确定不处理仍要继续，请点击「是，继续打包」。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmSkip(false)}
                className="px-3 py-1 text-xs rounded bg-loom-panel border border-loom-border text-loom-muted hover:text-loom-text transition-colors"
              >
                返回检查
              </button>
              <button
                onClick={confirmSkipAndGo}
                className="px-3 py-1 text-xs rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 transition-opacity"
              >
                是，继续打包
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/** 选项卡主体：空状态 / 结果摘要 / 内容列表 */
function Body({
  empty,
  emptyText,
  result,
  children,
}: {
  empty: boolean
  emptyText: string
  result?: { title: string; lines: string[]; logs: string[]; tail: string } | null
  children: React.ReactNode
}): JSX.Element {
  if (result) {
    return (
      <div className="flex-1 overflow-y-auto px-5 pb-1">
        <h3 className="text-sm font-semibold text-loom-text mb-2">{result.title}</h3>
        <div className="text-xs text-loom-muted leading-relaxed">
          {result.lines.map((l, i) => (
            <p key={i}>{l}</p>
          ))}
          <div className="mt-2 bg-loom-bg border border-loom-border rounded max-h-40 overflow-y-auto p-2 font-mono text-[11px]">
            {result.logs.length > 0 ? result.logs.map((l, i) => <div key={i}>{l}</div>) : <div>（无日志）</div>}
          </div>
          <p className="mt-2 text-loom-text">{result.tail}</p>
        </div>
      </div>
    )
  }
  if (empty) {
    return <div className="flex-1 px-5 text-xs text-loom-muted py-2">{emptyText}</div>
  }
  return <div className="flex-1 overflow-y-auto px-5">{children}</div>
}

function ErrorBox({ text }: { text: string }): JSX.Element {
  return (
    <div className="mx-5 mt-2 text-xs text-loom-err bg-loom-err/10 border border-loom-err/30 rounded px-3 py-2">
      应用失败：{text}
    </div>
  )
}

/** 底部操作栏 */
function Footer({
  hint,
  busy,
  done,
  disabled,
  applyLabel,
  busyLabel,
  onApply,
  onCancel,
}: {
  hint: string
  busy: boolean
  done: boolean
  disabled: boolean
  applyLabel: string
  busyLabel: string
  onApply: () => void
  onCancel: () => void
}): JSX.Element {
  return (
    <div className="flex justify-between items-center p-5 pt-3">
      <span className="text-[11px] text-loom-muted">{hint}</span>
      <div className="flex gap-2">
        {!done && (
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-3 py-1 text-xs rounded bg-loom-panel border border-loom-border text-loom-muted hover:text-loom-text transition-colors"
          >
            取消
          </button>
        )}
        <button
          onClick={done ? onCancel : onApply}
          disabled={busy || (!done && disabled)}
          className="px-3 py-1 text-xs rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
        >
          {busy ? busyLabel : done ? '完成' : applyLabel}
        </button>
      </div>
    </div>
  )
}
