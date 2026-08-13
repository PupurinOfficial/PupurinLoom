import { useEffect, useRef, useState } from 'react'
import Modal from './Modal'
import Button from './Button'

export interface PromptDialogProps {
  open: boolean
  title: string
  placeholder?: string
  defaultValue?: string
  /** 等宽字体输入（如资源文件名） */
  monospace?: boolean
  onConfirm: (value: string) => void | Promise<void>
  onCancel: () => void
}

// 统一输入弹窗（替代被 Electron 禁用的 window.prompt）
// 组件内部管理输入值；Enter 确认 / Esc 取消；确认按钮 async 时显示 loading。
export default function PromptDialog({
  open,
  title,
  placeholder,
  defaultValue = '',
  monospace,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const [value, setValue] = useState(defaultValue)
  const [saving, setSaving] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (open) {
      setValue(defaultValue)
      setSaving(false)
      // 等待 Modal 挂载后聚焦
      requestAnimationFrame(() => inputRef.current?.focus())
    }
  }, [open, defaultValue])

  async function handleConfirm(): Promise<void> {
    if (saving) return
    const v = value
    setSaving(true)
    try {
      await onConfirm(v)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onCancel}
      title={title}
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            取消
          </Button>
          <Button variant="primary" size="sm" onClick={() => void handleConfirm()} loading={saving}>
            确定
          </Button>
        </>
      }
    >
      <input
        ref={inputRef}
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void handleConfirm()
          if (e.key === 'Escape') onCancel()
        }}
        placeholder={placeholder}
        className={[
          'w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm text-loom-text',
          'focus:outline-none focus:border-loom-accent',
          monospace ? 'font-mono' : '',
        ].join(' ')}
      />
    </Modal>
  )
}
