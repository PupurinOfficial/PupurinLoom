import { useEffect, type ReactNode } from 'react'

export interface ModalProps {
  open: boolean
  onClose: () => void
  /** 标题（可选；提供时渲染标题栏 + 右上角关闭按钮） */
  title?: ReactNode
  /** 底部按钮区 */
  footer?: ReactNode
  /** 弹窗宽度类名，如 'w-80' / 'w-[480px]'，默认 'w-80' */
  width?: string
  /** 遮罩层级，默认 50 */
  zIndex?: number
  children: ReactNode
}

// 统一模态弹窗：半透明遮罩 + 居中卡片（标题栏可选 + 底部按钮区可选）
// 点击遮罩 / 按 Esc 关闭；内部点击不冒泡。
export default function Modal({
  open,
  onClose,
  title,
  footer,
  width = 'w-80',
  zIndex = 50,
  children,
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className={`fixed inset-0 flex items-center justify-center bg-black/50`}
      style={{ zIndex }}
      onClick={onClose}
    >
      <div
        className={`${width} rounded-lg bg-loom-panel border border-loom-border shadow-xl`}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-loom-border">
            <span className="text-sm font-semibold text-loom-text">{title}</span>
            <button
              onClick={onClose}
              title="关闭"
              className="p-1 rounded text-loom-muted hover:text-loom-text hover:bg-loom-panel2 transition-colors"
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="14" height="14">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
        )}
        <div className="p-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 px-4 py-3 border-t border-loom-border">{footer}</div>
        )}
      </div>
    </div>
  )
}
