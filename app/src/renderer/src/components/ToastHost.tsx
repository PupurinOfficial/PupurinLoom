import { usePlugins } from '../store/plugins'

// 右下角消息提示（插件 loom.toast 与命令错误反馈）
export default function ToastHost() {
  const toasts = usePlugins((s) => s.toasts)
  const removeToast = usePlugins((s) => s.removeToast)

  const colorOf = (type: string): string => {
    if (type === 'error') return 'border-loom-err/50 text-loom-err'
    if (type === 'success') return 'border-loom-ok/50 text-loom-ok'
    return 'border-loom-accent/50 text-loom-text'
  }
  const dotOf = (type: string): string => {
    if (type === 'error') return 'bg-loom-err'
    if (type === 'success') return 'bg-loom-ok'
    return 'bg-loom-accent'
  }

  return (
    <div className="fixed bottom-10 right-4 z-[60] flex flex-col gap-2 items-end pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => removeToast(t.id)}
          className={`pointer-events-auto max-w-sm flex items-start gap-2 rounded-md border bg-loom-panel px-3 py-2 shadow-lg text-xs cursor-pointer ${colorOf(t.type)}`}
        >
          <span className={`mt-0.5 w-1.5 h-1.5 rounded-full flex-shrink-0 ${dotOf(t.type)}`} />
          <span className="break-words">{t.message}</span>
        </div>
      ))}
    </div>
  )
}
