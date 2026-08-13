import { useStore } from '../store/useStore'

export default function StatusBar() {
  const status = useStore((s) => s.status)

  return (
    <footer className="flex items-center justify-between h-7 px-3 bg-loom-panel2 border-t border-loom-border text-[11px] font-mono text-loom-muted select-none">
      <div className="flex items-center gap-4">
        <span className="text-loom-accent">● 铃言织机°</span>
      </div>
      <div className="flex items-center gap-3">
        <span>
          backend:{' '}
          {status?.running ? (
            <span className="text-loom-ok">: {status.port}</span>
          ) : (
            <span className="text-loom-err">offline</span>
          )}
        </span>
      </div>
    </footer>
  )
}
