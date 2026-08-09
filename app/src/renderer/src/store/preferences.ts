import { create } from 'zustand'

// ---- 应用偏好：配色主题（明暗模式 + 内置/自定义配色）与编辑器字号 ----
// 持久化到 userData/settings.json（主进程 settings:set，白名单键）

export type ThemeMode = 'dark' | 'light'

export interface ThemePreset {
  id: string
  name: string
  darkAccent: string
  darkAccentDim: string
  lightAccent: string
  lightAccentDim: string
}

// 内置配色：每种配色在明/暗模式下各有一组强调色（浅色模式下自动加深保证对比度）
export const THEME_PRESETS: ThemePreset[] = [
  { id: 'gold', name: '铃金', darkAccent: '#FFE4A6', darkAccentDim: '#8a7a4a', lightAccent: '#b07d2e', lightAccentDim: '#a08a5a' },
  { id: 'sakura', name: '樱粉', darkAccent: '#ffc9d4', darkAccentDim: '#8f5a68', lightAccent: '#d96a85', lightAccentDim: '#b0566e' },
  { id: 'ocean', name: '海青', darkAccent: '#9fd8ff', darkAccentDim: '#4a7a9a', lightAccent: '#2f7fc1', lightAccentDim: '#2a6a9a' },
  { id: 'forest', name: '森绿', darkAccent: '#a8e0b0', darkAccentDim: '#4a8a58', lightAccent: '#3f8f52', lightAccentDim: '#3a7a4a' },
  { id: 'sunset', name: '落日橙', darkAccent: '#ffb38a', darkAccentDim: '#9a6a48', lightAccent: '#d2691e', lightAccentDim: '#b05a1e' },
  { id: 'violet', name: '星紫', darkAccent: '#d4b3ff', darkAccentDim: '#6a5a9a', lightAccent: '#7a4fc4', lightAccentDim: '#6640a0' },
]

export const DEFAULT_PRESET_ID = 'gold'

// hex (#rrggbb) → "r g b" 空格分隔（CSS 变量值）
function hexToRgbTriplet(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) return '255 228 166'
  const n = parseInt(m[1], 16)
  return `${(n >> 16) & 255} ${(n >> 8) & 255} ${n & 255}`
}

export function getPreset(id: string): ThemePreset {
  return THEME_PRESETS.find((p) => p.id === id) ?? THEME_PRESETS[0]
}

// 将当前主题应用到 DOM（<html data-theme> + 强调色 CSS 变量）
export function applyThemeToDom(mode: ThemeMode, accentHex: string, accentDimHex: string): void {
  const root = document.documentElement
  root.dataset.theme = mode
  root.style.setProperty('--loom-accent', hexToRgbTriplet(accentHex))
  root.style.setProperty('--loom-accent-dim', hexToRgbTriplet(accentDimHex))
}

const K = {
  mode: 'themeMode',
  preset: 'themePreset',
  customAccent: 'themeCustomAccent',
  fontSize: 'editorFontSize',
}

function persist(key: string, value: unknown): void {
  void window.pupurin.setSetting(key, value).catch(() => {
    /* 持久化失败不影响本次生效 */
  })
}

// 计算当前生效的强调色（自定义优先，否则用预设）
export function effectiveAccent(s: {
  mode: ThemeMode
  presetId: string
  customAccent: string | null
}): { accent: string; accentDim: string } {
  const p = getPreset(s.presetId)
  const accent = s.customAccent ?? (s.mode === 'dark' ? p.darkAccent : p.lightAccent)
  const accentDim = s.mode === 'dark' ? p.darkAccentDim : p.lightAccentDim
  return { accent, accentDim }
}

interface PreferencesState {
  ready: boolean
  mode: ThemeMode
  presetId: string
  customAccent: string | null
  editorFontSize: number
  load: () => Promise<void>
  setMode: (m: ThemeMode) => void
  setPreset: (id: string) => void
  setCustomAccent: (hex: string | null) => void
  setEditorFontSize: (n: number) => void
}

export const usePreferences = create<PreferencesState>((set, get) => ({
  ready: false,
  mode: 'dark',
  presetId: DEFAULT_PRESET_ID,
  customAccent: null,
  editorFontSize: 13,

  // 启动时从 settings.json 读回偏好并应用到 DOM
  async load() {
    try {
      const s = await window.pupurin.getSettings()
      const mode: ThemeMode = s.themeMode === 'light' ? 'light' : 'dark'
      const presetId =
        typeof s.themePreset === 'string' && THEME_PRESETS.some((p) => p.id === s.themePreset)
          ? s.themePreset
          : DEFAULT_PRESET_ID
      const customAccent =
        typeof s.themeCustomAccent === 'string' && /^#?[0-9a-f]{6}$/i.test(s.themeCustomAccent.trim())
          ? s.themeCustomAccent.trim()
          : null
      const fontSize =
        typeof s.editorFontSize === 'number' ? Math.min(24, Math.max(10, Math.round(s.editorFontSize))) : 13
      set({ ready: true, mode, presetId, customAccent, editorFontSize: fontSize })
      const { accent, accentDim } = effectiveAccent({ mode, presetId, customAccent })
      applyThemeToDom(mode, accent, accentDim)
      document.documentElement.style.setProperty('--loom-editor-font', `${fontSize}px`)
    } catch {
      set({ ready: true })
    }
  },

  setMode(m) {
    const { presetId, customAccent } = get()
    set({ mode: m })
    const { accent, accentDim } = effectiveAccent({ mode: m, presetId, customAccent })
    applyThemeToDom(m, accent, accentDim)
    persist(K.mode, m)
  },

  setPreset(id) {
    const { mode, customAccent } = get()
    set({ presetId: id })
    const { accent, accentDim } = effectiveAccent({ mode, presetId: id, customAccent })
    applyThemeToDom(mode, accent, accentDim)
    persist(K.preset, id)
  },

  setCustomAccent(hex) {
    const { mode, presetId } = get()
    const norm = hex && /^#?[0-9a-f]{6}$/i.test(hex.trim()) ? hex.trim() : null
    set({ customAccent: norm })
    const { accent, accentDim } = effectiveAccent({ mode, presetId, customAccent: norm })
    applyThemeToDom(mode, accent, accentDim)
    persist(K.customAccent, norm)
  },

  setEditorFontSize(n) {
    const clamped = Math.min(24, Math.max(10, Math.round(n)))
    set({ editorFontSize: clamped })
    document.documentElement.style.setProperty('--loom-editor-font', `${clamped}px`)
    persist(K.fontSize, clamped)
  },
}))
