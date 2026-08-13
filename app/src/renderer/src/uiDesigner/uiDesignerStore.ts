// UI 设计器状态 store（功能栏与页面解耦，参考「织机属性」的 store 模式）：
// 页面负责加载/画布，右侧功能栏负责属性面板/控件库，两者共享本 store。

import { create } from 'zustand'
import type { CustomControl, CustomGroup, DesignScreenId, GroupType, UiDesignState } from './types'
import type { ScriptContainer, RenderedEl } from './screenRenderer'
import { loadUiDesignState, serializeUiChanges, patchStatementPos, patchContainerSpacing, patchStatementProp, removeStatementLine, ejectStatement, ungroupContainer } from './loadState'
import type { ScriptElPropKind, UngroupParentInfo } from './loadState'
import { parseAllCustomControls, groupLayout } from './customControls'
import { parseAllScreenNames, screenUsesGameMenu } from './parseScreens'
import { patchState } from './merge'
import { findPreset } from './presets'
import { AUTO_IMAGE } from './types'
import { generateAutoImage } from './autoImage'

const FONT_EXT = ['ttf', 'otf', 'ttc']
const IMG_EXT = ['png', 'jpg', 'jpeg', 'webp']

/** 深层可选：属性面板以 `{ colors: { accent } }` 片段补丁形式修改 ui 状态 */
type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] }

interface UiDesignerStore {
  projectPath: string
  ui: UiDesignState | null
  sources: { gui: string; screens: string }
  custom: CustomControl[]
  /** 自定义控件编组（Figma 式两级选中：组 → 单个控件） */
  groups: CustomGroup[]
  screen: DesignScreenId
  /** 项目 screens.rpy 中的全部 screen 名称（按出现顺序） */
  allScreens: string[]
  /** 基于 game_menu 框架的 screen（预览渲染统一菜单框架） */
  gameMenuScreens: string[]
  /** 选中项：固定元素 id / 自定义控件 id / 编组 id / 脚本元素 sel-xxx */
  selected: string | null
  /** 框选暂存：选中的自定义控件 id / 编组 id（用于创建编组 / 解散编组） */
  multiSelected: string[]
  /** 当前屏幕的脚本容器（screens.rpy 中的 vbox/hbox/fixed），由预览渲染后写入 */
  scriptGroups: ScriptContainer[]
  /** 当前屏幕的渲染元素（供选中脚本元素时展示/编辑属性），由预览渲染后写入 */
  renderedEls: RenderedEl[]
  fontOptions: string[]
  /** game/gui 下全部图片路径（递归所有子文件夹，供图片选择弹窗按目录分组展示） */
  guiImages: string[]
  loading: boolean
  loaded: boolean
  modified: boolean
  saving: boolean
  error: string | null

  load: (projectPath: string) => Promise<void>
  patchUi: (patch: DeepPartial<UiDesignState>) => void
  applyPreset: (presetId: string) => void
  setScreen: (screen: DesignScreenId) => void
  select: (id: string | null) => void
  selectMulti: (ids: string[]) => void
  clearMulti: () => void
  /** 写入当前屏幕的脚本容器（渲染结果） */
  setScriptGroups: (list: ScriptContainer[]) => void
  /** 写入当前屏幕的渲染元素（渲染结果，供脚本元素属性面板） */
  setRenderedEls: (list: RenderedEl[]) => void
  /** 移动脚本容器内的单个元素：写回该源码语句的 pos（id 为 sc-<行号>） */
  updateScriptElementPos: (id: string, x: number, y: number) => void
  /** 移动脚本容器：写回 pos（基于容器自带 pos + 拖拽增量） */
  updateScriptGroupPos: (id: string, x: number, y: number) => void
  /** 修改脚本容器间距：写回 spacing 属性 */
  updateScriptGroupSpacing: (id: string, spacing: number) => void
  /** 修改脚本元素属性（编组内控件改内容/字号/颜色等）：按源码行行内写回（不破坏 pos 等属性） */
  updateScriptElProp: (line: number, kind: ScriptElPropKind, value: string) => void
  /** 删除脚本元素（编组内控件删除入口）：按源码行删除该语句 */
  removeScriptElement: (line: number) => void
  /** 脚本元素退出编组：从容器块移出到 screen 顶层，写 pos 保持当前位置 */
  exitScriptElement: (line: number) => void
  /** 解散脚本编组：删除容器块，直接子语句提升到顶层并补 pos 保持位置 */
  ungroupScriptGroup: (id: string) => void
  addCustom: (c: Omit<CustomControl, 'id' | 'screen'> & { screen: DesignScreenId }) => void
  updateCustom: (id: string, patch: Partial<CustomControl>) => void
  removeCustom: (id: string) => void
  /** 把一批未编组控件创建为编组；子控件坐标转为相对编组原点的偏移 */
  createGroup: (type: GroupType, controlIds: string[]) => void
  /** 解散编组：子控件还原为独立控件（用当前布局后的绝对坐标） */
  ungroup: (groupId: string) => void
  /** 控件退出编组：坐标转为画布绝对坐标（位置留在原地），从编组 children 移除 */
  removeFromGroup: (controlId: string) => void
  updateGroup: (
    id: string,
    patch: Partial<Pick<CustomGroup, 'x' | 'y' | 'spacing' | 'type' | 'xalign' | 'width' | 'height' | 'cols' | 'positions' | 'scrollbars'>>
  ) => void
  /** 删除编组（连同子控件） */
  removeGroup: (id: string) => void
  save: () => Promise<void>
}

export const useUiDesigner = create<UiDesignerStore>((set, get) => ({
  projectPath: '',
  ui: null,
  sources: { gui: '', screens: '' },
  custom: [],
  groups: [],
  screen: 'say',
  allScreens: [],
  gameMenuScreens: [],
  selected: null,
  multiSelected: [],
  scriptGroups: [],
  renderedEls: [],
  fontOptions: [],
  guiImages: [],
  loading: false,
  loaded: false,
  modified: false,
  saving: false,
  error: null,

  load: async (projectPath) => {
    if (get().loading) return
    set({ loading: true, error: null, projectPath })
    try {
      const { state, sources } = await loadUiDesignState(projectPath)
      const { controls, groups } = parseAllCustomControls(sources.screens)
      const allScreens = parseAllScreenNames(sources.screens)
      const gameMenuScreens = allScreens.filter((n) => screenUsesGameMenu(sources.screens, n))
      // 递归收集 game/gui 下所有图片（含全部子文件夹，弹窗按目录分组展示）
      const walkGuiImages = async (dir: string): Promise<string[]> => {
        const out: string[] = []
        const walk = async (d: string): Promise<void> => {
          const items = await window.pupurin.listFiles(projectPath, d).catch(() => [])
          for (const it of items) {
            if (it.isDir) {
              await walk(it.path)
              continue
            }
            if (IMG_EXT.includes(it.name.split('.').pop()?.toLowerCase() ?? '')) out.push(it.path)
          }
        }
        await walk(dir)
        return out.sort()
      }
      const [rootFiles, guiImages] = await Promise.all([
        window.pupurin.listFiles(projectPath, '').catch(() => []),
        walkGuiImages('gui'),
      ])
      const fonts = rootFiles
        .filter((f) => !f.isDir && FONT_EXT.includes(f.name.split('.').pop()?.toLowerCase() ?? ''))
        .map((f) => f.name)
      const imgs = [...guiImages]
      ;(Object.values(state.fonts) as string[]).forEach(
        (f) => f && !fonts.includes(f) && fonts.unshift(f)
      )
      ;(Object.values(state.images) as string[]).forEach(
        (p) => p && p !== AUTO_IMAGE && !imgs.includes(p) && imgs.unshift(p)
      )
      set({
        ui: state,
        sources,
        custom: controls,
        groups,
        allScreens,
        gameMenuScreens,
        fontOptions: fonts,
        guiImages: imgs,
        modified: false,
        loading: false,
        loaded: true,
        selected: null,
        multiSelected: [],
        scriptGroups: [],
        renderedEls: [],
      })
    } catch (e) {
      set({ loading: false, error: String(e) })
    }
  },

  patchUi: (patch) => {
    set((s) => (s.ui ? { ui: patchState(s.ui, patch), modified: true } : s))
  },

  applyPreset: (presetId) => {
    const p = findPreset(presetId)
    if (!p) return
    set((s) => {
      if (!s.ui) return s
      let ui = patchState(s.ui, { colors: { ...s.ui.colors, ...p.colors } })
      if (p.sizes) ui = patchState(ui, { sizes: { ...s.ui.sizes, ...p.sizes } })
      return { ui, modified: true }
    })
  },

  setScreen: (screen) => set({ screen, selected: null, multiSelected: [], renderedEls: [] }),

  select: (id) => set({ selected: id, multiSelected: [] }),

  selectMulti: (ids) => set({ multiSelected: ids }),

  clearMulti: () => set({ multiSelected: [] }),

  setScriptGroups: (list) => set({ scriptGroups: list }),

  setRenderedEls: (list) => set({ renderedEls: list }),

  updateScriptElementPos: (id, x, y) => {
    set((s) => {
      if (!s.sources.screens) return s
      const screens = patchStatementPos(s.sources.screens, id, x, y)
      return { sources: { ...s.sources, screens }, modified: true }
    })
  },

  updateScriptGroupPos: (id, x, y) => {
    set((s) => {
      if (!s.sources.screens) return s
      const screens = patchStatementPos(s.sources.screens, id, x, y)
      return { sources: { ...s.sources, screens }, modified: true }
    })
  },

  updateScriptGroupSpacing: (id, spacing) => {
    set((s) => {
      if (!s.sources.screens) return s
      const screens = patchContainerSpacing(s.sources.screens, id, spacing)
      return { sources: { ...s.sources, screens }, modified: true }
    })
  },

  updateScriptElProp: (line, kind, value) => {
    set((s) => {
      if (!s.sources.screens) return s
      const screens = patchStatementProp(s.sources.screens, line, kind, value)
      if (screens === s.sources.screens) return s
      return { sources: { ...s.sources, screens }, modified: true }
    })
  },

  removeScriptElement: (line) => {
    set((s) => {
      if (!s.sources.screens) return s
      const screens = removeStatementLine(s.sources.screens, line)
      if (screens === s.sources.screens) return s
      // 删除后行号整体前移，原 sel-<key> 选中失效 → 清空选中
      return { sources: { ...s.sources, screens }, modified: true, selected: null }
    })
  },

  exitScriptElement: (line) => {
    set((s) => {
      const el = s.renderedEls.find((e) => e.line === line)
      const cid = el?.containerId
      if (!el || !cid || el.line === undefined) return s
      const containerLine = Number(cid.replace(/^sc-/, ''))
      if (Number.isNaN(containerLine)) return s
      const screens = ejectStatement(s.sources.screens, el.line, containerLine, el.x, el.y)
      if (screens === s.sources.screens) return s
      return { sources: { ...s.sources, screens }, modified: true, selected: null }
    })
  },

  ungroupScriptGroup: (id) => {
    set((s) => {
      const containerLine = Number(id.replace(/^sc-/, ''))
      if (Number.isNaN(containerLine)) return s
      // 渲染绝对坐标表：叶子元素与子容器都用其包围盒左上角作为 pos 基准（含 w/h，供流式偏移推算）
      const positions = new Map<number, { x: number; y: number; w?: number; h?: number }>()
      for (const el of s.renderedEls) {
        if (el.line !== undefined) positions.set(el.line, { x: Math.round(el.x), y: Math.round(el.y), w: el.w, h: el.h })
      }
      for (const c of s.scriptGroups) {
        const n = Number(c.id.replace(/^sc-/, ''))
        if (!Number.isNaN(n)) positions.set(n, { x: Math.round(c.x), y: Math.round(c.y), w: c.w, h: c.h })
      }
      // 父容器信息：被解散容器若嵌套在 vbox/hbox/fixed 内，需按父坐标系换算相对 pos
      // （流式父布局会在子元素自身 pos 之上再叠加父偏移，直接写绝对坐标会双重偏移）
      const self = s.scriptGroups.find((c) => c.id === id)
      let parent: UngroupParentInfo | null = null
      if (self?.parentId) {
        const p = s.scriptGroups.find((c) => c.id === self.parentId)
        if (p) {
          parent = { kind: p.kind, x: Math.round(p.x), y: Math.round(p.y), spacing: p.spacing, padL: p.padL, padT: p.padT }
        }
      }
      const screens = ungroupContainer(s.sources.screens, containerLine, positions, parent)
      if (screens === s.sources.screens) return s
      return { sources: { ...s.sources, screens }, modified: true, selected: null }
    })
  },

  addCustom: (c) => {
    const control: CustomControl = {
      id: `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      ...c,
    }
    set((s) => ({
      custom: [...s.custom, control],
      selected: control.id,
      multiSelected: [],
      modified: true,
    }))
  },

  updateCustom: (id, patch) => {
    set((s) => ({
      custom: s.custom.map((c) => (c.id === id ? { ...c, ...patch } : c)),
      modified: true,
    }))
  },

  removeCustom: (id) => {
    set((s) => ({
      custom: s.custom.filter((c) => c.id !== id),
      groups: s.groups.map((g) =>
        g.children.includes(id) ? { ...g, children: g.children.filter((x) => x !== id) } : g
      ),
      selected: s.selected === id ? null : s.selected,
      multiSelected: s.multiSelected.filter((x) => x !== id),
      modified: true,
    }))
  },

  createGroup: (type, controlIds) => {
    if (!controlIds.length) return
    set((s) => {
      const picked = s.custom.filter(
        (c) => controlIds.includes(c.id) && !s.groups.some((g) => g.children.includes(c.id))
      )
      if (!picked.length) return s
      // 包围盒 → 编组原点（取子控件当前绝对坐标的并集左上角）
      const minX = Math.min(...picked.map((c) => c.x))
      const minY = Math.min(...picked.map((c) => c.y))
      const group: CustomGroup = {
        id: `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
        screen: s.screen,
        type,
        x: Math.round(minX),
        y: Math.round(minY),
        spacing: 12,
        children: picked.map((c) => c.id),
      }
      // 子控件坐标转为相对编组原点的偏移
      const idSet = new Set(picked.map((c) => c.id))
      const custom = s.custom.map((c) =>
        idSet.has(c.id) ? { ...c, x: c.x - group.x, y: c.y - group.y } : c
      )
      return {
        custom,
        groups: [...s.groups, group],
        selected: group.id,
        multiSelected: [],
        modified: true,
      }
    })
  },

  removeFromGroup: (id) => {
    set((s) => {
      const g = s.groups.find((gr) => gr.children.includes(id))
      if (!g) return s
      const c = s.custom.find((x) => x.id === id)
      if (!c) return s
      // 当前布局位置（vbox/hbox 由布局计算，fixed 为相对偏移）→ 组原点 → 画布绝对坐标，位置留在原地
      const rel = groupLayout(g, s.custom).get(id)
      return {
        custom: s.custom.map((x) =>
          x.id === id
            ? { ...x, x: Math.round(g.x + (rel?.x ?? 0)), y: Math.round(g.y + (rel?.y ?? 0)) }
            : x
        ),
        groups: s.groups.map((gr) =>
          gr.id === g.id ? { ...gr, children: gr.children.filter((x) => x !== id) } : gr
        ),
        modified: true,
      }
    })
  },

  ungroup: (groupId) => {
    set((s) => {
      const g = s.groups.find((x) => x.id === groupId)
      if (!g) return s
      const rel = groupLayout(g, s.custom)
      const abs = new Map<string, { x: number; y: number }>()
      for (const [id, r] of rel) {
        abs.set(id, { x: g.x + r.x, y: g.y + r.y })
      }
      const idSet = new Set(g.children)
      return {
        custom: s.custom.map((c) =>
          idSet.has(c.id) ? { ...c, x: abs.get(c.id)?.x ?? c.x, y: abs.get(c.id)?.y ?? c.y } : c
        ),
        groups: s.groups.filter((x) => x.id !== groupId),
        selected: null,
        multiSelected: s.multiSelected.filter((x) => x !== groupId),
        modified: true,
      }
    })
  },

  updateGroup: (id, patch) => {
    set((s) => ({
      groups: s.groups.map((g) => (g.id === id ? { ...g, ...patch } : g)),
      modified: true,
    }))
  },

  removeGroup: (id) => {
    set((s) => {
      const g = s.groups.find((x) => x.id === id)
      const del = new Set(g?.children ?? [])
      return {
        custom: s.custom.filter((c) => !del.has(c.id)),
        groups: s.groups.filter((x) => x.id !== id),
        selected: s.selected === id ? null : s.selected,
        multiSelected: s.multiSelected.filter((x) => x !== id),
        modified: true,
      }
    })
  },

  save: async () => {
    const { ui, sources, projectPath, custom, groups, saving } = get()
    if (!ui || !projectPath || saving) return
    set({ saving: true, error: null })
    try {
      // 混合模式：标记「自动生成」的底图先生成 PNG 落地
      const resolved = { ...ui.images }
      const autoKinds: Array<[keyof UiDesignState['images'], 'textbox' | 'namebox' | 'mainMenu']> = [
        ['textbox', 'textbox'],
        ['namebox', 'namebox'],
        ['mainMenu', 'mainMenu'],
      ]
      for (const [key, kind] of autoKinds) {
        if (resolved[key] === AUTO_IMAGE) {
          const dataUrl = generateAutoImage(kind, ui)
          const rel = `gui/loom_auto_${kind}.png`
          await window.pupurin.writeImageBase64(projectPath, rel, dataUrl)
          resolved[key] = rel
        }
      }
      const finalState = { ...ui, images: resolved }
      const out = serializeUiChanges(finalState, sources, custom, groups)
      await Promise.all([
        window.pupurin.saveRpyFile(projectPath, 'gui.rpy', out.gui),
        window.pupurin.saveRpyFile(projectPath, 'screens.rpy', out.screens),
      ])
      set({ ui: finalState, sources: out, modified: false, saving: false })
    } catch (e) {
      set({ saving: false, error: '保存失败：' + String(e) })
    }
  },
}))
