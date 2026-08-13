// 加载项目当前 UI 状态：读取 gui.rpy + screens.rpy，解析成 UiDesignState。
// 也负责把设计结果写回这两个文件（行级保格式替换）。

import type { CustomControl, CustomGroup, UiDesignState } from './types'
import {
  parseGuiDefines,
  resolveValue,
  unquote,
  toNumber,
  normalizeColor,
  defaultState,
  updateDefine,
} from './parseGui'
import {
  parseStyleBlocks,
  updateStyleProp,
  dedupeStyleProps,
  replaceScreenCustomSection,
  parseAllScreenNames,
} from './parseScreens'
import { customStatementsForScreen } from './customControls'

export interface UiSources {
  gui: string
  screens: string
}

/** 从 style 块的 background 值里提取第一个引号路径，如 "gui/textbox.png" */
export function extractImagePath(backgroundValue: string): string {
  const m = /"([^"]+)"/.exec(backgroundValue)
  return m ? m[1] : ''
}

/** 读取项目现有 UI 状态 */
export async function loadUiDesignState(
  projectPath: string
): Promise<{ state: UiDesignState; sources: UiSources }> {
  const def = defaultState()
  let guiSrc = ''
  let screensSrc = ''
  try {
    guiSrc = (await window.pupurin.readFile(projectPath, 'gui.rpy')).replace(/\r\n/g, '\n')
  } catch {
    guiSrc = ''
  }
  try {
    // 统一为 LF：正则（style 属性/define 解析）在 CRLF 行尾下会全部失配，导致布局全乱
    screensSrc = (await window.pupurin.readFile(projectPath, 'screens.rpy')).replace(/\r\n/g, '\n')
  } catch {
    screensSrc = ''
  }

  const defines = parseGuiDefines(guiSrc)
  const res = (key: string, fallback: string): string => {
    const d = defines.get(key)
    return d ? resolveValue(defines, d.raw) : fallback
  }

  const state: UiDesignState = {
    colors: {
      accent: normalizeColor(res('accent_color', def.colors.accent)),
      idle: normalizeColor(res('idle_color', def.colors.idle)),
      hover: normalizeColor(res('hover_color', def.colors.hover)),
      selected: normalizeColor(res('selected_color', def.colors.selected)),
      text: normalizeColor(res('text_color', def.colors.text)),
      muted: normalizeColor(res('muted_color', def.colors.muted)),
    },
    fonts: {
      text: unquote(res('text_font', `"${def.fonts.text}"`)),
      name: unquote(res('name_text_font', `"${def.fonts.name}"`)),
      interface: unquote(res('interface_text_font', `"${def.fonts.interface}"`)),
    },
    sizes: {
      text: toNumber(res('text_size', String(def.sizes.text)), def.sizes.text),
      name: toNumber(res('name_text_size', String(def.sizes.name)), def.sizes.name),
      interface: toNumber(res('interface_text_size', String(def.sizes.interface)), def.sizes.interface),
      quickButton: toNumber(
        res('quick_button_text_size', String(def.sizes.quickButton)),
        def.sizes.quickButton
      ),
      choiceButton: toNumber(
        res('choice_button_text_size', String(def.sizes.choiceButton)),
        def.sizes.choiceButton
      ),
      choiceSpacing: toNumber(
        res('choice_spacing', String(def.sizes.choiceSpacing)),
        def.sizes.choiceSpacing
      ),
    },
    layout: {
      windowYalign: toNumber(res('textbox_yalign', String(def.layout.windowYalign)), def.layout.windowYalign),
      windowHeight: toNumber(res('textbox_height', String(def.layout.windowHeight)), def.layout.windowHeight),
      dialogueX: toNumber(res('dialogue_xpos', String(def.layout.dialogueX)), def.layout.dialogueX),
      dialogueY: toNumber(res('dialogue_ypos', String(def.layout.dialogueY)), def.layout.dialogueY),
      dialogueWidth: toNumber(res('dialogue_width', String(def.layout.dialogueWidth)), def.layout.dialogueWidth),
      dialogueTextXalign: toNumber(
        res('dialogue_text_xalign', String(def.layout.dialogueTextXalign)),
        def.layout.dialogueTextXalign
      ),
      nameboxX: toNumber(res('name_xpos', String(def.layout.nameboxX)), def.layout.nameboxX),
      nameboxY: toNumber(res('name_ypos', String(def.layout.nameboxY)), def.layout.nameboxY),
      nameboxXalign: toNumber(res('name_xalign', String(def.layout.nameboxXalign)), def.layout.nameboxXalign),
      choiceY: def.layout.choiceY,
      choiceXalign: def.layout.choiceXalign,
      choiceWidth: toNumber(res('choice_button_width', String(def.layout.choiceWidth)), def.layout.choiceWidth),
      quickXalign: def.layout.quickXalign,
      quickYalign: def.layout.quickYalign,
      navX: toNumber(res('navigation_xpos', String(def.layout.navX)), def.layout.navX),
      navYalign: def.layout.navYalign,
      // namebox 尺寸可为 None（自适应），None → 0 表示按字号估算
      nameboxWidth: toNumber(res('namebox_width', '0'), 0),
      nameboxHeight: toNumber(res('namebox_height', '0'), 0),
    },
    images: {
      textbox: def.images.textbox,
      namebox: def.images.namebox,
      choiceIdle: def.images.choiceIdle,
      choiceHover: def.images.choiceHover,
      quickIdle: def.images.quickIdle,
      quickHover: def.images.quickHover,
      mainMenu: unquote(res('main_menu_background', `"${def.images.mainMenu}"`)),
      gameMenu: unquote(res('game_menu_background', `"${def.images.gameMenu}"`)),
    },
  }

  // screens.rpy 布局 + 底图
  const blocks = parseStyleBlocks(screensSrc)
  const win = blocks.get('window')
  const winBg = win?.props.find((p) => p.prop === 'background')?.value
  if (winBg) state.images.textbox = extractImagePath(winBg) || def.images.textbox

  const nb = blocks.get('namebox')
  const nbBg = nb?.props.find((p) => p.prop === 'background')?.value
  if (nbBg) state.images.namebox = extractImagePath(nbBg) || def.images.namebox

  const cv = blocks.get('choice_vbox')
  if (cv) {
    const y = cv.props.find((p) => p.prop === 'ypos')?.value
    if (y !== undefined) state.layout.choiceY = toNumber(y, def.layout.choiceY)
    const xa = cv.props.find((p) => p.prop === 'xalign')?.value
    if (xa !== undefined) state.layout.choiceXalign = toNumber(xa, def.layout.choiceXalign)
  }

  const qm = blocks.get('quick_menu')
  if (qm) {
    const xa = qm.props.find((p) => p.prop === 'xalign')?.value
    if (xa !== undefined) state.layout.quickXalign = toNumber(xa, def.layout.quickXalign)
    const ya = qm.props.find((p) => p.prop === 'yalign')?.value
    if (ya !== undefined) state.layout.quickYalign = toNumber(ya, def.layout.quickYalign)
  }

  return { state, sources: { gui: guiSrc, screens: screensSrc } }
}

/** 把设计结果写回 gui.rpy + screens.rpy，返回两个文件的新内容 */
export function serializeUiChanges(
  state: UiDesignState,
  sources: UiSources,
  custom: CustomControl[] = [],
  groups: CustomGroup[] = []
): UiSources {
  const { gui, screens } = sources
  const colors = state.colors
  const fonts = state.fonts
  const sizes = state.sizes
  const layout = state.layout

  // 主题层（gui.rpy define）——值表达式按原格式生成
  let g = gui
  const setColor = (key: string, v: string): void => {
    g = updateDefine(g, key, `'${v}'`)
  }
  const setFont = (key: string, v: string): void => {
    g = updateDefine(g, key, `"${v}"`)
  }
  const setNum = (key: string, v: number): void => {
    g = updateDefine(g, key, String(Math.round(v * 1000) / 1000))
  }

  setColor('accent_color', colors.accent)
  setColor('idle_color', colors.idle)
  setColor('hover_color', colors.hover)
  setColor('selected_color', colors.selected)
  setColor('text_color', colors.text)
  setColor('muted_color', colors.muted)

  setFont('text_font', fonts.text)
  setFont('name_text_font', fonts.name)
  setFont('interface_text_font', fonts.interface)

  setNum('text_size', sizes.text)
  setNum('name_text_size', sizes.name)
  setNum('interface_text_size', sizes.interface)
  setNum('quick_button_text_size', sizes.quickButton)
  setNum('choice_button_text_size', sizes.choiceButton)
  setNum('choice_spacing', sizes.choiceSpacing)

  setNum('textbox_yalign', layout.windowYalign)
  setNum('textbox_height', layout.windowHeight)
  setNum('dialogue_xpos', layout.dialogueX)
  setNum('dialogue_ypos', layout.dialogueY)
  setNum('dialogue_width', layout.dialogueWidth)
  setNum('dialogue_text_xalign', layout.dialogueTextXalign)
  setNum('name_xpos', layout.nameboxX)
  setNum('name_ypos', layout.nameboxY)
  setNum('name_xalign', layout.nameboxXalign)
  setNum('navigation_xpos', layout.navX)

  // 布局层（screens.rpy style 块）
  let s = screens
  s = updateStyleProp(s, 'choice_vbox', 'ypos', String(Math.round(layout.choiceY * 1000) / 1000))
  s = updateStyleProp(s, 'choice_vbox', 'xalign', String(Math.round(layout.choiceXalign * 1000) / 1000))
  s = updateStyleProp(s, 'quick_menu', 'xalign', String(Math.round(layout.quickXalign * 1000) / 1000))
  s = updateStyleProp(s, 'quick_menu', 'yalign', String(Math.round(layout.quickYalign * 1000) / 1000))

  // 自定义控件与编组：写入各 screen 的标记区（覆盖项目全部 screen，含用户新增的）
  if (screens) {
    for (const name of parseAllScreenNames(screens)) {
      s = replaceScreenCustomSection(s, name, customStatementsForScreen(custom, groups, name))
    }
  }

  // 底图写回（textbox / namebox 引号路径替换，保留其余参数）
  if (sources.screens) {
    s = replaceBackgroundImage(s, 'window', state.images.textbox)
    s = replaceBackgroundImage(s, 'namebox', state.images.namebox)
  }
  if (gui) {
    g = updateDefine(g, 'main_menu_background', `"${state.images.mainMenu}"`)
    g = updateDefine(g, 'game_menu_background', `"${state.images.gameMenu}"`)
  }

  // 最终安全网：清理目标 style 块中的重复属性，保证保存结果永远可被 Ren'Py 加载
  s = dedupeStyleProps(s)

  return { gui: g, screens: s }
}

/** 替换 style 块 background 中的第一个引号路径（只改首个同名块，避免误改文件尾部的手机变体） */
function replaceBackgroundImage(src: string, styleName: string, newPath: string): string {
  const lines = src.split(/\r?\n/)
  const re = new RegExp(`^style\\s+${styleName}:\\s*$`)
  let blockStart = -1
  for (let i = 0; i < lines.length; i++) {
    if (re.test(lines[i])) {
      blockStart = i
      break
    }
  }
  if (blockStart < 0) return src
  const out = lines.slice()
  for (let j = blockStart + 1; j < lines.length; j++) {
    const ln = lines[j]
    if (ln.trim() === '') continue
    // 出块：非缩进行（或新的 style 声明）
    if (!/^\s/.test(ln) || /^\s*style\s+/.test(ln)) break
    const pm = /^(\s+)background\s+(.+)$/.exec(ln)
    if (pm) {
      out[j] = `${pm[1]}background ${pm[2].replace(/"[^"]+"/, `"${newPath}"`)}`
      break
    }
  }
  return out.join('\n')
}

// ---------- 脚本容器（vbox/hbox/fixed）写回 ----------

/** 解析脚本容器选中 id `sc-<行号>` → 源码行号（0 基） */
export function scriptGroupLine(id: string): number | null {
  const m = /^sc-(\d+)$/.exec(id)
  return m ? Number(m[1]) : null
}

/** 在容器语句行上写入 `pos (x, y) xanchor 0 yanchor 0`（保留行首缩进与尾部冒号）：
 * 清除旧 pos/对齐/锚点参数，并把锚点固定为左上角——这样写回的 pos 即渲染的视觉左上角，
 * 拖拽到哪就落到哪（容器样式若带 yalign/yanchor，不固定锚点会整体偏移）。 */
export function patchStatementPos(src: string, id: string, x: number, y: number): string {
  const line = scriptGroupLine(id)
  if (line === null) return src
  const lines = src.split(/\r?\n/)
  if (line >= lines.length) return src
  const raw = lines[line]
  const indent = raw.match(/^\s*/)![0]
  let body = raw.slice(indent.length)
  const hasColon = body.trimEnd().endsWith(':')
  let head = hasColon ? body.trimEnd().slice(0, -1) : body.trimEnd()
  head = head
    .replace(/\bpos\s*\([^)]*\)/g, '')
    .replace(/\b(xalign|yalign|xanchor|yanchor)\s+[^\s:]+/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  head = `${head} pos (${x}, ${y}) xanchor 0 yanchor 0`
  lines[line] = `${indent}${head}${hasColon ? ':' : ''}`
  return lines.join('\n')
}

/** 在容器块内添加/替换 `spacing N`（作为块首属性；无则插入到容器语句下一行） */
export function patchContainerSpacing(src: string, id: string, spacing: number): string {
  const line = scriptGroupLine(id)
  if (line === null) return src
  const lines = src.split(/\r?\n/)
  if (line >= lines.length) return src
  const baseIndent = lines[line].match(/^\s*/)![0].length
  const blockIndent = ' '.repeat(baseIndent + 4)
  for (let j = line + 1; j < lines.length; j++) {
    const l = lines[j]
    if (l.trim() === '') continue
    const li = l.match(/^\s*/)![0].length
    if (li <= baseIndent) break
    if (/^\s*spacing\s+/.test(l)) {
      lines[j] = `${blockIndent}spacing ${spacing}`
      return lines.join('\n')
    }
  }
  lines.splice(line + 1, 0, `${blockIndent}spacing ${spacing}`)
  return lines.join('\n')
}

// ---------- 脚本元素行内写回（编组内控件改「其他信息」，不重写整行以免破坏 pos 等属性） ----------

/** 脚本元素可编辑属性的种类（patchStatementProp 的 kind 参数） */
export type ScriptElPropKind = 'text' | 'image' | 'color' | 'size' | 'bold' | 'align'

/** 在指定源码行做行内属性替换/追加；无法定位时返回原 src。
 *  text/image：替换行内首个引号串（text 覆盖显示文本，image 覆盖 add 图片 / imagebutton idle）；
 *  color/size/bold/align：替换同名属性，无则追加到行尾（冒号前）。 */
export function patchStatementProp(src: string, line: number, kind: ScriptElPropKind, value: string): string {
  const lines = src.split(/\r?\n/)
  if (line < 0 || line >= lines.length) return src
  const raw = lines[line]
  const indent = raw.match(/^\s*/)![0]
  let body = raw.slice(indent.length)
  const hasColon = body.trimEnd().endsWith(':')
  let head = hasColon ? body.trimEnd().slice(0, -1) : body.trimEnd()
  let changed = false
  if (kind === 'text' || kind === 'image') {
    const next = head.replace(/(["'])([^"']*)\1/, `"${String(value).replace(/"/g, '\\"')}"`)
    if (next !== head) {
      head = next
      changed = true
    }
  } else if (kind === 'color') {
    const cv = `"${String(value)}"`
    if (/\bcolor\s+["']?[^"'\s]+["']?/.test(head)) head = head.replace(/\bcolor\s+["']?[^"'\s]+["']?/, `color ${cv}`)
    else head = `${head} color ${cv}`
    changed = true
  } else if (kind === 'size') {
    const n = Math.max(0, Math.round(Number(value) || 0))
    if (/\b(text_size|size)\s+\d+\b/.test(head)) head = head.replace(/\b(text_size|size)\s+\d+\b/, (_m, p: string) => `${p} ${n}`)
    else head = `${head} size ${n}`
    changed = true
  } else if (kind === 'bold') {
    const b = value === 'True' || value === 'true' || value === '1' ? 'True' : 'False'
    if (/\bbold\s+(True|False)\b/.test(head)) head = head.replace(/\bbold\s+(True|False)\b/, `bold ${b}`)
    else head = `${head} bold ${b}`
    changed = true
  } else if (kind === 'align') {
    const n = Math.round(Number(value) * 100) / 100
    if (/\btext_align\s+[\d.]+\b/.test(head)) head = head.replace(/\btext_align\s+[\d.]+\b/, `text_align ${n}`)
    else head = `${head} text_align ${n}`
    changed = true
  }
  if (!changed) return src
  lines[line] = `${indent}${head}${hasColon ? ':' : ''}`
  return lines.join('\n')
}

/** 删除指定源码行（脚本编组内元素的删除入口） */
export function removeStatementLine(src: string, line: number): string {
  const lines = src.split(/\r?\n/)
  if (line < 0 || line >= lines.length) return src
  lines.splice(line, 1)
  return lines.join('\n')
}

// ---------- 脚本编组操作（退出编组 / 解散编组，位置保留） ----------

/** 行缩进长度 */
function lineIndent(l: string): number {
  return (l.match(/^\s*/)![0]).length
}

/** 语句块结束行（不含）：从 line 起，到下一个缩进 <= 该行缩进的语句为止（空行跳过） */
function blockEndLine(lines: string[], line: number): number {
  const ind = lineIndent(lines[line])
  let end = line + 1
  while (end < lines.length) {
    const l = lines[end]
    if (l.trim() === '') {
      end++
      continue
    }
    if (lineIndent(l) <= ind) break
    end++
  }
  return end
}

/** 脚本元素退出编组：把元素语句从容器块中移出到 screen 顶层，写 pos (x,y) 保持当前位置 */
export function ejectStatement(
  src: string,
  elementLine: number,
  containerLine: number,
  x: number,
  y: number
): string {
  const lines = src.split(/\r?\n/)
  if (elementLine < 0 || elementLine >= lines.length) return src
  const stmt = lines[elementLine].trim()
  if (!stmt) return src
  const end = blockEndLine(lines, containerLine)
  lines.splice(elementLine, 1) // 删除原元素行
  // 容器块结束处（删除一行后整体前移 1）；splice 对越界自动收尾
  const insertAt = Math.max(containerLine, end - 1)
  const newLine = `    ${appendAbsPos(stmt, x, y)}`
  lines.splice(insertAt, 0, newLine)
  return lines.join('\n')
}

/** 容器属性行关键字（vbox 的 xalign/ypos/spacing 等）：解散时随容器一起删除，避免提升到顶层改变语义 */
const CONTAINER_PROPS = /^(xalign|yalign|xpos|ypos|xanchor|yanchor|pos|spacing|padding|margin|offset|area|xsize|ysize|xfill|yfill|xminimum|yminimum|xmaximum|ymaximum|align)\b/

/** 给语句追加绝对定位 pos：清理行内旧定位属性（xalign/yalign/xpos/ypos/xanchor/yanchor/pos），
 *  位置统一由新 pos 决定。块头语句（text "x": 等）pos 必须插在冒号前，否则语法错误被忽略。
 *  注意：不能追加 yalign 0——yalign 会同时覆盖 pos 与 anchor（Ren'Py 定位规则），
 *  文本默认 yalign 差异由渲染器/真实运行时的样式默认处理，写回时保持 pos 精确指向左上角。 */
function appendAbsPos(line: string, x: number, y: number): string {
  let l = line.trimEnd()
  l = l.replace(/\s*pos\s*\([^)]*\)/g, '')
  l = l.replace(/\s*(?:xalign|yalign|xpos|ypos|xanchor|yanchor)\s+(?:\([^)]*\)|[^\s]+)/g, '')
  l = l.trimEnd()
  const posStr = `pos (${Math.round(x)}, ${Math.round(y)}) xanchor 0 yanchor 0`
  const colonM = /:\s*(#.*)?$/.exec(l)
  if (colonM) {
    return `${l.slice(0, colonM.index).trimEnd()} ${posStr}${l.slice(colonM.index)}`
  }
  return `${l} ${posStr}`
}

/** 解散脚本编组的父容器信息（用于把绝对坐标换算成子元素在新父容器中的相对 pos） */
export interface UngroupParentInfo {
  kind: 'vbox' | 'hbox' | 'fixed'
  /** 父容器渲染绝对位置（画布坐标） */
  x: number
  y: number
  /** 父容器 spacing（流式布局子元素之间的间距） */
  spacing: number
  /** 父容器内边距 left/top */
  padL: number
  padT: number
}

/** 解散脚本编组：删除容器行，块内行整体缩进 -4（内部直接子语句提升到 screen 顶层），
 *  并给每个直接子语句补 pos 保持位置留在原地。
 *  容器自身的属性行（xalign/ypos/spacing 等）随容器删除，不提升。
 *  pos 的坐标系取决于父容器（parent 参数）：
 *   - 无父容器（screen 顶层）：pos = 渲染绝对坐标；
 *   - 父为 fixed：pos = 绝对坐标 - 父容器内原点（父 abs + padding）；
 *   - 父为 vbox/hbox（流式）：子元素按序落在「容器位置 + 前序子元素尺寸累计 + i×父间距」，
 *     pos = 绝对坐标 - 容器位置 - 流式累计偏移（否则写回绝对 pos 会被父流式布局再次叠加，双重偏移）。 */
export function ungroupContainer(
  src: string,
  containerLine: number,
  positions: Map<number, { x: number; y: number; w?: number; h?: number }>,
  parent?: UngroupParentInfo | null
): string {
  const lines = src.split(/\r?\n/)
  if (containerLine < 0 || containerLine >= lines.length) return src
  const containerIndent = lineIndent(lines[containerLine])
  const end = blockEndLine(lines, containerLine)
  // 需要补 pos 的直接子语句（缩进 = 容器缩进 + 4，且已知渲染绝对坐标）
  const toAdd: Array<{ i: number; x: number; y: number }> = []
  // 容器属性行：随容器删除
  const toDrop: number[] = []
  const cAbs = positions.get(containerLine) // 容器自身的渲染绝对位置
  const parentIsFlow = parent?.kind === 'vbox' || parent?.kind === 'hbox'
  // 流式父布局下，直接子元素按源码顺序依次落位：前序子元素尺寸 + 父间距 逐项累计
  let offsetX = 0
  let offsetY = 0
  for (let i = containerLine + 1; i < end; i++) {
    const l = lines[i]
    if (l.trim() === '') continue
    if (lineIndent(l) !== containerIndent + 4) continue
    const first = l.trim().split(/\s+/)[0]
    if (CONTAINER_PROPS.test(first)) {
      toDrop.push(i)
      continue
    }
    const p = positions.get(i)
    if (!p) continue // 无渲染位置（如 $ 赋值/python 等不可见语句）：不补 pos，仅提升层级
    let x = p.x
    let y = p.y
    if (cAbs && parentIsFlow) {
      x = p.x - cAbs.x - offsetX
      y = p.y - cAbs.y - offsetY
      // 累计本子元素占位：hbox 横向（宽度），vbox 纵向（高度），再加父间距
      if (parent!.kind === 'hbox') offsetX += (p.w ?? 0) + parent!.spacing
      else offsetY += (p.h ?? 0) + parent!.spacing
    } else if (parent && parent.kind === 'fixed') {
      // fixed 父：子元素定位相对父容器包围盒左上角
      // （渲染器 bbox 已含父容器原点 + padding 偏移，再扣 padL/padT 会双扣）
      x = p.x - parent.x
      y = p.y - parent.y
    }
    toAdd.push({ i, x, y })
  }
  // 先补 pos（行号未变；统一用绝对定位，清理行内旧定位属性）
  for (const t of toAdd) {
    lines[t.i] = appendAbsPos(lines[t.i], t.x, t.y)
  }
  // 块内所有非空行缩进 -4（保持相对结构，嵌套子容器内部同步上移）
  for (let i = containerLine + 1; i < end; i++) {
    const l = lines[i]
    if (l.trim() === '') continue
    const ind = lineIndent(l)
    if (ind >= 4) lines[i] = ' '.repeat(ind - 4) + l.slice(ind)
  }
  // 删除容器行与容器属性行（逆序删除）
  const dropLines = [...toDrop, containerLine].sort((a, b) => b - a)
  for (const i of dropLines) lines.splice(i, 1)
  return lines.join('\n')
}
