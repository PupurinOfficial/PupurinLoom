import { create } from 'zustand'
import type { PluginMeta } from '../types'
import { useStore } from './useStore'
import { parseSource } from '../api/client'

// ---- 插件运行时（渲染层）----
// 每个插件通过 new Function('loom', code) 执行，仅注入白名单 loom API。
// 插件可注册命令（点击执行）与面板（HTML + mount 渲染）。

export interface PluginCommand {
  pluginId: string
  id: string
  title: string
  fn: () => void
}

export interface PluginPanelSpec {
  html: string
  mount?: (el: HTMLElement) => void
}

export interface PluginPanel {
  pluginId: string
  id: string
  title: string
  render: () => PluginPanelSpec
  /** 声明后可将面板加入右侧功能栏（插件页可单独关闭） */
  sidebar?: boolean
}

export interface ToastItem {
  id: number
  message: string
  type: 'info' | 'success' | 'error'
}

export interface HookEntry {
  pluginId: string
  event: string
  fn: (payload: unknown) => void | Promise<void>
}

interface PluginsState {
  plugins: PluginMeta[]
  commands: PluginCommand[]
  panels: PluginPanel[]
  hooks: HookEntry[]
  toasts: ToastItem[]
  loading: boolean
  error: string | null
  loadPlugins: (opts?: { force?: boolean }) => Promise<void>
  toggleEnabled: (id: string) => Promise<void>
  trustAndEnable: (id: string) => Promise<void>
  runCommand: (cmd: PluginCommand) => void
  pushToast: (message: string, type?: ToastItem['type']) => void
  removeToast: (id: number) => void
  emitHook: (event: string, payload?: unknown) => void
}

let toastSeq = 0

// 插件私有数据缓存（loom.store.get/set 同步读写）
const pluginDataCache = new Map<string, Record<string, unknown>>()
// 已执行过的插件 id（防止重复注册命令/面板/钩子/观察器）
const executedPlugins = new Set<string>()
// 串行化加载链：多个 loadPlugins 并发时依次执行，避免竞态导致的重复注册
let loadChain: Promise<void> = Promise.resolve()

// 命令/面板按 (pluginId, id) 去重，钩子按 (pluginId, event) 去重（防御重复注册）
function dedupeItems<T extends { pluginId: string; id: string }>(items: T[]): T[] {
  const seen = new Set<string>()
  return items.filter((x) => {
    const k = `${x.pluginId}:${x.id}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function dedupeHooks(items: HookEntry[]): HookEntry[] {
  const seen = new Set<string>()
  return items.filter((x) => {
    const k = `${x.pluginId}:${x.event}`
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

function buildLoomApi(
  pluginId: string,
  push: (c: PluginCommand) => void,
  pushPanel: (p: PluginPanel) => void,
  pushHook: (h: HookEntry) => void
): Record<string, unknown> {
  const getStore = () => usePlugins.getState()
  const getProject = () => useStore.getState().currentProject

  return {
    commands: {
      register: (id: string, title: string, fn: () => void): void => {
        if (typeof id !== 'string' || typeof title !== 'string' || typeof fn !== 'function') return
        push({ pluginId, id, title, fn })
      },
    },
    panel: {
      register: (
        id: string,
        title: string,
        spec: { render: () => PluginPanelSpec },
        opts?: { sidebar?: boolean }
      ): void => {
        if (typeof id !== 'string' || typeof title !== 'string' || !spec || typeof spec.render !== 'function') return
        pushPanel({ pluginId, id, title, render: spec.render, sidebar: !!opts?.sidebar })
      },
    },
    hooks: {
      on: (event: string, fn: (payload: unknown) => void | Promise<void>): void => {
        if (typeof event !== 'string' || typeof fn !== 'function') return
        pushHook({ pluginId, event, fn })
      },
    },
    toast: (message: unknown, type: 'info' | 'success' | 'error' = 'info'): void => {
      getStore().pushToast(String(message), type)
    },
    store: {
      get: (key: string): unknown => pluginDataCache.get(pluginId)?.[key] ?? null,
      set: (key: string, value: unknown): void => {
        const cur = pluginDataCache.get(pluginId) ?? {}
        cur[key] = value
        pluginDataCache.set(pluginId, cur)
        void window.pupurin.setPluginData(pluginId, cur).catch(() => {})
      },
    },
    project: {
      getPath: (): string | null => getProject()?.path ?? null,
      readScript: async (): Promise<string | null> => {
        const p = getProject()
        if (!p) return null
        return window.pupurin.readFile(p.path, useStore.getState().currentFilePath)
      },
      writeScript: async (content: string): Promise<void> => {
        const p = getProject()
        if (!p) throw new Error('未打开项目')
        await window.pupurin.saveRpyFile(p.path, useStore.getState().currentFilePath, String(content))
        useStore.getState().setSource(String(content))
        useStore.getState().setSourceModified(false)
      },
      parse: async (content?: string): Promise<unknown> => {
        const src = content ?? useStore.getState().source
        return parseSource(src)
      },
      listFiles: async (subDir = ''): Promise<unknown[]> => {
        const p = getProject()
        if (!p) return []
        return window.pupurin.listFiles(p.path, subDir)
      },
    },
    settings: {
      get: async (key: string): Promise<unknown> => {
        const s = await window.pupurin.getSettings()
        return s[key] ?? null
      },
      set: async (key: string, value: unknown): Promise<void> => {
        await window.pupurin.setSetting(key, value)
      },
    },
    // 主进程能力：项目内受限文件读写 / HTTP 代理 / 命令执行（exec 需确认弹窗）
    fs: {
      read: (subPath: string): Promise<string | null> => {
        const p = getProject()
        return p ? window.pupurin.pluginFsRead(p.path, subPath) : Promise.resolve(null)
      },
      write: (subPath: string, content: string): Promise<void> => {
        const p = getProject()
        if (!p) throw new Error('未打开项目')
        return window.pupurin.pluginFsWrite(p.path, subPath, content)
      },
      list: (subDir = ''): Promise<Array<{ name: string; isDir: boolean; path: string }>> => {
        const p = getProject()
        return p ? window.pupurin.pluginFsList(p.path, subDir) : Promise.resolve([])
      },
    },
    http: {
      get: (url: string, headers?: Record<string, string>): Promise<{ ok: boolean; status: number; text: string }> =>
        window.pupurin.pluginHttp('GET', url, undefined, headers),
      post: (url: string, body?: unknown, headers?: Record<string, string>): Promise<{ ok: boolean; status: number; text: string }> =>
        window.pupurin.pluginHttp('POST', url, body === undefined ? undefined : JSON.stringify(body), headers),
    },
    exec: (command: string): Promise<{ code: number | null; stdout: string; stderr: string }> =>
      window.pupurin.pluginExec(command),
  }
}

export const usePlugins = create<PluginsState>((set, get) => ({
  plugins: [],
  commands: [],
  panels: [],
  hooks: [],
  toasts: [],
  loading: false,
  error: null,

  loadPlugins: (opts) => {
    const run = async (): Promise<void> => {
      set({ loading: true, error: null })
      try {
        const list = await window.pupurin.listPlugins()
        // force：清空已执行标记，全部插件重新执行（刷新/启用切换后）
        if (opts?.force) executedPlugins.clear()
        const needExec = opts?.force
        const commands: PluginCommand[] = needExec ? [] : [...get().commands]
        const panels: PluginPanel[] = needExec ? [] : [...get().panels]
        const hooks: HookEntry[] = needExec ? [] : [...get().hooks]
        // 预取启用插件的私有数据
        for (const meta of list) {
          if (meta.enabled && meta.trusted) {
            try {
              pluginDataCache.set(meta.id, await window.pupurin.getPluginData(meta.id))
            } catch {
              pluginDataCache.set(meta.id, {})
            }
          }
        }
        // 依次执行插件 main.js（已执行过的跳过，避免命令/面板/钩子重复注册）
        for (const meta of list) {
          if (!meta.enabled || !meta.trusted || !meta.hasMain) continue
          if (executedPlugins.has(meta.id)) continue
          const code = await window.pupurin.loadPluginMain(meta.id)
          if (!code) continue
          try {
            const factory = new Function('loom', '"use strict";\n' + code)
            factory(
              buildLoomApi(
                meta.id,
                (c) => commands.push(c),
                (p) => panels.push(p),
                (h) => hooks.push(h)
              )
            )
            executedPlugins.add(meta.id)
          } catch (e) {
            get().pushToast(`插件「${meta.name}」加载失败：${String(e)}`, 'error')
          }
        }
        set({ plugins: list, commands: dedupeItems(commands), panels: dedupeItems(panels), hooks: dedupeHooks(hooks), loading: false })
      } catch (e) {
        set({ error: String(e), loading: false })
      }
    }
    // 串行执行：前一次加载完成后才开始下一次，避免并发竞态导致重复注册
    loadChain = loadChain.catch(() => {}).then(run)
    return loadChain
  },

  toggleEnabled: async (id) => {
    const meta = get().plugins.find((p) => p.id === id)
    await window.pupurin.setPluginEnabled(id, !meta?.enabled)
    await get().loadPlugins({ force: true })
  },

  trustAndEnable: async (id) => {
    await window.pupurin.setPluginTrusted(id, true)
    await window.pupurin.setPluginEnabled(id, true)
    await get().loadPlugins({ force: true })
  },

  runCommand: (cmd) => {
    try {
      const r = cmd.fn() as unknown
      if (r instanceof Promise) {
        r.catch((e) => get().pushToast(`命令执行失败：${String(e)}`, 'error'))
      }
    } catch (e) {
      get().pushToast(`命令执行失败：${String(e)}`, 'error')
    }
  },

  pushToast: (message, type = 'info') => {
    const id = ++toastSeq
    set((s) => ({ toasts: [...s.toasts.slice(-4), { id, message, type }] }))
    setTimeout(() => get().removeToast(id), 3200)
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
  },

  emitHook: (event, payload) => {
    for (const h of get().hooks) {
      if (h.event !== event) continue
      try {
        const r = h.fn(payload)
        if (r instanceof Promise) {
          r.catch((e) => get().pushToast(`钩子 ${event} 执行失败：${String(e)}`, 'error'))
        }
      } catch (e) {
        get().pushToast(`钩子 ${event} 执行失败：${String(e)}`, 'error')
      }
    }
  },
}))
