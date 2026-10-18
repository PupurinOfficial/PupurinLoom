// 灵感词库 store：项目主页「来点灵感」板块的滚动词条
// - 四个类别：形容词 / 角色 / 动词 / 名词，默认使用内置词库（角色行取自项目角色）
// - order：各行从上到下的顺序，可由用户在「板块设置」中调整；hidden 控制某行是否显示
// - words：每类可自定义（也可由 AI 生成后写入）；角色行额外自动读取项目角色名
// - wordColors：逐词配色（可选，未配色的词用默认样式；角色自动词默认取角色自带色）
// - 数据按项目隔离持久化到 localStorage（同 versionSchemes 的做法）
import { create } from 'zustand'

export type InspirationCategory = 'adj' | 'char' | 'verb' | 'noun'

export const INSPIRATION_CATEGORIES: { id: InspirationCategory; label: string }[] = [
  { id: 'adj', label: '形容词' },
  { id: 'char', label: '角色' },
  { id: 'verb', label: '动词' },
  { id: 'noun', label: '名词' },
]

export const DEFAULT_ORDER: InspirationCategory[] = ['adj', 'char', 'verb', 'noun']

/** 内置默认词库（用户未自定义时使用）；角色行默认为空，由项目角色自动填充 */
export const DEFAULT_INSPIRATION_WORDS: Record<InspirationCategory, string[]> = {
  adj: [
    '兴奋的', '温柔的', '寂静的', '潮湿的', '遥远的', '明亮的', '恍惚的', '甜腻的',
    '冰凉的', '拥挤的', '褪色的', '灼热的', '沙哑的', '蓬松的', '空荡的', '鲜活的',
    '疲倦的', '锋利的', '柔软的', '沉重的', '透明的', '微小的', '深蓝色的', '苍白的',
    '喧闹的', '孤独的', '漫长的', '短暂的', '破旧的', '崭新的', '模糊的', '尖锐的',
    '温暖的', '冰冷的', '咸涩的', '斑驳的', '迟缓的', '敏捷的', '干净的', '凌乱的',
    '安静的', '刺眼的', '柔和的', '干裂的', '光滑的', '粗糙的', '甜美的', '苦涩的',
    '紧张的', '松弛的', '慌张的', '从容的', '沉默的', '喧哗的', '朦胧的', '清澈的',
    '浑浊的', '轻盈的', '蓬乱的', '素净的', '滚烫的', '微凉的',
  ],
  char: [],
  verb: [
    '奔跑', '跌倒', '回头', '凝望', '微笑', '流泪', '拥抱', '松手',
    '追赶', '停顿', '转身', '蹲下', '仰望', '低头', '深呼吸', '咬着',
    '抓住', '放开', '拉扯', '推着', '抚摸', '敲打', '晃荡', '摇晃',
    '摇摆', '滑落', '飘起', '坠下', '上升', '沉没', '散开', '聚拢',
    '穿过', '绕开', '越过', '钻入', '爬出', '跳下', '攀上', '翻过',
    '淌过', '淋着', '晒着', '吹着', '听着', '数着', '等着', '睡着',
    '醒来', '睁眼', '闭眼', '憋气', '吐气', '唱歌', '哼着', '低语',
    '喊出', '点头', '摇头', '耸肩', '撒谎', '坦白', '告别', '重逢',
    '迷路', '许愿', '失约', '妥协', '反抗', '颤抖', '融化', '冻结',
    '燃烧', '熄灭', '盛开', '凋零', '腐烂', '发芽',
  ],
  noun: [
    '河边', '月光', '蝉鸣', '站台', '汽水', '操场', '天台', '便利店',
    '校服', '单车', '雨伞', '车厢', '走廊', '阁楼', '旧书', '磁带',
    '耳机', '围巾', '玻璃', '窗户', '水面', '沙滩', '路灯', '招牌',
    '台阶', '雨滴', '云层', '落日', '晨雾', '雪地', '花园', '树影',
    '长椅', '钥匙', '信封', '相册', '相机', '信箱', '拖鞋', '毛毯',
    '台灯', '茶杯', '便当', '药片', '屏幕', '键盘', '迷宫', '影子',
    '泡沫', '气泡', '裙摆', '发绳', '纽扣', '硬币', '车票', '船票',
    '地图', '指南针', '风铃', '风筝', '烟花', '蜡烛', '蛋糕', '气球',
    '铃铛', '琴键', '唱片', '舞鞋', '剧本', '面具', '教室', '屋顶',
    '河堤', '麦田', '隧道', '桥洞', '港口', '灯塔', '沙漏', '镜子',
  ],
}

/** 供 AI 生成时使用的类别标签（提示词里用中文） */
export function categoryLabel(id: InspirationCategory): string {
  return INSPIRATION_CATEGORIES.find((c) => c.id === id)?.label ?? id
}

/** 把多行/多分隔符文本解析为词条数组（去空、去重、保序） */
export function parseWords(text: string): string[] {
  const parts = String(text || '')
    .split(/[\n,，、;；|]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  return Array.from(new Set(parts))
}

/** 洗牌（Fisher–Yates，返回新数组） */
export function shuffle<T>(arr: T[]): T[] {
  const a = arr.slice()
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

/** 逐词配色：类别 → 词条 → 颜色（#RRGGBB） */
export type WordColors = Record<InspirationCategory, Record<string, string>>
/** 各行是否显示：类别 → 是否隐藏 */
export type HiddenMap = Record<InspirationCategory, boolean>

interface StoredShape {
  order?: unknown
  words?: unknown
  colors?: unknown
  hidden?: unknown
  charAuto?: unknown
}

interface InspirationState {
  projectPath: string | null
  order: InspirationCategory[]
  words: Record<InspirationCategory, string[]>
  wordColors: WordColors
  hidden: HiddenMap
  /** 角色行是否自动读取项目角色名（默认开启，手动/AI 补充的词始终叠加） */
  charAuto: boolean
  dialogOpen: boolean

  load: (projectPath: string) => void
  persist: () => void
  setOrder: (order: InspirationCategory[]) => void
  moveCategory: (id: InspirationCategory, dir: -1 | 1) => void
  setWords: (id: InspirationCategory, words: string[]) => void
  resetWords: (id: InspirationCategory) => void
  setWordColor: (id: InspirationCategory, word: string, color: string) => void
  clearWordColor: (id: InspirationCategory, word: string) => void
  toggleHidden: (id: InspirationCategory) => void
  setCharAuto: (on: boolean) => void
  resetAll: () => void
  openDialog: () => void
  closeDialog: () => void
}

const KEY_PREFIX = 'loom-inspiration:'
const key = (projectPath: string): string => KEY_PREFIX + projectPath
const COLOR_RE = /^#[0-9a-fA-F]{6}$/

function cloneDefaults(): Record<InspirationCategory, string[]> {
  return {
    adj: DEFAULT_INSPIRATION_WORDS.adj.slice(),
    char: DEFAULT_INSPIRATION_WORDS.char.slice(),
    verb: DEFAULT_INSPIRATION_WORDS.verb.slice(),
    noun: DEFAULT_INSPIRATION_WORDS.noun.slice(),
  }
}

function emptyColors(): WordColors {
  return { adj: {}, char: {}, verb: {}, noun: {} }
}

function emptyHidden(): HiddenMap {
  return { adj: false, char: false, verb: false, noun: false }
}

function normalizeOrder(raw: unknown): InspirationCategory[] {
  const valid: InspirationCategory[] = ['adj', 'char', 'verb', 'noun']
  const arr = Array.isArray(raw) ? raw.filter((x): x is InspirationCategory => valid.includes(x)) : []
  // 补全缺失类别，保证始终是四行
  const seen = new Set(arr)
  return [...arr, ...DEFAULT_ORDER.filter((c) => !seen.has(c))]
}

function normalizeWords(raw: unknown): Record<InspirationCategory, string[]> {
  const out = cloneDefaults()
  if (!raw || typeof raw !== 'object') return out
  const o = raw as Record<string, unknown>
  for (const c of DEFAULT_ORDER) {
    const list = o[c]
    if (Array.isArray(list)) {
      const cleaned = list.filter((x): x is string => typeof x === 'string').map((s) => s.trim()).filter(Boolean)
      // 空数组视为「未自定义」：非角色类别回退默认词库，角色类别默认即空
      if (cleaned.length > 0) out[c] = Array.from(new Set(cleaned))
    }
  }
  return out
}

function normalizeColors(raw: unknown): WordColors {
  const out = emptyColors()
  if (!raw || typeof raw !== 'object') return out
  const o = raw as Record<string, unknown>
  for (const c of DEFAULT_ORDER) {
    const map = o[c]
    if (!map || typeof map !== 'object') continue
    const acc: Record<string, string> = {}
    for (const [word, color] of Object.entries(map as Record<string, unknown>)) {
      if (typeof color === 'string' && COLOR_RE.test(color)) acc[word] = color
    }
    out[c] = acc
  }
  return out
}

function normalizeHidden(raw: unknown): HiddenMap {
  const out = emptyHidden()
  if (!raw || typeof raw !== 'object') return out
  const o = raw as Record<string, unknown>
  for (const c of DEFAULT_ORDER) {
    if (typeof o[c] === 'boolean') out[c] = o[c] as boolean
  }
  return out
}

export const useInspiration = create<InspirationState>((set, get) => ({
  projectPath: null,
  order: DEFAULT_ORDER.slice(),
  words: cloneDefaults(),
  wordColors: emptyColors(),
  hidden: emptyHidden(),
  charAuto: true,
  dialogOpen: false,

  load: (projectPath) => {
    let parsed: StoredShape = {}
    try {
      const raw = localStorage.getItem(key(projectPath))
      if (raw) parsed = JSON.parse(raw) as StoredShape
    } catch {
      /* 读取失败回退默认 */
    }
    set({
      projectPath,
      order: normalizeOrder(parsed.order),
      words: normalizeWords(parsed.words),
      wordColors: normalizeColors(parsed.colors),
      hidden: normalizeHidden(parsed.hidden),
      charAuto: typeof parsed.charAuto === 'boolean' ? parsed.charAuto : true,
    })
  },

  persist: () => {
    const { projectPath, order, words, wordColors, hidden, charAuto } = get()
    if (!projectPath) return
    try {
      localStorage.setItem(key(projectPath), JSON.stringify({ order, words, colors: wordColors, hidden, charAuto }))
    } catch {
      /* ignore */
    }
  },

  setOrder: (order) => {
    set({ order: normalizeOrder(order) })
    get().persist()
  },

  moveCategory: (id, dir) => {
    const order = get().order.slice()
    const i = order.indexOf(id)
    const j = i + dir
    if (i < 0 || j < 0 || j >= order.length) return
    ;[order[i], order[j]] = [order[j], order[i]]
    set({ order })
    get().persist()
  },

  setWords: (id, words) => {
    const cleaned = Array.from(new Set(words.map((s) => s.trim()).filter(Boolean)))
    set({ words: { ...get().words, [id]: cleaned.length > 0 ? cleaned : DEFAULT_INSPIRATION_WORDS[id].slice() } })
    get().persist()
  },

  resetWords: (id) => {
    set({ words: { ...get().words, [id]: DEFAULT_INSPIRATION_WORDS[id].slice() } })
    get().persist()
  },

  setWordColor: (id, word, color) => {
    if (!word) return
    const cat = { ...get().wordColors[id] }
    if (color && COLOR_RE.test(color)) cat[word] = color
    else delete cat[word]
    set({ wordColors: { ...get().wordColors, [id]: cat } })
    get().persist()
  },

  clearWordColor: (id, word) => {
    const cat = { ...get().wordColors[id] }
    delete cat[word]
    set({ wordColors: { ...get().wordColors, [id]: cat } })
    get().persist()
  },

  toggleHidden: (id) => {
    set({ hidden: { ...get().hidden, [id]: !get().hidden[id] } })
    get().persist()
  },

  setCharAuto: (on) => {
    set({ charAuto: !!on })
    get().persist()
  },

  resetAll: () => {
    set({
      order: DEFAULT_ORDER.slice(),
      words: cloneDefaults(),
      wordColors: emptyColors(),
      hidden: emptyHidden(),
      charAuto: true,
    })
    get().persist()
  },

  openDialog: () => set({ dialogOpen: true }),
  closeDialog: () => set({ dialogOpen: false }),
}))
