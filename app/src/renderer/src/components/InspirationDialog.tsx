import { useEffect, useState } from 'react'
import {
  useInspiration,
  INSPIRATION_CATEGORIES,
  DEFAULT_INSPIRATION_WORDS,
  parseWords,
  categoryLabel,
  type InspirationCategory,
} from '../store/inspiration'
import { useStore } from '../store/useStore'
import { useAiProviders, requestChat } from '../store/aiProviders'

// 「来点灵感」板块设置：调整各行上下顺序与显示隐藏、编辑/生成词条、逐词配色
export default function InspirationDialog() {
  const open = useInspiration((s) => s.dialogOpen)
  const closeDialog = useInspiration((s) => s.closeDialog)
  const order = useInspiration((s) => s.order)
  const words = useInspiration((s) => s.words)
  const wordColors = useInspiration((s) => s.wordColors)
  const hidden = useInspiration((s) => s.hidden)
  const charAuto = useInspiration((s) => s.charAuto)
  const moveCategory = useInspiration((s) => s.moveCategory)
  const setWords = useInspiration((s) => s.setWords)
  const resetWords = useInspiration((s) => s.resetWords)
  const setWordColor = useInspiration((s) => s.setWordColor)
  const clearWordColor = useInspiration((s) => s.clearWordColor)
  const toggleHidden = useInspiration((s) => s.toggleHidden)
  const setCharAuto = useInspiration((s) => s.setCharAuto)
  const resetAll = useInspiration((s) => s.resetAll)

  // 角色行：项目角色名自动读取（可在设置里开关「自动读取」）
  const characters = useStore((s) => s.characters)

  const [tab, setTab] = useState<InspirationCategory>('adj')
  const [draft, setDraft] = useState('')
  const [aiBusy, setAiBusy] = useState(false)
  const [aiMsg, setAiMsg] = useState<{ ok: boolean; text: string } | null>(null)

  // 打开或切换类别时，把该类别词条同步到编辑框
  useEffect(() => {
    if (!open) return
    setDraft(words[tab].join('\n'))
    setAiMsg(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab])

  if (!open) return null

  // 角色自动词（项目角色名）与角色自带色
  const charNames = characters.map((c) => c.name).filter(Boolean)
  const charColor: Record<string, string> = {}
  for (const c of characters) if (c.name && c.color) charColor[c.name] = c.color

  // 某行最终展示的词条（角色行 = 自动词 + 手动/AI 补充）
  const effectiveWords = (id: InspirationCategory): string[] => {
    if (id !== 'char' || !charAuto) return words[id]
    return Array.from(new Set([...charNames, ...words.char]))
  }

  const sectionTitle = 'text-[11px] font-semibold tracking-wider text-loom-muted uppercase mb-2'
  const inputCls =
    'w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm focus:outline-none focus:border-loom-accent'
  const btnCls =
    'px-3 py-2 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors whitespace-nowrap disabled:opacity-50'

  const applyDraft = (): void => {
    setWords(tab, parseWords(draft))
  }

  // 让 AI 生成新词条（使用「AI 管理」中的默认接口）
  const generateByAI = async (): Promise<void> => {
    setAiBusy(true)
    setAiMsg(null)
    try {
      const st = useAiProviders.getState()
      await st.ensureLoaded()
      const provider = useAiProviders.getState().resolveFor(null)
      if (!provider) {
        setAiMsg({ ok: false, text: '未配置 AI 接口，请先到「设置 → AI 管理」中添加并设为默认。' })
        return
      }
      const prompt =
        '你是视觉小说创作的灵感词库助手。请生成新的灵感词条，用于多行滚动字幕。\n' +
        '要求：形容词、名词、动词各 40 个；形容词以「的」结尾，名词为具体事物或场景，动词为动作或状态；\n' +
        '角色名为 20 个不重复的中文名（2-4 字），贴合题材；每条约 2-5 个汉字，贴合青春、日常、恋爱、悬疑等视觉小说题材，避免重复与生僻词。\n' +
        '只输出 JSON，不要任何解释，格式：{"adj":["..."],"char":["..."],"verb":["..."],"noun":["..."]}'
      const r = await requestChat(
        provider,
        [
          { role: 'system', content: '你只输出严格合法的 JSON。' },
          { role: 'user', content: prompt },
        ],
        { json: true, maxTokens: 3000, temperature: 0.9, timeoutMs: 120000 }
      )
      if (!r.ok) {
        setAiMsg({ ok: false, text: r.error || `请求失败（HTTP ${r.status}）` })
        return
      }
      const raw = (r.content || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim()
      let data: Record<string, unknown> | null = null
      try {
        data = JSON.parse(raw)
      } catch {
        setAiMsg({ ok: false, text: 'AI 返回的内容无法解析为 JSON，请重试。' })
        return
      }
      const next: Partial<Record<InspirationCategory, string[]>> = {}
      let n = 0
      for (const c of INSPIRATION_CATEGORIES) {
        const list = data?.[c.id]
        if (!Array.isArray(list)) continue
        const cleaned = parseWords(list.filter((x): x is string => typeof x === 'string').join('\n'))
        if (cleaned.length > 0) {
          next[c.id] = cleaned
          n += cleaned.length
        }
      }
      if (n === 0) {
        setAiMsg({ ok: false, text: 'AI 未返回可用的词条，请重试。' })
        return
      }
      for (const [id, list] of Object.entries(next)) {
        setWords(id as InspirationCategory, list as string[])
      }
      // 同步当前类别的编辑框，避免显示旧内容
      setDraft((next[tab] ?? words[tab]).join('\n'))
      setAiMsg({ ok: true, text: `已由 AI 更新 ${n} 个词条（${provider.name}）` })
    } catch (e) {
      setAiMsg({ ok: false, text: e instanceof Error ? e.message : String(e) })
    } finally {
      setAiBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={closeDialog}>
      <div
        className="w-[680px] max-w-[96vw] max-h-[88vh] flex flex-col rounded-lg bg-loom-panel border border-loom-border shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="px-4 py-3 border-b border-loom-border flex items-center flex-shrink-0">
          <h3 className="text-sm font-semibold">来点灵感 · 设置</h3>
          <span className="ml-2 text-xs text-loom-muted/70">调整行顺序与显示、逐词配色，或自定义 / 让 AI 生成词条</span>
          <button
            onClick={closeDialog}
            className="ml-auto p-1 rounded text-loom-muted hover:text-loom-text hover:bg-loom-border/30 transition-colors"
            title="关闭"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-auto px-4 py-4 space-y-5">
          {/* 行顺序与显示 */}
          <section>
            <div className={sectionTitle}>行顺序与显示（从上到下）</div>
            <div className="space-y-1.5">
              {order.map((id, i) => (
                <div
                  key={id}
                  className={`flex items-center gap-2 rounded border border-loom-border bg-loom-bg px-3 py-2 ${
                    hidden[id] ? 'opacity-55' : ''
                  }`}
                >
                  <span className="text-xs text-loom-muted w-5 font-mono">{i + 1}</span>
                  <span className="text-sm">{categoryLabel(id)}</span>
                  <span className="text-[11px] text-loom-muted/70">{effectiveWords(id).length} 个词条</span>
                  <div className="ml-auto flex items-center gap-1">
                    <button
                      className={btnCls + ' !px-2 !py-1'}
                      onClick={() => toggleHidden(id)}
                      title="显示 / 隐藏该行"
                    >
                      {hidden[id] ? '已隐藏' : '显示中'}
                    </button>
                    <button
                      className={btnCls + ' !px-2 !py-1'}
                      disabled={i === 0}
                      onClick={() => moveCategory(id, -1)}
                      title="上移"
                    >
                      ▲
                    </button>
                    <button
                      className={btnCls + ' !px-2 !py-1'}
                      disabled={i === order.length - 1}
                      onClick={() => moveCategory(id, 1)}
                      title="下移"
                    >
                      ▼
                    </button>
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-loom-muted/70 mt-1.5">
              行内词语每次进入主页都会随机打乱，无需手动排序；隐藏的行不会出现在板块中。
            </p>
          </section>

          {/* 词条编辑 */}
          <section>
            <div className={sectionTitle}>词条内容</div>
            <div className="flex items-center gap-1 mb-2">
              {INSPIRATION_CATEGORIES.map((c) => (
                <button
                  key={c.id}
                  onClick={() => setTab(c.id)}
                  className={`px-3 py-1.5 rounded text-xs border transition-colors ${
                    tab === c.id
                      ? 'border-loom-accent bg-loom-accent/10 text-loom-accent'
                      : 'border-loom-border hover:bg-loom-border/30'
                  }`}
                >
                  {c.label}
                </button>
              ))}
              <span className="ml-auto text-[11px] text-loom-muted/70">{parseWords(draft).length} 个</span>
            </div>

            {/* 角色行：自动读取项目角色 */}
            {tab === 'char' && (
              <div className="mb-2 rounded border border-loom-border bg-loom-bg px-3 py-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-loom-muted">自动读取项目角色</span>
                  <button
                    onClick={() => setCharAuto(!charAuto)}
                    className={`ml-auto px-2 py-0.5 rounded border text-[11px] transition-colors ${
                      charAuto
                        ? 'border-loom-accent/60 bg-loom-accent/10 text-loom-accent'
                        : 'border-loom-border text-loom-muted hover:bg-loom-border/30'
                    }`}
                  >
                    {charAuto ? '已开启' : '已关闭'}
                  </button>
                </div>
                {charAuto && (
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {charNames.length === 0 ? (
                      <span className="text-[11px] text-loom-muted/70">项目中还没有角色</span>
                    ) : (
                      charNames.map((n) => (
                        <span
                          key={n}
                          className="px-2 py-0.5 rounded-full border border-loom-border bg-loom-panel2 text-[11px]"
                          style={charColor[n] ? { color: charColor[n], borderColor: charColor[n] } : undefined}
                        >
                          {n}
                        </span>
                      ))
                    )}
                  </div>
                )}
              </div>
            )}

            <textarea
              className={inputCls + ' font-mono !text-xs h-40 resize-y'}
              value={draft}
              onChange={(e) => {
                setDraft(e.target.value)
                setWords(tab, parseWords(e.target.value))
              }}
              placeholder={tab === 'char' ? '手动 / AI 补充的角色名，每行一个' : '每行一个词，也可用逗号 / 顿号分隔'}
            />
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <button
                className={btnCls + ' !border-loom-accent/50 !text-loom-accent'}
                disabled={aiBusy}
                onClick={() => void generateByAI()}
              >
                {aiBusy ? 'AI 生成中…' : '让 AI 提供'}
              </button>
              <button
                className={btnCls}
                onClick={() => {
                  resetWords(tab)
                  setDraft(DEFAULT_INSPIRATION_WORDS[tab].join('\n'))
                }}
              >
                {tab === 'char' ? '清空补充词条' : '恢复该类默认词库'}
              </button>
              <button
                className={btnCls}
                onClick={() => {
                  applyDraft()
                }}
              >
                应用编辑
              </button>
            </div>
            {aiMsg && (
              <div
                className={`mt-2 px-3 py-2 rounded border text-xs leading-relaxed ${
                  aiMsg.ok
                    ? 'bg-loom-accent/10 border-loom-accent/40 text-loom-accent'
                    : 'bg-loom-err/15 border-loom-err/40 text-loom-err'
                }`}
              >
                {aiMsg.text}
              </div>
            )}
            <p className="text-[11px] text-loom-muted/70 mt-2">
              编辑会即时保存到本项目（各项目独立）。AI 生成会同时更新所有类别的词条。
            </p>
          </section>

          {/* 逐词配色 */}
          <section>
            <div className={sectionTitle}>词语配色（可选）</div>
            <div className="flex flex-wrap gap-1.5">
              {effectiveWords(tab).length === 0 ? (
                <span className="text-[11px] text-loom-muted/70">当前行还没有词条</span>
              ) : (
                effectiveWords(tab).map((w) => {
                  const override = wordColors[tab][w]
                  const cur = override || (tab === 'char' ? charColor[w] : '') || '#8a8a8a'
                  return (
                    <div
                      key={w}
                      className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${
                        override ? 'border-loom-accent/60 bg-loom-accent/10' : 'border-loom-border bg-loom-bg'
                      }`}
                      title="点击色块为该词配色"
                    >
                      <input
                        type="color"
                        className="w-5 h-5 flex-shrink-0"
                        value={cur}
                        onChange={(e) => setWordColor(tab, w, e.target.value)}
                      />
                      <span style={override ? { color: override } : undefined}>{w}</span>
                      {override && (
                        <button
                          onClick={() => clearWordColor(tab, w)}
                          className="text-loom-muted hover:text-loom-err leading-none"
                          title="清除该词配色"
                        >
                          ✕
                        </button>
                      )}
                    </div>
                  )
                })
              )}
            </div>
            <p className="text-[11px] text-loom-muted/70 mt-1.5">
              未配色的词使用默认样式；角色行若未配色则默认取角色自带的名字颜色。
            </p>
          </section>
        </div>

        {/* 底部 */}
        <div className="px-4 py-3 border-t border-loom-border flex items-center flex-shrink-0">
          <button
            className={btnCls}
            onClick={() => {
              resetAll()
              setDraft(DEFAULT_INSPIRATION_WORDS[tab].join('\n'))
              setAiMsg({ ok: true, text: '已恢复默认顺序、显示、配色与词库' })
            }}
          >
            全部恢复默认
          </button>
          <div className="flex-1" />
          <button
            onClick={closeDialog}
            className="px-4 py-2 rounded bg-loom-accent text-loom-bg font-semibold text-xs hover:opacity-90 transition-opacity"
          >
            完成
          </button>
        </div>
      </div>
    </div>
  )
}
