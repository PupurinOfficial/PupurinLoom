// 对话解析器：把 Ren'Py 脚本片段解析成可视化对话块
// 支持：角色对话、旁白、菜单、跳转、注释、label 声明、存档、视频、场景、show/hide

export type BlockType =
  | 'narration'    // 旁白："..."
  | 'dialogue'     // 角色对话：e "..." / e happy "..."
  | 'menu'         // 菜单块
  | 'menu_option'  // 菜单选项
  | 'jump'         // jump label
  | 'call'         // call label
  | 'label'        // label 声明
  | 'save'         // $ renpy.save("slot")
  | 'movie_cutscene' // $ renpy.movie_cutscene("video")
  | 'scene'        // scene background
  | 'show'         // show character sprite
  | 'hide'         // hide character sprite
  | 'open_url'     // $ renpy.open_url("url")
  | 'default'      // default varName = value
  | 'modify_var'   // $ varName += value / $ varName -= value / $ varName = value
  | 'if'           // if 条件分支（合并 if/elif/else 链）
  | 'return'       // return 返回
  | 'voice'        // voice "voice/xxx.ogg"
  | 'effect'       // with dissolve / with hpunch 等全局特效
  | 'command'      // 其他指令
  | 'comment'      // 注释
  | 'blank'        // 空行

// if/elif/else 分支结构
export interface IfBranch {
  type: 'if' | 'elif' | 'else'
  condition?: string
  children: DialogueBlock[]
}

export interface DialogueBlock {
  type: BlockType
  line: number
  raw: string
  // dialogue / narration
  charVar?: string
  sprite?: string
  text?: string
  // menu
  options?: MenuOptionBlock[]
  // menu_option
  optionText?: string
  optionTarget?: string | null
  // jump / call / label
  target?: string
  labelName?: string
  // save
  saveSlot?: string
  saveDescription?: string
  // movie_cutscene
  videoPath?: string
  // open_url
  urlPath?: string
  // scene
  background?: string
  /** 特效（with 转场/震动/闪光等）：show/scene/hide 后缀参数 或 独立 effect 块 */
  transition?: string
  // show / hide
  showCharVar?: string
  showSprite?: string
  /** 显示/隐藏目标类型：sprite=角色立绘；cg=画廊CG；other=images/ 下任意图片（不写 # loom: 标记，靠 images/ 列表确定性分类） */
  showKind?: 'sprite' | 'cg' | 'other'
  /** 图片名（cg/other 用，含空格时如 "海边 晴" / "bg beach"） */
  showImage?: string
  /** 用户显式切换过类型（sprite/cg 序列化为 `# loom:<kind>` 注释持久化；other 不写标记） */
  showExplicit?: boolean
  // default
  varName?: string
  varValue?: string
  // modify_var
  modifyOp?: 'add' | 'subtract' | 'assign'
  modifyValue?: string
  // if block (merged if/elif/else chain)
  branches?: IfBranch[]
  // children (for menu options)
  children?: DialogueBlock[]
  // voice 语音（dialogue 块使用；独立 voice 块也使用）
  voicePath?: string
  /** 版本标签（r18 / 全年龄 / watch 等）：通过行内注释 `# loom: versions: a,b` 持久化，
   *  导出时按版本方案静态过滤。空/undefined = 所有版本都包含。 */
  versions?: string[]
  /** 翻译 ID：Ren'Py 翻译工具追加在对话/旁白行尾的 `id xxx` 或 `# id xxx`，
   *  原样保存（含前缀），序列化时回写，避免编辑时丢失翻译关联。 */
  id?: string
}

export interface MenuOptionBlock {
  text: string
  target: string | null
  line: number
  children?: DialogueBlock[]
  /** 版本标签（同 DialogueBlock.versions），序列化为选项行内注释 */
  versions?: string[]
}

// Ren'Py 关键字
const KEYWORDS = new Set([
  'jump', 'call', 'menu', 'label', 'return', 'scene', 'show', 'hide',
  'play', 'stop', 'queue', 'pause', 'with', 'set', 'if', 'elif', 'else',
  'while', 'for', 'pass', 'break', 'continue', 'python',
  'default', 'define', 'transform', 'image', 'screen', 'init',
  '$', 'window', 'voice',
])

// 官方内置转场特效的中文显示名（with 语句可直接使用）
export const TRANSITION_LABELS: Record<string, string> = {
  dissolve: '溶解淡入',
  fade: '淡入淡出',
  pixellate: '马赛克切换',
  move: '位置移动',
  moveinright: '右侧滑入',
  moveinleft: '左侧滑入',
  moveintop: '顶部滑入',
  moveinbottom: '底部滑入',
  moveoutright: '右移出场',
  moveoutleft: '左移出场',
  ease: '平滑移动',
  zoomin: '放大显现',
  zoomout: '缩小消失',
  zoominout: '放大再缩小',
  hpunch: '水平震动',
  vpunch: '垂直震动',
  blinds: '百叶窗',
  squares: '方块切换',
  wipeleft: '向左擦除',
  wiperight: '向右擦除',
  wipeup: '向上擦除',
  wipedown: '向下擦除',
  slideleft: '向左滑过',
  slideright: '向右滑过',
  slideawayleft: '向左滑出',
  slideawayright: '向右滑出',
  pushleft: '向左推入',
  pushright: '向右推入',
  pushup: '向上推入',
  pushdown: '向下推入',
  irisin: '聚拢显现',
  irisout: '扩散消失',
}

// 获取特效的中文显示名；未知（用户自定义）返回 undefined，由调用方回退显示原始表达式
export function getTransitionLabel(raw?: string): string | undefined {
  if (!raw) return undefined
  const key = raw.trim()
  return TRANSITION_LABELS[key] ?? undefined
}

// 行尾可带翻译 ID（`id xxx` 或 `# id xxx`），捕获组保存完整 id 串（含可选 # 前缀）
const DIALOGUE_RE = /^\s*([A-Za-z_]\w*)\s+(?:([A-Za-z_]\w*)\s+)?["'](.*?)["']\s*(?:((?:#\s*)?id\s+\S+)\s*)?(?:#.*)?$/
// 带引号角色名的对话：`"路人" "text"` / `"路人" happy "text"`（Ren'Py 允许中文等非标识符角色名）
// 必须在 NARRATION_RE 之前匹配，否则会被旁白正则吞并改写
const DIALOGUE_QUOTED_RE = /^\s*(["'])([^"']{1,30})\1\s+(?:([A-Za-z_]\w*)\s+)?(["'])(.*?)\4\s*(?:((?:#\s*)?id\s+\S+)\s*)?(?:#.*)?$/
const NARRATION_RE = /^\s*["'](.*?)["']\s*(?:((?:#\s*)?id\s+\S+)\s*)?(?:#.*)?$/
const LABEL_RE = /^\s*label\s+([A-Za-z_]\w*)\s*(?:\((.*?)\))?\s*:\s*(?:#.*)?$/
const JUMP_RE = /^\s*jump\s+([A-Za-z_]\w*)\s*(?:#.*)?$/
const CALL_RE = /^\s*call\s+([A-Za-z_]\w*)\s*(?:#.*)?$/
const MENU_RE = /^(\s*)menu\s*([A-Za-z_]\w*)?\s*:\s*(?:#.*)?$/
const MENU_OPTION_RE = /^\s*["'](.+?)["']\s*:\s*(?:jump\s+([A-Za-z_]\w*))?(?:#.*)?$/
const IF_RE = /^(\s*)if\s+(.+?)\s*:\s*(?:#.*)?$/
const ELIF_RE = /^(\s*)elif\s+(.+?)\s*:\s*(?:#.*)?$/
const ELSE_RE = /^(\s*)else\s*:\s*(?:#.*)?$/
const COMMENT_RE = /^\s*(#.*)?$/

// $ renpy.save("slot") 或 $ renpy.save("slot", "description")
const SAVE_RE = /^\s*\$\s*renpy\.save\s*\(\s*["'](.+?)["'](?:\s*,\s*["'](.+?)["'])?\s*\)\s*(?:#.*)?$/

// $ renpy.movie_cutscene("video")
const MOVIE_RE = /^\s*\$\s*renpy\.movie_cutscene\s*\(\s*["'](.+?)["']\s*\)\s*(?:#.*)?$/

// $ renpy.open_url("url")
const OPEN_URL_RE = /^\s*\$\s*renpy\.open_url\s*\(\s*["'](.+?)["']\s*\)\s*(?:#.*)?$/

// scene background  [with transition]
const SCENE_RE = /^\s*scene\s+([A-Za-z_]\w*)\s*(?:with\s+(\S+))?\s*(?:#.*)?$/

// show/hide 目标可为角色（char var）或图片名（画廊CG，可含空格/中文）。
// 解析时统一按「首词 + 次词」拆（角色/CG 代码层面等价，CG 识别交给 UI 层）。
// 末尾可选 with 特效：show e happy with dissolve（次词负向前瞻避免吞掉 with）
const SHOW_RE = /^\s*show\s+(\S+)(?:\s+(?!with\b)(\S+))?(?:\s+with\s+(\S+))?\s*(?:#.*)?$/

// hide charVar [sprite]  [with transition]
const HIDE_RE = /^\s*hide\s+(\S+)(?:\s+(?!with\b)(\S+))?(?:\s+with\s+(\S+))?\s*(?:#.*)?$/

// 独立全局特效：with dissolve / with hpunch / with Fade(0.1, 0.0, 0.5, color="#fff")
// 注释须以空白分隔（避免把 color="#fff" 中的 # 误判为注释）
const WITH_RE = /^\s*with\s+(.+?)(?:\s+#.*)?$/

// default varName = value
const DEFAULT_RE = /^\s*default\s+([A-Za-z_]\w*)\s*=\s*(.+?)\s*(?:#.*)?$/

// $ varName += value / $ varName -= value / $ varName = value
const MODIFY_VAR_RE = /^\s*\$\s*([A-Za-z_]\w*)\s*([\+\-]?=)\s*(.+?)\s*(?:#.*)?$/

// voice "voice/xxx.ogg"
const VOICE_RE = /^\s*voice\s+["'](.+?)["']\s*(?:#.*)?$/

function leadingSpaces(line: string): number {
  return line.length - line.replace(/^\s+/, '').length
}

/** 解析行内 `# loom:` 标记（可同时含类型标记与版本标签）：
 *  例：`# loom:sprite versions: r18,watch` / `# loom: versions: 全年龄`
 *  返回 showKind（sprite/cg，show/hide 专用）与版本标签数组。 */
export function parseLoomTags(raw: string): { showKind?: 'sprite' | 'cg'; versions?: string[] } {
  const m = /#\s*loom:\s*([^#\n]*?)\s*$/.exec(raw)
  if (!m) return {}
  const tokens = m[1].trim().split(/\s+/).filter(Boolean)
  const out: { showKind?: 'sprite' | 'cg'; versions?: string[] } = {}
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t === 'sprite' || t === 'cg') {
      out.showKind = t
    } else if (t === 'versions:' || t === 'versions') {
      const list: string[] = []
      let j = i + 1
      // 收集后续 token 直到下一个含冒号的 key（如 sprite/cg 或新的 xxx:）
      while (j < tokens.length && !tokens[j].includes(':')) {
        list.push(...tokens[j].split(/[,，]/).map((s) => s.trim()).filter(Boolean))
        j++
      }
      if (list.length > 0) out.versions = list
    }
  }
  return out
}

// 给解析出的块回填 # loom: 中的版本/类型信息（show/hide 额外回填 showKind/showExplicit）
function withLoom<T extends DialogueBlock>(block: T, line: string): T {
  const loom = parseLoomTags(line)
  if (loom.showKind && (block.type === 'show' || block.type === 'hide')) {
    return { ...block, showKind: loom.showKind, showExplicit: true, versions: loom.versions }
  }
  if (loom.versions) {
    return { ...block, versions: loom.versions }
  }
  return block
}

// 解析单行内容为 block（不包含子内容）
function parseLineInner(line: string, lineNum: number): DialogueBlock | null {
  // 注释或空行
  if (COMMENT_RE.test(line)) {
    return {
      type: line.trim().startsWith('#') ? 'comment' : 'blank',
      line: lineNum,
      raw: line,
    }
  }

  const lm = line.match(LABEL_RE)
  if (lm) {
    return { type: 'label', line: lineNum, raw: line, labelName: lm[1] }
  }

  const sm = line.match(SAVE_RE)
  if (sm) {
    return { type: 'save', line: lineNum, raw: line, saveSlot: sm[1], saveDescription: sm[2] }
  }

  const mm = line.match(MOVIE_RE)
  if (mm) {
    return { type: 'movie_cutscene', line: lineNum, raw: line, videoPath: mm[1] }
  }

  const om = line.match(OPEN_URL_RE)
  if (om) {
    return { type: 'open_url', line: lineNum, raw: line, urlPath: om[1] }
  }

  const scm = line.match(SCENE_RE)
  if (scm) {
    return { type: 'scene', line: lineNum, raw: line, background: scm[1], transition: scm[2] }
  }

  // 独立全局特效（with xxx）：优先于 show/hide 之外识别
  const wm = line.match(WITH_RE)
  if (wm) {
    return { type: 'effect', line: lineNum, raw: line, transition: wm[1].trim() }
  }

  const shm = line.match(SHOW_RE)
  if (shm) {
    const loomKind = /#\s*loom:(sprite|cg)\b/.exec(line)
    return {
      type: 'show',
      line: lineNum,
      raw: line,
      showCharVar: shm[1],
      showSprite: shm[2],
      transition: shm[3],
      showKind: loomKind ? (loomKind[1] as 'sprite' | 'cg') : undefined,
      showExplicit: loomKind ? true : undefined,
    }
  }

  const hdm = line.match(HIDE_RE)
  if (hdm) {
    const loomKind = /#\s*loom:(sprite|cg)\b/.exec(line)
    return {
      type: 'hide',
      line: lineNum,
      raw: line,
      showCharVar: hdm[1],
      showSprite: hdm[2],
      transition: hdm[3],
      showKind: loomKind ? (loomKind[1] as 'sprite' | 'cg') : undefined,
      showExplicit: loomKind ? true : undefined,
    }
  }

  const dftm = line.match(DEFAULT_RE)
  if (dftm) {
    return { type: 'default', line: lineNum, raw: line, varName: dftm[1], varValue: dftm[2] }
  }

  const mvmm = line.match(MODIFY_VAR_RE)
  if (mvmm) {
    const op = mvmm[2] === '+=' ? 'add' : mvmm[2] === '-=' ? 'subtract' : 'assign'
    return {
      type: 'modify_var',
      line: lineNum,
      raw: line,
      varName: mvmm[1],
      modifyOp: op,
      modifyValue: mvmm[3],
    }
  }

  const jm = line.match(JUMP_RE)
  if (jm) {
    return { type: 'jump', line: lineNum, raw: line, target: jm[1] }
  }

  const cm = line.match(CALL_RE)
  if (cm) {
    return { type: 'call', line: lineNum, raw: line, target: cm[1] }
  }

  const dm = line.match(DIALOGUE_RE)
  if (dm && !KEYWORDS.has(dm[1])) {
    return { type: 'dialogue', line: lineNum, raw: line, charVar: dm[1], sprite: dm[2], text: dm[3], id: dm[4] }
  }

  // 带引号角色名（如 `"路人" "text"`）：charVar 保存完整引号串以便原样回写
  const qdm = line.match(DIALOGUE_QUOTED_RE)
  if (qdm) {
    return {
      type: 'dialogue',
      line: lineNum,
      raw: line,
      charVar: `${qdm[1]}${qdm[2]}${qdm[1]}`,
      sprite: qdm[3],
      text: qdm[5],
      id: qdm[6],
    }
  }

  const nm = line.match(NARRATION_RE)
  if (nm) {
    return { type: 'narration', line: lineNum, raw: line, text: nm[1], id: nm[2] }
  }

  // 无法识别的行作为 command
  return { type: 'command', line: lineNum, raw: line }
}

// parseLineInner + 行内 # loom: 标记回填（versions 对所有块类型生效）
function parseLine(line: string, lineNum: number): DialogueBlock | null {
  const block = parseLineInner(line, lineNum)
  return block ? withLoom(block, line) : null
}

// 递归解析 blocks，支持嵌套结构
function parseBlocks(lines: string[], startIdx: number, baseIndent: number): { blocks: DialogueBlock[]; nextIdx: number } {
  const blocks: DialogueBlock[] = []
  let i = startIdx

  while (i < lines.length) {
    const line = lines[i]
    const lineNum = i + 1
    const indent = leadingSpaces(line)
    const trimmed = line.trim()

    // 空行或注释直接添加
    if (!trimmed) {
      blocks.push({ type: 'blank', line: lineNum, raw: line })
      i++
      continue
    }

    // 如果缩进小于等于基准缩进，说明当前块结束
    if (indent <= baseIndent && trimmed) {
      break
    }

    // voice 语句：若紧跟在后的非空行为对话，则合并为对话块的语音
    const voiceMatch = line.match(VOICE_RE)
    if (voiceMatch) {
      let j = i + 1
      while (j < lines.length && !lines[j].trim()) j++
      const nextLine = lines[j]
      let merged = false
      if (nextLine) {
        const dm = nextLine.match(DIALOGUE_RE)
        if (dm && !KEYWORDS.has(dm[1])) {
          blocks.push({
            type: 'dialogue',
            line: j + 1,
            raw: nextLine,
            charVar: dm[1],
            sprite: dm[2],
            text: dm[3],
            voicePath: voiceMatch[1],
            id: dm[4],
          })
          i = j + 1
          merged = true
        }
      }
      // 后面没有对话时作为独立 voice 块
      if (!merged) {
        blocks.push({ type: 'voice', line: lineNum, raw: line, voicePath: voiceMatch[1] })
        i++
      }
      continue
    }

    // 检查是否是 if/elif/else（需要特殊处理）
    const ifMatch = line.match(IF_RE)
    if (ifMatch) {
      const ifIndent = indent
      const ifLoom = parseLoomTags(line)
      const ifBlock: DialogueBlock = {
        type: 'if',
        line: lineNum,
        raw: line,
        branches: [],
        versions: ifLoom.versions,
      }
      i++

      // 解析 if 分支的 children
      const ifChildResult = parseBlocks(lines, i, ifIndent)
      ifBlock.branches!.push({
        type: 'if',
        condition: ifMatch[2],
        children: ifChildResult.blocks,
      })
      i = ifChildResult.nextIdx

      // 检查后续的 elif/else
      while (i < lines.length) {
        const nextLine = lines[i]
        const nextLineNum = i + 1
        const nextIndent = leadingSpaces(nextLine)
        const nextTrimmed = nextLine.trim()

        if (!nextTrimmed) {
          i++
          continue
        }

        // 如果缩进不等于 if 的缩进，结束
        if (nextIndent !== ifIndent) break

        const elifMatch = nextLine.match(ELIF_RE)
        if (elifMatch) {
          i++
          const elifChildResult = parseBlocks(lines, i, ifIndent)
          ifBlock.branches!.push({
            type: 'elif',
            condition: elifMatch[2],
            children: elifChildResult.blocks,
          })
          i = elifChildResult.nextIdx
          continue
        }

        const elseMatch = nextLine.match(ELSE_RE)
        if (elseMatch) {
          i++
          const elseChildResult = parseBlocks(lines, i, ifIndent)
          ifBlock.branches!.push({
            type: 'else',
            children: elseChildResult.blocks,
          })
          i = elseChildResult.nextIdx
          break
        }

        break
      }
      blocks.push(ifBlock)
      continue
    }

    // 检查是否是 menu
    const menuMatch = line.match(MENU_RE)
    if (menuMatch) {
      const menuIndent = indent
      const menuLoom = parseLoomTags(line)
      const menuBlock: DialogueBlock = {
        type: 'menu',
        line: lineNum,
        raw: line,
        options: [],
        versions: menuLoom.versions,
      }
      i++

      // 解析菜单选项
      while (i < lines.length) {
        const optLine = lines[i]
        const optLineNum = i + 1
        const optIndent = leadingSpaces(optLine)
        const optTrimmed = optLine.trim()

        if (!optTrimmed) {
          i++
          continue
        }

        // 如果缩进小于等于 menu 缩进，结束
        if (optIndent <= menuIndent) break

        const optMatch = optLine.match(MENU_OPTION_RE)
        if (optMatch) {
          const optLoom = parseLoomTags(optLine)
          const opt: MenuOptionBlock = {
            text: optMatch[1],
            target: optMatch[2] ?? null,
            line: optLineNum,
            children: [],
            versions: optLoom.versions,
          }
          i++

          // 检查是否有子内容（缩进更深的行）
          if (i < lines.length) {
            const nextLine = lines[i]
            const nextIndent = leadingSpaces(nextLine)
            const nextTrimmed = nextLine.trim()

            // 如果下一行缩进更深且有内容，解析为 children
            if (nextTrimmed && nextIndent > optIndent) {
              const childResult = parseBlocks(lines, i, optIndent)
              opt.children = childResult.blocks
              i = childResult.nextIdx
            }
          }

          menuBlock.options!.push(opt)
          continue
        }

        // 不是选项格式，结束菜单解析
        break
      }

      blocks.push(menuBlock)
      continue
    }

    // 普通行
    const block = parseLine(line, lineNum)
    if (block) {
      blocks.push(block)
    }
    i++
  }

  return { blocks, nextIdx: i }
}

export function parseDialogue(source: string): DialogueBlock[] {
  const lines = source.split('\n')
  const { blocks } = parseBlocks(lines, 0, -1)
  return blocks
}

// 根据 blocks 计算每个角色当前的立绘状态
// 返回 Map<charVar, { sprite: string | undefined; visible: boolean }>
export interface CharSpriteState {
  sprite?: string
  visible: boolean
}

export function computeCharSpriteStates(blocks: DialogueBlock[]): Map<string, CharSpriteState> {
  const states = new Map<string, CharSpriteState>()
  for (const block of blocks) {
    if (block.type === 'show' && block.showCharVar) {
      states.set(block.showCharVar, {
        sprite: block.showSprite,
        visible: true,
      })
    } else if (block.type === 'hide' && block.showCharVar) {
      // hide 指定差分：只清除该差分；hide 全部（无差分）：清除全部
      const existing = states.get(block.showCharVar)
      if (existing) {
        if (!block.showSprite || existing.sprite === block.showSprite) {
          existing.visible = false
          if (!block.showSprite) {
            existing.sprite = undefined
          }
        }
      } else {
        states.set(block.showCharVar, {
          sprite: block.showSprite,
          visible: false,
        })
      }
    }
  }
  return states
}

/** 依据画廊 CG 名列表 + images/ 图片名列表，把 show/hide 块分类为 立绘(sprite) / 画廊CG(cg) / 其他(other)。
 *  命中画廊 CG 全名（可含空格）→ cg；命中 images/ 自动图片名 → other；否则一律 sprite。
 *  显式 showKind（用户切换或 # loom: 注释）保持不变。「其他」不写代码标记，靠 images/ 列表确定性分类。
 *  递归处理 if/menu 等嵌套子块。放在 parse 之后执行，保证「切换 → 保存 → 重新解析」后分类稳定（不依赖角色名匹配启发式）。 */
export function classifyShowBlocks(blocks: DialogueBlock[], cgImages: string[], otherImages?: string[]): DialogueBlock[] {
  const cgSet = new Set(cgImages)
  const otherSet = new Set(otherImages ?? [])
  // 分类单个块
  const classifyOne = (b: DialogueBlock): DialogueBlock => {
    if (b.type !== 'show' && b.type !== 'hide') return b
    if (b.showKind === 'cg' || b.showKind === 'other') {
      // 归一化：从注释/画廊反解析回的块可能只有 showCharVar+showSprite，补齐 showImage 并清空字符字段
      if (!b.showImage) {
        const full = [b.showCharVar, b.showSprite].filter(Boolean).join(' ')
        if (full) return { ...b, showImage: full, showCharVar: undefined, showSprite: undefined }
      }
      return b
    }
    if (b.showKind === 'sprite') return b
    const full = [b.showCharVar, b.showSprite].filter(Boolean).join(' ')
    if (full && cgSet.has(full)) {
      return { ...b, showKind: 'cg', showImage: full, showCharVar: undefined, showSprite: undefined }
    }
    if (full && otherSet.has(full)) {
      return { ...b, showKind: 'other', showImage: full, showCharVar: undefined, showSprite: undefined }
    }
    return { ...b, showKind: 'sprite' }
  }
  // 递归：分类自身 + 嵌套子块
  const recurse = (b: DialogueBlock): DialogueBlock => {
    const c = classifyOne(b)
    if (c.type === 'if' && c.branches) {
      return { ...c, branches: c.branches.map((br) => ({ ...br, children: br.children.map(recurse) })) }
    }
    if (c.type === 'menu' && c.options) {
      return { ...c, options: c.options.map((o) => ({ ...o, children: (o.children ?? []).map(recurse) })) }
    }
    if (c.children) {
      return { ...c, children: c.children.map(recurse) }
    }
    return c
  }
  return blocks.map(recurse)
}
