import { useEffect, useRef } from 'react'
import { useStore } from '../store/useStore'
import type { LogEntry, ConsoleFilter } from '../types'

const FILTERS: { id: ConsoleFilter; label: string }[] = [
  { id: 'all', label: '全部' },
  { id: 'info', label: '信息' },
  { id: 'system', label: '系统' },
  { id: 'error', label: '错误' }
]

function matchesFilter(log: LogEntry, filter: ConsoleFilter): boolean {
  if (filter === 'all') return true
  if (filter === 'system') return log.type === 'system'
  if (filter === 'error') return log.level === 'error'
  // info: 非系统、非错误
  return log.type !== 'system' && log.level !== 'error'
}

function formatTime(t: number | undefined, i: number): string {
  if (typeof t === 'number' && t > 0) {
    const d = new Date(t * 1000)
    return d.toLocaleTimeString('zh-CN', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0')
  }
  return String(i)
}

export default function Console() {
  const logs = useStore((s) => s.logs)
  const filter = useStore((s) => s.consoleFilter)
  const setFilter = useStore((s) => s.setConsoleFilter)
  const autoScroll = useStore((s) => s.autoScroll)
  const setAutoScroll = useStore((s) => s.setAutoScroll)
  const clearLogs = useStore((s) => s.clearLogs)
  const ref = useRef<HTMLDivElement>(null)

  const visibleLogs = logs.filter((l) => matchesFilter(l, filter))

  useEffect(() => {
    if (autoScroll && ref.current) {
      ref.current.scrollTop = ref.current.scrollHeight
    }
  }, [visibleLogs, autoScroll])

  return (
    <div className="flex flex-col h-full bg-loom-panel">
      <div className="flex items-center gap-1 px-2 h-7 bg-loom-panel2 border-b border-loom-border text-[11px]">
        {/* 级别筛选 */}
        <div className="flex items-center gap-0.5">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={[
                'px-1.5 py-0.5 rounded font-mono transition-colors',
                filter === f.id
                  ? 'bg-loom-accent/20 text-loom-accent'
                  : 'text-loom-muted hover:text-loom-text'
              ].join(' ')}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="w-px h-3 bg-loom-border mx-1" />

        {/* 自动滚动 */}
        <button
          onClick={() => setAutoScroll(!autoScroll)}
          title="自动滚动到底部"
          className={[
            'px-1.5 py-0.5 rounded font-mono transition-colors',
            autoScroll ? 'text-loom-accent' : 'text-loom-muted hover:text-loom-text'
          ].join(' ')}
        >
          {autoScroll ? '⤓ 自动' : '⤓ 手动'}
        </button>

        {/* 清空 */}
        <button
          onClick={clearLogs}
          title="清空日志"
          className="px-1.5 py-0.5 rounded text-loom-muted hover:text-loom-err font-mono transition-colors"
        >
          清空
        </button>

        <span className="ml-auto text-loom-muted/60 font-mono">
          {visibleLogs.length}/{logs.length}
        </span>
      </div>
      <div
        ref={ref}
        className="flex-1 overflow-auto p-2 font-mono text-[11px] leading-relaxed"
      >
        {visibleLogs.length === 0 && (
          <div className="text-loom-muted">
            {logs.length === 0 ? '等待日志…' : '当前筛选下无日志'}
          </div>
        )}
        {visibleLogs.map((l, i) => (
          <div
            key={i}
            className={
              l.type === 'system'
                ? 'text-loom-accent'
                : l.level === 'error'
                ? 'text-loom-err'
                : 'text-loom-text'
            }
          >
            <span className="text-loom-muted">[{formatTime(l.t, i)}]</span>{' '}
            {l.msg}
          </div>
        ))}
      </div>
    </div>
  )
}
