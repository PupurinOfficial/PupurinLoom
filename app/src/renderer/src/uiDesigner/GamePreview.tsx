// 实时游戏画面预览：1920×1080 画布。
// 真实渲染：解析项目 screens.rpy 的实际语句 → renderScreenElements → RenderedEl 绝对定位渲染，
// 替代硬编码默认模板，让预览忠于项目真实 UI（say/choice/main_menu/game_menu/quick_menu/任意 screen）。
// 固定元素（window/namebox/dialogue/choice/nav）可选中/拖拽（写回 gui define / style 属性，实时生效）；
// 自定义控件可拖拽移动，支持从控件库拖入添加。

import { useEffect, useMemo, useRef, useState } from 'react'
import type {
  CustomControl,
  CustomControlType,
  CustomGroup,
  DesignScreenId,
  PreviewElementId,
  UiDesignState,
  UiLayout,
} from './types'
import { GROUP_TYPES } from './types'
import { parseGuiDefines } from './parseGui'
import { updateStyleProp } from './parseScreens'
import { renderScreenElements } from './screenRenderer'
import type { RenderedEl, ScriptContainer } from './screenRenderer'
import { estimateSize, groupBounds, groupLayout } from './customControls'

export const PREVIEW_W = 1920
export const PREVIEW_H = 1080

/** 编辑器强调色（--loom-accent CSS 变量，运行时解析）：选中/框选/编组徽标等编辑器状态色 */
const EDITOR_ACCENT = 'rgb(var(--loom-accent))'

const FIXED_ELEMENTS = new Set<PreviewElementId>(['window', 'namebox', 'dialogue', 'choice', 'quick', 'nav'])
/** 全屏占位元素（quick_menu 的整屏 box 等）不提供拖拽框 */
const FULLSCREEN_IDS = new Set<PreviewElementId>(['quick'])

/** UiLayout 字段 → gui.rpy define（拖拽写回后实时驱动渲染器） */
const LAYOUT_DEFINE_MAP: Array<[keyof UiLayout, string]> = [
  ['windowYalign', 'textbox_yalign'],
  ['windowHeight', 'textbox_height'],
  ['dialogueX', 'dialogue_xpos'],
  ['dialogueY', 'dialogue_ypos'],
  ['dialogueWidth', 'dialogue_width'],
  ['dialogueTextXalign', 'dialogue_text_xalign'],
  ['nameboxX', 'name_xpos'],
  ['nameboxY', 'name_ypos'],
  ['nameboxXalign', 'name_xalign'],
  ['nameboxWidth', 'namebox_width'],
  ['nameboxHeight', 'namebox_height'],
  ['choiceWidth', 'choice_button_width'],
  ['navX', 'navigation_xpos'],
]

/** UiLayout 字段 → screens.rpy style 属性（choice_vbox / quick_menu） */
const LAYOUT_STYLE_MAP: Array<[keyof UiLayout, string, string]> = [
  ['choiceY', 'choice_vbox', 'ypos'],
  ['choiceXalign', 'choice_vbox', 'xalign'],
  ['quickXalign', 'quick_menu', 'xalign'],
  ['quickYalign', 'quick_menu', 'yalign'],
]

interface GamePreviewProps {
  projectPath: string
  state: UiDesignState
  screen: DesignScreenId
  custom: CustomControl[]
  /** 自定义控件编组 */
  groups: CustomGroup[]
  /** 框选暂存 */
  multiSelected: string[]
  /** 项目源码（渲染器输入） */
  sources: { gui: string; screens: string }
  selected: string | null
  onSelect: (id: string | null) => void
  onSelectMulti: (ids: string[]) => void
  onChangeLayout: (patch: Partial<UiLayout>) => void
  onCustomMove: (id: string, x: number, y: number) => void
  onGroupMove: (id: string, x: number, y: number) => void
  /** 脚本容器整体移动（写回 pos） */
  onScriptGroupMove: (id: string, x: number, y: number) => void
  /** 渲染出的脚本容器（供面板编辑间距等） */
  onScriptGroups: (list: ScriptContainer[]) => void
  /** 渲染出的元素列表（供面板展示/编辑脚本元素属性） */
  onRenderedEls: (list: RenderedEl[]) => void
  onDropCustom: (x: number, y: number, type: CustomControlType) => void
}

function ProceduralBox({ from, to, radius = 12 }: { from: string; to: string; radius?: number }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        borderRadius: radius,
        background: `linear-gradient(160deg, ${from}, ${to})`,
        boxShadow: 'inset 0 0 0 1px rgba(255,255,255,0.08), 0 6px 24px rgba(0,0,0,0.35)',
      }}
    />
  )
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))
const r2 = (v: number): number => Math.round(v * 100) / 100

export default function GamePreview({
  projectPath,
  state,
  screen,
  custom,
  groups,
  multiSelected,
  sources,
  selected,
  onSelect,
  onSelectMulti,
  onChangeLayout,
  onCustomMove,
  onGroupMove,
  onScriptGroupMove,
  onScriptGroups,
  onRenderedEls,
  onDropCustom,
}: GamePreviewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const canvasRootRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.5)
  const dragRef = useRef<{
    id: string
    scale: number
    sx: number
    sy: number
    /** 拖拽起点：固定元素渲染矩形 / 自定义控件坐标 / 编组原点 */
    start: Record<string, number>
  } | null>(null)
  /** 框选状态：画布坐标选区（起点/终点） */
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null)
  const marqueeRef = useRef<{
    x0: number
    y0: number
    sx: number
    sy: number
    rect: { x0: number; y0: number; x1: number; y1: number } | null
  } | null>(null)

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = (): void => {
      setScale(Math.min(el.clientWidth / PREVIEW_W, el.clientHeight / PREVIEW_H))
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const { layout, colors, fonts } = state

  // ---------- 渲染输入：gui define + screens.rpy，合并用户 layout 修改（拖拽实时生效） ----------
  const defines = useMemo(() => {
    const map = parseGuiDefines(sources.gui)
    const setNum = (key: string, v: number): void => {
      const d = map.get(key)
      if (d) map.set(key, { ...d, raw: String(Math.round(v * 1000) / 1000) })
    }
    for (const [lk, gk] of LAYOUT_DEFINE_MAP) {
      const v = layout[lk]
      if (typeof v === 'number' && v !== 0) setNum(gk, v)
    }
    return map
  }, [sources.gui, layout])

  const liveSrc = useMemo(() => {
    let s = sources.screens
    for (const [lk, st, prop] of LAYOUT_STYLE_MAP) {
      const v = layout[lk]
      if (typeof v === 'number') s = updateStyleProp(s, st, prop, String(Math.round(v * 1000) / 1000))
    }
    return s
  }, [sources.screens, layout])

  // ---------- 图片加载（自然尺寸 → imgSizes；base64 → imgCache） ----------
  const imgCache = useRef(new Map<string, { url: string; w: number; h: number }>())
  const [imgSizes, setImgSizes] = useState<Map<string, { w: number; h: number }>>(() => new Map())

  // 真实渲染：当前 screen + quick_menu 覆盖层（say/choice 游戏内场景）
  const renderOut = useMemo(() => {
    if (!liveSrc) return { rendered: [] as RenderedEl[], scriptContainers: [] as ScriptContainer[] }
    const env = {
      src: liveSrc,
      defines,
      imgSizes,
      previewW: PREVIEW_W,
      previewH: PREVIEW_H,
      isMainMenu: screen === 'main_menu',
    }
    const r = renderScreenElements(liveSrc, screen, env)
    if (screen === 'say' || screen === 'choice') {
      const q = renderScreenElements(liveSrc, 'quick_menu', env)
      return {
        rendered: [...r.els, ...q.els],
        scriptContainers: [...r.containers, ...q.containers],
      }
    }
    return { rendered: r.els, scriptContainers: r.containers }
  }, [liveSrc, screen, defines, imgSizes])

  const rendered = renderOut.rendered
  const scriptContainers = renderOut.scriptContainers

  // 把脚本容器与渲染元素写入 store（供属性面板编辑间距 / 展示脚本元素属性）
  useEffect(() => {
    onScriptGroups(scriptContainers)
    onRenderedEls(rendered)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scriptContainers, rendered])

  // 脚本容器索引：id → 容器；元素 key → 所属容器
  const scriptContainerById = useMemo(
    () => new Map(scriptContainers.map((c) => [c.id, c])),
    [scriptContainers]
  )
  const scriptContainerOfKey = useMemo(() => {
    const m = new Map<string, ScriptContainer>()
    for (const c of scriptContainers) for (const k of c.children) m.set(k, c)
    return m
  }, [scriptContainers])

  const imgPaths = useMemo(() => {
    const set = new Set<string>()
    for (const el of rendered) {
      if (el.image) set.add(el.image)
      if (el.bgImage) set.add(el.bgImage)
    }
    // 自定义控件可能用到 frame / 自定义图片
    set.add('gui/frame.png')
    for (const c of custom) if (c.image) set.add(c.image)
    return [...set]
  }, [rendered, custom])

  useEffect(() => {
    let alive = true
    void (async () => {
      const next = new Map(imgSizes)
      for (const p of imgPaths) {
        if (imgCache.current.has(p)) {
          const info = imgCache.current.get(p)!
          if (!next.has(p)) next.set(p, { w: info.w, h: info.h })
          continue
        }
        try {
          const url = await window.pupurin.readImageBase64(projectPath, p)
          const info = await new Promise<{ w: number; h: number }>((res) => {
            const im = new Image()
            im.onload = () => res({ w: im.naturalWidth, h: im.naturalHeight })
            im.onerror = () => res({ w: 0, h: 0 })
            im.src = url
          })
          imgCache.current.set(p, { url, ...info })
          next.set(p, info)
        } catch {
          imgCache.current.set(p, { url: '', w: 0, h: 0 })
          next.set(p, { w: 0, h: 0 })
        }
      }
      if (alive) setImgSizes(next)
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath, imgPaths.join('|')])

  const screenCustom = custom.filter((c) => c.screen === screen)
  const screenGroups = groups.filter((g) => g.screen === screen)

  /** 控件在画布上的绝对位置（编组内控件 = 组原点 + 相对偏移） */
  const absControlPos = (c: CustomControl): { x: number; y: number } => {
    const g = screenGroups.find((gr) => gr.children.includes(c.id))
    if (g) {
      const r = groupLayout(g, custom).get(c.id)
      return { x: g.x + (r?.x ?? 0), y: g.y + (r?.y ?? 0) }
    }
    return { x: c.x, y: c.y }
  }

  /** 脚本容器包围盒 = 子元素包围盒并集 */
  const containerBounds = (c: ScriptContainer): { x: number; y: number; w: number; h: number } => {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const k of c.children) {
      const el = rendered.find((e) => e.key === k)
      if (el) {
        if (el.x < minX) minX = el.x
        if (el.y < minY) minY = el.y
        if (el.x + el.w > maxX) maxX = el.x + el.w
        if (el.y + el.h > maxY) maxY = el.y + el.h
      }
    }
    if (minX === Infinity) return { x: 0, y: 0, w: 0, h: 0 }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY }
  }

  // ---------- 背景（真实背景由 rendered 输出；此处兜底渐变） ----------
  const sceneBg = (
    <div className="absolute inset-0">
      <ProceduralBox from="rgba(255,228,166,0.14)" to="rgba(20,20,24,0.95)" radius={0} />
    </div>
  )

  // ---------- 拖拽 ----------
  function onPointerDown(e: React.PointerEvent, id: string): void {
    e.stopPropagation()
    // 按住 Ctrl/Shift 拖拽 = 框选（从任意位置开始，直到松开）
    if (e.ctrlKey || e.shiftKey) {
      startMarqueeFrom(e)
      return
    }
    // 编组/脚本容器两级选中：仅当「当前没选中该组(容器)本身、也没选中其内部任一控件」时，第一击选组(容器)；
    // 否则（组已选中、或组内某个控件已选中）直接选中点击的控件，避免选中单个后再次点击又弹回组。
    const inGroup = screenGroups.find((g) => g.children.includes(id))
    if (inGroup) {
      const insideSel = selected === inGroup.id || (selected !== null && inGroup.children.includes(selected))
      if (!insideSel) {
        onSelect(inGroup.id)
        dragRef.current = null
        return
      }
    }
    if (id.startsWith('sel-')) {
      const sc = scriptContainerOfKey.get(id.slice(4))
      // 递归判断「点击控件是否处于已选中的选中域内」：已选中的要么是 sc 本身、
      // 要么是 sc 内已选中的单个控件、要么是 sc 的某个祖先容器（嵌套编组下钻选中单个）
      const insideSel =
        sc !== undefined &&
        (() => {
          if (selected === null) return false
          if (selected.startsWith('sel-') && scriptContainerOfKey.get(selected.slice(4)) === sc) return true
          let cur: ScriptContainer | undefined = sc
          while (cur) {
            if (selected === cur.id) return true
            cur = cur.parentId ? scriptContainerById.get(cur.parentId) : undefined
          }
          return false
        })()
      if (sc && !insideSel) {
        onSelect(sc.id)
        dragRef.current = null
        return
      }
    }
    onSelect(id)
    if (id.startsWith('sel-')) {
      // 编组内组件：仅选中高亮，不拖拽
      dragRef.current = null
      return
    }
    // vbox/hbox 编组内控件：位置由布局决定，单独拖拽不生效 → 仅选中（fixed 组可拖）
    if (inGroup && inGroup.type !== 'fixed') {
      dragRef.current = null
      return
    }
    const root = canvasRootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const sc = rect.width / PREVIEW_W
    const start: Record<string, number> = {}
    if (FIXED_ELEMENTS.has(id as PreviewElementId)) {
      // 固定元素：记录渲染矩形起点，拖拽写回 layout 字段 → 重新渲染实时移动
      const el = rendered.find((r) => r.id === id)
      if (el) {
        start.elX = el.x
        start.elY = el.y
        start.elW = el.w
        start.elH = el.h
      }
    } else {
      const c = screenCustom.find((x) => x.id === id)
      if (c) {
        start.x = c.x
        start.y = c.y
      }
    }
    dragRef.current = { id, scale: sc, sx: e.clientX, sy: e.clientY, start }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  // 编组包围盒拖拽（整体移动）
  function onGroupPointerDown(e: React.PointerEvent, gid: string): void {
    e.stopPropagation()
    // 按住 Ctrl/Shift 拖拽 = 框选
    if (e.ctrlKey || e.shiftKey) {
      startMarqueeFrom(e)
      return
    }
    onSelect(gid)
    const g = groups.find((x) => x.id === gid)
    const root = canvasRootRef.current
    if (!g || !root) return
    const rect = root.getBoundingClientRect()
    dragRef.current = {
      id: gid,
      scale: rect.width / PREVIEW_W,
      sx: e.clientX,
      sy: e.clientY,
      start: { gx: g.x, gy: g.y },
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  // 脚本容器（vbox/hbox/fixed）拖拽：写回 pos（基准 = 容器渲染位置 + 拖拽增量）
  // 流式布局子容器（父为 vbox/hbox）的位置由父布局决定，写回 pos 在真实 Ren'Py 中会被覆盖 → 仅选中不移动
  function onScriptGroupPointerDown(e: React.PointerEvent, cid: string): void {
    e.stopPropagation()
    // 按住 Ctrl/Shift 拖拽 = 框选
    if (e.ctrlKey || e.shiftKey) {
      startMarqueeFrom(e)
      return
    }
    onSelect(cid)
    const c = scriptContainerById.get(cid)
    if (!c || c.parentKind === 'vbox' || c.parentKind === 'hbox') {
      dragRef.current = null
      return
    }
    const root = canvasRootRef.current
    if (!root) {
      dragRef.current = null
      return
    }
    const rect = root.getBoundingClientRect()
    dragRef.current = {
      id: cid,
      scale: rect.width / PREVIEW_W,
      sx: e.clientX,
      sy: e.clientY,
      start: { scX: c.x, scY: c.y },
    }
    window.addEventListener('pointermove', onPointerMove)
    window.addEventListener('pointerup', onPointerUp)
  }

  // 脚本容器覆盖层点击：点中某个子控件矩形 → 二击选中该控件；点空白/边框 → 整体拖拽
  function onScriptOverlayPointerDown(e: React.PointerEvent, cid: string): void {
    e.stopPropagation()
    // 按住 Ctrl/Shift 拖拽 = 框选
    if (e.ctrlKey || e.shiftKey) {
      startMarqueeFrom(e)
      return
    }
    onSelect(cid)
    const c = scriptContainerById.get(cid)
    const root = canvasRootRef.current
    if (!c || !root) {
      dragRef.current = null
      return
    }
    const rect = root.getBoundingClientRect()
    const cx = (e.clientX - rect.left) / (rect.width / PREVIEW_W)
    const cy = (e.clientY - rect.top) / (rect.height / PREVIEW_H)
    for (const k of c.children) {
      const el = rendered.find((r) => r.key === k)
      if (el && el.w > 0 && el.h > 0 && cx >= el.x && cx <= el.x + el.w && cy >= el.y && cy <= el.y + el.h) {
        onSelect(`sel-${k}`)
        dragRef.current = null
        return
      }
    }
    onScriptGroupPointerDown(e, cid)
  }

  function onPointerMove(e: PointerEvent): void {
    const d = dragRef.current
    if (!d) return
    const dx = (e.clientX - d.sx) / d.scale
    const dy = (e.clientY - d.sy) / d.scale
    const st = d.start
    const id = d.id

    // 脚本容器整体移动（基准 pos + 拖拽增量）
    if (st.scX !== undefined) {
      onScriptGroupMove(id, Math.round(st.scX + dx), Math.round(st.scY + dy))
      return
    }

    // 编组整体移动
    if (st.gx !== undefined) {
      onGroupMove(id, Math.round(st.gx + dx), Math.round(st.gy + dy))
      return
    }

    if (FIXED_ELEMENTS.has(id as PreviewElementId)) {
      if (st.elX === undefined) return
      const winEl = rendered.find((r) => r.id === 'window')
      const winX = winEl?.x ?? 0
      const winY = winEl?.y ?? 0
      let patch: Partial<UiLayout> | null = null
      if (id === 'window') {
        const H = st.elH
        patch = { windowYalign: r2(clamp((st.elY + dy) / (PREVIEW_H - H), 0, 1.2)) }
      } else if (id === 'dialogue') {
        patch = {
          dialogueX: Math.round(clamp(st.elX - winX + dx, -20, PREVIEW_W)),
          dialogueY: Math.round(clamp(st.elY - winY + dy, -60, layout.windowHeight)),
        }
      } else if (id === 'namebox') {
        patch = {
          nameboxX: Math.round(clamp(st.elX - winX + dx, -120, PREVIEW_W)),
          nameboxY: Math.round(clamp(st.elY - winY + dy, -60, layout.windowHeight + 60)),
        }
      } else if (id === 'choice') {
        patch = {
          choiceY: Math.round(clamp(st.elY + st.elH / 2 + dy, 0, PREVIEW_H)),
          choiceXalign: r2(clamp((st.elX + st.elW / 2 + dx) / PREVIEW_W, 0, 1)),
        }
      } else if (id === 'nav') {
        patch = { navX: Math.round(clamp(st.elX + dx, -120, PREVIEW_W)) }
      }
      if (patch) onChangeLayout(patch)
    } else {
      onCustomMove(id, Math.round(st.x + dx), Math.round(st.y + dy))
    }
  }

  function onPointerUp(): void {
    dragRef.current = null
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
  }

  // ---------- 框选（canvas 空白处按下拖拽矩形选区，松开选中框内控件；Ctrl/Shift+拖拽任意位置同样触发） ----------
  function startMarqueeFrom(e: React.PointerEvent): void {
    const root = canvasRootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const sx = (e.clientX - rect.left) / (rect.width / PREVIEW_W)
    const sy = (e.clientY - rect.top) / (rect.height / PREVIEW_H)
    marqueeRef.current = { x0: sx, y0: sy, sx: e.clientX, sy: e.clientY, rect: null }
    onSelect(null)
    window.addEventListener('pointermove', onMarqueeMove)
    window.addEventListener('pointerup', onMarqueeUp)
  }

  function onCanvasPointerDown(e: React.PointerEvent): void {
    startMarqueeFrom(e)
  }

  function onMarqueeMove(e: PointerEvent): void {
    const m = marqueeRef.current
    if (!m) return
    if (Math.abs(e.clientX - m.sx) < 4 && Math.abs(e.clientY - m.sy) < 4) return
    const root = canvasRootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const cx = (e.clientX - rect.left) / (rect.width / PREVIEW_W)
    const cy = (e.clientY - rect.top) / (rect.height / PREVIEW_H)
    m.rect = {
      x0: Math.min(m.x0, cx),
      y0: Math.min(m.y0, cy),
      x1: Math.max(m.x0, cx),
      y1: Math.max(m.y0, cy),
    }
    setMarquee({ x0: m.x0, y0: m.y0, x1: cx, y1: cy })
  }

  function onMarqueeUp(): void {
    const m = marqueeRef.current
    marqueeRef.current = null
    window.removeEventListener('pointermove', onMarqueeMove)
    window.removeEventListener('pointerup', onMarqueeUp)
    setMarquee(null)
    if (!m?.rect) return
    const r = m.rect
    const hit = (x: number, y: number, w: number, h: number): boolean =>
      x < r.x1 && x + w > r.x0 && y < r.y1 && y + h > r.y0
    const ids: string[] = []
    // 只框选独立控件；编组内控件归编组管理，需点击编组整体操作
    for (const c of screenCustom) {
      if (screenGroups.some((g) => g.children.includes(c.id))) continue
      const p = absControlPos(c)
      const { w, h } = estimateSize(c)
      if (hit(p.x, p.y, w, h)) ids.push(c.id)
    }
    if (ids.length) onSelectMulti(ids)
  }

  useEffect(() => () => {
    window.removeEventListener('pointermove', onPointerMove)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointermove', onMarqueeMove)
    window.removeEventListener('pointerup', onMarqueeUp)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // 控件库拖入
  function onDrop(e: React.DragEvent): void {
    e.preventDefault()
    const type = e.dataTransfer.getData('application/x-loom-custom') as CustomControlType | ''
    if (!type) return
    const root = canvasRootRef.current
    if (!root) return
    const rect = root.getBoundingClientRect()
    const x = Math.round((e.clientX - rect.left) / (rect.width / PREVIEW_W))
    const y = Math.round((e.clientY - rect.top) / (rect.height / PREVIEW_H))
    onDropCustom(clamp(x, 0, PREVIEW_W), clamp(y, 0, PREVIEW_H), type)
  }

  const outline = (id: string): React.CSSProperties => {
    if (selected === id) return { outline: `2px dashed ${EDITOR_ACCENT}`, outlineOffset: 2, cursor: 'move' }
    if (multiSelected.includes(id)) return { outline: `2px solid ${EDITOR_ACCENT}`, outlineOffset: 1, cursor: 'move' }
    return { cursor: 'move' }
  }

  // ---------- RenderedEl → DOM ----------
  function renderEl(el: RenderedEl): React.ReactNode {
    const base: React.CSSProperties = {
      position: 'absolute',
      left: el.x,
      top: el.y,
      width: el.w,
      height: el.h,
      pointerEvents: 'none',
    }
    if (el.rotate !== undefined) {
      base.transform = `rotate(${el.rotate}deg)`
      base.transformOrigin = 'center'
    }
    if (el.alpha !== undefined) base.opacity = el.alpha
    switch (el.kind) {
      case 'image': {
        const info = el.image ? imgCache.current.get(el.image) : undefined
        if (info && info.url) {
          return (
            <div key={el.key} style={base}>
              <img src={info.url} alt="" className="w-full h-full" style={{ objectFit: el.objectFit ?? 'contain' }} draggable={false} />
            </div>
          )
        }
        return <div key={el.key} style={{ ...base, background: el.bg ?? '#555a66' }} />
      }
      case 'text': {
        return (
          <div
            key={el.key}
            style={{
              ...base,
              color: el.color,
              fontSize: el.fontSize,
              fontFamily: el.fontFamily ?? (fonts.interface || 'inherit'),
              fontWeight: el.bold ? 700 : 400,
              textAlign: el.align ?? 'left',
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
            }}
          >
            {el.text}
          </div>
        )
      }
      case 'button': {
        const info = el.bgImage ? imgCache.current.get(el.bgImage) : undefined
        return (
          <div
            key={el.key}
            style={{
              ...base,
              background: info ? undefined : el.bg,
              borderRadius: el.radius,
              display: 'flex',
              alignItems: 'center',
              justifyContent: el.align === 'left' ? 'flex-start' : 'center',
              padding: el.align === 'left' ? '0 14px' : 0,
              color: el.color,
              fontSize: el.fontSize,
              fontFamily: el.fontFamily ?? (fonts.interface || 'inherit'),
              fontWeight: el.bold ? 700 : 400,
              overflow: 'hidden',
            }}
          >
            {info && info.url && (
              <img src={info.url} alt="" className="absolute inset-0 w-full h-full object-cover" draggable={false} />
            )}
            <span className="relative z-10">{el.text}</span>
          </div>
        )
      }
      case 'bar': {
        const pct = (el.barFill ?? 0) * 100
        return (
          <div key={el.key} style={{ ...base, background: '#3a3a3e', borderRadius: 4, overflow: 'hidden' }}>
            <div
              style={
                el.vertical
                  ? { position: 'absolute', left: 0, bottom: 0, width: '100%', height: `${pct}%`, background: el.color ?? '#CCCFE1' }
                  : { position: 'absolute', left: 0, top: 0, height: '100%', width: `${pct}%`, background: el.color ?? '#CCCFE1' }
              }
            />
          </div>
        )
      }
      case 'box': {
        const info = el.bgImage ? imgCache.current.get(el.bgImage) : undefined
        if (info && info.url) {
          return (
            <div key={el.key} style={{ ...base, borderRadius: el.radius, overflow: 'hidden' }}>
              <img src={info.url} alt="" className="w-full h-full object-cover" draggable={false} />
            </div>
          )
        }
        return <div key={el.key} style={{ ...base, background: el.bg ?? 'transparent', borderRadius: el.radius }} />
      }
    }
  }

  // 固定元素可拖拽层（叠加在真实渲染之上，保持代码渲染纯净）
  const fixedOverlays = rendered
    .filter((el) => el.id && FIXED_ELEMENTS.has(el.id) && !FULLSCREEN_IDS.has(el.id))
    .map((el) => (
      <div
        key={`sel-${el.key}`}
        style={{
          position: 'absolute',
          left: el.x,
          top: el.y,
          width: el.w,
          height: el.h,
          zIndex: 15,
          ...outline(el.id!),
        }}
        onPointerDown={(e) => onPointerDown(e, el.id!)}
      />
    ))

  // 编组内组件选中层：所有可选中元素提供透明点击区，hover 浅边框，选中高亮虚线框
  const selectableOverlays = rendered
    .filter((el) => el.sel && !(el.id && FIXED_ELEMENTS.has(el.id) && !FULLSCREEN_IDS.has(el.id)))
    .map((el) => {
      const sid = `sel-${el.key}`
      // 所属脚本容器已选中：点击交给容器覆盖层统一处理（二击选中单个控件 / 拖拽整体），子覆盖层放行
      const containerSel = el.containerId ? scriptContainerById.get(el.containerId)?.id === selected : false
      if (containerSel) return null
      return (
        <div
          key={`ov-${el.key}`}
          className="group"
          style={{ position: 'absolute', left: el.x, top: el.y, width: el.w, height: el.h, zIndex: 14 }}
          onPointerDown={(e) => onPointerDown(e, sid)}
        >
          <div className="absolute inset-0 border border-transparent group-hover:border-loom-accent/40" />
          {selected === sid && (
            <div className="absolute inset-0" style={{ outline: `2px dashed ${EDITOR_ACCENT}`, outlineOffset: 1 }} />
          )}
        </div>
      )
    })

  // ---------- 自定义控件渲染 ----------
  function renderCustom(c: CustomControl): React.ReactNode {
    const abs = absControlPos(c)
    const textAlign = c.xalign === 1 ? 'right' : c.xalign === 0.5 ? 'center' : 'left'
    const base: React.CSSProperties = {
      position: 'absolute',
      left: abs.x,
      top: abs.y,
      width: c.width,
      height: c.height,
      ...outline(c.id),
      overflow: 'hidden',
      // 控件始终置于固定元素与装饰层之上，保证可选中 / 可拖拽
      zIndex: 20,
      ...(typeof c.alpha === 'number' ? { opacity: c.alpha } : {}),
    }
    if (c.type === 'text') {
      return (
        <div
          key={c.id}
          style={{
            ...base,
            width: 'auto',
            height: 'auto',
            minWidth: 24,
            minHeight: 16,
            color: c.color ?? colors.text,
            fontFamily: fonts.interface || 'inherit',
            fontSize: c.size ?? 33,
            fontWeight: c.bold ? 700 : 400,
            textAlign,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
          }}
          onPointerDown={(e) => onPointerDown(e, c.id)}
        >
          {c.text ?? '文本'}
        </div>
      )
    }
    if (c.type === 'label') {
      return (
        <div
          key={c.id}
          style={{
            ...base,
            width: 'auto',
            height: 'auto',
            minWidth: 24,
            minHeight: 20,
            color: c.color ?? colors.accent,
            fontFamily: fonts.interface || 'inherit',
            fontSize: c.size ?? 33,
            fontWeight: 700,
            textAlign,
            letterSpacing: 2,
            lineHeight: 1.4,
            whiteSpace: 'pre-wrap',
          }}
          onPointerDown={(e) => onPointerDown(e, c.id)}
        >
          {c.text ?? '标签'}
        </div>
      )
    }
    if (c.type === 'input') {
      return (
        <div
          key={c.id}
          style={{
            ...base,
            display: 'flex',
            alignItems: 'center',
            padding: '0 14px',
            background: 'rgba(0,0,0,0.25)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderBottom: `2px solid ${colors.accent}`,
            borderRadius: 4,
            color: c.color ?? colors.muted,
            fontFamily: fonts.interface || 'inherit',
            fontSize: c.size ?? Math.round((c.height ?? 50) * 0.5),
            textAlign,
            letterSpacing: 1,
          }}
          onPointerDown={(e) => onPointerDown(e, c.id)}
        >
          {c.text ?? '输入框'}
        </div>
      )
    }
    if (c.type === 'frame') {
      const info = imgCache.current.get('gui/frame.png')
      return (
        <div
          key={c.id}
          style={{ ...base, ...outline(c.id) }}
          onPointerDown={(e) => onPointerDown(e, c.id)}
        >
          {info && info.url ? (
            <img src={info.url} alt="" className="w-full h-full" draggable={false} />
          ) : (
            <ProceduralBox from="rgba(255,255,255,0.08)" to="rgba(255,255,255,0.03)" radius={12} />
          )}
        </div>
      )
    }
    if (c.type === 'button') {
      return (
        <div
          key={c.id}
          style={{
            ...base,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'linear-gradient(180deg, rgba(255,228,166,0.25), rgba(255,228,166,0.10))',
            border: `1px solid ${c.color ?? colors.idle}66`,
            borderRadius: 10,
            color: c.color ?? colors.idle,
            fontFamily: fonts.interface || 'inherit',
            fontSize: c.textSize ?? Math.round((c.height ?? 66) * 0.4),
            fontWeight: c.bold ? 700 : 400,
            letterSpacing: 1,
          }}
          onPointerDown={(e) => onPointerDown(e, c.id)}
        >
          {c.text ?? '按钮'}
        </div>
      )
    }
    if (c.type === 'image') {
      const info = c.image ? imgCache.current.get(c.image) : undefined
      return (
        <div
          key={c.id}
          style={{ ...base, ...outline(c.id) }}
          onPointerDown={(e) => onPointerDown(e, c.id)}
        >
          {info && info.url ? (
            <img src={info.url} alt="" className="w-full h-full object-contain" draggable={false} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[12px] text-loom-muted bg-loom-panel2 border border-loom-border">
              图片
            </div>
          )}
        </div>
      )
    }
    if (c.type === 'imagebutton') {
      const info = c.image ? imgCache.current.get(c.image) : undefined
      return (
        <div
          key={c.id}
          style={{ ...base, ...outline(c.id), borderRadius: 8, overflow: 'hidden' }}
          onPointerDown={(e) => onPointerDown(e, c.id)}
        >
          {info && info.url ? (
            <img src={info.url} alt="" className="w-full h-full object-contain" draggable={false} />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-[12px] text-loom-muted bg-loom-panel2 border border-loom-border">
              图片按钮
            </div>
          )}
          {c.hoverImage && c.hoverImage !== c.image && (
            <div
              className="absolute top-1 right-1 rounded px-1 py-px text-[9px]"
              style={{ background: EDITOR_ACCENT, color: '#202020' }}
              title={`悬停图：${c.hoverImage}`}
            >
              hover
            </div>
          )}
        </div>
      )
    }
    if (c.type === 'null') {
      return (
        <div
          key={c.id}
          style={{
            ...base,
            border: '1px dashed rgba(255,255,255,0.25)',
            background: 'rgba(255,255,255,0.03)',
          }}
          onPointerDown={(e) => onPointerDown(e, c.id)}
        >
          <span
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px]"
            style={{ color: 'rgba(255,255,255,0.4)' }}
          >
            占位
          </span>
        </div>
      )
    }
    if (c.type === 'hotspot') {
      return (
        <div
          key={c.id}
          style={{
            ...base,
            border: `1px dashed ${EDITOR_ACCENT}88`,
            background: 'rgba(255,170,60,0.12)',
            borderRadius: 6,
          }}
          onPointerDown={(e) => onPointerDown(e, c.id)}
        >
          <span
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px]"
            style={{ color: EDITOR_ACCENT }}
          >
            热区
          </span>
        </div>
      )
    }
    // bar / vbar / slider / hotbar
    const vertical = c.type === 'vbar'
    const knob = c.type === 'slider' || c.type === 'hotbar'
    const fill = `${Math.round((c.value ?? 0.5) * 100)}%`
    return (
      <div
        key={c.id}
        style={{
          ...base,
          ...outline(c.id),
          borderRadius: knob ? 999 : 4,
          background: '#3a3a3e',
          position: 'absolute',
          overflow: 'hidden',
        }}
        onPointerDown={(e) => onPointerDown(e, c.id)}
      >
        <div
          style={
            vertical
              ? {
                  position: 'absolute',
                  bottom: 0,
                  left: 0,
                  width: '100%',
                  height: fill,
                  borderRadius: 4,
                  background: `linear-gradient(0deg, ${colors.accent}aa, ${colors.accent})`,
                }
              : {
                  position: 'absolute',
                  left: 0,
                  top: 0,
                  width: fill,
                  height: '100%',
                  borderRadius: 4,
                  background: `linear-gradient(90deg, ${colors.accent}aa, ${colors.accent})`,
                }
          }
        />
        {knob && (
          <div
            style={{
              position: 'absolute',
              left: `${Math.round((c.value ?? 0.5) * 100)}%`,
              top: '50%',
              transform: 'translate(-50%, -50%)',
              width: Math.max(18, Math.round((c.height ?? 38) * 0.7)),
              height: Math.max(18, Math.round((c.height ?? 38) * 0.7)),
              borderRadius: '50%',
              background: '#ffffff',
              boxShadow: '0 2px 8px rgba(0,0,0,0.45)',
            }}
          />
        )}
      </div>
    )
  }

  // 编组包围盒覆盖层：未选中不拦截子控件点击（两级选中）；选中后整体可拖拽
  const groupOverlays = screenGroups.map((g) => {
    const b = groupBounds(g, custom)
    const isSel = selected === g.id
    const isMulti = multiSelected.includes(g.id)
    const label = GROUP_TYPES.find((t) => t.type === g.type)?.name ?? g.type
    return (
      <div
        key={`grp-${g.id}`}
        style={{
          position: 'absolute',
          left: b.x,
          top: b.y,
          width: b.w,
          height: b.h,
          zIndex: 16,
          boxSizing: 'border-box',
          border: isSel
            ? `2px dashed ${EDITOR_ACCENT}`
            : isMulti
              ? `2px solid ${EDITOR_ACCENT}`
              : '1px dashed rgba(140,160,255,0.4)',
          background: isSel ? 'rgba(120,140,255,0.10)' : 'transparent',
          pointerEvents: isSel ? 'auto' : 'none',
          cursor: 'move',
        }}
        onPointerDown={isSel ? (e) => onGroupPointerDown(e, g.id) : undefined}
      >
        <div
          className="absolute top-1 left-1 whitespace-nowrap rounded px-1.5 py-px text-[10px] font-medium select-none"
          style={{
            background: isSel ? EDITOR_ACCENT : 'rgba(90,110,220,0.9)',
            color: '#202020',
            cursor: 'move',
            pointerEvents: 'auto',
          }}
          onPointerDown={(e) => onGroupPointerDown(e, g.id)}
        >
          {label} · {g.children.length} 个
        </div>
      </div>
    )
  })

  // 脚本容器（screens.rpy vbox/hbox/fixed）覆盖层：选中后整体拖拽；未选中不拦截子控件
  const scriptGroupOverlays = scriptContainers.map((c) => {
    const b = containerBounds(c)
    if (b.w <= 0 || b.h <= 0) return null
    const isSel = selected === c.id
    // 流式布局子容器（父为 vbox/hbox）不可整体移动（真实 Ren'Py 中 pos 会被父布局覆盖）
    const canMove = !c.parentKind || c.parentKind === 'fixed'
    const label = c.kind === 'vbox' ? '垂直编组 vbox' : c.kind === 'hbox' ? '水平编组 hbox' : '自由编组 fixed'
    return (
      <div
        key={`sc-${c.id}`}
        style={{
          position: 'absolute',
          left: b.x,
          top: b.y,
          width: b.w,
          height: b.h,
          zIndex: 13,
          boxSizing: 'border-box',
          border: isSel ? `2px dashed ${EDITOR_ACCENT}` : '1px dashed rgba(140,160,255,0.4)',
          background: isSel ? 'rgba(120,140,255,0.10)' : 'transparent',
          pointerEvents: isSel ? 'auto' : 'none',
          cursor: canMove ? 'move' : 'default',
        }}
        onPointerDown={isSel ? (e) => onScriptOverlayPointerDown(e, c.id) : undefined}
      >
        <div
          className="absolute top-1 left-1 whitespace-nowrap rounded px-1.5 py-px text-[10px] font-medium select-none"
          style={{
            background: isSel ? EDITOR_ACCENT : 'rgba(90,110,220,0.9)',
            color: '#202020',
            cursor: canMove ? 'move' : 'default',
            pointerEvents: 'auto',
          }}
          onPointerDown={(e) => onScriptGroupPointerDown(e, c.id)}
        >
          {label} · {c.children.length} 个
        </div>
      </div>
    )
  })

  return (
    <div
      ref={containerRef}
      className="flex-1 min-h-0 w-full relative flex items-center justify-center bg-loom-bg p-4"
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
    >
      <div style={{ width: PREVIEW_W * scale, height: PREVIEW_H * scale }}>
        <div
          ref={canvasRootRef}
          className="relative overflow-hidden select-none"
          style={{
            width: PREVIEW_W,
            height: PREVIEW_H,
            transform: `scale(${scale})`,
            transformOrigin: 'top left',
            background: '#202020',
          }}
          onPointerDown={onCanvasPointerDown}
        >
          {sceneBg}
          {rendered.map(renderEl)}
          {fixedOverlays}
          {selectableOverlays}
          {screenCustom.map(renderCustom)}
          {groupOverlays}
          {scriptGroupOverlays}
          {marquee && (
            <div
              className="absolute"
              style={{
                left: Math.min(marquee.x0, marquee.x1),
                top: Math.min(marquee.y0, marquee.y1),
                width: Math.abs(marquee.x1 - marquee.x0),
                height: Math.abs(marquee.y1 - marquee.y0),
                zIndex: 30,
                border: `1px solid ${EDITOR_ACCENT}`,
                background: `${EDITOR_ACCENT}22`,
                pointerEvents: 'none',
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
