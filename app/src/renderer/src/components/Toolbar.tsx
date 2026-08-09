import { useStore } from '../store/useStore'

export default function Toolbar({ onReload }: { onReload: () => void }) {
  const status = useStore((s) => s.status)
  const labels = useStore((s) => s.labels)
  const edges = useStore((s) => s.edges)
  const loading = useStore((s) => s.loading)

  return (
    <div className="flex items-center gap-4 px-4 h-12 bg-loom-panel border-b border-loom-border select-none">
      <div className="flex items-center gap-2">
        <div className="w-3 h-3 rounded-full bg-loom-accent shadow-[0_0_8px_#FFE4A6]" />
        <span className="font-semibold text-loom-text tracking-wide">Pupurin° Loom</span>
        <span className="text-[10px] px-1.5 py-0.5 rounded bg-loom-accent/20 text-loom-accent font-mono">
          DEMO
        </span>
      </div>

      <div className="text-xs text-loom-muted font-mono">
        {labels.length} labels · {edges.length} edges
      </div>

      <div className="flex-1" />

      <div className="text-xs text-loom-muted font-mono">
        backend:{' '}
        {status?.running ? (
          <span className="text-loom-ok">running :{status.port}</span>
        ) : (
          <span className="text-loom-err">offline</span>
        )}
      </div>

      <button
        onClick={onReload}
        disabled={loading}
        className="px-3 py-1 text-xs rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 disabled:opacity-50 transition-opacity"
      >
        {loading ? '加载中…' : '重新解析'}
      </button>
    </div>
  )
}
