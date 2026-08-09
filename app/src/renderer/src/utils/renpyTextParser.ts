// Ren'Py 文本标签解析器
// 支持 {size=N}, {color=#HEX}, {i}, {b}, {u}, {s}, {font="name"}, {alpha=N} 等标签
// 参考: https://www.renpy.org/doc/html/text.html

export interface TextStyle {
  size?: number
  color?: string
  italic?: boolean
  bold?: boolean
  underline?: boolean
  strikethrough?: boolean
  font?: string
  alpha?: number
}

export interface TextSegment {
  text: string
  style: TextStyle
}

// 标签匹配正则：{tag} 或 {tag=value} 或 {/tag}
const TAG_RE = /\{(\/?)(\w+)(?:=([^}]*))?\}/g

// 已知的样式标签
const STYLE_TAGS = new Set(['size', 'color', 'i', 'b', 'u', 's', 'font', 'alpha'])

/**
 * 解析 Ren'Py 文本标签，返回带样式的文本片段数组
 * 未识别的标签（如 style 切换）将被忽略，但其文本内容保留
 */
export function parseRenpyText(text: string): TextSegment[] {
  const segments: TextSegment[] = []
  let current: TextStyle = {}
  let lastIndex = 0
  let match: RegExpExecArray | null

  TAG_RE.lastIndex = 0

  while ((match = TAG_RE.exec(text)) !== null) {
    const [fullMatch, isClosing, tagName, tagValue] = match
    const start = match.index

    // 标签之前的纯文本
    if (start > lastIndex) {
      segments.push({
        text: text.slice(lastIndex, start),
        style: { ...current }
      })
    }

    const tag = tagName.toLowerCase()

    // 处理标签
    if (!isClosing) {
      switch (tag) {
        case 'size': {
          const n = parseInt(tagValue ?? '', 10)
          if (!isNaN(n)) current.size = n
          break
        }
        case 'color': {
          if (tagValue) current.color = tagValue
          break
        }
        case 'i':
          current.italic = true
          break
        case 'b':
          current.bold = true
          break
        case 'u':
          current.underline = true
          break
        case 's':
          current.strikethrough = true
          break
        case 'font': {
          if (tagValue) current.font = tagValue.replace(/^"|"$/g, '')
          break
        }
        case 'alpha': {
          const n = parseFloat(tagValue ?? '')
          if (!isNaN(n)) current.alpha = Math.max(0, Math.min(1, n))
          break
        }
        default:
          // 未知标签（如 {style=...}），忽略但不影响样式
          break
      }
    } else {
      // 关闭标签
      switch (tag) {
        case 'size':
          current.size = undefined
          break
        case 'color':
          current.color = undefined
          break
        case 'i':
          current.italic = undefined
          break
        case 'b':
          current.bold = undefined
          break
        case 'u':
          current.underline = undefined
          break
        case 's':
          current.strikethrough = undefined
          break
        case 'font':
          current.font = undefined
          break
        case 'alpha':
          current.alpha = undefined
          break
        default:
          break
      }
    }

    lastIndex = start + fullMatch.length
  }

  // 最后一段纯文本
  if (lastIndex < text.length) {
    segments.push({
      text: text.slice(lastIndex),
      style: { ...current }
    })
  }

  return segments
}

/**
 * 将 TextStyle 转换为 React CSSProperties
 */
export function styleToCss(style: TextStyle): React.CSSProperties {
  const css: React.CSSProperties = {}
  if (style.size !== undefined) css.fontSize = `${style.size}px`
  if (style.color !== undefined) css.color = style.color
  if (style.italic) css.fontStyle = 'italic'
  if (style.bold) css.fontWeight = 'bold'
  if (style.underline) css.textDecoration = 'underline'
  if (style.strikethrough) css.textDecoration = 'line-through'
  if (style.font) css.fontFamily = style.font
  if (style.alpha !== undefined) css.opacity = style.alpha
  return css
}
