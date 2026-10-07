// 版本方案面板（打包发布页功能栏侧边栏）：
// 方案管理（新建/删除/标签增删与颜色）+ 当前方案选择 + 当前方案过滤统计
import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { useVersionSchemes } from '../store/versionSchemes'
import { listStoryFiles } from '../utils/storyFiles'
import { parseDialogue } from '../utils/dialogueParser'
import { filterBlocksByVersions, type VersionFilterStats } from '../utils/versionFilter'
import TagDropdown from './TagDropdown'

/** 标签默认颜色（未自定义时） */
const FALLBACK_COLOR = '#8a8a8a'

export default function VersionSchemePanel() {
  const projectPath = useStore((s) => s.currentProject?.path ?? '')
  const vs = useVersionSchemes()
  const { schemes, active } = vs
  const activeScheme = schemes.find((s) => s.name === active) ?? null

  const [stats, setStats] = useState<(VersionFilterStats & { files: number }) | null>(null)
  const [statsLoading, setStatsLoading] = useState(false)
  const [newScheme, setNewScheme] = useState('')
  const [newTagName, setNewTagName] = useState('')

  // 当前方案过滤统计（方案/标签变化时自动刷新）
  useEffect(() => {
    if (!projectPath) return
    if (!activeScheme || activeScheme.tags.length === 0) {
      setStats(null)
      return
    }
    let cancelled = false
    setStatsLoading(true)
    void (async () => {
      try {
        const storyFiles = await listStoryFiles(projectPath)
        const tags = activeScheme.tags
        let files = 0
        const total: VersionFilterStats = { keptBlocks: 0, removedBlocks: 0, removedLabels: 0, redirectedJumps: 0 }
        for (const rel of storyFiles) {
          const content = await window.pupurin.readFile(projectPath, rel)
          const { stats: st } = filterBlocksByVersions(parseDialogue(content), tags)
          files += 1
          total.keptBlocks += st.keptBlocks
          total.removedBlocks += st.removedBlocks
          total.removedLabels += st.removedLabels
          total.redirectedJumps += st.redirectedJumps
        }
        if (!cancelled) setStats({ files, ...total })
      } catch {
        if (!cancelled) setStats(null)
      } finally {
        if (!cancelled) setStatsLoading(false)
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, active, schemes])

  const addScheme = (): void => {
    vs.addScheme(newScheme)
    setNewScheme('')
  }

  return (
    <div className="p-3 space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-loom-text mb-1">版本方案</h2>
        <p className="text-[11px] text-loom-muted leading-relaxed mb-1.5">
          <span className="text-loom-text font-medium">版本标签</span>
          ：给剧情块打上的分类标记（如 r18、全年龄、watch）。在织机里双击剧情块可打标签，每个标签可以自定义颜色。
        </p>
        <p className="text-[11px] text-loom-muted leading-relaxed">
          <span className="text-loom-text font-medium">版本方案</span>
          ：打包出的一个「版本」。方案包含哪些标签，导出时就保留打了这些标签（或没打标签）的内容，其余剧情块会被移除。
        </p>
      </div>

      {/* 启用开关：选中方案 = 启用过滤；未启用则按完整内容打包 */}
      {schemes.length === 0 ? (
        <div className="text-[11px] text-loom-muted rounded-lg bg-loom-bg border border-dashed border-loom-border p-3">
          暂无方案。先创建一个方案，再回到剧情编辑器给块添加版本标签。
        </div>
      ) : (
        <div className="space-y-1.5">
          {schemes.map((s) => (
            <div
              key={s.name}
              className={`rounded-lg border p-2.5 space-y-2 transition-colors ${
                active === s.name ? 'border-loom-accent bg-loom-accent/10' : 'border-loom-border/70 bg-loom-bg/40'
              }`}
            >
              <div className="flex items-center gap-2">
                <label className="flex items-center gap-1.5 flex-1 min-w-0 cursor-pointer">
                  <input
                    type="radio"
                    checked={active === s.name}
                    onChange={() => vs.setActive(s.name)}
                    className="accent-loom-accent"
                  />
                  <span className="text-xs font-mono text-loom-text truncate">{s.name}</span>
                </label>
                {active === s.name && (
                  <button
                    onClick={() => vs.clearActive()}
                    className="text-[10px] text-loom-muted hover:text-loom-err transition-colors"
                    title="不启用版本过滤"
                  >
                    取消
                  </button>
                )}
                <button
                  onClick={() => vs.removeScheme(s.name)}
                  className="text-[10px] text-loom-muted hover:text-loom-err transition-colors"
                  title="删除方案"
                >
                  ✕
                </button>
              </div>
              {/* 方案的标签列表（编辑中的方案用下拉选择/新建） */}
              {active === s.name ? (
                <TagDropdown
                  value={s.tags}
                  onChange={(next) => {
                    const added = next.filter((t) => !s.tags.includes(t))
                    const removed = s.tags.filter((t) => !next.includes(t))
                    for (const t of added) vs.addTag(s.name, t)
                    for (const t of removed) vs.removeTag(s.name, t)
                  }}
                />
              ) : (
                <div className="flex items-center gap-1 flex-wrap">
                  {s.tags.length === 0 ? (
                    <span className="text-[10px] text-loom-muted/70">（无标签，等于完整内容）</span>
                  ) : (
                    s.tags.map((t) => {
                      const color = vs.tagColors[t] ?? FALLBACK_COLOR
                      return (
                        <span
                          key={t}
                          className="px-1.5 py-0.5 rounded text-[10px] font-mono"
                          style={{ background: color + '18', border: `1px solid ${color}44`, color }}
                        >
                          {t}
                        </span>
                      )
                    })
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* 新建方案 */}
      <div className="flex items-center gap-2">
        <input
          type="text"
          value={newScheme}
          onChange={(e) => setNewScheme(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              addScheme()
            }
          }}
          placeholder="新建方案名称"
          className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-xs text-loom-text focus:outline-none focus:border-loom-accent"
        />
        <button
          onClick={addScheme}
          className="px-2.5 py-1 rounded bg-loom-accent text-loom-bg text-[11px] font-semibold hover:bg-loom-accent/90 transition-colors"
        >
          添加
        </button>
      </div>

      {/* 版本标签管理（项目级：查看/改色/删除/新建） */}
      <div className="rounded-lg bg-loom-bg border border-loom-border p-3 space-y-2">
        <h3 className="text-[11px] font-semibold text-loom-text">版本标签管理</h3>
        <p className="text-[10px] text-loom-muted leading-snug">
          标签是项目级定义，可被多个方案复用，也用于织机剧情块的版本设置。删除标签会同时从所有方案中移除。
        </p>
        {Object.keys(vs.tagColors).length === 0 ? (
          <p className="text-[10px] text-loom-muted/70">暂无标签，在下方创建。</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {Object.entries(vs.tagColors).map(([t, color]) => (
              <span
                key={t}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono"
                style={{ background: color + '22', border: `1px solid ${color}55`, color }}
              >
                <label className="relative w-2.5 h-2.5 rounded-full cursor-pointer flex-shrink-0" title="自定义标签颜色">
                  <span className="absolute inset-0 rounded-full" style={{ background: color }} />
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => vs.setTagColor(t, e.target.value)}
                    className="absolute inset-0 opacity-0 cursor-pointer"
                  />
                </label>
                {t}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    vs.removeTagDefinition(t)
                  }}
                  className="px-1 py-0.5 relative z-10 rounded hover:bg-loom-bg transition-colors"
                  title="删除该标签（同时从所有方案移除）"
                >
                  ✕
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newTagName}
            onChange={(e) => setNewTagName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                if (newTagName.trim()) vs.ensureTagColor(newTagName)
                setNewTagName('')
              }
            }}
            placeholder="新建标签名"
            className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-[10px] font-mono text-loom-text focus:outline-none focus:border-loom-accent"
          />
          <button
            type="button"
            onClick={() => {
              if (newTagName.trim()) vs.ensureTagColor(newTagName)
              setNewTagName('')
            }}
            disabled={!newTagName.trim()}
            className="px-2 py-1 rounded bg-loom-accent text-loom-bg text-[10px] font-semibold disabled:opacity-40 transition-colors"
          >
            创建
          </button>
        </div>
      </div>

      {/* 内容统计：当前方案过滤效果 */}
      {activeScheme && (
        <div className="rounded-lg bg-loom-bg border border-loom-border p-3 space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-semibold text-loom-text">过滤统计</span>
            {statsLoading && <span className="text-[10px] text-loom-muted animate-pulse">计算中…</span>}
          </div>
          {!statsLoading && stats && (
            <>
              <div className="text-[11px] text-loom-muted">
                剧情文件 <span className="text-loom-text font-mono">{stats.files}</span> 个
              </div>
              <div className="text-[11px] text-loom-muted">
                保留 <span className="text-loom-ok font-mono">{stats.keptBlocks}</span> 块
                <span className="mx-1 text-loom-muted/50">·</span>
                移除 <span className="text-loom-err font-mono">{stats.removedBlocks}</span> 块
              </div>
              {(stats.removedLabels > 0 || stats.redirectedJumps > 0) && (
                <div className="text-[11px] text-loom-warn">
                  移除 label <span className="font-mono">{stats.removedLabels}</span> 个，
                  跳转修正 <span className="font-mono">{stats.redirectedJumps}</span> 处
                </div>
              )}
              <p className="text-[10px] text-loom-muted/70 leading-snug">
                打包时将按此方案过滤剧情内容；跳转到被移除场景的 jump/call 会自动改跳最近的存活场景。
              </p>
            </>
          )}
          {!statsLoading && !stats && (
            <p className="text-[10px] text-loom-muted/70">
              当前方案标签为空（相当于完整内容），或统计失败。
            </p>
          )}
        </div>
      )}

      {!activeScheme && (
        <p className="text-[10px] text-loom-muted/70 leading-snug">
          未启用版本过滤：打包将包含全部剧情内容。启用一个方案后，其标签会自动应用于上方三个打包目标。
        </p>
      )}
    </div>
  )
}
