import { create } from 'zustand'

// 功能栏偏好：插件声明 sidebar 后默认加入右侧功能栏，插件页可单独关闭（持久化到 settings.json）
const SETTINGS_KEY = 'sidebarPanels'

interface SidebarPrefsState {
  loaded: boolean
  /** pluginId -> false 表示从功能栏隐藏该插件的面板 */
  enabled: Record<string, boolean>
  load: () => Promise<void>
  setPluginEnabled: (pluginId: string, enabled: boolean) => Promise<void>
}

export const useSidebarPrefs = create<SidebarPrefsState>((set, get) => ({
  loaded: false,
  enabled: {},
  load: async () => {
    try {
      const s = await window.pupurin.getSettings()
      const raw = (s as Record<string, unknown>)[SETTINGS_KEY]
      set({
        enabled: raw && typeof raw === 'object' ? (raw as Record<string, boolean>) : {},
        loaded: true,
      })
    } catch {
      set({ loaded: true, enabled: {} })
    }
  },
  setPluginEnabled: async (pluginId, enabled) => {
    const next = { ...get().enabled, [pluginId]: enabled }
    set({ enabled: next })
    try {
      await window.pupurin.setSetting(SETTINGS_KEY, next)
    } catch {
      /* 忽略持久化失败 */
    }
  },
}))
