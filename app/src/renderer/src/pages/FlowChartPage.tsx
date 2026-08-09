import FlowCanvas from '../components/FlowCanvas'
import CodePanel from '../components/CodePanel'
import { useStore } from '../store/useStore'

export default function FlowChartPage() {
  const labels = useStore((s) => s.labels)

  return (
    <div className="flex h-full">
      {/* 左侧：节点图 */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="flex items-center gap-2 px-3 h-8 bg-loom-panel2 border-b border-loom-border text-xs">
          <span className="text-loom-accent font-mono">流程图</span>
          <span className="text-loom-muted">
            {labels.length} nodes · 点击节点查看剧本
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <FlowCanvas />
        </div>
      </div>

      {/* 右侧：剧本详情 */}
      <div className="w-[420px] flex flex-col border-l border-loom-border">
        <CodePanel />
      </div>
    </div>
  )
}
