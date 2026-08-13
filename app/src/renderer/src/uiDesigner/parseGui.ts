// gui.rpy 解析与写回：
// - 解析 `define gui.xxx = value`（保注释、保格式，只替换值表达式）
// - 解析引用链（value 可能是 `gui.interface_text_font` 这样的引用）
// - 所有写回都是行级替换，不重排用户的其他内容

import type { GuiDefine } from './types'

const DEFINE_RE = /^(\s*)define\s+gui\.([A-Za-z0-9_]+)\s*=\s*(.*)$/

/**
 * 把「值 + 行尾注释」拆开：# 出现在引号外且前面是空白才视为注释开始
 * （'#FFE4A6' 这类带 # 的颜色字面量不能被截断）
 */
function splitComment(rest: string): { value: string; comment: string } {
  let quote: '"' | "'" | null = null
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i]
    if (quote) {
      if (c === quote) quote = null
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '#' && (i === 0 || /\s/.test(rest[i - 1]))) {
      return { value: rest.slice(0, i).trim(), comment: rest.slice(i) }
    }
  }
  return { value: rest.trim(), comment: '' }
}

/** 解析 gui.rpy，返回按 key 索引的 define（保留最后一次出现的行） */
export function parseGuiDefines(src: string): Map<string, GuiDefine> {
  const map = new Map<string, GuiDefine>()
  const lines = src.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const m = DEFINE_RE.exec(lines[i])
    if (!m) continue
    const { value } = splitComment(m[3])
    map.set(m[2], { key: m[2], raw: value, line: i })
  }
  return map
}

/** 行级替换某条 define 的值表达式（保持缩进/行尾注释，值表达式由调用方传入） */
export function updateDefine(src: string, key: string, value: string): string {
  const lines = src.split(/\r?\n/)
  let changed = false
  const out = lines.map((ln) => {
    if (changed) return ln
    const m = DEFINE_RE.exec(ln)
    if (!m || m[2] !== key) return ln
    changed = true
    const { comment } = splitComment(m[3])
    return `${m[1]}define gui.${key} = ${value}${comment}`
  })
  return changed ? out.join('\n') : src
}

/** 去掉引号，取字符串字面量的内容 */
export function unquote(raw: string): string {
  const t = raw.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1)
  }
  return t
}

/**
 * 解析一个 define 的「最终值」：
 * - 字符串字面量 → 去掉引号的内容
 * - `gui.xxx` 引用 → 递归解析被引用 define
 * - 数字 / None / True / False → 原样返回
 */
export function resolveValue(defines: Map<string, GuiDefine>, raw: string): string {
  const seen = new Set<string>()
  let cur = raw.trim()
  while (true) {
    if (cur.startsWith('gui.')) {
      const key = cur.slice('gui.'.length).trim()
      if (seen.has(key) || !defines.has(key)) return cur
      seen.add(key)
      cur = defines.get(key)!.raw
      continue
    }
    return unquote(cur)
  }
}

/** 数值解析（含 float / None / 表达式回退），失败返回 fallback */
export function toNumber(value: string, fallback: number): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : fallback
}

/** 颜色规范化：把 '#RRGGBB' / '#RRGGBBAA' / 名称统一成可编辑的 #RRGGBB（透明后缀保留） */
export function normalizeColor(value: string): string {
  const t = value.trim()
  if (/^#[0-9a-fA-F]{6,8}$/.test(t)) return t.toLowerCase()
  // 常见命名色（Ren'Py 默认模板用 white/black 等）
  const named: Record<string, string> = {
    white: '#ffffff',
    black: '#000000',
    red: '#ff0000',
    green: '#00ff00',
    blue: '#0000ff',
  }
  if (named[t.toLowerCase()]) return named[t.toLowerCase()]
  return t
}

/** 把内部颜色值格式化为 gui.rpy 单引号字面量 */
export function quoteColor(color: string): string {
  return `'${color}'`
}

/** 把字体文件名格式化为 gui.rpy 双引号字面量 */
export function quoteFont(name: string): string {
  return `"${name}"`
}

/** 默认状态（当 gui.rpy / screens.rpy 缺失时兜底，与模板默认值一致） */
export function defaultState() {
  return {
    colors: {
      accent: '#ffe4a6',
      idle: '#888888',
      hover: '#ffe4a6',
      selected: '#ffffff',
      text: '#ffffff',
      muted: '#515100',
    },
    fonts: { text: 'SourceHanSansLite.ttf', name: 'SourceHanSansLite.ttf', interface: 'SourceHanSansLite.ttf' },
    sizes: { text: 33, name: 45, interface: 33, quickButton: 21, choiceButton: 33, choiceSpacing: 33 },
    layout: {
      windowYalign: 1.0,
      windowHeight: 278,
      dialogueX: 402,
      dialogueY: 75,
      dialogueWidth: 1116,
      dialogueTextXalign: 0,
      nameboxX: 360,
      nameboxY: 0,
      nameboxXalign: 0,
      choiceY: 405,
      choiceXalign: 0.5,
      choiceWidth: 1185,
      quickXalign: 0.5,
      quickYalign: 1.0,
      navX: 60,
      navYalign: 0.5,
      nameboxWidth: 0,
      nameboxHeight: 0,
    },
    images: {
      textbox: 'gui/textbox.png',
      namebox: 'gui/namebox.png',
      choiceIdle: 'gui/button/choice_idle_background.png',
      choiceHover: 'gui/button/choice_hover_background.png',
      quickIdle: 'gui/button/quick_idle_background.png',
      quickHover: 'gui/button/quick_hover_background.png',
      mainMenu: 'gui/main_menu.png',
      gameMenu: 'gui/game_menu.png',
    },
  } as const
}

export type DefaultState = ReturnType<typeof defaultState>
