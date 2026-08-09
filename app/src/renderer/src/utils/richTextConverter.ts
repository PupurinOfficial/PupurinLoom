// Markdown / BBCode → Ren'Py 文本标签转换器
// 对照表：
//   加粗   **加粗**  / [b]加粗[/b]                → {b}加粗{/b}
//   斜体   *斜体*    / [i]斜体[/i]                → {i}斜体{/i}
//   下划线 (HTML <u>) / [u]下划线[/u]             → {u}下划线{/u}
//   删除线 ~~删除线~~ / [s]删除线[/s]             → {s}删除线{/s}
//   颜色   <font color="red">..</font> / [color=red]..[/color] → {color=#ff0000}..{/color}
//   大小   <font size="5">..</font> / [size=4]..[/size]       → {size=+5}..{/size}
//   链接   [显示文字](URL) / [url=URL]显示文字[/url]          → {a=URL}显示文字{/a}
//   图片   ![替代文字](图片URL) / [img]图片URL[/img]          → {image=图片文件名}
//   居中   (HTML <center>) / [center]..[/center]  → {center}..{/center}

export type RichTextMode = 'markdown' | 'bbcode'

// 常见 CSS 颜色名 → hex（Ren'Py 颜色标签需要 #rrggbb）
const COLOR_MAP: Record<string, string> = {
  red: '#ff0000',
  blue: '#0000ff',
  green: '#008000',
  yellow: '#ffff00',
  orange: '#ffa500',
  purple: '#800080',
  pink: '#ffc0cb',
  black: '#000000',
  white: '#ffffff',
  gray: '#808080',
  grey: '#808080',
  cyan: '#00ffff',
  magenta: '#ff00ff',
  brown: '#a52a2a',
  gold: '#ffd700',
  silver: '#c0c0c0',
  navy: '#000080',
  teal: '#008080',
  lime: '#00ff00',
  maroon: '#800000',
  olive: '#808000',
  aqua: '#00ffff',
  fuchsia: '#ff00ff',
  indigo: '#4b0082',
  violet: '#ee82ee',
  beige: '#f5f5dc',
  coral: '#ff7f50',
  crimson: '#dc143c',
  khaki: '#f0e68c',
  salmon: '#fa8072',
  tan: '#d2b48c',
  turquoise: '#40e0d0'
}

// 颜色名 → hex；已是 #hex 则原样保留；未知名称原样返回
export function colorToHex(color: string): string {
  const c = color.trim().toLowerCase()
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c
  return COLOR_MAP[c] ?? color.trim()
}

// 从图片 URL/路径 提取 Ren'Py 图片文件名（去掉目录与扩展名）
// 例如 images/bg/room.png → room
function imageFileName(url: string): string {
  const clean = url.trim().replace(/\\/g, '/')
  const name = clean.split('/').pop() ?? clean
  return name.replace(/\.[^.]+$/, '')
}

function mdToRenpy(text: string): string {
  let out = text
  // 图片 ![替代文字](图片URL)（必须先于链接，避免 ![ 被链接规则误匹配）
  out = out.replace(/!\[[^\]]*\]\(([^)]+)\)/g, (_m, url: string) => `{image=${imageFileName(url)}}`)
  // 链接 [显示文字](URL)（先于粗体/斜体，支持 [**粗**](url) 等嵌套）
  out = out.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_m, t: string, url: string) => `{a=${url.trim()}}${t}{/a}`)
  // 粗体 **text**
  out = out.replace(/\*\*([^*]+)\*\*/g, (_m, t: string) => `{b}${t}{/b}`)
  // 删除线 ~~text~~
  out = out.replace(/~~([^~]+)~~/g, (_m, t: string) => `{s}${t}{/s}`)
  // 斜体 *text*（粗体已先转换，剩下的 * 即为斜体）
  out = out.replace(/(^|[^*])\*([^*\n]+)\*/g, (_m, pre: string, t: string) => `${pre}{i}${t}{/i}`)
  // HTML 标签（Markdown 中下划线/居中/颜色/大小需用 HTML）
  out = out.replace(/<u>(.*?)<\/u>/gi, (_m, t: string) => `{u}${t}{/u}`)
  out = out.replace(/<center>(.*?)<\/center>/gi, (_m, t: string) => `{center}${t}{/center}`)
  out = out.replace(/<b>(.*?)<\/b>/gi, (_m, t: string) => `{b}${t}{/b}`)
  out = out.replace(/<i>(.*?)<\/i>/gi, (_m, t: string) => `{i}${t}{/i}`)
  out = out.replace(/<s>(.*?)<\/s>/gi, (_m, t: string) => `{s}${t}{/s}`)
  out = out.replace(/<(?:strike|del)>(.*?)<\/(?:strike|del)>/gi, (_m, t: string) => `{s}${t}{/s}`)
  out = out.replace(/<font\s+color\s*=\s*["']?([^"'>\s]+)["']?\s*>(.*?)<\/font>/gi,
    (_m, c: string, t: string) => `{color=${colorToHex(c)}}${t}{/color}`)
  out = out.replace(/<font\s+size\s*=\s*["']?([^"'>\s]+)["']?\s*>(.*?)<\/font>/gi,
    (_m, s: string, t: string) => `{size=+${s}}${t}{/size}`)
  return out
}

function bbToRenpy(text: string): string {
  let out = text
  // 图片 [img]图片URL[/img]
  out = out.replace(/\[img\](.*?)\[\/img\]/gi, (_m, url: string) => `{image=${imageFileName(url)}}`)
  // 颜色 [color=X]text[/color]
  out = out.replace(/\[color\s*=\s*([^\]]+)\](.*?)\[\/color\]/gi,
    (_m, c: string, t: string) => `{color=${colorToHex(c)}}${t}{/color}`)
  // 大小 [size=N]text[/size]
  out = out.replace(/\[size\s*=\s*([^\]]+)\](.*?)\[\/size\]/gi,
    (_m, s: string, t: string) => `{size=+${s}}${t}{/size}`)
  // 链接 [url=X]text[/url]
  out = out.replace(/\[url\s*=\s*([^\]]+)\](.*?)\[\/url\]/gi,
    (_m, u: string, t: string) => `{a=${u.trim()}}${t}{/a}`)
  // 居中 [center]text[/center]
  out = out.replace(/\[center\](.*?)\[\/center\]/gi, (_m, t: string) => `{center}${t}{/center}`)
  // 粗体 / 斜体 / 下划线 / 删除线
  out = out.replace(/\[b\](.*?)\[\/b\]/gi, (_m, t: string) => `{b}${t}{/b}`)
  out = out.replace(/\[i\](.*?)\[\/i\]/gi, (_m, t: string) => `{i}${t}{/i}`)
  out = out.replace(/\[u\](.*?)\[\/u\]/gi, (_m, t: string) => `{u}${t}{/u}`)
  out = out.replace(/\[s\](.*?)\[\/s\]/gi, (_m, t: string) => `{s}${t}{/s}`)
  return out
}

// 按指定模式转换
export function convertRichText(text: string, mode: RichTextMode): string {
  return mode === 'bbcode' ? bbToRenpy(text) : mdToRenpy(text)
}

// 自动检测输入是 BBCode 还是 Markdown
export function detectRichTextMode(text: string): RichTextMode {
  if (/\[(?:b|i|u|s|center|img|color\s*=|size\s*=|url\s*=)/i.test(text)) return 'bbcode'
  return 'markdown'
}
