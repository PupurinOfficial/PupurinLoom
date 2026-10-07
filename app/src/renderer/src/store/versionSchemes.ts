// 版本方案 store：多版本导出的方案管理与持久化（localStorage，按项目隔离）
// - 方案（VersionScheme）：打包时选择「保留哪些标签的内容」，对应打包出的一个版本
// - 标签颜色注册表（tagColors）：项目级，给每个版本标签（如 r18）自定义颜色，织机编辑器行右侧展示
// 方案管理/选择/统计在打包发布页功能栏侧边栏；打包发布页主体只读当前方案用于导出过滤。
import { create } from 'zustand'

export interface VersionScheme {
  name: string
  tags: string[]
}

/** 默认标签色板：新建标签未指定颜色时按出现顺序轮换取色 */
const PALETTE = ['#f43f5e', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

/** 默认方案：每个项目默认包含，tags 为空 = 包含全部内容（标准版） */
export const DEFAULT_SCHEME_NAME = '标准版'

interface VersionSchemesState {
  projectPath: string | null
  schemes: VersionScheme[]
  active: string | null
  /** 项目级标签颜色注册表：标签名 → 颜色 */
  tagColors: Record<string, string>
  /** 切换项目时加载该项目的方案与标签颜色（localStorage） */
  load: (projectPath: string) => void
  addScheme: (name: string) => void
  removeScheme: (name: string) => void
  setActive: (name: string) => void
  clearActive: () => void
  addTag: (schemeName: string, tag: string) => void
  removeTag: (schemeName: string, tag: string) => void
  setTagColor: (tag: string, color: string) => void
  /** 确保标签已注册颜色并返回其颜色（未注册则自动分配色板颜色） */
  ensureTagColor: (tag: string) => string
  /** 删除标签定义（项目级）：移除颜色注册，并同时从所有方案中移除该标签 */
  removeTagDefinition: (tag: string) => void
}

const schemeKey = (projectPath: string): string => `loom-versions:${projectPath}`
const colorKey = (projectPath: string): string => `loom-tag-colors:${projectPath}`

function persist(state: VersionSchemesState): void {
  if (!state.projectPath) return
  try {
    localStorage.setItem(schemeKey(state.projectPath), JSON.stringify({ schemes: state.schemes, active: state.active }))
    localStorage.setItem(colorKey(state.projectPath), JSON.stringify(state.tagColors))
  } catch { /* ignore */ }
}

export const useVersionSchemes = create<VersionSchemesState>((set, get) => ({
  projectPath: null,
  schemes: [],
  active: null,
  tagColors: {},

  load: (projectPath) => {
    let parsed: { schemes?: unknown; active?: unknown } = {}
    try {
      const raw = localStorage.getItem(schemeKey(projectPath))
      if (raw) parsed = JSON.parse(raw)
    } catch { /* ignore */ }
    let schemes: VersionScheme[] = Array.isArray(parsed.schemes)
      ? parsed.schemes
          .filter((s) => s && typeof s === 'object' && typeof (s as VersionScheme).name === 'string')
          .map((s) => ({
            name: (s as VersionScheme).name,
            tags: Array.isArray((s as VersionScheme).tags)
              ? (s as VersionScheme).tags.filter((t): t is string => typeof t === 'string')
              : [],
          }))
      : []
    // 每个项目默认都有「标准版」方案（包含全部内容）；未定义任何方案时自动创建并启用
    const hasStandard = schemes.some((s) => s.name === DEFAULT_SCHEME_NAME)
    if (!hasStandard) schemes = [{ name: DEFAULT_SCHEME_NAME, tags: [] }, ...schemes]
    const active = schemes.length === 1 ? DEFAULT_SCHEME_NAME : typeof parsed.active === 'string' ? parsed.active : null

    let tagColors: Record<string, string> = {}
    try {
      const c = localStorage.getItem(colorKey(projectPath))
      if (c) {
        const parsedColors = JSON.parse(c) as Record<string, unknown>
        if (parsedColors && typeof parsedColors === 'object') {
          for (const [tag, color] of Object.entries(parsedColors)) {
            if (typeof color === 'string') tagColors[tag] = color
          }
        }
      }
    } catch { /* ignore */ }
    set({ projectPath, schemes, active, tagColors })
  },

  addScheme: (name) => {
    const trimmed = name.trim()
    if (!trimmed) return
    const { schemes, active } = get()
    if (schemes.some((s) => s.name === trimmed)) return
    set({ schemes: [...schemes, { name: trimmed, tags: [] }], active: active ?? trimmed })
    persist(get())
  },

  removeScheme: (name) => {
    // 标准版不可删除（每个项目默认方案）
    if (name === DEFAULT_SCHEME_NAME) return
    const { schemes, active } = get()
    const next = schemes.filter((s) => s.name !== name)
    set({ schemes: next, active: active === name ? null : active })
    persist(get())
  },

  setActive: (name) => {
    set({ active: name })
    persist(get())
  },

  clearActive: () => {
    set({ active: null })
    persist(get())
  },

  addTag: (schemeName, tag) => {
    const t = tag.trim()
    if (!t) return
    const { schemes } = get()
    ensureTagColor(set, get, t)
    set({
      schemes: schemes.map((s) => (s.name === schemeName && !s.tags.includes(t) ? { ...s, tags: [...s.tags, t] } : s)),
    })
    persist(get())
  },

  removeTag: (schemeName, tag) => {
    const { schemes } = get()
    set({ schemes: schemes.map((s) => (s.name === schemeName ? { ...s, tags: s.tags.filter((x) => x !== tag) } : s)) })
    persist(get())
  },

  setTagColor: (tag, color) => {
    set({ tagColors: { ...get().tagColors, [tag]: color } })
    persist(get())
  },

  ensureTagColor: (tag) => ensureTagColor(set, get, tag),

  removeTagDefinition: (tag) => {
    const { tagColors, schemes } = get()
    const nextColors = { ...tagColors }
    delete nextColors[tag]
    set({
      tagColors: nextColors,
      schemes: schemes.map((s) => (s.tags.includes(tag) ? { ...s, tags: s.tags.filter((t) => t !== tag) } : s)),
    })
    persist(get())
  },
}))

/** 标签颜色分配/读取（被 addTag 与 ensureTagColor 共用）：未注册则按色板轮换取色 */
function ensureTagColor(
  set: (partial: Partial<VersionSchemesState>) => void,
  get: () => VersionSchemesState,
  tag: string
): string {
  const t = tag.trim()
  if (!t) return PALETTE[0]
  const { tagColors } = get()
  if (tagColors[t]) return tagColors[t]
  const color = PALETTE[Object.keys(tagColors).length % PALETTE.length]
  set({ tagColors: { ...tagColors, [t]: color } })
  persist(get())
  return color
}
