import { useMemo } from 'react'
import {
  ReactFlow,
  Background,
  Controls,
  Position,
  MarkerType,
  type Node,
  type Edge
} from '@xyflow/react'
import { useStore } from '../store/useStore'
import { usePreferences } from '../store/preferences'

function layoutGrid(count: number): Array<{ x: number; y: number }> {
  const cols = Math.min(3, Math.max(1, count))
  const gapX = 300
  const gapY = 180
  return Array.from({ length: count }, (_, i) => ({
    x: (i % cols) * gapX,
    y: Math.floor(i / cols) * gapY
  }))
}

// menu 边的 sourcePosition 轮换，避免多条边从同一点重叠
const MENU_SOURCE_POSITIONS = [Position.Top, Position.Right, Position.Bottom, Position.Left]

const EDGE_STYLES: Record<string, { stroke: string; animated: boolean }> = {
  jump: { stroke: 'var(--loom-border)', animated: false },
  call: { stroke: 'var(--loom-accent-dim)', animated: true },
  menu: { stroke: '#c084d8', animated: false }
}

export default function FlowCanvas() {
  const labels = useStore((s) => s.labels)
  const edges = useStore((s) => s.edges)
  const selectedLabelId = useStore((s) => s.selectedLabelId)
  const selectLabel = useStore((s) => s.selectLabel)
  const setSelection = useStore((s) => s.setSelection)
  const editorFontSize = usePreferences((s) => s.editorFontSize)
  // 流程图节点/边的字号跟随设置（相对默认值缩放）
  const nodeFont = Math.max(10, editorFontSize - 2)
  const edgeFont = Math.max(9, editorFontSize - 3)

  const positions = useMemo(() => layoutGrid(labels.length), [labels.length])
  const labelIds = useMemo(() => new Set(labels.map((l) => l.id)), [labels])

  const nodes: Node[] = useMemo(
    () =>
      labels.map((l, i) => {
        const pos = positions[i] ?? { x: 0, y: 0 }
        const hasMenu = l.menu_options && l.menu_options.length > 0
        return {
          id: l.id,
          type: 'default',
          position: pos,
          data: {
            label: (
              <div className="flex flex-col gap-0.5" style={{ fontSize: nodeFont }}>
                <div className="flex items-center gap-1.5">
                  <span className="font-mono text-loom-accent font-semibold">{l.name}</span>
                  {hasMenu && (
                    <span className="text-[0.75em] px-1 rounded bg-[#c084d833] text-[#c084d8] font-mono">
                      menu
                    </span>
                  )}
                </div>
                {l.doc ? (
                  <span className="text-loom-muted text-[0.833em] truncate max-w-[200px]">
                    {l.doc}
                  </span>
                ) : (
                  <span className="text-loom-muted/50 text-[0.833em]">—</span>
                )}
                <span className="text-loom-muted/60 text-[0.75em] font-mono">L{l.line}-{l.end_line}</span>
              </div>
            )
          },
          style: {
            background: 'var(--loom-panel)',
            color: 'var(--loom-text)',
            border: `1.5px solid ${selectedLabelId === l.id ? 'var(--loom-accent)' : 'var(--loom-border)'}`,
            borderRadius: '8px',
            padding: '8px 12px',
            width: 220,
            boxShadow: selectedLabelId === l.id
              ? '0 0 0 3px color-mix(in srgb, var(--loom-accent) 15%, transparent)'
              : 'none'
          },
          sourcePosition: Position.Right,
          targetPosition: Position.Left
        }
      }),
    [labels, positions, selectedLabelId, nodeFont]
  )

  const rfEdges: Edge[] = useMemo(() => {
    // 按 source 分组 menu 边，为每个 source 分配不同的 sourcePosition
    const menuEdgeCount: Record<string, number> = {}
    return edges
      .filter((e) => e.source) // 必须有源
      .filter((e) => labelIds.has(e.target)) // target 必须存在（过滤 broken）
      .map((e) => {
        const style = EDGE_STYLES[e.type] ?? EDGE_STYLES.jump
        let sourcePosition: Position | undefined
        if (e.type === 'menu' && e.source) {
          const idx = menuEdgeCount[e.source] ?? 0
          sourcePosition = MENU_SOURCE_POSITIONS[idx % MENU_SOURCE_POSITIONS.length]
          menuEdgeCount[e.source] = idx + 1
        }
        // menu 边显示选项文本，其它显示类型
        const label = e.type === 'menu' ? (e.option_text ?? 'menu') : e.type
        return {
          id: `e${e.line}-${e.source}-${e.target}`,
          source: e.source!,
          target: e.target,
          type: 'smoothstep',
          animated: style.animated,
          label,
          labelStyle: {
            fill: e.type === 'menu' ? '#c084d8' : 'var(--loom-muted)',
            fontSize: edgeFont,
            fontFamily: 'monospace'
          },
          labelBgStyle: { fill: 'var(--loom-bg)' },
          style: { stroke: style.stroke, strokeWidth: 1.5, strokeDasharray: e.type === 'menu' ? '4 3' : undefined },
          markerEnd: { type: MarkerType.ArrowClosed, color: style.stroke, width: 16, height: 16 },
          sourcePosition
        } as Edge
      })
  }, [edges, labelIds, edgeFont])

  if (labels.length === 0) {
    return (
      <div className="w-full h-full flex items-center justify-center text-loom-muted text-sm">
        无节点数据
      </div>
    )
  }

  return (
    <div className="w-full h-full">
      <ReactFlow
        nodes={nodes}
        edges={rfEdges}
        fitView
        fitViewOptions={{ padding: 0.2 }}
        onNodeClick={(_, n) => { selectLabel(n.id); setSelection({ type: 'label', id: n.id }) }}
        onPaneClick={() => { selectLabel(null); setSelection({ type: null, id: null }) }}
        proOptions={{ hideAttribution: true }}
      >
        <Background color="#3a352e" gap={22} size={1.5} />
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
