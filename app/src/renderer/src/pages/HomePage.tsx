import { useEffect, useMemo, useRef, useState } from 'react'
import { useStore } from '../store/useStore'
import { fetchProjectStats, type ProjectStats } from '../api/client'
import { useInspiration, shuffle, categoryLabel, type InspirationCategory, type WordColors } from '../store/inspiration'
import { useVersionSchemes } from '../store/versionSchemes'
import { parseTags, readProfile, writeProfile, type ProjectProfile } from '../store/projectProfile'
import InspirationDialog from '../components/InspirationDialog'
import ExportProjectDialog from '../components/ExportProjectDialog'

export default function HomePage() {
  const labels = useStore((s) => s.labels)
  const edges = useStore((s) => s.edges)
  const source = useStore((s) => s.source)
  const status = useStore((s) => s.status)
  const dialogueChars = useStore((s) => s.dialogueChars)
  const currentProject = useStore((s) => s.currentProject)
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null)

  // 灵感板块：词库/顺序/配色/显示按项目独立，切项目时重新加载
  const inspirOrder = useInspiration((s) => s.order)
  const inspirWords = useInspiration((s) => s.words)
  const inspirColors = useInspiration((s) => s.wordColors)
  const inspirHidden = useInspiration((s) => s.hidden)
  const inspirCharAuto = useInspiration((s) => s.charAuto)
  const openInspirSettings = useInspiration((s) => s.openDialog)
  const characters = useStore((s) => s.characters)
  const setActiveView = useStore((s) => s.setActiveView)

  // 项目信息（config.name / build.version，读写 game/options.rpy）：默认收起
  const [projInfo, setProjInfo] = useState<{ title: string; version: string } | null>(null)
  const [infoExpanded, setInfoExpanded] = useState(false)
  const [infoErr, setInfoErr] = useState<string | null>(null)
  // 项目简介（标签 + 多行简介）
  const [profile, setProfile] = useState<ProjectProfile>({ tags: [], intro: '' })
  const [introEditing, setIntroEditing] = useState(false)
  const [tagInput, setTagInput] = useState('')
  // 版本方案数（点击前往「打包发布」页）
  const schemeCount = useVersionSchemes((s) => s.schemes.length)
  // 导出项目（.loom 归档）弹窗
  const [exportOpen, setExportOpen] = useState(false)

  const projectPath = currentProject?.path ?? ''

  // 加载项目统计
  useEffect(() => {
    if (!projectPath) return
    fetchProjectStats(projectPath)
      .then(setProjectStats)
      .catch((e) => console.error('fetch stats failed:', e))
  }, [projectPath])

  // 切换项目时加载该项目的灵感词库与顺序
  useEffect(() => {
    if (projectPath) useInspiration.getState().load(projectPath)
  }, [projectPath])

  // 切换项目时加载显示名/版本号（options.rpy）、版本方案、项目简介
  useEffect(() => {
    if (!projectPath) return
    setInfoExpanded(false)
    setInfoErr(null)
    setIntroEditing(false)
    setTagInput('')
    void window.pupurin
      .readProjectInfo(projectPath)
      .then(setProjInfo)
      .catch(() => setProjInfo(null))
    useVersionSchemes.getState().load(projectPath)
    setProfile(readProfile(projectPath))
  }, [projectPath])

  // 保存显示名 / 版本号：写回 options.rpy
  async function saveProjectInfo(patch: { title?: string; version?: string }): Promise<void> {
    if (!projectPath) return
    setInfoErr(null)
    try {
      setProjInfo(await window.pupurin.updateProjectInfo(projectPath, patch))
    } catch (e) {
      setInfoErr(e instanceof Error ? e.message : String(e))
    }
  }

  // 保存标签 / 简介（按项目隔离）
  function saveProfile(next: ProjectProfile): void {
    setProfile(next)
    if (!projectPath) return
    writeProfile(projectPath, next)
  }

  // 输入框回车/逗号时把内容并入标签
  function addTags(text: string): void {
    const next = parseTags(text)
    if (next.length > 0) saveProfile({ ...profile, tags: Array.from(new Set([...profile.tags, ...next])) })
    setTagInput('')
  }

  // 角色行词条：自动读取项目角色名 + 手动/AI 补充（去重）
  const effWords = useMemo<Record<InspirationCategory, string[]>>(() => {
    const base: Record<InspirationCategory, string[]> = {
      adj: inspirWords.adj,
      char: inspirWords.char,
      verb: inspirWords.verb,
      noun: inspirWords.noun,
    }
    if (inspirCharAuto) {
      const auto = characters.map((c) => c.name).filter(Boolean)
      base.char = Array.from(new Set([...auto, ...inspirWords.char]))
    }
    return base
  }, [inspirWords, characters, inspirCharAuto])

  // 逐词配色：角色自动词默认取角色自带色，用户自定义配色优先
  const effColors = useMemo<WordColors>(() => {
    let charColors: Record<string, string> = {}
    if (inspirCharAuto) {
      for (const c of characters) if (c.name && c.color) charColors[c.name] = c.color
    }
    charColors = { ...charColors, ...inspirColors.char }
    return { adj: inspirColors.adj, char: charColors, verb: inspirColors.verb, noun: inspirColors.noun }
  }, [characters, inspirColors, inspirCharAuto])

  // 每次进入主页随机打乱各行词序（“每次都随机排列顺序”）
  const shuffledWords = useMemo<Record<InspirationCategory, string[]>>(
    () => ({
      adj: shuffle(effWords.adj),
      char: shuffle(effWords.char),
      verb: shuffle(effWords.verb),
      noun: shuffle(effWords.noun),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effWords, inspirOrder, projectPath]
  )

  // 隐藏的行不显示（顺序仍保留，可在设置中重新勾选）
  const visibleOrder = inspirOrder.filter((id) => !inspirHidden[id])

  const totalLines = projectStats?.total_lines ?? source.split('\n').length
  const totalChars = projectStats?.dialogue_chars ?? dialogueChars
  const labelCount = projectStats?.labels ?? labels.length
  const menuCount = projectStats?.menus ?? labels.reduce((n, l) => n + (l.menu_options?.length ?? 0), 0)

  return (
    <div className="h-full overflow-auto p-6">
      {/* 板块设置弹窗（仅主页需要） */}
      <InspirationDialog />
      {/* 导出项目（.loom 归档） */}
      {exportOpen && <ExportProjectDialog projectPath={projectPath} onClose={() => setExportOpen(false)} />}
      <div className="max-w-4xl mx-auto space-y-6">
        {/* 顶部标题 */}
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-loom-accent/20 flex items-center justify-center">
            <svg viewBox="0 0 24 24" fill="none" stroke="#FFE4A6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" width="24" height="24">
              <path d="M3 12l9-9 9 9M5 10v10h14V10" />
              <circle cx="12" cy="14" r="1.5" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-semibold text-loom-text">
              {currentProject?.name ?? '工作台'}
            </h1>
            <p className="text-xs text-loom-muted">
              {currentProject ? `路径: ${currentProject.path}` : '欢迎回到铃言织机°'}
            </p>
          </div>
        </div>

        {/* 统计卡片 */}
        <div className="grid grid-cols-4 gap-3">
          <StatCard label="对话字数" value={totalChars.toLocaleString()} hint={`全部 .rpy 文件`} />
          <StatCard label="总行数" value={totalLines.toLocaleString()} hint={`${projectStats?.files ?? 1} 个剧本文件`} />
          <StatCard label="剧情节点" value={String(labelCount)} hint="label 数量" />
          <StatCard label="跳转/选项" value={String(edges.length)} hint={`jump/call/menu · ${menuCount} 选项`} />
        </div>

        {/* 项目信息：默认收起（仅名称/版本号），展开后显示方案数/引擎/后端；点击值可原地编辑 */}
        <Section
          title="项目信息"
          action={
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setInfoExpanded((v) => !v)}
                className="px-2.5 py-1 rounded border border-loom-border bg-loom-panel2 text-[11px] text-loom-muted hover:text-loom-text hover:bg-loom-border/30 transition-colors"
              >
                {infoExpanded ? '收起' : '展开'}
              </button>
              <button
                onClick={() => {
                  if (projectPath) setExportOpen(true)
                }}
                disabled={!projectPath}
                className="px-2.5 py-1 rounded border border-loom-border bg-loom-panel2 text-[11px] text-loom-muted hover:text-loom-text hover:bg-loom-border/30 transition-colors disabled:opacity-40"
                title="导出为 .loom 归档（可分享或在其他设备恢复）"
              >
                导出项目
              </button>
              <button
                onClick={() => {
                  if (projectPath) void window.pupurin.showProjectInFinder(projectPath)
                }}
                className="px-2.5 py-1 rounded border border-loom-border bg-loom-panel2 text-[11px] text-loom-muted hover:text-loom-text hover:bg-loom-border/30 transition-colors"
                title="在 Finder（或文件资源管理器）中打开项目目录"
              >
                在 Finder 中打开
              </button>
            </div>
          }
        >
          <EditableInfoRow
            k="项目名称"
            v={projInfo?.title ?? currentProject?.name ?? ''}
            placeholder="未命名"
            onSave={(nv) => void saveProjectInfo({ title: nv })}
          />
          <EditableInfoRow
            k="版本号"
            v={projInfo?.version ?? '1.0'}
            placeholder="1.0"
            onSave={(nv) => void saveProjectInfo({ version: nv })}
          />
          {infoExpanded && (
            <>
              <InfoRow
                k="版本方案数"
                v={`${schemeCount} 个`}
                onClick={() => setActiveView('package')}
                title="前往打包发布页管理版本方案"
              />
              <InfoRow k="引擎" v="Ren'Py (需安装 SDK)" />
              <InfoRow k="后端服务" v={status?.running ? `运行中 · 端口 ${status.port}` : '离线'} />
            </>
          )}
          {infoErr && <p className="text-[11px] text-loom-err mt-1.5">保存失败：{infoErr}</p>}
        </Section>

        {/* 项目简介：标签 + 多行简介，点击「编辑」进入填写 */}
        <Section
          title="项目简介"
          action={
            <button
              onClick={() => setIntroEditing((v) => !v)}
              className="px-2.5 py-1 rounded border border-loom-border bg-loom-panel2 text-[11px] text-loom-muted hover:text-loom-text hover:bg-loom-border/30 transition-colors"
            >
              {introEditing ? '完成' : '编辑'}
            </button>
          }
        >
          {introEditing ? (
            <div className="space-y-3">
              <div>
                <div className="text-[11px] text-loom-muted mb-1.5">项目标签（回车或逗号添加，如「轻喜剧 奇幻」）</div>
                {profile.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {profile.tags.map((t) => (
                      <span
                        key={t}
                        className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-loom-accent/10 border border-loom-accent/40 text-[11px] text-loom-accent"
                      >
                        #{t}
                        <button
                          onClick={() => saveProfile({ ...profile, tags: profile.tags.filter((x) => x !== t) })}
                          className="text-loom-muted hover:text-loom-err leading-none"
                          title="删除标签"
                        >
                          ✕
                        </button>
                      </span>
                    ))}
                  </div>
                )}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ',' || e.key === '，') {
                      e.preventDefault()
                      addTags(tagInput)
                    } else if (e.key === 'Backspace' && !tagInput && profile.tags.length > 0) {
                      saveProfile({ ...profile, tags: profile.tags.slice(0, -1) })
                    }
                  }}
                  onBlur={() => addTags(tagInput)}
                  placeholder="输入标签后回车，如 轻喜剧 奇幻 悬疑"
                  className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm focus:outline-none focus:border-loom-accent"
                />
              </div>
              <div>
                <div className="text-[11px] text-loom-muted mb-1.5">项目简介</div>
                <textarea
                  value={profile.intro}
                  onChange={(e) => saveProfile({ ...profile, intro: e.target.value })}
                  rows={5}
                  placeholder="介绍一下这个故事的世界观、基调、主要角色或创作想法…"
                  className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm leading-relaxed resize-y focus:outline-none focus:border-loom-accent"
                />
              </div>
              <p className="text-[11px] text-loom-muted/80 leading-relaxed">
                标签与简介会作为 AI 提示词的一部分，供铃光时刻、来点灵感等 AI 功能参考，让生成内容贴合作品基调。
                <br />
                简介保存在本机（按项目隔离），不会写入项目文件夹，换设备或重装后需重新填写。
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {profile.tags.length > 0 ? (
                <div className="flex flex-wrap gap-1.5">
                  {profile.tags.map((t) => (
                    <span
                      key={t}
                      className="px-2 py-0.5 rounded-full bg-loom-accent/10 border border-loom-accent/40 text-[11px] text-loom-accent"
                    >
                      #{t}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-loom-muted/60">还没有标签，点击「编辑」添加。</p>
              )}
              {profile.intro.trim() ? (
                <p className="text-sm text-loom-text/90 leading-relaxed whitespace-pre-wrap">{profile.intro}</p>
              ) : (
                <p className="text-xs text-loom-muted/60">还没有简介，点击「编辑」填写。</p>
              )}
            </div>
          )}
        </Section>

        {/* 来点灵感：多行词条持续向右滚动，行顺序/词库/配色/显示可在板块设置中调整或由 AI 生成 */}
        <Section
          title="来点灵感"
          action={
            <button
              onClick={openInspirSettings}
              className="px-2.5 py-1 rounded border border-loom-border bg-loom-panel2 text-[11px] text-loom-muted hover:text-loom-text hover:bg-loom-border/30 transition-colors"
              title="设置行顺序 / 显示隐藏 / 编辑词库 / 逐词配色 / 让 AI 提供"
            >
              设置
            </button>
          }
        >
          <div className="space-y-3">
            {visibleOrder.map((id) => (
              <div key={id} className="flex items-center gap-3">
                <span className="w-12 flex-shrink-0 text-right text-[11px] text-loom-muted">
                  {categoryLabel(id)}
                </span>
                <MarqueeRow words={shuffledWords[id]} colors={effColors[id]} />
              </div>
            ))}
            {visibleOrder.length === 0 && (
              <p className="text-xs text-loom-muted/70">所有行已隐藏，可在「设置」中重新勾选显示。</p>
            )}
          </div>
        </Section>

        {/* 品牌区 */}
        <div className="pt-4 pb-2 text-center space-y-1.5 select-none">
          <div className="text-xs text-loom-muted">
            铃言织机° <span className="text-loom-muted/60">(Pupurin° Loom)</span> · A Pupurin° Project
          </div>
          <div className="text-[11px] text-loom-muted/70">
            仆仆铃°工作室
            <a
              href="https://space.bilibili.com/3546379813129005"
              onClick={(e) => {
                e.preventDefault()
                void window.pupurin.openExternal('https://space.bilibili.com/3546379813129005')
              }}
              className="ml-2 text-loom-accent hover:underline"
            >
              Bilibili · 关注我们
            </a>
          </div>
        </div>
      </div>
    </div>
  )
}

function StatCard({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="rounded-lg bg-loom-panel border border-loom-border p-4">
      <div className="text-xs text-loom-muted">{label}</div>
      <div className="text-2xl font-semibold text-loom-text mt-1 font-mono">{value}</div>
      <div className="text-[10px] text-loom-muted/70 mt-1">{hint}</div>
    </div>
  )
}

function Section({
  title,
  action,
  children,
}: {
  title: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <div className="rounded-lg bg-loom-panel border border-loom-border">
      <div className="px-4 py-2.5 border-b border-loom-border flex items-center gap-2">
        <span className="text-sm font-semibold text-loom-text">{title}</span>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// 单行词条：内容复制两份并整体向右位移（-50% → 0），形成无缝循环滚动
function MarqueeRow({ words, colors }: { words: string[]; colors?: Record<string, string> }) {
  // 词条过少时循环补齐，避免轨道短于视口出现空白
  const source = words.length > 0 ? words : ['—']
  const base: string[] = []
  while (base.length < Math.max(24, source.length)) {
    base.push(...source)
  }

  // 每份自带尾部间距，保证两份宽度严格相等（用 flex gap 会让 -50% 偏半个间距）
  const duration = Math.max(24, base.length * 1.4)
  const copy = (key: string, hidden: boolean) => (
    <div key={key} className="flex gap-2 pr-2" aria-hidden={hidden || undefined}>
      {base.map((w, i) => {
        const color = colors?.[w]
        return (
          <span
            key={`${w}-${i}`}
            className="px-2.5 py-1 rounded-full bg-loom-panel2 border border-loom-border text-xs text-loom-text/90 whitespace-nowrap"
            style={color ? { color, borderColor: color } : undefined}
          >
            {w}
          </span>
        )
      })}
    </div>
  )

  return (
    <div className="loom-insp-viewport flex-1 min-w-0">
      <div className="loom-insp-track" style={{ animationDuration: `${duration}s` }}>
        {copy('a', false)}
        {copy('b', true)}
      </div>
    </div>
  )
}

// 只读信息行；传入 onClick 时整行可点击（如「版本方案数」前往打包发布页）
function InfoRow({ k, v, onClick, title }: { k: string; v: string; onClick?: () => void; title?: string }) {
  const body = (
    <>
      <span className="text-loom-muted">{k}</span>
      <span className={`font-mono ${onClick ? 'text-loom-accent' : 'text-loom-text'}`}>
        {v}
        {onClick && <span className="ml-1 text-loom-muted">↗</span>}
      </span>
    </>
  )
  if (onClick) {
    return (
      <button
        onClick={onClick}
        title={title}
        className="w-full text-left flex justify-between py-1.5 border-b border-loom-border/50 last:border-0 text-sm hover:bg-loom-border/20 transition-colors"
      >
        {body}
      </button>
    )
  }
  return <div className="flex justify-between py-1.5 border-b border-loom-border/50 last:border-0 text-sm">{body}</div>
}

// 可原地编辑的信息行：点击值 → 输入框，Enter/失焦保存，Esc 取消
function EditableInfoRow({
  k,
  v,
  onSave,
  placeholder,
}: {
  k: string
  v: string
  onSave: (next: string) => void
  placeholder?: string
}) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(v)
  // 防止 Enter 与随后的 blur 重复提交 / Esc 后 blur 仍提交
  const doneRef = useRef(false)

  function commit(): void {
    if (doneRef.current) return
    doneRef.current = true
    setEditing(false)
    const next = draft.trim()
    if (next && next !== v) onSave(next)
  }

  function cancel(): void {
    doneRef.current = true
    setEditing(false)
  }

  if (editing) {
    return (
      <div className="py-1.5 border-b border-loom-border/50 last:border-0">
        <div className="text-[11px] text-loom-muted mb-1">{k}</div>
        <input
          autoFocus
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            else if (e.key === 'Escape') cancel()
          }}
          onBlur={commit}
          className="w-full bg-loom-bg border border-loom-accent/60 rounded px-2 py-1 text-sm font-mono focus:outline-none"
        />
      </div>
    )
  }

  return (
    <button
      onClick={() => {
        doneRef.current = false
        setDraft(v)
        setEditing(true)
      }}
      title="点击编辑"
      className="group w-full text-left flex justify-between py-1.5 border-b border-loom-border/50 last:border-0 text-sm hover:bg-loom-border/20 transition-colors"
    >
      <span className="text-loom-muted">{k}</span>
      <span className="text-loom-text font-mono flex items-center gap-1.5">
        {v || <span className="text-loom-muted/60">{placeholder ?? '—'}</span>}
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          width="11"
          height="11"
          className="text-loom-muted opacity-0 group-hover:opacity-100 transition-opacity"
        >
          <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z" />
        </svg>
      </span>
    </button>
  )
}
