import { useState } from 'react'
import type { NonAsciiRenameItem, NonAsciiRenameResult } from '../types'

interface Props {
  projectPath: string
  items: NonAsciiRenameItem[]
  onClose: () => void
  /** 应用成功后回调（可在此刷新文件列表等） */
  onApplied?: (result: NonAsciiRenameResult) => void
  /**
   * 用户取消（不改名）时，先弹「仍要继续吗」确认；确认后调用此回调继续原流程。
   * 仅打包预检等「用户可能明知风险仍要继续」的场景传入；不传则取消直接关闭。
   */
  onSkipConfirm?: () => void
}

/**
 * 非 ASCII 文件名检查/修复弹窗
 *
 * Ren'Py 要求游戏内所有文件名必须为 ASCII，否则打进安卓 APK 后文件名乱码、
 * 字体/影片/图片无法加载。此弹窗列出所有问题文件，左边是原名称，
 * 右边是系统建议的新名称（用户可手动修改），确认后一并重命名并同步更新
 * 所有 .rpy 中的引用。
 */
export default function NonAsciiRenameDialog({ projectPath, items, onClose, onApplied, onSkipConfirm }: Props): JSX.Element {
  // 可编辑的新名称：key 为扫描结果索引
  const [names, setNames] = useState<Record<number, string>>(() => {
    const init: Record<number, string> = {}
    items.forEach((it, i) => { init[i] = it.suggested })
    return init
  })
  const [applying, setApplying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<NonAsciiRenameResult | null>(null)
  // 用户点击「取消」后是否弹「仍要继续打包吗」确认
  const [confirmSkip, setConfirmSkip] = useState(false)

  async function handleApply(): Promise<void> {
    if (applying) return
    setError(null)
    setApplying(true)
    try {
      const applyItems = items.map((it, i) => ({
        dir: it.dir,
        oldName: it.oldName,
        newName: names[i]?.trim() || it.suggested,
        isDir: it.isDir,
      }))
      const res = await window.pupurin.applyNonAsciiRename(projectPath, applyItems)
      setResult(res)
      onApplied?.(res)
    } catch (e) {
      setError(String(e))
    } finally {
      setApplying(false)
    }
  }

  // 取消：应用成功后直接关闭；未应用时若场景支持「跳过继续」，先确认再放行
  function handleCancel(): void {
    if (result) {
      onClose()
      return
    }
    if (onSkipConfirm) {
      setConfirmSkip(true)
      return
    }
    onClose()
  }

  // 确认「仍要继续」：关闭弹窗并放行原流程（如继续打包）
  function confirmSkipAndGo(): void {
    setConfirmSkip(false)
    onClose()
    onSkipConfirm?.()
  }

  // 应用成功后显示结果摘要
  if (result) {
    return (
      <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50" onClick={onClose}>
        <div
          className="bg-loom-panel2 border border-loom-border rounded-lg shadow-xl w-[440px] p-5"
          onClick={(e) => e.stopPropagation()}
        >
          <h3 className="text-sm font-semibold text-loom-text mb-2">重命名完成</h3>
          <div className="text-xs text-loom-muted leading-relaxed mb-4">
            <p>已重命名 <span className="text-loom-accent font-semibold">{result.count}</span> 个文件/目录，同步更新了{' '}
              <span className="text-loom-accent font-semibold">{result.patchedFiles}</span> 个脚本中的引用。</p>
            <div className="mt-2 bg-loom-bg border border-loom-border rounded max-h-32 overflow-y-auto p-2 font-mono text-[11px]">
              {result.logs.map((l, i) => (
                <div key={i}>{l}</div>
              ))}
            </div>
            <p className="mt-2 text-loom-text">请重新打包后在设备上验证。若仍有问题，可在资源管理器中手动改名。</p>
          </div>
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              className="px-3 py-1 text-xs rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 transition-opacity"
            >完成</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/50" onClick={handleCancel}>
      <div
        className="bg-loom-panel2 border border-loom-border rounded-lg shadow-xl w-[560px] max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-5 pb-3">
          <h3 className="text-sm font-semibold text-loom-text mb-2">发现 {items.length} 个非 ASCII 文件名</h3>
          <div className="text-xs text-loom-muted leading-relaxed bg-loom-bg border border-loom-border rounded p-3">
            <p className="text-loom-accent font-medium mb-1">⚠ Ren'Py 要求游戏内所有文件名必须为 ASCII（字母 / 数字 / 下划线 / 连字符）。</p>
            <p>非 ASCII 文件名（如中文、特殊符号）在安卓等移动设备上会乱码，导致<b className="text-loom-text">字体、影片、图片无法加载</b>，而在 PC 上却一切正常，难以排查。</p>
            <p className="mt-1"><b className="text-loom-text">确认应用后：</b>将会更改原文件名称与代码中对这些文件的引用，请先在下方核对新名称。</p>
          </div>
        </div>

        {/* 对照表：左 = 原名称，右 = 可编辑的新名称 */}
        <div className="flex-1 overflow-y-auto px-5">
          <div className="flex items-center text-[11px] text-loom-muted px-2 pb-1">
            <span className="flex-1">原名称</span>
            <span className="w-3 mx-2 text-center">→</span>
            <span className="flex-1">新名称（可修改）</span>
          </div>
          <div className="space-y-1.5">
            {items.map((it, i) => {
              const fullOld = it.dir ? `${it.dir}/${it.oldName}` : it.oldName
              const fullNew = it.dir ? `${it.dir}/${names[i] ?? ''}` : (names[i] ?? '')
              const invalid = !/^[\x00-\x7F]*$/.test(names[i] ?? '')
              return (
                <div key={i} className="flex items-center gap-2">
                  <div className="flex-1 min-w-0 bg-loom-bg border border-loom-border rounded px-2 py-1.5 font-mono text-xs text-loom-muted truncate" title={fullOld}>
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
                        value={names[i] ?? ''}
                        onChange={(e) => setNames((p) => ({ ...p, [i]: e.target.value }))}
                        disabled={applying}
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
        </div>

        {error && (
          <div className="mx-5 mt-2 text-xs text-loom-err bg-loom-err/10 border border-loom-err/30 rounded px-3 py-2">
            应用失败：{error}
          </div>
        )}

        <div className="flex justify-between items-center p-5 pt-3">
          <span className="text-[11px] text-loom-muted">确认后仅重命名文件并同步更新脚本中的引用，不会改动其他内容</span>
          <div className="flex gap-2">
            <button
              onClick={handleCancel}
              disabled={applying}
              className="px-3 py-1 text-xs rounded bg-loom-panel border border-loom-border text-loom-muted hover:text-loom-text transition-colors"
            >取消</button>
            <button
              onClick={() => void handleApply()}
              disabled={applying}
              className="px-3 py-1 text-xs rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
            >{applying ? '正在应用…' : '应用重命名'}</button>
          </div>
        </div>
      </div>

      {/* 「仍要继续吗」确认（打包预检场景：用户不改名也允许继续） */}
      {confirmSkip && (
        <div
          className="fixed inset-0 z-[130] flex items-center justify-center bg-black/50"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="bg-loom-panel2 border border-loom-border rounded-lg shadow-xl w-[420px] p-5">
            <h3 className="text-sm font-semibold text-loom-text mb-2">您确认要继续打包吗？</h3>
            <p className="text-xs text-loom-muted leading-relaxed mb-4">
              当前仍有 <span className="text-loom-err font-semibold">{items.length}</span> 个不合规文件名未修改。它们可能在安卓等移动设备上
              <b className="text-loom-text">无法加载</b>（字体、影片、图片乱码）。若确定不修改仍要继续，请点击「是，继续打包」。
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setConfirmSkip(false)}
                className="px-3 py-1 text-xs rounded bg-loom-panel border border-loom-border text-loom-muted hover:text-loom-text transition-colors"
              >返回检查</button>
              <button
                onClick={confirmSkipAndGo}
                className="px-3 py-1 text-xs rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 transition-opacity"
              >是，继续打包</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
