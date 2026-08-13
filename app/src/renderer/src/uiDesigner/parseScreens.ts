// screens.rpy 样式块解析与写回：
// 只操作「安全属性集」所在的 style 块（style window: / namebox: / choice_vbox: / quick_menu:），
// 属性行级替换，保留缩进与其余内容。

import type { StyleBlock, StyleProp } from './types'

/** 需要设计器管理的 style 块 */
export const TARGET_STYLES = ['window', 'namebox', 'choice_vbox', 'quick_menu'] as const

/** 织机 UI 设计器自定义控件的标记注释（生成到对应 screen 内，避免与其他代码混淆） */
export const CUSTOM_START = '# -- 织机 UI 自定义控件开始 --'
export const CUSTOM_END = '# -- 织机 UI 自定义控件结束 --'

/** 是否「带冒号」的 style 块声明（`style name:`）；排除 `style name is other` 别名声明 */
function isBlockDecl(line: string): boolean {
  return /^style\s+[\w]+\s*:\s*$/.test(line)
}

const PROP_RE = /^(\s+)([a-z_][a-z0-9_]*)\s+(.+)$/

/** 解析指定 style 块（只返回 TARGET_STYLES 中存在的块；同名块取首个出现，
 *  因为文件尾部的手机变体 `style window:` 是 variant 覆盖，主定义在文件靠前位置） */
export function parseStyleBlocks(src: string): Map<string, StyleBlock> {
  const lines = src.split(/\r?\n/)
  const map = new Map<string, StyleBlock>()
  for (let i = 0; i < lines.length; i++) {
    const m = /^style\s+([\w]+)\s*:\s*$/.exec(lines[i])
    if (!m) continue
    const name = m[1]
    if (!(TARGET_STYLES as readonly string[]).includes(name)) continue
    if (map.has(name)) continue
    const block: StyleBlock = { name, start: i, end: i + 1, props: [] }
    // 块结束：下一个非空且缩进 < 4 的行
    for (let j = i + 1; j < lines.length; j++) {
      const ln = lines[j]
      if (ln.trim() === '') continue
      const indent = ln.match(/^\s*/)![0].length
      if (indent < 4) {
        block.end = j
        break
      }
      const pm = PROP_RE.exec(ln)
      if (pm) {
        block.props.push({ prop: pm[2], value: pm[3].trim(), line: j })
      }
    }
    map.set(name, block)
  }
  return map
}

/** 在 style 块内替换一条属性；不存在则追加到块末。返回新源码（未变化则返回原串） */
export function updateStyleProp(
  src: string,
  styleName: string,
  propName: string,
  value: string
): string {
  const blocks = parseStyleBlocks(src)
  const block = blocks.get(styleName)
  if (!block) return src

  const lines = src.split(/\r?\n/)
  const indent = '    '
  // 同名属性可能重复（早期版本追加式写回遗留），全部删除后只保留一个，实现自愈
  const existing = block.props.filter((p) => p.prop === propName)

  if (existing.length > 0) {
    // 从后往前删除多余的同名行（先删后面，行号不受影响），保留第一个并替换值
    for (let k = existing.length - 1; k > 0; k--) {
      lines.splice(existing[k].line, 1)
    }
    lines[existing[0].line] = `${indent}${propName} ${value}`
    return lines.join('\n')
  }

  // 追加到块内最后一个属性之后（块内空白行不动）
  let insertAt = block.end - 1
  for (let j = block.end - 1; j > block.start; j--) {
    if (lines[j].trim() !== '') {
      insertAt = j + 1
      break
    }
  }
  lines.splice(insertAt, 0, `${indent}${propName} ${value}`)
  return lines.join('\n')
}

/** 全量去重：清理目标 style 块中的重复属性（保留首个），
 *  作为写回后的最终安全网——无论哪条分支被触发，保存结果都不会再包含同名重复属性。 */
export function dedupeStyleProps(src: string): string {
  const blocks = parseStyleBlocks(src)
  if (blocks.size === 0) return src
  const lines = src.split(/\r?\n/)
  const toRemove = new Set<number>()
  for (const block of blocks.values()) {
    const seen = new Set<string>()
    for (const p of block.props) {
      if (seen.has(p.prop)) toRemove.add(p.line)
      else seen.add(p.prop)
    }
  }
  if (toRemove.size === 0) return src
  return lines.filter((_, i) => !toRemove.has(i)).join('\n')
}

// ---------- 自定义控件：screen 块解析 / 标记区替换 ----------

/** screen 块 */
export interface ScreenBlock {
  name: string
  start: number
  end: number
}

/** 解析指定 screen 块（内容 4 空格缩进；块结束 = 下一个非空且缩进 < 4 的行） */
export function parseScreenBlocks(src: string, targets: string[]): Map<string, ScreenBlock> {
  const lines = src.split(/\r?\n/)
  const map = new Map<string, ScreenBlock>()
  for (let i = 0; i < lines.length; i++) {
    const m = /^screen\s+([\w]+)\s*\(.*\)\s*:\s*$/.exec(lines[i])
    if (!m) continue
    const name = m[1]
    if (!targets.includes(name) || map.has(name)) continue
    let end = lines.length
    for (let j = i + 1; j < lines.length; j++) {
      const ln = lines[j]
      if (ln.trim() === '') continue
      if ((ln.match(/^\s*/)![0].length) < 4) {
        end = j
        break
      }
    }
    map.set(name, { name, start: i, end })
  }
  return map
}

/** 解析源码中出现的全部 screen 名称（按出现顺序） */
export function parseAllScreenNames(src: string): string[] {
  const lines = src.split(/\r?\n/)
  const names: string[] = []
  for (let i = 0; i < lines.length; i++) {
    const m = /^screen\s+([\w]+)\s*\(.*\)\s*:\s*$/.exec(lines[i])
    if (m && !names.includes(m[1])) names.push(m[1])
  }
  return names
}

/** 判断某 screen 是否基于 game_menu 框架（内容含 use game_menu / use file_slots），
 *  用于在预览中渲染统一的菜单框架（背景 + 标题 + 导航 + 返回） */
export function screenUsesGameMenu(src: string, screenName: string): boolean {
  const blocks = parseScreenBlocks(src, [screenName])
  const block = blocks.get(screenName)
  if (!block) return false
  const lines = src.split(/\r?\n/)
  for (let i = block.start + 1; i < block.end; i++) {
    if (/\buse\s+(game_menu|file_slots)\b/.test(lines[i])) return true
  }
  return false
}

/** 通用 style 块（含 is 继承声明） */
export interface AllStyleBlock {
  name: string
  /** style X is Y（无则为 null） */
  is: string | null
  start: number
  end: number
  props: StyleProp[]
}

/** 解析源码中的全部 style 块（含 `style name is other` 别名声明，别名无 props）。
 *  支持三种声明：
 *  - `style name is other`（纯别名）
 *  - `style name:`（带属性块）
 *  - `style name is other:`（继承 + 带属性块，如 `style choice_button is default:`）
 *  同一名字先别名后块 → 用块补全属性（保留 is）；已带属性的块不会被尾部 variant 覆盖改写。 */
export function parseAllStyles(src: string): Map<string, AllStyleBlock> {
  const lines = src.split(/\r?\n/)
  const map = new Map<string, AllStyleBlock>()
  const readBlock = (i: number, name: string, is: string | null): AllStyleBlock => {
    const block: AllStyleBlock = { name, is, start: i, end: i + 1, props: [] }
    for (let j = i + 1; j < lines.length; j++) {
      const ln = lines[j]
      if (ln.trim() === '') continue
      const indent = ln.match(/^\s*/)![0].length
      if (indent < 4) {
        block.end = j
        break
      }
      const pm = PROP_RE.exec(ln)
      if (pm) block.props.push({ prop: pm[2], value: pm[3].trim(), line: j })
    }
    return block
  }
  const apply = (block: AllStyleBlock): void => {
    const ex = map.get(block.name)
    if (ex && ex.props.length > 0) return // 保留首个带属性的块（文件尾部 variant 覆盖不参与）
    if (ex) {
      ex.is = block.is ?? ex.is
      ex.start = block.start
      ex.end = block.end
      ex.props = block.props
    } else {
      map.set(block.name, block)
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const aliasBlock = /^style\s+([\w]+)\s+is\s+([\w]+)\s*:\s*$/.exec(lines[i])
    if (aliasBlock) {
      apply(readBlock(i, aliasBlock[1], aliasBlock[2]))
      continue
    }
    const alias = /^style\s+([\w]+)\s+is\s+([\w]+)\s*$/.exec(lines[i])
    if (alias) {
      const name = alias[1]
      if (!map.has(name)) map.set(name, { name, is: alias[2], start: i, end: i + 1, props: [] })
      continue
    }
    const m = /^style\s+([\w]+)\s*:\s*$/.exec(lines[i])
    if (!m) continue
    apply(readBlock(i, m[1], null))
  }
  return map
}

/** 解析 style 名（含继承链），返回合并后的属性表（子样式覆盖父样式） */
export function resolveStyleMap(
  allStyles: Map<string, AllStyleBlock>,
  name: string,
  visited = new Set<string>()
): Map<string, string> {
  const out = new Map<string, string>()
  if (!name || visited.has(name)) return out
  visited.add(name)
  const block = allStyles.get(name)
  if (!block) return out
  if (block.is) {
    const parent = resolveStyleMap(allStyles, block.is, visited)
    for (const [k, v] of parent) out.set(k, v)
  }
  for (const p of block.props) out.set(p.prop, p.value)
  return out
}

/**
 * 替换（或追加）screen 内的织机自定义控件标记区。
 * @param statements 控件语句（不含缩进与标记注释），为空则删除标记区
 */
export function replaceScreenCustomSection(
  src: string,
  screenName: string,
  statements: string[]
): string {
  const blocks = parseScreenBlocks(src, [screenName])
  const block = blocks.get(screenName)
  if (!block) return src

  const lines = src.split(/\r?\n/)
  const indent = '    '
  const sec: string[] = statements.length
    ? [indent + CUSTOM_START, ...statements.map((s) => indent + s), indent + CUSTOM_END]
    : []

  // 找标记区
  let startIdx = -1
  let endIdx = -1
  for (let i = block.start + 1; i < block.end; i++) {
    const t = lines[i].trim()
    if (t === CUSTOM_START) startIdx = i
    else if (t === CUSTOM_END) {
      endIdx = i
      break
    }
  }

  if (startIdx >= 0 && endIdx >= startIdx) {
    // 替换整个标记区
    lines.splice(startIdx, endIdx - startIdx + 1, ...sec)
    return lines.join('\n')
  }

  if (!statements.length) return src
  // 追加到块内最后一个非空行之后
  let insertAt = block.end - 1
  for (let j = block.end - 1; j > block.start; j--) {
    if (lines[j].trim() !== '') {
      insertAt = j + 1
      break
    }
  }
  lines.splice(insertAt, 0, ...sec)
  return lines.join('\n')
}
