// 迷你 Ren'Py 屏幕渲染器：
// 解析项目 screens.rpy 中指定 screen 的实际语句（add/text/textbutton/imagebutton/
// vbox/hbox/frame/window/if/use/for/transclude…），结合 gui.rpy define 与 style 块，
// 计算真实布局并输出绝对定位的渲染元素，使 UI 预览忠于项目实际代码而非默认模板。

import type { PreviewElementId } from './types'
import type { GuiDefine } from './types'
import { parseScreenBlocks, parseAllStyles, resolveStyleMap } from './parseScreens'
import type { AllStyleBlock } from './parseScreens'
import { resolveValue } from './parseGui'

// ---------- 渲染元素 ----------

export interface RenderedEl {
  key: string
  kind: 'image' | 'text' | 'button' | 'bar' | 'box'
  x: number
  y: number
  w: number
  h: number
  image?: string
  text?: string
  color?: string
  fontSize?: number
  fontFamily?: string
  bold?: boolean
  align?: 'center' | 'left' | 'right'
  alpha?: number
  radius?: number
  bgImage?: string
  bg?: string
  id?: PreviewElementId
  rotate?: number
  objectFit?: 'contain' | 'cover' | 'fill'
  /** bar/vbar 的填充比例（0..1） */
  barFill?: number
  /** 垂直滑条 */
  vertical?: boolean
  /** 可选中（编组内组件；固定元素忽略此标记） */
  sel?: boolean
  /** 所属脚本容器 id（sc-<行号>；仅 vbox/hbox/fixed 内的元素） */
  containerId?: string
  /** 源码行号（0 基，写回 pos 用） */
  line?: number
}

/** 脚本容器（screens.rpy 中的 vbox/hbox/fixed）：作为编组支持两级选中与整体操作 */
export interface ScriptContainer {
  /** 选中 id：sc-<源码行号>（行号全局唯一，移动/间距写回用） */
  id: string
  kind: 'vbox' | 'hbox' | 'fixed'
  /** 容器渲染后的左上角（画布绝对坐标），整体拖拽的基准 */
  x: number
  y: number
  /** 容器渲染尺寸（子元素包围盒，解散编组时按序推算流式偏移用） */
  w: number
  h: number
  /** 容器内边距（padding 的 left/top；解散到 fixed 父容器时作为子元素定位基准） */
  padL: number
  padT: number
  /** 解析出的 spacing（无则 0） */
  spacing: number
  /** 父容器 kind：存在且为 vbox/hbox 时表示流式布局子容器（位置由父布局决定，拖拽移动无法持久化） */
  parentKind?: 'vbox' | 'hbox' | 'fixed'
  /** 父容器 id（sc-<行号>），用于嵌套容器的选中下钻判断 */
  parentId?: string
  /** 子元素 key 列表 */
  children: string[]
}

// ---------- 语法树 ----------

export interface SNode {
  kind: string
  line: number
  indent: number
  textExpr?: string
  headProps: Map<string, string>
  blockProps: Map<string, string>
  children: SNode[]
  cond?: string
  useName?: string
  hasBlock: boolean
}

const PROP_NAMES = new Set([
  'pos', 'xpos', 'ypos', 'xalign', 'yalign', 'xanchor', 'yanchor', 'xoffset', 'yoffset',
  'xsize', 'ysize', 'xfill', 'yfill', 'xmaximum', 'ymaximum', 'width', 'height',
  'spacing', 'xspacing', 'yspacing', 'padding',
  'left_padding', 'top_padding', 'right_padding', 'bottom_padding',
  'xpadding', 'ypadding',
  'left_margin', 'top_margin', 'right_margin', 'bottom_margin',
  'background', 'idle', 'hover', 'color', 'text_color', 'text_size', 'size',
  'font', 'bold', 'italic', 'text_align', 'line_spacing', 'outlines',
  'style', 'at', 'fit', 'alpha', 'anchor', 'action', 'value', 'default',
  'hover_background', 'selected_background', 'sensitive_background',
  'activate_sound', 'hover_sound', 'keysym', 'keyboard_focus',
  'image', 'foreground', 'thumb', 'base_bar', 'thumb_offset', 'length', 'step',
  'id', 'left_bar', 'right_bar', 'top_bar', 'bottom_bar', 'thumb_shadow',
  'unscrollable', 'mousewheel', 'draggable', 'pagekeys', 'side_yfill',
  'cols', 'rows', 'yinitial', 'xinitial', 'offset', 'subpixel', 'language',
  'adjust_spacing', 'scrollbars', 'focus_mask', 'sensitive', 'range', 'suffix',
  'hint', 'keysym', 'enabled', 'role', 'xmaximum', 'ymaximum',
  'style',
])

const STATEMENT_KINDS = new Set([
  'vbox', 'hbox', 'fixed', 'grid', 'side', 'frame', 'window', 'viewport', 'vpgrid',
  'text', 'textbutton', 'label', 'input', 'add', 'imagebutton', 'button', 'bar', 'vbar', 'null',
])

// 顶层语句（screen 内）而非属性行；'style' 已在 PROP_NAMES 中按属性行处理（如 `style "quick_menu"`）
const SKIP_KINDS = new Set(['key', 'timer', 'on', 'zorder', 'modal', 'tag', 'transform', 'init'])

// ---------- 分词 ----------

/** 按空白分词，保留引号串与括号组为整体 */
export function tokenize(line: string): string[] {
  const out: string[] = []
  let i = 0
  const n = line.length
  while (i < n) {
    const ch = line[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < n && line[j] !== ch) j++
      out.push(line.slice(i, j + 1))
      i = j + 1
      continue
    }
    if (ch === '(' || ch === '[' || ch === '{') {
      const open = ch
      const close = open === '(' ? ')' : open === '[' ? ']' : '}'
      let depth = 1
      let j = i + 1
      while (j < n && depth > 0) {
        if (line[j] === open) depth++
        else if (line[j] === close) depth--
        j++
      }
      out.push(line.slice(i, j))
      i = j
      continue
    }
    let j = i
    while (j < n && !/\s/.test(line[j])) j++
    out.push(line.slice(i, j))
    i = j
  }
  return out
}

function extractQuoted(tok: string): string | null {
  // 覆盖 "X" / _("X") / ("X") / _('X') 等
  const t = tok.trim()
  if (t.startsWith('"') && t.endsWith('"')) return t.slice(1, -1)
  if (t.startsWith("'") && t.endsWith("'")) return t.slice(1, -1)
  const m = /^_?\(["']([^"']*)["']\)/.exec(t)
  return m ? m[1] : null
}

/** 从头部提取文本 + 属性 */
function parseHead(head: string): { text?: string; props: Map<string, string>; dyn?: boolean } {
  const props = new Map<string, string>()
  const toks = tokenize(head)
  let text: string | undefined
  let idx = 0
  if (toks.length && (toks[0].startsWith('"') || toks[0].startsWith('_(') || toks[0].startsWith('("'))) {
    const t = extractQuoted(toks[0])
    if (t !== null) { text = t; idx = 1 }
  }
  let dyn = false
  // 文本后紧跟 `+ 表达式`（如 text "/ " + title）→ 动态文本，追加占位
  if (text !== undefined && toks[idx] === '+') dyn = true
  // 未引用的文本表达式（如 choice 的 textbutton i.caption）→ 记录原始表达式，供 textOf 解析
  if (text === undefined && toks.length && !PROP_NAMES.has(toks[0])) {
    props.set('__textexpr', toks[0])
  }
  while (idx < toks.length) {
    const k = toks[idx]
    if (PROP_NAMES.has(k)) {
      const v: string[] = []
      idx++
      while (idx < toks.length && !PROP_NAMES.has(toks[idx])) { v.push(toks[idx]); idx++ }
      props.set(k, v.join(' '))
    } else idx++
  }
  return { text, props, dyn }
}

// ---------- 树构建 ----------

/** 解析 screen 语句为树 */
export function parseScreenTree(src: string, screenName: string): SNode | null {
  const blocks = parseScreenBlocks(src, [screenName])
  const block = blocks.get(screenName)
  if (!block) return null
  const lines = src.split(/\r?\n/)
  const root: SNode = { kind: 'screen', line: block.start, indent: 0, headProps: new Map(), blockProps: new Map(), children: [], hasBlock: true }
  const stack: SNode[] = [root]
  for (let i = block.start + 1; i < block.end; i++) {
    const ln = lines[i]
    if (ln.trim() === '') continue
    const indent = ln.match(/^\s*/)![0].length
    if (indent < 4) continue
    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      // `has vbox`（无冒号）的块内容与 has 同级缩进 → 不弹出，归入 has 容器
      const top = stack[stack.length - 1]
      if (top.blockProps.get('__sameindent') === '1' && top.indent === indent) break
      stack.pop()
    }
    const node = buildNode(ln.trim(), i)
    if (!node) continue
    node.indent = indent
    const cur = stack[stack.length - 1]
    if (node.kind === 'prop') {
      // 属性行归入当前节点的 blockProps
      cur.blockProps.set(node.textExpr ?? '', node.headProps.get('__v') ?? '')
      continue
    }
    cur.children.push(node)
    // 所有带块语句（含 if/elif/else/for）都入栈，让块体正确嵌套
    if (node.hasBlock) stack.push(node)
  }
  return root
}

/** 提取块内属性行 → blockProps；返回子语句节点 */
function buildNode(line: string, idx: number): SNode | null {
  if (line.startsWith('#')) return null
  const mk = (partial: Partial<SNode> & { kind: string }): SNode => ({
    line: idx,
    indent: 0,
    headProps: new Map(),
    blockProps: new Map(),
    children: [],
    hasBlock: false,
    ...partial,
  })
  if (/^if\s+/.test(line)) {
    const cm = /^if\s+(.+):\s*$/.exec(line)
    return mk({ kind: 'if', cond: cm ? cm[1] : 'True', hasBlock: true })
  }
  if (/^elif\s+/.test(line)) {
    const cm = /^elif\s+(.+):\s*$/.exec(line)
    return mk({ kind: 'elif', cond: cm ? cm[1] : 'True', hasBlock: true })
  }
  if (/^else\s*:\s*$/.test(line)) return mk({ kind: 'else', hasBlock: true })
  if (/^for\s+/.test(line)) {
    const cm = /^for\s+(.+):\s*$/.exec(line)
    return mk({ kind: 'for', cond: cm ? cm[1] : '', hasBlock: true })
  }
  if (/^\$\s+/.test(line)) return mk({ kind: '$', textExpr: line.slice(1).trim() })
  if (/^default\s+/.test(line)) return mk({ kind: '$', textExpr: line.slice(7).trim() })
  if (/^python\s*:\s*$/.test(line)) return mk({ kind: 'python', hasBlock: true })
  if (/^style_prefix\s+/.test(line)) {
    const q = /"([^"]+)"/.exec(line)
    return mk({ kind: 'style_prefix', textExpr: q ? q[1] : '' })
  }
  const um = /^use\s+([\w_]+)\s*(\(.*\))?\s*:?\s*$/.exec(line)
  if (um) return mk({ kind: 'use', useName: um[1], textExpr: um[2] ?? '', hasBlock: line.trim().endsWith(':') })
  if (/^transclude\b/.test(line)) return mk({ kind: 'transclude' })
  // has <kind>：将块内语句放入指定容器（如 `has vbox` → 后续行归入 vbox）
  const hm = /^has\s+([a-z_][a-z0-9_]*)\s*:?\s*$/.exec(line)
  if (hm) {
    const hnode = mk({ kind: hm[1], hasBlock: true })
    // 无冒号的 `has vbox`：块内容与 has 同级缩进（Ren'Py 语法），记录标记供树构建使用
    if (!line.trim().endsWith(':')) hnode.blockProps.set('__sameindent', '1')
    return hnode
  }

  const sm = /^([a-z_][a-z0-9_]*)\s*(.*)$/.exec(line)
  if (!sm) return null
  const kind = sm[1]
  if (SKIP_KINDS.has(kind)) return null
  // 块内属性行：首 token 是属性名
  if (PROP_NAMES.has(kind)) return mk({ kind: 'prop', textExpr: kind, headProps: new Map([['__v', sm[2].trim()]]) })
  if (!STATEMENT_KINDS.has(kind)) return null

  const headStr = sm[2].endsWith(':') ? sm[2].slice(0, -1) : sm[2]
  const p2 = parseHead(headStr)
  const node = mk({
    kind,
    textExpr: p2.text !== undefined ? p2.text : undefined,
    headProps: p2.props,
    hasBlock: sm[2].endsWith(':'),
  })
  // add：首个 token 是显示对象表达式（Solid / 图片 / Transform / 变量）
  if (kind === 'add' && headStr.trim() !== '') {
    const toks = tokenize(headStr)
    if (toks.length && !PROP_NAMES.has(toks[0])) {
      node.headProps.set('__disp', toks[0])
    }
  }
  // 动态文本（text "/ " + title）→ 追加占位
  if (kind === 'text' && p2.dyn) {
    node.textExpr = (p2.text ?? '') + '…'
  }
  return node
}

// ==================== 渲染环境 / 值解析 ====================

export interface RenderEnv {
  /** screens.rpy 全文（use 内联需要） */
  src: string
  /** gui.rpy define 表 */
  defines: Map<string, GuiDefine>
  /** screens.rpy 全部 style 块（缺省时从 src 自动解析） */
  allStyles?: Map<string, AllStyleBlock>
  /** 具名 transform 块（transform NAME: xalign …） */
  transforms?: Map<string, Map<string, string>>
  /** 已知图片自然尺寸（game/ 相对路径） */
  imgSizes: Map<string, { w: number; h: number }>
  previewW: number
  previewH: number
  /** 当前是否处于标题菜单（main_menu 变量） */
  isMainMenu: boolean
}

interface Ctx {
  /** renderScreenElements 内部已填充 allStyles/transforms（必填），但 RenderEnv 对外声明为可选 */
  env: RenderEnv & {
    allStyles: Map<string, AllStyleBlock>
    transforms: Map<string, Map<string, string>>
  }
  vars: Map<string, string>
  prefix: string
  used: Set<string>
  cnt: number
  /** 渲染 key 前缀：以 screen 名区分，避免多个 screen 的渲染结果合并时 key 冲突，
   *  导致 React 调和出错、切换界面后旧元素残留（如对话文本滞留在其他页面） */
  keyPrefix: string
  groupRotate: number
  groupZoom: number
  /** 脚本容器栈：进入 vbox/hbox/fixed 布局时压栈，子元素挂到栈顶容器 */
  containerStack: Array<{ id: string; kind: 'vbox' | 'hbox' | 'fixed' }>
  /** 容器记录（id → 信息） */
  containerMap: Map<string, ScriptContainer>
}

const unquote = (s: string): string => {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}

/** 解析具名 transform 块（简单属性行），供 at NAME 使用 */
export function parseTransformDefs(src: string): Map<string, Map<string, string>> {
  const map = new Map<string, Map<string, string>>()
  const lines = src.split(/\r?\n/)
  let cur: Map<string, string> | null = null
  let curIndent = -1
  for (let i = 0; i < lines.length; i++) {
    const tm = /^transform\s+([\w]+)\s*:\s*$/.exec(lines[i])
    if (tm) {
      cur = new Map()
      map.set(tm[1], cur)
      curIndent = -1
      continue
    }
    if (!cur) continue
    const ln = lines[i]
    if (ln.trim() === '') continue
    const indent = ln.match(/^\s*/)![0].length
    if (curIndent < 0) curIndent = indent
    if (indent < curIndent) {
      cur = null
      continue
    }
    const pm = /^\s*([a-z_][a-z0-9_]*)\s+(.+?)\s*$/.exec(ln)
    if (pm && PROP_NAMES.has(pm[1]) && pm[1] !== 'at') cur.set(pm[1], pm[2].trim())
  }
  return map
}

function resolveExpr(expr: string | undefined, ctx: Ctx): number | string | boolean | null {
  if (!expr) return null
  const t = expr.trim()
  if (t === 'None' || t === '') return null
  if (t === 'True') return true
  if (t === 'False') return false
  const q = /^_?["']([^"']*)["']$/.exec(t)
  if (q) return q[1]
  const n = Number(t)
  if (t !== '' && Number.isFinite(n)) return n
  if (t.startsWith('gui.')) {
    const d = ctx.env.defines.get(t.slice(4).trim())
    if (d) {
      const v = resolveValue(ctx.env.defines, d.raw)
      const n2 = Number(v)
      return Number.isFinite(n2) ? n2 : v
    }
    return null
  }
  if (ctx.vars.has(t)) {
    const v = ctx.vars.get(t)!
    const n3 = Number(v)
    if (Number.isFinite(n3) && /^[\d.]+$/.test(v)) return n3
    return v
  }
  return null
}

function resolveNum(expr: string | undefined, ctx: Ctx, fallback: number): number {
  const v = resolveExpr(expr, ctx)
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function guiNum(ctx: Ctx, key: string, fallback: number): number {
  const d = ctx.env.defines.get(key)
  if (d) {
    const n = Number(resolveValue(ctx.env.defines, d.raw))
    if (Number.isFinite(n)) return n
  }
  return fallback
}

function guiStr(ctx: Ctx, key: string, fallback: string): string {
  const d = ctx.env.defines.get(key)
  return d ? resolveValue(ctx.env.defines, d.raw) : fallback
}

/** 从显示对象表达式提取颜色（Solid("#fff", …)） */
function solidColor(expr: string): string | null {
  const m = /Solid\(\s*["']([^"']+)["']/.exec(expr)
  return m ? m[1] : null
}

/** 从显示对象表达式提取图片路径（"path" / Image(…) / Frame(…) / gui.xxx 定义 / 变量） */
function imagePathOf(expr: string, ctx: Ctx): string | null {
  const t = expr.trim()
  if (!t || /^(Solid|Function|Null|SideImage|StaticValue|Variable|renpy\.)/.test(t)) return null
  const q = /["']([^"']+)["']/.exec(t)
  if (q) return q[1]
  // gui.xxx 引用（如 gui.main_menu_background → gui/main_menu.png）：经 define 解析后再取图片路径
  if (t.startsWith('gui.')) {
    const v = resolveExpr(t, ctx)
    if (typeof v === 'string' && v !== '') return imagePathOf(v, ctx) ?? v
    return null
  }
  const key = t.split('(')[0].trim()
  if (ctx.vars.has(t)) return imagePathOf(ctx.vars.get(t)!, ctx)
  if (ctx.vars.has(key)) return imagePathOf(ctx.vars.get(key)!, ctx)
  return null
}

/** 解析 at 表达式中的 Transform(zoom=…, rotate=…, size=(w,h), fit=…) */
function parseTransformOf(atExpr: string | undefined, ctx: Ctx): { zoom: number; rotate: number; fit?: string; size?: { w: number; h: number } } {
  const out = { zoom: 1, rotate: 0, fit: undefined as string | undefined, size: undefined as { w: number; h: number } | undefined }
  if (!atExpr) return out
  const tm = /Transform\(([^)]*)\)/.exec(atExpr)
  if (tm) {
    for (const pm of tm[1].matchAll(/([a-z_]+)\s*=\s*([^,)]+)/g)) {
      const val = pm[2].trim()
      if (pm[1] === 'zoom') out.zoom = resolveNum(val, ctx, 1)
      else if (pm[1] === 'rotate') out.rotate = resolveNum(val, ctx, 0)
      else if (pm[1] === 'fit') out.fit = val.replace(/["']/g, '')
      else if (pm[1] === 'size') {
        const sm = /\((\d+)\s*,\s*(\d+)\)/.exec(val)
        if (sm) out.size = { w: Number(sm[1]), h: Number(sm[2]) }
      }
    }
  }
  return out
}

/** 具名 transform 属性（at main_menu_logo_transform） */
function namedTransformProps(atExpr: string | undefined, ctx: Ctx): Map<string, string> {
  const out = new Map<string, string>()
  if (!atExpr) return out
  for (const m of atExpr.matchAll(/\b([\w]+)\b/g)) {
    const props = ctx.env.transforms?.get(m[1])
    if (props) for (const [k, v] of props) if (!out.has(k)) out.set(k, v)
  }
  return out
}

// ==================== 条件求值 ====================

const KNOWN_TRUE = new Set([
  'True', 'quick_menu', 'renpy.variant("pc")', 'renpy.variant("web")',
])
const KNOWN_FALSE = new Set([
  'False', 'wordbook_notify', 'in_extra_chapter', 'current_extra_id', '_in_replay',
  'renpy.variant("small")', 'renpy.variant("mobile")',
])

function evalCond(cond: string, ctx: Ctx): boolean {
  const c = cond.trim()
  if (KNOWN_TRUE.has(c)) return true
  if (KNOWN_FALSE.has(c)) return false
  if (c === 'main_menu') return ctx.env.isMainMenu
  if (c === 'home_bg') return false // 函数赋值结果未知 → 走含具体图片的 else 分支
  if (c.startsWith('not ')) return !evalCond(c.slice(4), ctx)
  if (/renpy\.variant\("pc"\)\s+or\s+renpy\.variant\("web"\)/.test(c)) return true
  if (/renpy\.variant\("web"\)\s+and\s+not\s+renpy\.variant\("mobile"\)/.test(c)) return true
  if (/is not None$/.test(c)) return true
  if (/ is None$/.test(c)) return false
  const cm = /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(c)
  if (cm) {
    const l = resolveExpr(cm[1].trim(), ctx)
    const r = resolveExpr(cm[3].trim(), ctx)
    if (typeof l === 'number' && typeof r === 'number') {
      switch (cm[2]) {
        case '==': return l === r
        case '!=': return l !== r
        case '>': return l > r
        case '<': return l < r
        case '>=': return l >= r
        case '<=': return l <= r
      }
    }
    if (typeof l === 'string' && typeof r === 'string' && (cm[2] === '==' || cm[2] === '!=')) {
      return cm[2] === '==' ? l === r : l !== r
    }
    return true // 无法静态求值 → 取首分支
  }
  if (ctx.vars.has(c)) {
    const v = ctx.vars.get(c)!
    return !v.includes('(') // 函数调用结果未知 → 取 else 分支
  }
  return true
}

/** 求值 if/elif/else 链，返回命中的子节点列表 */
function conditionalChildren(node: SNode, ctx: Ctx): SNode[] {
  const out: SNode[] = []
  const kids = node.children
  let i = 0
  while (i < kids.length) {
    const c = kids[i]
    if (c.kind === 'if') {
      let branch: SNode | null = null
      let j = i
      while (j < kids.length && (kids[j].kind === 'if' || kids[j].kind === 'elif' || kids[j].kind === 'else')) {
        const b = kids[j]
        if (!branch && (b.kind === 'else' || evalCond(b.cond ?? 'True', ctx))) branch = b
        j++
      }
      if (branch) out.push(...conditionalChildren(branch, ctx))
      i = j
      continue
    }
    out.push(c)
    i++
  }
  return out
}

// ==================== use 内联 ====================

/** 递归替换 transclude 槽位（可能嵌套在 if/viewport 内） */
function fillTranscludes(nodes: SNode[], fill: SNode[]): SNode[] {
  const out: SNode[] = []
  for (const n of nodes) {
    if (n.kind === 'transclude') {
      out.push(...fill)
      continue
    }
    if (n.hasBlock) n.children = fillTranscludes(n.children, fill)
    out.push(n)
  }
  return out
}

/** 递归展开 use 节点（transclude 槽位填充），返回替换后的节点列表 */
function inlineNode(node: SNode, ctx: Ctx): SNode[] {
  if (node.kind !== 'use') return [node]
  const name = node.useName!
  if (ctx.used.has(name) || !ctx.env.src) return []
  const tree = parseScreenTree(ctx.env.src, name)
  if (!tree) return []
  ctx.used.add(name)
  const kids: SNode[] = []
  for (const c of tree.children) kids.push(...inlineNode(c, ctx))
  ctx.used.delete(name)
  const blockKids: SNode[] = []
  for (const c of node.children) blockKids.push(...inlineNode(c, ctx))
  const inlined = fillTranscludes(kids, blockKids)
  // navigation 内联 → 标记首个容器为 nav（固定元素）
  if (name === 'navigation') {
    const first = inlined.find((k) => k.kind === 'vbox' || k.kind === 'hbox' || k.kind === 'fixed' || k.kind === 'frame')
    if (first) first.blockProps.set('__fixed', 'nav')
  }
  return inlined
}

// ==================== 样式解析 ====================

function styleNameOf(node: SNode, ctx: Ctx): string {
  const st = node.headProps.get('style') ?? node.blockProps.get('style')
  if (st) return unquote(st)
  const idProp = node.headProps.get('id') ?? node.blockProps.get('id')
  const id = idProp ? unquote(idProp) : undefined
  if (id === 'what') return 'say_dialogue'
  if (id === 'who') return 'say_label'
  if (id === 'window' || id === 'namebox') return id
  const p = ctx.prefix ? ctx.prefix + '_' : ''
  switch (node.kind) {
    case 'text': return p + 'text'
    case 'label': return p + 'label'
    case 'textbutton':
    case 'button':
    case 'imagebutton': return p + 'button'
    case 'input': return p + 'input'
    case 'bar': return p + 'bar'
    case 'vbar': return p + 'vbar'
    default: return p + node.kind
  }
}

/** 供 layout 函数读取的内部键（即使以 __ 开头也不能被过滤） */
const INTERNAL_PROPS = new Set(['__disp', '__textexpr', '__fixed'])

/** 节点的有效属性：style 继承链 ⊕ 块属性 ⊕ 头部属性（后者覆盖前者） */
function effectiveProps(node: SNode, ctx: Ctx): Map<string, string> {
  const out = new Map<string, string>()
  const sp = resolveStyleMap(ctx.env.allStyles, styleNameOf(node, ctx))
  for (const [k, v] of sp) out.set(k, v)
  for (const [k, v] of node.blockProps) if (!k.startsWith('__') || INTERNAL_PROPS.has(k)) out.set(k, v)
  for (const [k, v] of node.headProps) if (!k.startsWith('__') || INTERNAL_PROPS.has(k)) out.set(k, v)
  // pos (x, y) 简写 → 绝对 xpos/ypos（覆盖样式对齐），供容器移动写回后即时生效
  const posRaw = out.get('pos')
  if (posRaw) {
    const pm = /\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*\)/.exec(posRaw)
    if (pm) {
      out.set('xpos', pm[1])
      out.set('ypos', pm[2])
      out.delete('xalign')
      out.delete('yalign')
    }
  }
  return out
}

function fixedIdOf(node: SNode): PreviewElementId | undefined {
  const idProp = node.headProps.get('id') ?? node.blockProps.get('id')
  const id = idProp ? unquote(idProp) : undefined
  if (id === 'window') return 'window'
  if (id === 'namebox') return 'namebox'
  if (id === 'what') return 'dialogue'
  if (id === 'choice') return 'choice'
  const fixed = node.blockProps.get('__fixed')
  if (fixed === 'nav' || fixed === 'quick' || fixed === 'choice') return fixed as PreviewElementId
  return undefined
}

// ==================== 布局 ====================

interface Rect {
  x: number
  y: number
  w: number
  h: number
}

function pushEl(ctx: Ctx, out: RenderedEl[], el: Omit<RenderedEl, 'key' | 'line'>, line?: number): void {
  const key = `${ctx.keyPrefix}-e${ctx.cnt++}`
  // 若当前处于脚本容器内，记录归属并登记为容器子元素
  const top = ctx.containerStack[ctx.containerStack.length - 1]
  if (top) {
    el.containerId = top.id
    ctx.containerMap.get(top.id)?.children.push(key)
  }
  out.push({ key, ...(line !== undefined ? { line } : {}), ...el })
}

/** 文本宽度估算：CJK 全角，其余 0.55 倍 */
function textWidth(text: string, fontSize: number): number {
  let w = 0
  for (const ch of text) {
    w += /[\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F]/.test(ch) ? 1 : 0.55
  }
  return Math.max(12, w * fontSize)
}

function paddingOf(props: Map<string, string>, ctx: Ctx): { l: number; t: number; r: number; b: number } {
  const pad = props.get('padding')
  if (pad) {
    const m = /\(([^)]+)\)/.exec(pad)
    if (m) {
      const nums = m[1].split(',').map((s) => Number(s.trim()))
      const ok = nums.every((n) => Number.isFinite(n))
      if (ok) {
        if (nums.length === 4) return { l: nums[0], t: nums[1], r: nums[2], b: nums[3] }
        if (nums.length === 2) return { l: nums[0], t: nums[1], r: nums[0], b: nums[1] }
        if (nums.length === 1) return { l: nums[0], t: nums[0], r: nums[0], b: nums[0] }
      }
    } else {
      const n = Number(pad)
      if (Number.isFinite(n)) return { l: n, t: n, r: n, b: n }
    }
  }
  const g = (k: string): number => resolveNum(props.get(k), ctx, 0)
  // xpadding/ypadding 是 padding 的快捷写法（如 style page_label 的 xpadding 75）
  const l = g('left_padding') ?? 0
  const r = g('right_padding') ?? 0
  const t = g('top_padding') ?? 0
  const b = g('bottom_padding') ?? 0
  if (l || r || t || b) return { l, t, r, b }
  const xp = g('xpadding')
  const yp = g('ypadding')
  return { l: xp, t: yp, r: xp, b: yp }
}

/** window/frame 的 margin（框外透明留白，计入框尺寸并偏移子元素） */
function marginOf(props: Map<string, string>, ctx: Ctx): { l: number; t: number; r: number; b: number } {
  const g = (k: string): number => resolveNum(props.get(k), ctx, 0)
  return { l: g('left_margin'), t: g('top_margin'), r: g('right_margin'), b: g('bottom_margin') }
}

function explicitSize(props: Map<string, string>, ctx: Ctx): { w?: number; h?: number } {
  const out: { w?: number; h?: number } = {}
  const xs = props.get('xsize') ?? props.get('width')
  if (xs) {
    const v = resolveExpr(xs, ctx)
    if (typeof v === 'number') out.w = v
  }
  const ys = props.get('ysize') ?? props.get('height')
  if (ys) {
    const v = resolveExpr(ys, ctx)
    if (typeof v === 'number') out.h = v
  }
  return out
}

/** 定位：pos(比例→父尺寸) - anchor(比例→自身尺寸) + offset；xalign 同时设置 pos/anchor */
function resolvePos(rect: Rect, size: { w: number; h: number }, props: Map<string, string>, ctx: Ctx, axis: 'x' | 'y'): number {
  const posKey = axis === 'x' ? 'xpos' : 'ypos'
  const anchorKey = axis === 'x' ? 'xanchor' : 'yanchor'
  const alignKey = axis === 'x' ? 'xalign' : 'yalign'
  const offKey = axis === 'x' ? 'xoffset' : 'yoffset'
  const pSize = axis === 'x' ? rect.w : rect.h
  const cSize = axis === 'x' ? size.w : size.h
  let pos = 0
  let anchor = 0
  const al = props.get(alignKey)
  if (al !== undefined) {
    pos = resolveNum(al, ctx, 0)
    anchor = pos
  } else {
    const pv = props.get(posKey)
    if (pv !== undefined) pos = resolveNum(pv, ctx, 0)
    const av = props.get(anchorKey)
    if (av !== undefined) anchor = resolveNum(av, ctx, 0)
  }
  let off = 0
  const ov = props.get(offKey)
  if (ov !== undefined) off = resolveNum(ov, ctx, 0)
  const p = pos >= 0 && pos <= 1 ? pos * pSize : pos
  const a = anchor >= 0 && anchor <= 1 ? anchor * cSize : anchor
  // 以 rect 左上角为基准：flow 容器通过 childRect.x/y 传递游标位置，子元素定位 = 基准 + 自身属性
  return (axis === 'x' ? rect.x : rect.y) + p - a + off
}

const textOf = (node: SNode, ctx: Ctx): string => {
  let t = node.textExpr ?? ''
  if (t === '') {
    const id = node.headProps.get('id') ?? node.blockProps.get('id')
    if (id === '"what"' || id === "'what'") t = '今天也要好好织布呢。'
    else if (id === '"who"' || id === "'who'") t = '铃音'
    else if (node.kind === 'label') t = '标签'
    else t = '文本'
  }
  // 动态变量占位 {chapter_title} 等
  t = t.replace(/\{[\w.]+\}/g, '…')
  // Ren'Py 文本插值 [config.name!t] / [page] → 占位
  t = t.replace(/\[[^\]]*\]/g, '…')
  // 隐藏文本标签 {#auto_page} 等（保留标签后的内容，如 "{#auto_page}A" → "A"）
  t = t.replace(/\{#[\w]+\}/g, '')
  const v = resolveExpr(t, ctx)
  if (typeof v === 'string' && !/\(/.test(v)) return v
  // 未引用的文本表达式（choice 菜单项 i.caption → for 循环变量）
  const texpr = node.headProps.get('__textexpr')
  if (texpr) {
    const cap = /^([\w.]+)\.caption$/.exec(texpr.trim())
    if (cap && ctx.vars.has(cap[1])) return String(ctx.vars.get(cap[1]))
    const v2 = resolveExpr(texpr, ctx)
    // 函数调用/复杂表达式（如 history 的 $ what = renpy.filter_text_tags(...)）→ 占位
    if (typeof v2 === 'string' && !/\(/.test(v2)) return v2
  }
  return t
}

function textFontSize(node: SNode, props: Map<string, string>, ctx: Ctx): number {
  const e = props.get('text_size') ?? props.get('size')
  if (e) {
    const v = resolveExpr(e, ctx)
    if (typeof v === 'number') return v
  }
  // 文本样式链中的 size（如 preferences_label_text）
  const tStyle = styleNameOf(node, ctx)
  const sp = resolveStyleMap(ctx.env.allStyles, tStyle)
  if (sp.has('size')) {
    const v = resolveExpr(sp.get('size'), ctx)
    if (typeof v === 'number') return v
  }
  // label 的字号在 *_label_text（定位在 *_label），单独查一次
  if (node.kind === 'label') {
    const lt = resolveStyleMap(ctx.env.allStyles, tStyle + '_text')
    if (lt.has('size')) {
      const v = resolveExpr(lt.get('size'), ctx)
      if (typeof v === 'number') return v
    }
  }
  return node.kind === 'label' ? guiNum(ctx, 'interface_text_size', guiNum(ctx, 'text_size', 33)) : guiNum(ctx, 'text_size', 33)
}

function colorOf(expr: string | undefined, ctx: Ctx, fallback: string): string {
  if (!expr) return fallback
  const v = resolveExpr(expr, ctx)
  if (typeof v === 'string' && v.startsWith('#')) return v
  if (typeof v === 'string') {
    const named: Record<string, string> = { white: '#ffffff', black: '#000000', gray: '#808080' }
    const k = v.toLowerCase()
    if (named[k]) return named[k]
  }
  return fallback
}

function backgroundOf(props: Map<string, string>, ctx: Ctx): { bg?: string; bgImage?: string; radius?: number } {
  const bg = props.get('background')
  if (!bg || bg === 'None') return {}
  const solid = solidColor(bg)
  if (solid) return { bg: solid, radius: 8 }
  const img = imagePathOf(bg, ctx)
  if (img) return { bgImage: img }
  return {}
}

/** 文本/标签 */
function layoutText(
  node: SNode, rect: Rect, props: Map<string, string>, ctx: Ctx, out: RenderedEl[], fixedId?: PreviewElementId
): { w: number; h: number } {
  const text = textOf(node, ctx)
  const fontSize = textFontSize(node, props, ctx)
  const exp = explicitSize(props, ctx)
  const w = exp.w ?? textWidth(text, fontSize)
  const h = exp.h ?? fontSize * 1.6
  const x = resolvePos(rect, { w, h }, props, ctx, 'x')
  let y = resolvePos(rect, { w, h }, props, ctx, 'y')
  // label 容器高度来自 *_label 样式（如 game_menu_label 的 ysize 180），
  // 文本用 *_label_text 的 yalign 在容器内垂直居中，避免标题贴顶
  if (node.kind === 'label' && h > fontSize * 1.6 + 1) {
    const lt = resolveStyleMap(ctx.env.allStyles, styleNameOf(node, ctx) + '_text')
    const ya = resolveNum(lt.get('yalign'), ctx, 0)
    if (ya > 0) y = y + (h - fontSize * 1.6) * ya
  }
  const alignProp = resolveNum(props.get('text_align'), ctx, 0)
  const ta = props.get('text_align')
  if (ta && alignProp === 0) void 0 // noop 保持行内逻辑简单
  const align = alignProp > 0.7 ? 'right' : alignProp < 0.3 ? 'left' : 'center'
  const fallbackColor = node.kind === 'label' ? guiStr(ctx, 'accent_color', '#ffe4a6') : guiStr(ctx, 'text_color', '#ffffff')
  pushEl(ctx, out, {
    kind: 'text', x, y, w, h, text, id: fixedId,
    color: colorOf(props.get('color') ?? props.get('text_color'), ctx, fallbackColor),
    fontSize,
    fontFamily: props.get('font') ? unquote(props.get('font')!) : undefined,
    bold: props.get('bold') === 'True' || props.get('bold') === 'true',
    align,
    rotate: ctx.groupRotate !== 0 ? ctx.groupRotate : undefined,
  }, node.line)
  return { w, h }
}

/** 按钮（textbutton / button） */
function layoutButton(
  node: SNode, rect: Rect, props: Map<string, string>, ctx: Ctx, out: RenderedEl[], fixedId?: PreviewElementId
): { w: number; h: number } {
  const text = textOf(node, ctx)
  const fontSize = ((): number => {
    const e = props.get('text_size')
    if (e) {
      const v = resolveExpr(e, ctx)
      if (typeof v === 'number') return v
    }
    // 按钮文本样式链（navigation_button_text / choice_button_text…）
    const btnStyle = styleNameOf(node, ctx)
    const tStyle = resolveStyleMap(ctx.env.allStyles, btnStyle + '_text')
    if (tStyle.has('size')) {
      const v = resolveExpr(tStyle.get('size'), ctx)
      if (typeof v === 'number') return v
    }
    return guiNum(ctx, 'text_size', 33)
  })()
  const exp = explicitSize(props, ctx)
  const pad = paddingOf(props, ctx)
  // 测量子元素（如 page_label 内的 input、slot 内的 vbox）→ 按钮包住内容
  let cw = 0
  let ch = 0
  const savedP = ctx.prefix
  for (const c of conditionalChildren(node, ctx)) {
    if (c.kind === 'style_prefix') { ctx.prefix = c.textExpr ?? ''; continue }
    const m = measure(c, ctx)
    cw = Math.max(cw, m.w)
    ch = Math.max(ch, m.h)
  }
  ctx.prefix = savedP
  const textW = text ? textWidth(text, fontSize) + 40 : 200
  const w = exp.w ?? Math.max(textW, cw + pad.l + pad.r)
  const h = exp.h ?? Math.max(fontSize * 2, ch + pad.t + pad.b)
  const x = resolvePos(rect, { w, h }, props, ctx, 'x')
  const y = resolvePos(rect, { w, h }, props, ctx, 'y')
  const bg = backgroundOf(props, ctx)
  pushEl(ctx, out, {
    kind: 'button', x, y, w, h, text, id: fixedId,
    color: colorOf(props.get('text_color') ?? props.get('color'), ctx, guiStr(ctx, 'idle_color', '#888888')),
    fontSize,
    fontFamily: props.get('font') ? unquote(props.get('font')!) : undefined,
    bold: props.get('bold') === 'True',
    bg: bg.bg,
    bgImage: bg.bgImage,
    radius: bg.radius,
    align: 'center',
    rotate: ctx.groupRotate !== 0 ? ctx.groupRotate : undefined,
  }, node.line)
  // 按钮内部子元素（input / vbox 等）以 fixed 布局在 padding 内
  if (node.children.length) {
    const inner: Rect = { x: x + pad.l, y: y + pad.t, w: Math.max(0, w - pad.l - pad.r), h: Math.max(0, h - pad.t - pad.b) }
    const savedP2 = ctx.prefix
    for (const c of conditionalChildren(node, ctx)) {
      if (c.kind === 'style_prefix') { ctx.prefix = c.textExpr ?? ''; continue }
      layoutNode(c, inner, ctx, out, false)
    }
    ctx.prefix = savedP2
  }
  return { w, h }
}

/** 图片按钮（imagebutton） */
function layoutImageButton(
  node: SNode, rect: Rect, props: Map<string, string>, ctx: Ctx, out: RenderedEl[], fixedId?: PreviewElementId
): { w: number; h: number } {
  const image = imagePathOf(props.get('idle') ?? '', ctx)
  if (!image) return { w: 0, h: 0 }
  const nat = ctx.env.imgSizes.get(image) ?? { w: 160, h: 160 }
  const tf = parseTransformOf(props.get('at'), ctx)
  const exp = explicitSize(props, ctx)
  const w = (exp.w ?? nat.w * tf.zoom) * ctx.groupZoom
  const h = (exp.h ?? nat.h * tf.zoom) * ctx.groupZoom
  const x = resolvePos(rect, { w, h }, props, ctx, 'x')
  const y = resolvePos(rect, { w, h }, props, ctx, 'y')
  const rotate = (tf.rotate + ctx.groupRotate) % 360
  pushEl(ctx, out, {
    kind: 'image', x, y, w, h, image, id: fixedId,
    objectFit: 'contain',
    rotate: rotate !== 0 ? rotate : undefined,
    alpha: 1,
  }, node.line)
  return { w, h }
}

/** add 语句（Solid 色块 / 图片 / Transform） */
function layoutAdd(
  node: SNode, rect: Rect, props: Map<string, string>, ctx: Ctx, out: RenderedEl[], fixedId: PreviewElementId | undefined, topLevel: boolean
): { w: number; h: number } {
  const disp = props.get('__disp') ?? ''
  if (!disp) return { w: 0, h: 0 }
  const tf = parseTransformOf(props.get('at'), ctx)
  const named = namedTransformProps(props.get('at'), ctx)
  const exp = explicitSize(props, ctx)
  const solid = solidColor(disp)
  if (solid) {
    const w = exp.w ?? (topLevel ? rect.w : 0)
    const h = exp.h ?? (topLevel ? rect.h : 0)
    const x = resolvePos(rect, { w, h }, props, ctx, 'x')
    const y = resolvePos(rect, { w, h }, props, ctx, 'y')
    const alphaM = /alpha\s*=\s*([\d.]+)/.exec(disp)
    pushEl(ctx, out, {
      kind: 'image', x, y, w, h, bg: solid, id: fixedId,
      alpha: alphaM ? Number(alphaM[1]) : undefined,
      rotate: ctx.groupRotate !== 0 ? ctx.groupRotate : undefined,
    }, node.line)
    return { w, h }
  }
  const image = imagePathOf(disp, ctx)
  if (!image) return { w: 0, h: 0 }
  const nat = ctx.env.imgSizes.get(image)
  const tfSize = tf.size ?? (named.get('fit') ? undefined : undefined)
  const fit = tf.fit ?? (named.has('fit') ? named.get('fit') : undefined)
  let w: number
  let h: number
  if (exp.w !== undefined && exp.h !== undefined) {
    w = exp.w
    h = exp.h
  } else if (tfSize) {
    w = tfSize.w
    h = tfSize.h
  } else if (nat) {
    w = nat.w * tf.zoom
    h = nat.h * tf.zoom
  } else {
    // 未知尺寸（如图片名非文件路径 / 尚未加载）：统一默认尺寸，不随层级变化，
    // 避免解散/提升编组后图片在「容器内 300x300 ↔ 顶层全屏」之间突变导致大小与位置偏移
    w = 300
    h = 300
  }
  w *= ctx.groupZoom
  h *= ctx.groupZoom
  // 具名 transform 的对齐（如 main_menu_logo_transform xalign 0.5）
  const mprops = new Map(props)
  if (named.size) {
    for (const [k, v] of named) if (!mprops.has(k)) mprops.set(k, v)
  }
  const x = resolvePos(rect, { w, h }, mprops, ctx, 'x')
  const y = resolvePos(rect, { w, h }, mprops, ctx, 'y')
  const rotate = (tf.rotate + ctx.groupRotate) % 360
  pushEl(ctx, out, {
    kind: 'image', x, y, w, h, image, id: fixedId,
    objectFit: (fit as 'contain' | 'cover' | 'fill') ?? 'contain',
    rotate: rotate !== 0 ? rotate : undefined,
  }, node.line)
  return { w, h }
}

/** 滑条 */
function layoutBar(
  node: SNode, rect: Rect, props: Map<string, string>, ctx: Ctx, out: RenderedEl[], fixedId?: PreviewElementId
): { w: number; h: number } {
  const vertical = node.kind === 'vbar'
  const barSize = guiNum(ctx, 'bar_size', 38)
  const exp = explicitSize(props, ctx)
  const w = vertical ? (exp.w ?? barSize) : (exp.w ?? 400)
  const h = vertical ? (exp.h ?? 300) : (exp.h ?? barSize)
  const x = resolvePos(rect, { w, h }, props, ctx, 'x')
  const y = resolvePos(rect, { w, h }, props, ctx, 'y')
  pushEl(ctx, out, {
    kind: 'bar', x, y, w, h, id: fixedId, vertical, barFill: 0.5,
    bg: '#3a3a3e', radius: vertical ? 4 : 4,
  }, node.line)
  return { w, h }
}

function layoutInput(
  node: SNode, rect: Rect, props: Map<string, string>, ctx: Ctx, out: RenderedEl[], fixedId?: PreviewElementId
): { w: number; h: number } {
  const exp = explicitSize(props, ctx)
  const w = exp.w ?? 400
  const h = exp.h ?? 50
  const x = resolvePos(rect, { w, h }, props, ctx, 'x')
  const y = resolvePos(rect, { w, h }, props, ctx, 'y')
  pushEl(ctx, out, {
    kind: 'button', x, y, w, h, text: '输入…', id: fixedId,
    color: guiStr(ctx, 'muted_color', '#8a8a8a'),
    fontSize: Math.round(h * 0.5),
    bg: 'rgba(0,0,0,0.25)',
    align: 'left',
  }, node.line)
  return { w, h }
}

/** 测量（只算尺寸，不发射元素；不改动 vars） */
function measure(node: SNode, ctx: Ctx): { w: number; h: number } {
  if (node.kind === '$' || node.kind === 'default' || node.kind === 'prop' || node.kind === 'python' || node.kind === 'style_prefix' || node.kind === 'transclude' || node.kind === 'use') {
    return { w: 0, h: 0 }
  }
  const props = effectiveProps(node, ctx)
  const exp = explicitSize(props, ctx)
  switch (node.kind) {
    case 'null': return { w: exp.w ?? 0, h: exp.h ?? 0 }
    case 'text':
    case 'label': {
      const fontSize = textFontSize(node, props, ctx)
      const text = textOf(node, ctx)
      return { w: exp.w ?? textWidth(text, fontSize), h: exp.h ?? fontSize * 1.6 }
    }
    case 'textbutton':
    case 'button': {
      const text = textOf(node, ctx)
      const e = props.get('text_size')
      const fs = e && typeof resolveExpr(e, ctx) === 'number' ? (resolveExpr(e, ctx) as number) : guiNum(ctx, 'text_size', 33)
      const pad = paddingOf(props, ctx)
      // 与 layoutButton 一致：测量子元素（如 page_label 内的 input、slot 内的 vbox）
      let cw = 0
      let ch = 0
      const savedP = ctx.prefix
      for (const c of conditionalChildren(node, ctx)) {
        if (c.kind === 'style_prefix') { ctx.prefix = c.textExpr ?? ''; continue }
        const m = measure(c, ctx)
        cw = Math.max(cw, m.w)
        ch = Math.max(ch, m.h)
      }
      ctx.prefix = savedP
      return {
        w: exp.w ?? Math.max(text ? textWidth(text, fs) + 40 : 200, cw + pad.l + pad.r),
        h: exp.h ?? Math.max(fs * 2, ch + pad.t + pad.b),
      }
    }
    case 'imagebutton': {
      const image = imagePathOf(props.get('idle') ?? '', ctx)
      const nat = image ? ctx.env.imgSizes.get(image) ?? { w: 160, h: 160 } : { w: 160, h: 160 }
      const tf = parseTransformOf(props.get('at'), ctx)
      return { w: (exp.w ?? nat.w * tf.zoom) * ctx.groupZoom, h: (exp.h ?? nat.h * tf.zoom) * ctx.groupZoom }
    }
    case 'add': {
      const disp = props.get('__disp') ?? ''
      const tf = parseTransformOf(props.get('at'), ctx)
      const expW = exp.w ?? (tf.size ? tf.size.w : undefined)
      const expH = exp.h ?? (tf.size ? tf.size.h : undefined)
      if (solidColor(disp)) return { w: expW ?? 0, h: expH ?? 0 }
      const image = imagePathOf(disp, ctx)
      if (image) {
        const nat = ctx.env.imgSizes.get(image)
        return {
          w: (expW ?? nat?.w ?? 300) * ctx.groupZoom,
          h: (expH ?? nat?.h ?? 300) * ctx.groupZoom,
        }
      }
      return { w: 0, h: 0 }
    }
    case 'bar':
    case 'vbar': {
      const vertical = node.kind === 'vbar'
      const barSize = guiNum(ctx, 'bar_size', 38)
      return vertical
        ? { w: exp.w ?? barSize, h: exp.h ?? 300 }
        : { w: exp.w ?? 400, h: exp.h ?? barSize }
    }
    case 'input': return { w: exp.w ?? 400, h: exp.h ?? 50 }
    default: {
      const isFlow = node.kind === 'vbox' || node.kind === 'hbox' || node.kind === 'grid' || node.kind === 'vpgrid'
      const pad = paddingOf(props, ctx)
      const margin = marginOf(props, ctx)
      if (isFlow) {
        const horizontal = node.kind === 'hbox'
        const spacing = resolveNum(props.get('spacing'), ctx, 0)
        let cw = 0
        let ch = 0
        let n = 0
        const acc = (m: { w: number; h: number }): void => {
          if (horizontal) { cw += m.w; ch = Math.max(ch, m.h) } else { cw = Math.max(cw, m.w); ch += m.h }
          n++
        }
        for (const c of conditionalChildren(node, ctx)) {
          if (c.kind === 'for') {
            // 与 layoutBox 的模拟一致：for 展开 2 次
            for (let k = 0; k < 2; k++) for (const cc of c.children) acc(measure(cc, ctx))
            continue
          }
          acc(measure(c, ctx))
        }
        const gap = Math.max(0, n - 1) * spacing
        return {
          w: exp.w ?? cw + (horizontal ? gap : 0) + pad.l + pad.r + margin.l + margin.r,
          h: exp.h ?? ch + (horizontal ? 0 : gap) + pad.t + pad.b + margin.t + margin.b,
        }
      }
      if (exp.w !== undefined && exp.h !== undefined) return { w: exp.w, h: exp.h }
      let cw = 0
      let ch = 0
      for (const c of conditionalChildren(node, ctx)) {
        if (c.kind === 'for') continue
        const m = measure(c, ctx)
        cw = Math.max(cw, m.w)
        ch = Math.max(ch, m.h)
      }
      return { w: exp.w ?? cw + margin.l + margin.r, h: exp.h ?? ch + margin.t + margin.b }
    }
  }
}

/** 布局容器（vbox/hbox/fixed/frame/window/side/viewport/grid/vpgrid） */
function layoutBox(
  node: SNode, rect: Rect, ctx: Ctx, out: RenderedEl[], topLevel: boolean
): { w: number; h: number } {
  const props = effectiveProps(node, ctx)
  const isFlow = node.kind === 'vbox' || node.kind === 'hbox' || node.kind === 'grid' || node.kind === 'vpgrid'
  const pad = paddingOf(props, ctx)
  const margin = marginOf(props, ctx)
  const exp = explicitSize(props, ctx)
  const fixedId = fixedIdOf(node)
  const tf = parseTransformOf(props.get('at'), ctx)
  const named = namedTransformProps(props.get('at'), ctx)
  // 具名 transform 属性并入（logo 居中之类）
  if (named.size) for (const [k, v] of named) if (!props.has(k)) props.set(k, v)
  const groupRotate = (ctx.groupRotate + tf.rotate) % 360
  const groupZoom = ctx.groupZoom * tf.zoom

  // 内容尺寸（先测量）
  const kids = conditionalChildren(node, ctx)
  let contentW = 0
  let contentH = 0
  let kidCount = 0
  if (isFlow) {
    // hbox：宽 = 子宽度之和，高 = 最大子高；vbox/grid：宽 = 最大子宽，高 = 子高之和（Ren'Py 盒布局语义）
    const horizontal = node.kind === 'hbox'
    const spacing = resolveNum(props.get('spacing'), ctx, 0)
    const savedP = ctx.prefix
    for (const kid of kids) {
      if (kid.kind === 'style_prefix') { ctx.prefix = kid.textExpr ?? ''; continue }
      if (kid.kind === 'for') {
        // 与 layoutBox flow 布局一致：设置循环变量、for 展开 2 次（保证测量宽度与布局一致）
        const mm = /^([\w,\s]+)\s+in\s+(.+)$/.exec(kid.cond ?? '')
        const names = mm ? mm[1].split(',').map((s) => s.trim()) : []
        const saved2 = new Map<string, string | undefined>()
        for (const nm of names) saved2.set(nm, ctx.vars.get(nm))
        const labels = ['「嗯，开始吧」', '「再等等吧…」']
        for (let k = 0; k < 2; k++) {
          names.forEach((nm, i) => {
            if (i === 0) ctx.vars.set(nm, labels[k])
            else ctx.vars.set(nm, String(k))
          })
          for (const cc of kid.children) {
            if (cc.kind === '$') continue
            const m = measure(cc, ctx)
            if (horizontal) { contentW += m.w; contentH = Math.max(contentH, m.h) } else { contentW = Math.max(contentW, m.w); contentH += m.h }
            kidCount++
          }
        }
        for (const nm of names) {
          const v = saved2.get(nm)
          if (v === undefined) ctx.vars.delete(nm)
          else ctx.vars.set(nm, v)
        }
        continue
      }
      const m = measure(kid, ctx)
      if (horizontal) { contentW += m.w; contentH = Math.max(contentH, m.h) } else { contentW = Math.max(contentW, m.w); contentH += m.h }
      kidCount++
    }
    ctx.prefix = savedP
    const gap = Math.max(0, kidCount - 1) * spacing
    contentW = contentW + (horizontal ? gap : 0) + pad.l + pad.r + margin.l + margin.r
    contentH = contentH + (horizontal ? 0 : gap) + pad.t + pad.b + margin.t + margin.b
  } else {
    let cw = 0
    let ch = 0
    const savedP = ctx.prefix
    for (const kid of kids) {
      if (kid.kind === 'style_prefix') { ctx.prefix = kid.textExpr ?? ''; continue }
      if (kid.kind === 'for') continue
      const m = measure(kid, ctx)
      cw = Math.max(cw, m.w)
      ch = Math.max(ch, m.h)
    }
    ctx.prefix = savedP
    contentW = cw + pad.l + pad.r + margin.l + margin.r
    contentH = ch + pad.t + pad.b + margin.t + margin.b
  }

  const xfill = props.get('xfill') === 'True'
  const yfill = props.get('yfill') === 'True'
  // 容器背景元素（frame/window/带背景/固定元素）
  const bg = backgroundOf(props, ctx)
  // 顶层 frame/window 带背景 → 铺满整个屏幕（Ren'Py 中 game_menu 的遮罩盖满全屏）
  const hasBg = node.kind === 'frame' || node.kind === 'window' || bg.bg !== undefined || bg.bgImage !== undefined
  const w = exp.w ?? (topLevel && hasBg ? rect.w : (xfill ? rect.w : contentW))
  const h = exp.h ?? (topLevel && hasBg ? rect.h : (yfill ? rect.h : contentH))
  const x = resolvePos(rect, { w, h }, props, ctx, 'x')
  const y = resolvePos(rect, { w, h }, props, ctx, 'y')
  const emitBox = hasBg || fixedId !== undefined
  if (emitBox) {
    pushEl(ctx, out, {
      kind: 'box', x, y, w, h, id: fixedId,
      bg: bg.bg,
      bgImage: bg.bgImage,
      radius: bg.radius,
    }, node.line)
  }

  // 脚本容器登记（vbox/hbox/fixed）：子元素布局期间压栈，作为两级选中的编组单元
  const isScriptGroup = node.kind === 'vbox' || node.kind === 'hbox' || node.kind === 'fixed'
  const groupId = isScriptGroup ? `sc-${node.line}` : null
  if (groupId) {
    const parent = ctx.containerStack[ctx.containerStack.length - 1]
    ctx.containerStack.push({ id: groupId, kind: node.kind as 'vbox' | 'hbox' | 'fixed' })
    ctx.containerMap.set(groupId, {
      id: groupId,
      kind: node.kind as 'vbox' | 'hbox' | 'fixed',
      x,
      y,
      w: 0,
      h: 0,
      padL: pad.l,
      padT: pad.t,
      spacing: isFlow ? resolveNum(props.get('spacing'), ctx, 0) : 0,
      parentKind: parent?.kind,
      parentId: parent?.id,
      children: [],
    })
  }

  // 子元素布局
  const tmp: RenderedEl[] = []
  const innerW = Math.max(0, w - pad.l - pad.r - margin.l - margin.r)
  const innerH = Math.max(0, h - pad.t - pad.b - margin.t - margin.b)
  const prevRotate = ctx.groupRotate
  const prevZoom = ctx.groupZoom
  ctx.groupRotate = groupRotate
  ctx.groupZoom = groupZoom
  if (isFlow) {
    const vertical = node.kind !== 'hbox'
    const spacing = resolveNum(props.get('spacing'), ctx, 0)
    const childRect: Rect = { x: 0, y: 0, w: innerW, h: innerH }
    let cursor = 0
    const savedP = ctx.prefix
    for (const kid of kids) {
      if (kid.kind === 'for') {
        const mm = /^([\w,\s]+)\s+in\s+(.+)$/.exec(kid.cond ?? '')
        const names = mm ? mm[1].split(',').map((s) => s.trim()) : []
        const saved = new Map<string, string | undefined>()
        for (const nm of names) saved.set(nm, ctx.vars.get(nm))
        const labels = ['「嗯，开始吧」', '「再等等吧…」']
        for (let k = 0; k < 2; k++) {
          names.forEach((nm, i) => {
            if (i === 0) ctx.vars.set(nm, labels[k])
            else ctx.vars.set(nm, String(k))
          })
          for (const cc of kid.children) {
            if (cc.kind === '$') {
              const eq = /^([\w.]+)\s*=\s*(.*)$/.exec(cc.textExpr ?? '')
              if (eq) ctx.vars.set(eq[1].trim(), eq[2].trim())
              continue
            }
            // 先定位到游标处，再布局（否则子元素全部叠在容器原点）
            if (vertical) childRect.y = cursor
            else childRect.x = cursor
            const geom = layoutNode(cc, childRect, ctx, tmp, false)
            if (geom) cursor += (vertical ? geom.h : geom.w) + spacing
          }
        }
        for (const nm of names) {
          const v = saved.get(nm)
          if (v === undefined) ctx.vars.delete(nm)
          else ctx.vars.set(nm, v)
        }
        continue
      }
      // 先定位到游标处，再布局（否则子元素全部叠在容器原点）
      if (vertical) childRect.y = cursor
      else childRect.x = cursor
      const geom = layoutNode(kid, childRect, ctx, tmp, false)
      if (geom) cursor += (vertical ? geom.h : geom.w) + spacing
    }
    ctx.prefix = savedP
  } else {
    const childRect: Rect = { x: 0, y: 0, w: innerW, h: innerH }
    const savedP = ctx.prefix
    for (const kid of kids) {
      if (kid.kind === 'for') continue
      layoutNode(kid, childRect, ctx, tmp, false)
    }
    ctx.prefix = savedP
  }
  ctx.groupRotate = prevRotate
  ctx.groupZoom = prevZoom
  if (groupId) ctx.containerStack.pop()

  // 平移子元素到容器绝对位置（padding + margin 共同偏移）
  const ox = x + pad.l + margin.l
  const oy = y + pad.t + margin.t
  for (const el of tmp) {
    el.x += ox
    el.y += oy
    out.push(el)
  }
  return { w, h }
}

/** 布局单个显示语句 */
function layoutNode(
  node: SNode, rect: Rect, ctx: Ctx, out: RenderedEl[], topLevel: boolean
): { w: number; h: number } | null {
  if (node.kind === '$' || node.kind === 'default') {
    const eq = /^([\w.]+)\s*=\s*(.*)$/.exec(node.textExpr ?? '')
    if (eq) ctx.vars.set(eq[1].trim(), eq[2].trim())
    return null
  }
  if (node.kind === 'python' || node.kind === 'prop') return null
  if (node.kind === 'style_prefix') {
    // 块级 style_prefix：设置块内默认样式前缀（use 内联后也会走到这里）
    ctx.prefix = node.textExpr ?? ''
    return null
  }
  if (node.kind === 'use') {
    // use 已内联（理论上不会到这里）
    return null
  }
  const IS_BOX = node.kind === 'vbox' || node.kind === 'hbox' || node.kind === 'fixed' || node.kind === 'frame' ||
    node.kind === 'window' || node.kind === 'side' || node.kind === 'viewport' || node.kind === 'grid' || node.kind === 'vpgrid'
  if (IS_BOX) return layoutBox(node, rect, ctx, out, topLevel)
  const props = effectiveProps(node, ctx)
  const fixedId = fixedIdOf(node)
  switch (node.kind) {
    case 'null': {
      const exp = explicitSize(props, ctx)
      return { w: exp.w ?? 0, h: exp.h ?? 0 }
    }
    case 'text':
    case 'label': return layoutText(node, rect, props, ctx, out, fixedId)
    case 'textbutton':
    case 'button': return layoutButton(node, rect, props, ctx, out, fixedId)
    case 'imagebutton': return layoutImageButton(node, rect, props, ctx, out, fixedId)
    case 'add': return layoutAdd(node, rect, props, ctx, out, fixedId, topLevel)
    case 'bar':
    case 'vbar': return layoutBar(node, rect, props, ctx, out, fixedId)
    case 'input': return layoutInput(node, rect, props, ctx, out, fixedId)
    default: return null
  }
}

/** 渲染一个 screen 为绝对定位元素（顶层导出） */
export function renderScreenElements(
  src: string,
  screenName: string,
  env: RenderEnv
): { els: RenderedEl[]; containers: ScriptContainer[] } {
  const root = parseScreenTree(src, screenName)
  if (!root) return { els: [], containers: [] }
  // 从 src 直接解析样式与具名 transform（调用方可覆盖），保证渲染器自包含。
  // 显式填充 allStyles/transforms 为非空，满足 Ctx.env 的必填要求。
  const fullEnv = {
    ...env,
    allStyles: env.allStyles ?? parseAllStyles(src),
    transforms: env.transforms ?? parseTransformDefs(src),
  }
  const out: RenderedEl[] = []
  const ctx: Ctx = {
    env: fullEnv,
    vars: new Map(),
    prefix: '',
    used: new Set(),
    cnt: 0,
    keyPrefix: screenName,
    groupRotate: 0,
    groupZoom: 1,
    containerStack: [],
    containerMap: new Map(),
  }
  const screenRect: Rect = { x: 0, y: 0, w: env.previewW, h: env.previewH }

  // choice 屏幕：标记根 vbox 为固定元素 choice
  if (screenName === 'choice') {
    const vbox = root.children.find((c) => c.kind === 'vbox' || c.kind === 'hbox')
    if (vbox) vbox.blockProps.set('__fixed', 'choice')
  }

  // 逐条处理顶层语句（use 内联 / 条件 / 变量）
  const topKids: SNode[] = []
  for (const c of root.children) {
    if (c.kind === 'style_prefix') {
      ctx.prefix = c.textExpr ?? ''
      continue
    }
    if (c.kind === '$' || c.kind === 'default') {
      const eq = /^([\w.]+)\s*=\s*(.*)$/.exec(c.textExpr ?? '')
      if (eq) ctx.vars.set(eq[1].trim(), eq[2].trim())
      continue
    }
    if (c.kind === 'python') continue
    topKids.push(...inlineNode(c, ctx))
  }
  for (const c of conditionalChildren({ ...root, children: topKids }, ctx)) {
    if (c.kind === 'for') {
      const mm = /^([\w,\s]+)\s+in\s+(.+)$/.exec(c.cond ?? '')
      const names = mm ? mm[1].split(',').map((s) => s.trim()) : []
      const labels = ['「嗯，开始吧」', '「再等等吧…」']
      for (let k = 0; k < 2; k++) {
        names.forEach((nm, i) => {
          if (i === 0) ctx.vars.set(nm, labels[k])
          else ctx.vars.set(nm, String(k))
        })
        for (const cc of c.children) layoutNode(cc, screenRect, ctx, out, true)
      }
      continue
    }
    layoutNode(c, screenRect, ctx, out, true)
  }

  // quick_menu 屏幕：包裹一个全屏 box 作为固定元素 quick（供选中/定位）
  if (screenName === 'quick_menu' && out.length) {
    pushEl(ctx, out, {
      kind: 'box', x: 0, y: 0, w: env.previewW, h: env.previewH, id: 'quick', bg: 'rgba(0,0,0,0)',
    })
  }
  // 除固定/全屏占位外，其余可见元素均可选中（编组内组件）
  for (const el of out) {
    if (el.id === 'quick') continue
    el.sel = true
  }
  // 仅返回有可见子元素的容器（空容器无意义，也不渲染覆盖层）。
  // 先做「后代合并」：纯容器嵌套的外层容器没有直接叶子元素（children 为空），
  // 若直接过滤会导致它消失、parentId 链断裂（嵌套场景下钻选中单个控件失效）。
  // 把后代容器的元素并入父容器后：外层容器可选中、包围盒覆盖全部后代、下钻链完整。
  const allContainers = [...ctx.containerMap.values()]
  const byId = new Map(allContainers.map((c) => [c.id, c]))
  const mergedToParent = new Set<string>()
  let mergedAny = true
  while (mergedAny) {
    mergedAny = false
    for (const c of allContainers) {
      if (mergedToParent.has(c.id) || c.children.length === 0) continue
      const p = c.parentId ? byId.get(c.parentId) : undefined
      if (p) {
        p.children.push(...c.children)
        mergedToParent.add(c.id)
        mergedAny = true
      }
    }
  }
  const containers = allContainers.filter((c) => c.children.length > 0)
  // 容器 x/y 更新为子元素包围盒并集的左上角（画布绝对坐标）：
  // 嵌套容器登记时记录的是父坐标系位置，必须用绝对定位后的子元素推算实际视觉位置，作为拖拽基准
  const keyToEl = new Map(out.map((e) => [e.key, e]))
  for (const c of containers) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const k of c.children) {
      const el = keyToEl.get(k)
      if (el) {
        if (el.x < minX) minX = el.x
        if (el.y < minY) minY = el.y
        if (el.x + el.w > maxX) maxX = el.x + el.w
        if (el.y + el.h > maxY) maxY = el.y + el.h
      }
    }
    if (minX !== Infinity) {
      c.x = minX
      c.y = minY
      c.w = maxX - minX
      c.h = maxY - minY
    }
  }
  return { els: out, containers }
}
