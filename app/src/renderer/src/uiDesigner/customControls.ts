// 自定义控件与编组的序列化 / 反序列化：
// 控件保存为 screen 内带标记注释的 Ren'Py 语句（text / label / textbutton / add / bar / vbar / input），
// 编组保存为 hbox / vbox / fixed 容器语句（子控件缩进嵌套）。
// 读回时按标记区解析还原为 CustomControl / CustomGroup。
// 编组内控件的坐标存为「相对编组原点的偏移」：fixed 直接摆放，vbox/hbox 由布局决定（相对坐标仅用于解散还原）。

import type { CustomControl, CustomGroup, GroupType } from './types'
import { CUSTOM_END, CUSTOM_START, parseScreenBlocks, parseAllScreenNames } from './parseScreens'

function sanitizeText(t: string): string {
  return t.replace(/"/g, '“').replace(/\n/g, ' ')
}

/** 估算控件尺寸（vbox/hbox 组布局与解散还原用；带 xsize/ysize 的控件用存储值） */
export function estimateSize(c: CustomControl): { w: number; h: number } {
  const size = c.size ?? 33
  if (c.type === 'text' || c.type === 'label') {
    const len = (c.text ?? (c.type === 'text' ? '文本' : '标签')).length
    return { w: Math.max(24, Math.round(len * size)), h: Math.round(size * 1.4) }
  }
  return { w: c.width || 200, h: c.height || (c.type === 'image' ? 120 : 50) }
}

/** 计算编组内每个子控件的相对坐标（vbox/hbox 按布局，fixed 用存储偏移） */
export function groupLayout(
  g: CustomGroup,
  controls: CustomControl[]
): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>()
  let cursor = 0
  for (const id of g.children) {
    const c = controls.find((x) => x.id === id)
    if (!c) continue
    const { w, h } = estimateSize(c)
    if (g.type === 'vbox') {
      out.set(id, { x: 0, y: cursor })
      cursor += h + g.spacing
    } else if (g.type === 'hbox') {
      out.set(id, { x: cursor, y: 0 })
      cursor += w + g.spacing
    } else {
      out.set(id, { x: c.x, y: c.y })
    }
  }
  return out
}

/** 编组包围盒（画布绝对坐标） */
export function groupBounds(
  g: CustomGroup,
  controls: CustomControl[]
): { x: number; y: number; w: number; h: number } {
  const rel = groupLayout(g, controls)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const id of g.children) {
    const c = controls.find((x) => x.id === id)
    const r = rel.get(id)
    if (!c || !r) continue
    const { w, h } = estimateSize(c)
    minX = Math.min(minX, r.x)
    minY = Math.min(minY, r.y)
    maxX = Math.max(maxX, r.x + w)
    maxY = Math.max(maxY, r.y + h)
  }
  if (minX === Infinity) return { x: g.x, y: g.y, w: 0, h: 0 }
  return { x: g.x + minX, y: g.y + minY, w: maxX - minX, h: maxY - minY }
}

/** 通用属性片段：对齐 / 透明度（文本类控件对齐写 xalign，其余只写 alpha） */
function commonSuffix(c: CustomControl, opts: { align?: boolean } = {}): string {
  let out = ''
  if (opts.align && typeof c.xalign === 'number' && c.xalign !== 0) out += ` xalign ${c.xalign}`
  if (typeof c.alpha === 'number' && c.alpha !== 1) out += ` alpha ${c.alpha}`
  return out
}

/** 控件 → Ren'Py 语句（不含缩进）。omitPos：vbox/hbox 子控件不写 pos（由容器布局） */
export function customToStatement(c: CustomControl, opts: { omitPos?: boolean } = {}): string {
  const pos = opts.omitPos ? '' : ` pos (${Math.round(c.x)}, ${Math.round(c.y)})`
  switch (c.type) {
    case 'text':
      return `text "${sanitizeText(c.text ?? '文本')}"${pos} size ${c.size ?? 33} color "${c.color ?? '#ffffff'}"${
        c.bold ? ' bold True' : ''
      }${commonSuffix(c, { align: true })}`
    case 'label':
      return `label "${sanitizeText(c.text ?? '标签')}"${pos} size ${c.size ?? 33} color "${c.color ?? '#ffffff'}"${commonSuffix(
        c,
        { align: true }
      )}`
    case 'button':
      return `textbutton "${sanitizeText(c.text ?? '按钮')}" action NullAction()${pos} xsize ${Math.round(c.width)} ysize ${Math.round(
        c.height
      )}${typeof c.textSize === 'number' ? ` text_size ${Math.round(c.textSize)}` : ''}${
        c.color ? ` color "${c.color}"` : ''
      }${c.hoverColor ? ` hover_color "${c.hoverColor}"` : ''}${c.bold ? ' bold True' : ''}${commonSuffix(c, { align: true })}`
    case 'image':
      return `add "${c.image ?? ''}"${pos}${commonSuffix(c)}`
    case 'bar':
      return `bar value StaticValue(${c.value ?? 0.5}, 1.0)${pos} xsize ${Math.round(c.width)} ysize ${Math.round(c.height)}${commonSuffix(c)}`
    case 'vbar':
      return `vbar value StaticValue(${c.value ?? 0.5}, 1.0)${pos} xsize ${Math.round(c.width)} ysize ${Math.round(c.height)}${commonSuffix(c)}`
    case 'slider':
      return `bar value StaticValue(${c.value ?? 0.5}, 1.0) style "slider"${pos} xsize ${Math.round(c.width)} ysize ${Math.round(
        c.height
      )}${commonSuffix(c)}`
    case 'input':
      return `input default "${sanitizeText(c.text ?? '输入框')}"${pos} xsize ${Math.round(c.width)} ysize ${Math.round(
        c.height
      )}${typeof c.size === 'number' ? ` size ${Math.round(c.size)}` : ''}${
        c.color ? ` color "${c.color}"` : ''
      }${commonSuffix(c, { align: true })}`
    case 'frame':
      return `add Frame("gui/frame.png", gui.frame_borders, tile=gui.frame_tile)${pos} xsize ${Math.round(c.width)} ysize ${Math.round(
        c.height
      )}${commonSuffix(c)}`
    case 'imagebutton':
      return `imagebutton idle "${c.image ?? ''}" hover "${c.hoverImage ?? c.image ?? ''}" action NullAction()${pos} xsize ${Math.round(
        c.width
      )} ysize ${Math.round(c.height)}${commonSuffix(c)}`
    case 'null':
      return `null${pos} width ${Math.round(c.width)} height ${Math.round(c.height)}`
    case 'hotspot':
      return `hotspot (0, 0, ${Math.round(c.width)}, ${Math.round(c.height)}) action NullAction()${pos}${commonSuffix(c)}`
    case 'hotbar':
      return `hotbar value StaticValue(${c.value ?? 0.5}, 1.0) (0, 0, ${Math.round(c.width)}, ${Math.round(
        c.height
      )}) style "slider"${pos}${commonSuffix(c)}`
  }
}

/** 编组头语句（不含子行） */
export function groupHead(g: CustomGroup): string {
  const common = (extra = ''): string =>
    ` pos (${Math.round(g.x)}, ${Math.round(g.y)})${
      typeof g.xalign === 'number' && g.xalign !== 0 ? ` xalign ${g.xalign}` : ''
    }${extra}:`
  switch (g.type) {
    case 'grid': {
      const cols = g.cols ?? 2
      const rows = Math.max(1, Math.ceil(g.children.length / cols))
      return `grid ${cols} ${rows}${common()}`
    }
    case 'side':
      return `side "${g.positions ?? 'c r'}"${common()}`
    case 'button':
      return `button${common(` xsize ${Math.round(g.width ?? 220)} ysize ${Math.round(g.height ?? 66)}`)}`
    case 'window':
      return `window${common(` xsize ${Math.round(g.width ?? 500)} ysize ${Math.round(g.height ?? 220)}`)}`
    case 'viewport':
      return `viewport${common(
        ` xsize ${Math.round(g.width ?? 400)} ysize ${Math.round(g.height ?? 300)}${
          g.scrollbars ? ` scrollbars "${g.scrollbars}"` : ''
        }`
      )}`
    default:
      return `${g.type}${common()}`
  }
}

/** 编组 → Ren'Py 语句（含组内缩进，供 replaceScreenCustomSection 使用） */
export function groupToStatements(g: CustomGroup, controls: CustomControl[]): string[] {
  const head = groupHead(g)
  const lines: string[] = [head]
  if (g.spacing !== 0) {
    lines.push(`    spacing ${Math.round(g.spacing)}`)
  }
  for (const id of g.children) {
    const c = controls.find((x) => x.id === id)
    if (!c) continue
    lines.push(`    ${customToStatement(c, { omitPos: g.type !== 'fixed' })}`)
  }
  return lines
}

/** 按界面生成控件与编组语句（供 replaceScreenCustomSection 使用） */
export function customStatementsForScreen(
  custom: CustomControl[],
  groups: CustomGroup[],
  screen: string
): string[] {
  const out: string[] = []
  for (const g of groups.filter((x) => x.screen === screen)) {
    out.push(...groupToStatements(g, custom))
  }
  for (const c of custom.filter((x) => x.screen === screen)) {
    if (groups.some((g) => g.screen === screen && g.children.includes(c.id))) continue
    out.push(customToStatement(c))
  }
  return out
}

/** 解析编组头语句 → 编组信息（id/screen/spacing/children 由调用方补全）。不匹配返回 null。 */
export function parseGroupHead(
  t: string
): Omit<CustomGroup, 'id' | 'screen' | 'spacing' | 'children'> | null {
  const gmGrid = /^grid\s+(\d+)\s+(\d+)\s+pos\s*\((-?\d+),\s*(-?\d+)\)(?:\s+xalign\s+([\d.]+))?\s*:$/.exec(t)
  if (gmGrid) {
    return { type: 'grid', x: +gmGrid[3], y: +gmGrid[4], xalign: gmGrid[5] ? +gmGrid[5] : undefined, cols: +gmGrid[1] }
  }
  const gmSide = /^side\s+"([^"]*)"\s+pos\s*\((-?\d+),\s*(-?\d+)\)(?:\s+xalign\s+([\d.]+))?\s*:$/.exec(t)
  if (gmSide) {
    return { type: 'side', x: +gmSide[2], y: +gmSide[3], xalign: gmSide[4] ? +gmSide[4] : undefined, positions: gmSide[1] }
  }
  const gmGen = /^(hbox|vbox|fixed|button|window|viewport)\s+pos\s*\((-?\d+),\s*(-?\d+)\)(.*):\s*$/.exec(t)
  if (gmGen) {
    const tail = gmGen[4] ?? ''
    const out: Omit<CustomGroup, 'id' | 'screen' | 'spacing' | 'children'> = {
      type: gmGen[1] as GroupType,
      x: +gmGen[2],
      y: +gmGen[3],
    }
    const xal = /xalign ([\d.]+)/.exec(tail)
    if (xal) out.xalign = +xal[1]
    const xs = /xsize (\d+)/.exec(tail)
    if (xs) out.width = +xs[1]
    const ys = /ysize (\d+)/.exec(tail)
    if (ys) out.height = +ys[1]
    const sb = /scrollbars "([^"]*)"/.exec(tail)
    if (sb) out.scrollbars = sb[1]
    return out
  }
  return null
}

/** 从 screens.rpy 解析某 screen 标记区内的控件与编组 */
export function parseCustomControls(
  src: string,
  screenName: string
): { controls: CustomControl[]; groups: CustomGroup[] } {
  const blocks = parseScreenBlocks(src, [screenName])
  const block = blocks.get(screenName)
  const controls: CustomControl[] = []
  const groups: CustomGroup[] = []
  if (!block) return { controls, groups }
  const lines = src.split(/\r?\n/)
  let inSec = false
  let i = block.start + 1
  while (i < block.end) {
    const raw = lines[i]
    const t = raw.trim()
    if (t === CUSTOM_START) {
      inSec = true
      i++
      continue
    }
    if (t === CUSTOM_END) break
    if (!inSec) {
      i++
      continue
    }
    // 组头：容器语句（grid/side/button/window/viewport/hbox/vbox/fixed）
    const gInfo = parseGroupHead(t)
    if (gInfo) {
      const g: CustomGroup = {
        id: uid(),
        screen: screenName,
        spacing: 0,
        children: [],
        ...gInfo,
      }
      i++
      // 组内子行（缩进比组头深）
      const headIndent = raw.match(/^\s*/)![0].length
      while (i < block.end) {
        const cRaw = lines[i]
        const cT = cRaw.trim()
        if (cT === CUSTOM_END) break
        if (cRaw.match(/^\s*/)![0].length <= headIndent) break
        const sm = /^spacing\s+(\d+)$/.exec(cT)
        if (sm) {
          g.spacing = +sm[1]
          i++
          continue
        }
        const c = parseStatement(cT)
        if (c) {
          const control: CustomControl = { ...c, screen: screenName }
          controls.push(control)
          g.children.push(control.id)
        }
        i++
      }
      groups.push(g)
      continue
    }
    const c = parseStatement(t)
    if (c) controls.push({ ...c, screen: screenName })
    i++
  }
  // vbox/hbox 子控件：按布局推算相对坐标（fixed 已在语句中带 pos）
  for (const g of groups) {
    if (g.type === 'fixed') continue
    const rel = groupLayout(g, controls)
    for (const [id, r] of rel) {
      const c = controls.find((x) => x.id === id)
      if (c) {
        c.x = r.x
        c.y = r.y
      }
    }
  }
  return { controls, groups }
}

function parseStatement(line: string): Omit<CustomControl, 'screen'> | null {
  let m: RegExpExecArray | null
  const posMatch = (s: string): { x: number; y: number } => {
    const p = /pos\s*\((-?\d+),\s*(-?\d+)\)/.exec(s)
    return p ? { x: +p[1], y: +p[2] } : { x: 0, y: 0 }
  }
  const noPos = (s: string): string => s.replace(/\s*pos\s*\(-?\d+,\s*-?\d+\)/, '')
  const mk = (
    r: RegExpExecArray | null,
    rest: (line: string) => Omit<CustomControl, 'screen' | 'x' | 'y'>,
    tailIdx = 1
  ): Omit<CustomControl, 'screen'> | null => {
    if (!r) return null
    const tail = r[tailIdx]
    const body = noPos(tail)
    const m2 = posMatch(tail)
    return { ...rest(body), x: m2.x, y: m2.y }
  }
  // 通用尾属性：透明度 alpha / 对齐 xalign / 粗体 bold
  const common = (b: string): Pick<CustomControl, 'alpha' | 'xalign' | 'bold'> => {
    const alpha = /alpha ([\d.]+)/.exec(b)
    const xalign = /xalign ([\d.]+)/.exec(b)
    return {
      ...(alpha ? { alpha: +alpha[1] } : {}),
      ...(xalign ? { xalign: +xalign[1] } : {}),
      ...(/bold True/.test(b) ? { bold: true } : {}),
    }
  }
  // 注意顺序：slider（bar + style "slider"）必须先于普通 bar 匹配。
  // 这三个分支 value 为第 1 捕获组，尾部在 r[2]，故 mk 需传 tailIdx=2。
  if ((m = /^bar value StaticValue\(([\d.]+), 1\.0\) style "slider"(.*)$/.exec(line))) {
    return mk(
      m,
      (b) => {
        const s = /xsize (\d+) ysize (\d+)/.exec(b)
        return { id: uid(), type: 'slider', width: s ? +s[1] : 400, height: s ? +s[2] : 38, value: +m![1], ...common(b) }
      },
      2
    )
  }
  if ((m = /^bar value StaticValue\(([\d.]+), 1\.0\)(.*)$/.exec(line))) {
    return mk(
      m,
      (b) => {
        const s = /xsize (\d+) ysize (\d+)/.exec(b)
        return { id: uid(), type: 'bar', width: s ? +s[1] : 400, height: s ? +s[2] : 24, value: +m![1], ...common(b) }
      },
      2
    )
  }
  if ((m = /^vbar value StaticValue\(([\d.]+), 1\.0\)(.*)$/.exec(line))) {
    return mk(
      m,
      (b) => {
        const s = /xsize (\d+) ysize (\d+)/.exec(b)
        return { id: uid(), type: 'vbar', width: s ? +s[1] : 24, height: s ? +s[2] : 300, value: +m![1], ...common(b) }
      },
      2
    )
  }
  if ((m = /^text "([^"]*)"(.*)$/.exec(line))) {
    return mk(
      m,
      (b) => {
        const size = /size (\d+)/.exec(b)
        const color = /color "([^"]*)"/.exec(b)
        return {
          id: uid(),
          type: 'text',
          width: 0,
          height: 0,
          text: m![1],
          size: size ? +size[1] : 33,
          color: color ? color[1] : '#ffffff',
          ...common(b),
        }
      },
      2
    )
  }
  if ((m = /^label "([^"]*)"(.*)$/.exec(line))) {
    return mk(
      m,
      (b) => {
        const size = /size (\d+)/.exec(b)
        const color = /color "([^"]*)"/.exec(b)
        return {
          id: uid(),
          type: 'label',
          width: 0,
          height: 0,
          text: m![1],
          size: size ? +size[1] : 33,
          color: color ? color[1] : '#ffffff',
          ...common(b),
        }
      },
      2
    )
  }
  if ((m = /^textbutton "([^"]*)" action NullAction\(\)(.*)$/.exec(line))) {
    return mk(
      m,
      (b) => {
        const s = /xsize (\d+) ysize (\d+)/.exec(b)
        const ts = /text_size (\d+)/.exec(b)
        const color = /color "([^"]*)"/.exec(b)
        const hc = /hover_color "([^"]*)"/.exec(b)
        return {
          id: uid(),
          type: 'button',
          width: s ? +s[1] : 220,
          height: s ? +s[2] : 66,
          text: m![1],
          ...(ts ? { textSize: +ts[1] } : {}),
          ...(color ? { color: color[1] } : {}),
          ...(hc ? { hoverColor: hc[1] } : {}),
          ...common(b),
        }
      },
      2
    )
  }
  if ((m = /^add "([^"]*)"(.*)$/.exec(line))) {
    return mk(
      m,
      (b) => ({ id: uid(), type: 'image', width: 0, height: 0, image: m![1], ...common(b) }),
      2
    )
  }
  if ((m = /^add Frame\("gui\/frame\.png", gui\.frame_borders, tile=gui\.frame_tile\)(.*)$/.exec(line))) {
    return mk(m, (b) => {
      const s = /xsize (\d+) ysize (\d+)/.exec(b)
      return { id: uid(), type: 'frame', width: s ? +s[1] : 400, height: s ? +s[2] : 300, ...common(b) }
    })
  }
  if ((m = /^input default "([^"]*)"(.*)$/.exec(line))) {
    return mk(
      m,
      (b) => {
        const s = /xsize (\d+) ysize (\d+)/.exec(b)
        // 注意 \b：避免把 xsize 里的 "size" 误判为字号
        const size = /\bsize (\d+)/.exec(b)
        const color = /color "([^"]*)"/.exec(b)
        return {
          id: uid(),
          type: 'input',
          width: s ? +s[1] : 400,
          height: s ? +s[2] : 50,
          text: m![1],
          ...(size ? { size: +size[1] } : {}),
          ...(color ? { color: color[1] } : {}),
          ...common(b),
        }
      },
      2
    )
  }
  if ((m = /^imagebutton idle "([^"]*)" hover "([^"]*)" action NullAction\(\)(.*)$/.exec(line))) {
    return mk(
      m,
      (b) => {
        const s = /xsize (\d+) ysize (\d+)/.exec(b)
        return {
          id: uid(),
          type: 'imagebutton',
          width: s ? +s[1] : 200,
          height: s ? +s[2] : 120,
          image: m![1],
          hoverImage: m![2] || m![1],
          ...common(b),
        }
      },
      3
    )
  }
  if ((m = /^null(.*)$/.exec(line))) {
    return mk(m, (b) => {
      const w = /width (\d+)/.exec(b)
      const h = /height (\d+)/.exec(b)
      return { id: uid(), type: 'null', width: w ? +w[1] : 20, height: h ? +h[1] : 20, ...common(b) }
    })
  }
  if ((m = /^hotspot \(\d+, \d+, (\d+), (\d+)\) action NullAction\(\)(.*)$/.exec(line))) {
    return mk(
      m,
      (b) => ({ id: uid(), type: 'hotspot', width: +m![1], height: +m![2], ...common(b) }),
      3
    )
  }
  if ((m = /^hotbar value StaticValue\(([\d.]+), 1\.0\) \(\d+, \d+, (\d+), (\d+)\) style "slider"(.*)$/.exec(line))) {
    return mk(
      m,
      (b) => ({ id: uid(), type: 'hotbar', width: +m![2], height: +m![3], value: +m![1], ...common(b) }),
      4
    )
  }
  return null
}

/** 解析项目 screens.rpy 中全部 screen 的标记区控件与编组 */
export function parseAllCustomControls(
  src: string
): { controls: CustomControl[]; groups: CustomGroup[] } {
  const controls: CustomControl[] = []
  const groups: CustomGroup[] = []
  for (const name of parseAllScreenNames(src)) {
    const r = parseCustomControls(src, name)
    controls.push(...r.controls)
    groups.push(...r.groups)
  }
  return { controls, groups }
}

let seq = 0
function uid(): string {
  seq += 1
  return `c${Date.now().toString(36)}${seq}`
}
