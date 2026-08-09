import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { fetchProjectStats, type ProjectStats } from '../api/client'

export default function HomePage() {
  const labels = useStore((s) => s.labels)
  const edges = useStore((s) => s.edges)
  const source = useStore((s) => s.source)
  const status = useStore((s) => s.status)
  const dialogueChars = useStore((s) => s.dialogueChars)
  const currentProject = useStore((s) => s.currentProject)
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null)

  const projectPath = currentProject?.path ?? ''

  // 加载项目统计
  useEffect(() => {
    if (!projectPath) return
    fetchProjectStats(projectPath)
      .then(setProjectStats)
      .catch((e) => console.error('fetch stats failed:', e))
  }, [projectPath])

  const totalLines = projectStats?.total_lines ?? source.split('\n').length
  const totalChars = projectStats?.dialogue_chars ?? dialogueChars
  const labelCount = projectStats?.labels ?? labels.length
  const menuCount = projectStats?.menus ?? labels.reduce((n, l) => n + (l.menu_options?.length ?? 0), 0)

  return (
    <div className="h-full overflow-auto p-6">
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

        {/* 项目信息 */}
        <Section title="项目信息">
          <InfoRow k="项目名称" v={currentProject?.name ?? '未命名'} />
          <InfoRow k="项目路径" v={currentProject?.path ?? '—'} />
          <InfoRow k="版本号" v="v0.1.0" />
          <InfoRow k="引擎" v="Ren'Py (需安装 SDK)" />
          <InfoRow k="后端服务" v={status?.running ? `运行中 · 端口 ${status.port}` : '离线'} />
        </Section>

        {/* 剧情结构 */}
        <Section title="剧情结构">
          {projectStats?.file_stats && projectStats.file_stats.length > 0 ? (
            <div className="space-y-3">
              {projectStats.file_stats
                .slice()
                .sort((a, b) => a.path.localeCompare(b.path))
                .map((file) => (
                  <div key={file.path} className="bg-loom-panel2 rounded border border-loom-border">
                    <div className="flex items-center justify-between px-3 py-2 border-b border-loom-border">
                      <span className="text-xs font-mono text-loom-accent">{file.path}</span>
                      <span className="text-[10px] text-loom-muted">
                        {file.labels} 场景 · {file.dialogue_chars} 字
                      </span>
                    </div>
                    <div className="p-2">
                      {file.labels === 0 ? (
                        <div className="text-loom-muted/60 text-xs py-1">无场景</div>
                      ) : (
                        <div className="flex flex-wrap gap-1.5">
                          {/* 这里暂时只显示统计，实际 label 列表需要额外数据 */}
                          <span className="text-xs text-loom-muted">{file.labels} 个场景</span>
                        </div>
                      )}
                    </div>
                  </div>
                ))}
            </div>
          ) : labels.length === 0 ? (
            <div className="text-loom-muted text-sm">暂无解析数据，请在工具栏点击「重新解析」。</div>
          ) : (
            <div className="flex flex-wrap gap-2">
              {labels.map((l) => (
                <span
                  key={l.id}
                  className="px-2.5 py-1 rounded bg-loom-panel2 border border-loom-border text-xs font-mono text-loom-accent"
                >
                  {l.name}
                  <span className="text-loom-muted ml-1">L{l.line}</span>
                </span>
              ))}
            </div>
          )}
        </Section>

        {/* 最近活动 */}
        <Section title="最近活动">
          <ul className="space-y-1.5 text-sm text-loom-text/80">
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-loom-accent" />
              <span>DEMO 初始化完成，后端已就绪</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-loom-ok" />
              <span>解析了 {labelCount} 个 label，{edges.length} 条跳转，{menuCount} 个选项</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="w-1.5 h-1.5 rounded-full bg-loom-muted" />
              <span>等待更多操作…</span>
            </li>
          </ul>
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

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg bg-loom-panel border border-loom-border">
      <div className="px-4 py-2.5 border-b border-loom-border text-sm font-semibold text-loom-text">
        {title}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function InfoRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between py-1.5 border-b border-loom-border/50 last:border-0 text-sm">
      <span className="text-loom-muted">{k}</span>
      <span className="text-loom-text font-mono">{v}</span>
    </div>
  )
}
