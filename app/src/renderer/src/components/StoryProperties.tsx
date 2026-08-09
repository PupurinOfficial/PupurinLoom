import { useStore } from '../store/useStore'
import type { CharacterMeta } from '../types'
import CharacterAvatar, { SpriteThumbnail } from './CharacterAvatar'

// ---- 子面板：场景属性 ----

function SceneProperties({ labelId, onPlayFromLine }: { labelId: string; onPlayFromLine?: (line: number) => void }) {
  const labels = useStore((s) => s.labels)
  const edges = useStore((s) => s.edges)
  const label = labels.find((l) => l.id === labelId)

  if (!label) {
    return (
      <div className="p-4 text-sm text-loom-muted">
        场景数据未找到
      </div>
    )
  }

  const outgoingEdges = edges.filter((e) => e.source === label.name)
  const incomingEdges = edges.filter((e) => e.target === label.name)

  return (
    <div className="p-3 space-y-4">
      {/* 基本信息 */}
      <section>
        <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
          场景信息
        </h3>
        <div className="space-y-1.5">
          <PropRow label="名称" value={label.name} mono />
          {label.file && <PropRow label="文件" value={label.file} mono />}
          <PropRow label="行号" value={`L${label.line}–${label.end_line}`} mono />
          <PropRow label="总行数" value={String(label.end_line - label.line + 1)} />
        </div>
        {/* 从本场景开始玩 */}
        {onPlayFromLine && (
          <button
            onClick={() => onPlayFromLine(label.line)}
            className="mt-2 w-full flex items-center justify-center gap-1.5 px-2 py-1.5 text-[11px] rounded bg-loom-accent/15 text-loom-accent hover:bg-loom-accent/25 transition-colors"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11">
              <polygon points="5,3 19,12 5,21" />
            </svg>
            从本场景开始玩
          </button>
        )}
      </section>

      {/* 场景描述 */}
      {label.doc && (
        <section>
          <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
            简介
          </h3>
          <div className="px-3 py-2 rounded bg-loom-bg border border-loom-border text-xs text-loom-text whitespace-pre-wrap">
            {label.doc}
          </div>
        </section>
      )}

      {/* 跳转关系 */}
      <section>
        <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
          跳转关系
        </h3>
        <div className="space-y-2">
          <div>
            <span className="text-[11px] text-loom-muted">→ 出发（{outgoingEdges.length}）</span>
            {outgoingEdges.length === 0 ? (
              <div className="text-[11px] text-loom-muted/60 mt-0.5">无</div>
            ) : (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {outgoingEdges.map((e, i) => (
                  <span
                    key={i}
                    className={[
                      'px-1.5 py-0.5 rounded border text-[10px] font-mono',
                      e.resolved === false
                        ? 'bg-loom-err/15 border-loom-err/40 text-loom-err'
                        : 'bg-loom-panel2 border-loom-border text-loom-accent'
                    ].join(' ')}
                    title={e.resolved === false ? '目标 label 不存在' : undefined}
                  >
                    {e.type} → {e.target}{e.resolved === false ? '（悬空）' : ''}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div>
            <span className="text-[11px] text-loom-muted">← 到达（{incomingEdges.length}）</span>
            {incomingEdges.length === 0 ? (
              <div className="text-[11px] text-loom-muted/60 mt-0.5">无</div>
            ) : (
              <div className="flex flex-wrap gap-1 mt-0.5">
                {incomingEdges.map((e, i) => (
                  <span
                    key={i}
                    className="px-1.5 py-0.5 rounded bg-loom-panel2 border border-loom-border text-[10px] font-mono text-loom-ok"
                  >
                    {e.source ?? '?'} → {e.type}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* 分支选项 */}
      {label.menu_options && label.menu_options.length > 0 && (
        <section>
          <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
            分支选项
          </h3>
          <div className="space-y-1">
            {label.menu_options.map((opt, i) => (
              <div
                key={i}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-loom-bg border border-loom-border text-xs"
              >
                <span className="text-loom-muted">{i + 1}.</span>
                <span className="text-loom-text flex-1 truncate">{opt.text}</span>
                <span className="text-loom-accent font-mono text-[10px]">
                  → {opt.target ?? '—'}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

// ---- 子面板：角色属性 ----

function CharacterProperties({ character }: { character: CharacterMeta }) {
  return (
    <div className="p-3 space-y-4">
      {/* 基本信息 */}
      <section>
        <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
          角色信息
        </h3>
        <div className="flex items-center gap-3 mb-3">
          <CharacterAvatar character={character} size={48} rounded="rounded-lg" />
          <div>
            <div className="text-base font-semibold">{character.name}</div>
            <div className="text-xs text-loom-muted font-mono">
              {character.varName || '—'} · {character.sprites.length} 差分
            </div>
          </div>
        </div>
        <div className="space-y-1.5">
          <PropRow label="显示名称" value={character.name} />
          <PropRow label="变量名" value={character.varName || '—'} mono />
          <PropRow label="颜色" value={character.color} mono>
            <span
              className="px-2 py-0.5 rounded text-xs font-semibold"
              style={{ color: character.color, background: character.color + '22' }}
            >
              预览
            </span>
          </PropRow>
        </div>
      </section>

      {/* 简介 */}
      {character.description && (
        <section>
          <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
            简介
          </h3>
          <div className="px-3 py-2 rounded bg-loom-bg border border-loom-border text-xs text-loom-text whitespace-pre-wrap">
            {character.description}
          </div>
        </section>
      )}

      {/* 立绘差分 */}
      <section>
        <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
          立绘差分（{character.sprites.length}）
        </h3>
        {character.sprites.length === 0 ? (
          <div className="text-[11px] text-loom-muted/60">暂无差分</div>
        ) : (
          <div className="space-y-1">
            {character.sprites.map((sp) => (
              <div
                key={sp.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded bg-loom-bg border border-loom-border text-xs"
              >
                <SpriteThumbnail path={sp.path} size={32} />
                <div className="flex-1 min-w-0">
                  <div className="text-loom-text truncate">{sp.name}</div>
                  <div className="text-[10px] text-loom-muted font-mono truncate">
                    {sp.path || '—'}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

// ---- 子面板：默认视图（未选中 / 选中项目） ----

function DefaultView() {
  const characters = useStore((s) => s.characters)
  const projectLabels = useStore((s) => s.projectLabels)
  const setSelection = useStore((s) => s.setSelection)
  const setSelectedCharId = useStore((s) => s.setSelectedCharId)
  const selectLabel = useStore((s) => s.selectLabel)
  const requestNav = useStore((s) => s.requestNav)

  return (
    <div className="p-3 space-y-4">
      {/* 场景总览（跨文件） */}
      <section>
        <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
          全部场景（{projectLabels.length}）
        </h3>
        {projectLabels.length === 0 ? (
          <div className="text-[11px] text-loom-muted/60">暂无场景数据</div>
        ) : (
          <div className="space-y-1 max-h-40 overflow-auto">
            {projectLabels.map((l) => (
              <button
                key={l.id}
                onClick={() => {
                  // 跨文件导航：切换到所属文件并定位该 label
                  if (l.file) requestNav(l.file, l.line)
                  else {
                    setSelection({ type: 'label', id: l.id })
                    selectLabel(l.id)
                  }
                }}
                title={l.file ? `打开 ${l.file}` : undefined}
                className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-loom-panel2 transition-colors"
              >
                <span className="text-[10px] text-loom-muted font-mono">L{l.line}</span>
                <span className="text-xs text-loom-accent font-mono truncate">{l.name}</span>
                {l.file && (
                  <span className="text-[9px] text-loom-muted/70 font-mono truncate ml-auto max-w-[80px]">
                    {l.file}
                  </span>
                )}
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 角色总览 */}
      <section>
        <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
          角色列表（{characters.length}）
        </h3>
        {characters.length === 0 ? (
          <div className="text-[11px] text-loom-muted/60">暂无角色</div>
        ) : (
          <div className="space-y-1 max-h-40 overflow-auto">
            {characters.map((c) => (
              <button
                key={c.id}
                onClick={() => {
                  setSelection({ type: 'character', id: c.id })
                  setSelectedCharId(c.id)
                }}
                className="w-full flex items-center gap-2 px-2 py-1 rounded text-left hover:bg-loom-panel2 transition-colors"
              >
                <CharacterAvatar character={c} size={20} rounded="rounded" />
                <span className="text-xs truncate">{c.name}</span>
                <span className="text-[10px] text-loom-muted font-mono ml-auto">
                  {c.varName || '—'}
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      {/* 项目信息 */}
      <section>
        <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
          项目信息
        </h3>
        <div className="space-y-1.5">
          <PropRow label="场景总数" value={String(projectLabels.length)} />
          <PropRow label="角色总数" value={String(characters.length)} />
        </div>
      </section>
    </div>
  )
}

// ---- 通用组件 ----

function PropRow({
  label,
  value,
  mono,
  children
}: {
  label: string
  value: string
  mono?: boolean
  children?: React.ReactNode
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[11px] text-loom-muted flex-shrink-0">{label}</span>
      <span
        className={[
          'text-xs text-loom-text truncate',
          mono ? 'font-mono' : ''
        ].join(' ')}
        title={value}
      >
        {value}
      </span>
      {children}
    </div>
  )
}

// ---- 主导出组件 ----

// 属性面板顶栏信息（场景/角色选中时的动态标题），供功能栏顶栏复用，避免出现双层顶栏
export function usePropsHeader(): { title: string; subtitle: string; hasSelection: boolean } {
  const selection = useStore((s) => s.selection)
  const labels = useStore((s) => s.labels)
  const characters = useStore((s) => s.characters)

  let title = '属性'
  let subtitle = ''
  if (selection.type === 'label' && selection.id) {
    const label = labels.find((l) => l.id === selection.id)
    if (label) {
      title = label.name
      subtitle = `场景 · L${label.line}`
    }
  } else if (selection.type === 'character' && selection.id) {
    const char = characters.find((c) => c.id === selection.id)
    if (char) {
      title = char.name
      subtitle = '角色'
    }
  }
  return { title, subtitle, hasSelection: selection.type !== null }
}

export default function StoryProperties({ onPlayFromLine }: { onPlayFromLine?: (line: number) => void }) {
  const selection = useStore((s) => s.selection)
  const labels = useStore((s) => s.labels)
  const characters = useStore((s) => s.characters)

  let content: React.ReactNode = <DefaultView />

  if (selection.type === 'label' && selection.id) {
    const label = labels.find((l) => l.id === selection.id)
    if (label) {
      content = <SceneProperties labelId={selection.id} onPlayFromLine={onPlayFromLine} />
    }
  } else if (selection.type === 'character' && selection.id) {
    const char = characters.find((c) => c.id === selection.id)
    if (char) {
      content = <CharacterProperties character={char} />
    }
  }

  // 顶栏由功能栏统一渲染（usePropsHeader），此处只渲染内容
  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 overflow-auto">
        {content}
      </div>
    </div>
  )
}
