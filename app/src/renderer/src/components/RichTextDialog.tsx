import { useEffect, useMemo, useState } from 'react'
import { detectRichTextMode, convertRichText, type RichTextMode } from '../utils/richTextConverter'
import { parseRenpyText, styleToCss } from '../utils/renpyTextParser'

// 富文本转换弹窗：展示 Markdown/BBCode 原代码（自动检测、可手动切换）
// 与转换后的 Ren'Py 文本及渲染效果，确认后应用转换结果
interface RichTextDialogProps {
  open: boolean
  initialValue: string
  onClose: () => void
  onApply: (renpyText: string) => void
}

// 预览用的基准字号（Ren'Py {size=+N} 为相对值，预览时换算为绝对 px）
const PREVIEW_BASE_SIZE = 15

export default function RichTextDialog({ open, initialValue, onClose, onApply }: RichTextDialogProps) {
  const [mode, setMode] = useState<RichTextMode>('markdown')
  const [source, setSource] = useState('')

  // 打开时以当前文本初始化并自动检测模式
  useEffect(() => {
    if (open) {
      setSource(initialValue)
      setMode(detectRichTextMode(initialValue))
    }
  }, [open, initialValue])

  const converted = useMemo(() => convertRichText(source, mode), [source, mode])

  // 预览文本：把相对字号 {size=+N}/{-N} 换算为绝对字号，避免预览显示异常
  const previewText = useMemo(
    () =>
      converted.replace(/\{size=([+-]?\d+)\}/g, (_m, s: string) => {
        const n = parseInt(s, 10)
        return `{size=${/^[+-]/.test(s) ? PREVIEW_BASE_SIZE + n : n}}`
      }),
    [converted]
  )
  const previewSegments = useMemo(() => parseRenpyText(previewText), [previewText])

  if (!open) return null

  const modeBtn = (m: RichTextMode, label: string): JSX.Element => (
    <button
      onClick={() => setMode(m)}
      className={[
        'px-2.5 py-0.5 text-[11px] transition-colors',
        mode === m ? 'bg-loom-accent text-loom-bg font-semibold' : 'text-loom-muted hover:text-loom-text',
      ].join(' ')}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[720px] max-w-[92vw] max-h-[85vh] flex flex-col rounded-lg bg-loom-panel border border-loom-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center px-4 py-3 border-b border-loom-border select-none">
          <span className="text-sm font-semibold text-loom-text">富文本转换</span>
          <span className="ml-2 text-[10px] text-loom-muted font-mono">Markdown / BBCode → Ren'Py</span>
          <button
            onClick={onClose}
            className="ml-auto w-6 h-6 flex items-center justify-center rounded text-loom-muted hover:text-loom-text hover:bg-loom-panel2 transition-colors"
            title="关闭"
          >
            ✕
          </button>
        </div>

        {/* 主体 */}
        <div className="flex-1 min-h-0 overflow-auto p-4 space-y-3">
          {/* 原代码 */}
          <div>
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-[11px] text-loom-muted font-semibold flex-shrink-0">原代码</span>
              <div className="flex items-center rounded bg-loom-bg border border-loom-border overflow-hidden">
                {modeBtn('markdown', 'Markdown')}
                {modeBtn('bbcode', 'BBCode')}
              </div>
              <span className="text-[10px] text-loom-accent font-mono">
                {mode === 'bbcode' ? '检测为：BBCode' : '检测为：Markdown'}
              </span>
            </div>
            <textarea
              value={source}
              onChange={(e) => setSource(e.target.value)}
              rows={4}
              autoFocus
              placeholder={'在此输入 Markdown 或 BBCode 语法文本，如：\n**加粗** / [b]加粗[/b] / ~~删除线~~ / [color=red]红色[/color]'}
              className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm font-mono text-loom-text focus:outline-none focus:border-loom-accent resize-y"
            />
          </div>

          {/* 转换结果 */}
          <div>
            <div className="mb-1.5">
              <span className="text-[11px] text-loom-muted font-semibold">转换结果（Ren'Py 语法）</span>
            </div>
            <div className="rounded bg-loom-bg border border-loom-border px-3 py-2 text-sm font-mono text-loom-ok whitespace-pre-wrap break-all">
              {converted || <span className="text-loom-muted/50">（空）</span>}
            </div>
          </div>

          {/* 效果预览 */}
          <div>
            <div className="mb-1.5">
              <span className="text-[11px] text-loom-muted font-semibold">效果预览</span>
            </div>
            <div className="rounded bg-loom-bg border border-loom-border px-4 py-3 text-sm text-loom-text leading-relaxed">
              {previewSegments.length === 0 ? (
                <span className="text-loom-muted/60">（空）</span>
              ) : (
                previewSegments.map((seg, i) => (
                  <span key={i} style={styleToCss(seg.style)}>
                    {seg.text}
                  </span>
                ))
              )}
            </div>
          </div>
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-loom-border">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-text transition-colors"
          >
            取消
          </button>
          <button
            onClick={() => onApply(converted)}
            className="px-3 py-1 text-xs rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 transition-colors"
          >
            应用转换
          </button>
        </div>
      </div>
    </div>
  )
}
