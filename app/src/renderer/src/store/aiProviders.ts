import { create } from 'zustand'
import { projectProfileBlock } from './projectProfile'

// ---- AI 接口管理：多接口配置 + 全局默认 + 按功能绑定 ----
// 持久化到 userData/settings.json 的单个键 aiProviders（经主进程 settings:get/set）
// 依赖方向：plugins.ts → 本文件；本文件仅额外依赖 projectProfile（提示词注入），不引入其他 store，避免循环依赖。

export interface AiProvider {
  id: string
  name: string
  templateId: string
  /** 图标：emoji 或短文本，显示在下拉/列表/卡片左侧 */
  icon: string
  baseUrl: string
  apiKey: string
  model: string
}

export interface AiConfig {
  version: 1
  providers: AiProvider[]
  /** 全局默认接口 id；null = 未设置 */
  defaultId: string | null
  /** 功能绑定：featureId → providerId；null/缺省 = 跟随全局默认 */
  bindings: Record<string, string | null>
}

/** 暴露给 UI / 插件列表的安全视图（不含 apiKey） */
export interface AiProviderPublic {
  id: string
  name: string
  templateId: string
  icon: string
  baseUrl: string
  model: string
  hasKey: boolean
  isDefault: boolean
  invalid: boolean
}

export interface AiTemplate {
  id: string
  name: string
  icon: string
  baseUrl: string
  models: string[]
}

/** 常见服务商模板：新建时可一键套用（自动填图标、baseUrl 与推荐模型） */
export const AI_TEMPLATES: AiTemplate[] = [
  { id: 'openai', name: 'OpenAI', icon: '🌐', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'] },
  { id: 'deepseek', name: 'DeepSeek', icon: '🐋', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'zhipu-glm', name: '智谱 GLM', icon: '🧠', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-flash', 'glm-4-plus', 'glm-4-air'] },
  { id: 'qwen', name: '通义千问', icon: '☁️', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', models: ['qwen-plus', 'qwen-turbo', 'qwen-max'] },
  { id: 'kimi', name: 'Kimi（Moonshot）', icon: '🌙', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'kimi-k2-0711-preview'] },
  { id: 'custom', name: '自定义（OpenAI 兼容）', icon: '⭐', baseUrl: '', models: [] },
]

/** 图标候选：新建/编辑接口时可点选，也可自行输入任意 emoji */
export const AI_ICON_CHOICES = [
  '⭐', '🌐', '🐋', '🧠', '☁️', '🌙', '🤖', '✦', '⚡', '🎭',
  '🦊', '🐱', '🌸', '🔥', '💎', '🎵', '📖', '🖋️', '🪄', '🗝️',
]

const DEFAULT_ICON = '⭐'

/** 按模板取默认图标 */
function iconForTemplate(templateId: string): string {
  const t = AI_TEMPLATES.find((x) => x.id === templateId)
  return t ? t.icon : DEFAULT_ICON
}

/** 已知 AI 功能/插件：用于「功能绑定」列表。integrated=false 表示插件侧尚未接入（预留）。 */
export interface AiFeature {
  id: string
  name: string
  integrated: boolean
  note?: string
}

export const AI_FEATURES: AiFeature[] = [
  { id: 'pupurin-moments', name: '铃光时刻', integrated: true },
  { id: 'story-ai', name: 'AI 台词灵感', integrated: false, note: '预留（插件侧待接入）' },
]

/** 插件选择器里「＋ 新增 AI 服务…」哨兵值 */
export const AI_SELECTOR_NEW = '__new__'

const MAX_PROVIDERS = 50
const MAX_FIELD = 4000

let idSeq = 0
function genId(): string {
  return `p_${Date.now().toString(36)}_${(++idSeq).toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`
}

function str(v: unknown, max = MAX_FIELD): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

export function emptyConfig(): AiConfig {
  return { version: 1, providers: [], defaultId: null, bindings: {} }
}

/** 归一化任意输入为合法 AiConfig（容错，绝不抛错） */
export function normalizeConfig(raw: unknown): AiConfig {
  if (!raw || typeof raw !== 'object') return emptyConfig()
  const o = raw as Record<string, unknown>
  const list = Array.isArray(o.providers) ? o.providers.slice(0, MAX_PROVIDERS) : []
  const providers: AiProvider[] = []
  const seen = new Set<string>()
  for (const item of list) {
    if (!item || typeof item !== 'object') continue
    const p = item as Record<string, unknown>
    let id = str(p.id, 64)
    if (!id || seen.has(id)) id = genId()
    seen.add(id)
    providers.push({
      id,
      name: str(p.name, 128).trim() || '未命名服务',
      templateId: str(p.templateId, 64) || 'custom',
      icon: str(p.icon, 8).trim() || iconForTemplate(str(p.templateId, 64) || 'custom'),
      baseUrl: str(p.baseUrl, 2048).trim(),
      apiKey: str(p.apiKey, 2048),
      model: str(p.model, 256).trim(),
    })
  }
  let defaultId: string | null = str(o.defaultId, 64)
  if (!defaultId || !providers.some((p) => p.id === defaultId)) defaultId = null
  const bindings: Record<string, string | null> = {}
  const rawB = o.bindings
  if (rawB && typeof rawB === 'object') {
    for (const [k, v] of Object.entries(rawB as Record<string, unknown>)) {
      const pid = typeof v === 'string' ? v : ''
      // 指向已删除接口 → 清理为「跟随默认」
      bindings[str(k, 64)] = pid && providers.some((p) => p.id === pid) ? pid : null
    }
  }
  return { version: 1, providers, defaultId, bindings }
}

export function isValidBaseUrl(u: string): boolean {
  return /^https?:\/\//i.test((u || '').trim())
}

/** 接口地址归一化：允许填到版本号，自动补 /chat/completions（兼容旧 /completions） */
export function chatUrl(base: string): string {
  const b = (base || '').trim().replace(/\/+$/, '')
  if (!b) return ''
  if (/\/chat\/completions$/i.test(b)) return b
  if (/\/completions$/i.test(b)) return b.replace(/\/completions$/i, '/chat/completions')
  return b + '/chat/completions'
}

function httpError(status: number, text: string): string {
  const body = String(text || '').slice(0, 300)
  if (status === 401) return 'HTTP 401：API Key 无效或未授权。' + body
  if (status === 403) return 'HTTP 403：无权限访问该模型。' + body
  if (status === 404) return 'HTTP 404：接口地址或模型名有误（请检查接口地址与模型）。' + body
  if (status === 429) return 'HTTP 429：请求过于频繁或额度不足。' + body
  return `HTTP ${status}：${body}`
}

/** 从 OpenAI 兼容响应中提取助手文本 */
export function extractAssistantText(json: unknown): string {
  const j = json as Record<string, any> | null
  const choice = j?.choices?.[0]
  const msg = choice?.message?.content ?? choice?.delta?.content ?? choice?.text
  if (typeof msg === 'string') return msg
  if (Array.isArray(msg)) {
    return msg.map((x: any) => (typeof x?.text === 'string' ? x.text : '')).join('')
  }
  return ''
}

export interface AiChatOptions {
  temperature?: number
  maxTokens?: number
  json?: boolean
  timeoutMs?: number
  maxBytes?: number
  /**
   * 是否自动把当前项目简介（标签 + 简介）拼进提示词，默认 true。
   * 仅「测试连接」这类不需要作品背景的调用才需要显式关闭。
   */
  withProjectContext?: boolean
}

export interface AiChatResult {
  ok: boolean
  status: number
  text: string
  content: string
  error?: string
}

/** 用指定接口发起一次 OpenAI 兼容聊天请求（UI 测试连接与插件 loom.ai.chat 共用） */
export async function requestChat(
  provider: AiProvider,
  messages: unknown[],
  opts: AiChatOptions = {}
): Promise<AiChatResult> {
  const url = chatUrl(provider.baseUrl)
  if (!url) throw new Error('接口地址为空，请先填写接口地址')
  if (!provider.apiKey) throw new Error('API Key 为空，请先填写 API Key')
  // 统一注入项目简介（标签 + 简介），让输出贴合作品基调；无简介时不添加
  let finalMessages = messages
  if (opts.withProjectContext !== false) {
    const block = projectProfileBlock()
    if (block) finalMessages = [{ role: 'system', content: block }, ...messages]
  }
  const body: Record<string, unknown> = {
    model: provider.model || '',
    messages: finalMessages,
    temperature: typeof opts.temperature === 'number' ? opts.temperature : 0.3,
  }
  if (opts.maxTokens) body.max_tokens = opts.maxTokens
  if (opts.json) body.response_format = { type: 'json_object' }
  const r = await window.pupurin.pluginHttp(
    'POST',
    url,
    JSON.stringify(body),
    { 'Content-Type': 'application/json', Authorization: 'Bearer ' + provider.apiKey },
    { timeoutMs: opts.timeoutMs ?? 120000, maxBytes: opts.maxBytes ?? 200000 }
  )
  let json: unknown = null
  try {
    json = JSON.parse(r.text)
  } catch {
    json = null
  }
  const content = json ? extractAssistantText(json) : ''
  let error: string | undefined
  if (!r.ok) error = httpError(r.status, r.text)
  else if (json && typeof json === 'object' && (json as any).error) {
    const e = (json as any).error
    error = '接口返回错误：' + String(e?.message || e?.code || e)
  }
  return { ok: r.ok && !error, status: r.status, content, text: r.text, error }
}

// ---- 选择器助手（供 HTML 插件面板嵌入：选一个 / 新增一个）----

function escHtml(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** 生成插件面板用的 AI 选择器 <select>（含「跟随默认」与「＋ 新增 AI 服务…」） */
export function providerSelectorHtml(
  featureId: string,
  opts: { className?: string; noneLabel?: string } = {}
): string {
  const { config } = useAiProviders.getState()
  const bound = config.bindings[featureId] ?? null
  const def = config.providers.find((p) => p.id === config.defaultId) ?? null
  const noneLabel = opts.noneLabel ?? `跟随默认（${def ? def.name : '未配置'}）`
  const cls = opts.className ? ` class="${escHtml(opts.className)}"` : ''
  let html = `<select${cls} data-ai-selector="${escHtml(featureId)}">`
  html += `<option value="">${escHtml(noneLabel)}</option>`
  for (const p of config.providers) {
    const text = p.model ? `${p.name}（${p.model}）` : p.name
    // 图标前缀：原生 select 无法渲染图片，用 emoji/短文本在选项文字里呈现
    const label = `${p.icon ? p.icon + ' ' : ''}${text}`
    const sel = bound === p.id ? ' selected' : ''
    html += `<option value="${escHtml(p.id)}"${sel}>${escHtml(label)}</option>`
  }
  html += `<option value="${AI_SELECTOR_NEW}">＋ 新增 AI 服务…</option>`
  html += '</select>'
  return html
}

/** 绑定插件面板中的 AI 选择器：变更即写入绑定；选「新增」则拉起管理弹窗。返回卸载函数。 */
export function bindProviderSelector(
  root: HTMLElement,
  featureId: string,
  onChange?: (providerId: string | null) => void
): () => void {
  const el = root.querySelector(`[data-ai-selector="${featureId}"]`) as HTMLSelectElement | null
  if (!el) return () => {}
  const handler = (): void => {
    const v = el.value
    if (v === AI_SELECTOR_NEW) {
      // 打开管理弹窗后把选择器复位到当前绑定值，避免卡在「新增」项
      const cur = useAiProviders.getState().config.bindings[featureId] ?? ''
      el.value = cur
      useAiProviders.getState().openManager(featureId)
      return
    }
    useAiProviders.getState().setBinding(featureId, v || null)
    onChange?.(v || null)
  }
  el.addEventListener('change', handler)
  return () => el.removeEventListener('change', handler)
}

// ---- store ----

interface AiProvidersState {
  loaded: boolean
  config: AiConfig
  managerOpen: boolean
  managerFeature: string | null
  _loadPromise: Promise<void> | null

  ensureLoaded: () => Promise<void>
  load: () => Promise<void>
  persist: () => Promise<void>

  addProvider: (input: Partial<AiProvider>) => string
  updateProvider: (id: string, patch: Partial<AiProvider>) => void
  removeProvider: (id: string) => void
  setDefault: (id: string | null) => void
  setBinding: (featureId: string, id: string | null) => void

  openManager: (featureId?: string | null) => void
  closeManager: () => void

  publicList: () => AiProviderPublic[]
  publicDefault: () => AiProviderPublic | null
  providerById: (id: string) => AiProvider | null
  /** 按功能解析出可用接口（绑定 → 默认 → null），非法地址的接口会被跳过 */
  resolveFor: (featureId?: string | null) => AiProvider | null
}

let ensurePromise: Promise<void> | null = null

export const useAiProviders = create<AiProvidersState>((set, get) => ({
  loaded: false,
  config: emptyConfig(),
  managerOpen: false,
  managerFeature: null,
  _loadPromise: null,

  ensureLoaded: () => {
    if (get().loaded) return Promise.resolve()
    if (ensurePromise) return ensurePromise
    ensurePromise = get()
      .load()
      .catch(() => {
        /* 读取失败不阻塞调用方，使用空配置 */
      })
      .finally(() => {
        ensurePromise = null
      })
    return ensurePromise
  },

  load: async () => {
    try {
      const s = await window.pupurin.getSettings()
      set({ config: normalizeConfig(s.aiProviders), loaded: true })
    } catch {
      set({ config: emptyConfig(), loaded: true })
    }
  },

  persist: async () => {
    try {
      await window.pupurin.setSetting('aiProviders', get().config)
    } catch {
      /* 持久化失败不影响本次会话 */
    }
  },

  addProvider: (input) => {
    const p: AiProvider = {
      id: genId(),
      name: (input.name ?? '').trim() || '未命名服务',
      templateId: input.templateId ?? 'custom',
      icon: (input.icon ?? '').trim() || iconForTemplate(input.templateId ?? 'custom'),
      baseUrl: (input.baseUrl ?? '').trim(),
      apiKey: input.apiKey ?? '',
      model: (input.model ?? '').trim(),
    }
    const cfg = get().config
    const next: AiConfig = { ...cfg, providers: [...cfg.providers, p] }
    // 首个接口自动设为全局默认，省去一步操作
    if (!cfg.defaultId) next.defaultId = p.id
    set({ config: next })
    void get().persist()
    return p.id
  },

  updateProvider: (id, patch) => {
    const cfg = get().config
    const next: AiConfig = {
      ...cfg,
      providers: cfg.providers.map((p) => (p.id === id ? { ...p, ...patch, id: p.id } : p)),
    }
    set({ config: next })
    void get().persist()
  },

  removeProvider: (id) => {
    const cfg = get().config
    const providers = cfg.providers.filter((p) => p.id !== id)
    let defaultId = cfg.defaultId === id ? null : cfg.defaultId
    if (defaultId === null) defaultId = providers[0]?.id ?? null
    const bindings: Record<string, string | null> = {}
    for (const [k, v] of Object.entries(cfg.bindings)) bindings[k] = v === id ? null : v
    set({ config: { ...cfg, providers, defaultId, bindings } })
    void get().persist()
  },

  setDefault: (id) => {
    const cfg = get().config
    const valid = id && cfg.providers.some((p) => p.id === id) ? id : null
    set({ config: { ...cfg, defaultId: valid } })
    void get().persist()
  },

  setBinding: (featureId, id) => {
    const cfg = get().config
    const valid = id && cfg.providers.some((p) => p.id === id) ? id : null
    set({ config: { ...cfg, bindings: { ...cfg.bindings, [featureId]: valid } } })
    void get().persist()
  },

  openManager: (featureId = null) => set({ managerOpen: true, managerFeature: featureId ?? null }),
  closeManager: () => set({ managerOpen: false, managerFeature: null }),

  publicList: () => {
    const { config } = get()
    return config.providers.map((p) => ({
      id: p.id,
      name: p.name,
      templateId: p.templateId,
      icon: p.icon,
      baseUrl: p.baseUrl,
      model: p.model,
      hasKey: !!p.apiKey,
      isDefault: p.id === config.defaultId,
      invalid: !isValidBaseUrl(p.baseUrl),
    }))
  },

  publicDefault: () => {
    const { config } = get()
    const p = config.providers.find((x) => x.id === config.defaultId)
    return p
      ? {
          id: p.id,
          name: p.name,
          templateId: p.templateId,
          icon: p.icon,
          baseUrl: p.baseUrl,
          model: p.model,
          hasKey: !!p.apiKey,
          isDefault: true,
          invalid: !isValidBaseUrl(p.baseUrl),
        }
      : null
  },

  providerById: (id) => get().config.providers.find((p) => p.id === id) ?? null,

  resolveFor: (featureId) => {
    const cfg = get().config
    const bound = featureId ? cfg.bindings[featureId] ?? null : null
    for (const pid of [bound, cfg.defaultId]) {
      if (!pid) continue
      const p = cfg.providers.find((x) => x.id === pid)
      if (p && isValidBaseUrl(p.baseUrl)) return p
    }
    return null
  },
}))
