// UI 设计器状态模型：把 Ren'Py 的 gui.rpy define + screens.rpy 安全属性集
// 映射成图形化可编辑的状态。所有字段都有明确的写回目标。

// ---------- 主题层（gui.rpy define） ----------

export interface UiColors {
  /** gui.accent_color 强调色 */
  accent: string
  /** gui.idle_color 按钮常态色 */
  idle: string
  /** gui.hover_color 按钮悬停色 */
  hover: string
  /** gui.selected_color 选中色 */
  selected: string
  /** gui.text_color 正文色 */
  text: string
  /** gui.muted_color 弱化色 */
  muted: string
}

export interface UiFonts {
  /** gui.text_font 对话字体（文件名） */
  text: string
  /** gui.name_text_font 姓名框字体 */
  name: string
  /** gui.interface_text_font 界面字体 */
  interface: string
}

export interface UiSizes {
  /** gui.text_size 对话字号 */
  text: number
  /** gui.name_text_size 姓名字号 */
  name: number
  /** gui.interface_text_size 界面字号 */
  interface: number
  /** gui.quick_button_text_size 快捷菜单字号 */
  quickButton: number
  /** gui.choice_button_text_size 选择按钮字号 */
  choiceButton: number
  /** gui.choice_spacing 选择按钮间距 */
  choiceSpacing: number
}

// ---------- 布局层（gui.rpy define + screens.rpy style） ----------

export interface UiLayout {
  /** gui.textbox_yalign 对话窗垂直对齐（0..1，相对屏幕） */
  windowYalign: number
  /** gui.textbox_height 对话窗高度 */
  windowHeight: number
  /** gui.dialogue_xpos 对话文本 X（相对窗口） */
  dialogueX: number
  /** gui.dialogue_ypos 对话文本 Y（相对窗口） */
  dialogueY: number
  /** gui.dialogue_width 对话文本宽度 */
  dialogueWidth: number
  /** gui.dialogue_text_xalign 对话文本对齐 */
  dialogueTextXalign: number
  /** gui.name_xpos 姓名框 X（相对窗口，锚点） */
  nameboxX: number
  /** gui.name_ypos 姓名框 Y（相对窗口） */
  nameboxY: number
  /** gui.name_xalign 姓名框锚点（0 左 / 0.5 中 / 1 右） */
  nameboxXalign: number
  /** screens.rpy choice_vbox ypos 选择菜单垂直位置（锚点居中） */
  choiceY: number
  /** screens.rpy choice_vbox xalign 选择菜单水平对齐 */
  choiceXalign: number
  /** gui.choice_button_width 选择按钮宽度（0 = 未定义，自适应） */
  choiceWidth: number
  /** screens.rpy quick_menu xalign 快捷菜单水平对齐 */
  quickXalign: number
  /** screens.rpy quick_menu yalign 快捷菜单垂直对齐 */
  quickYalign: number
  /** gui.navigation_xpos 导航按钮列 X（标题菜单/游戏菜单共用） */
  navX: number
  /** navigation 屏幕按钮列 Y 对齐（固定 0.5） */
  navYalign: number
  /** gui.namebox_width 姓名框宽度（0 = None，按字号自适应） */
  nameboxWidth: number
  /** gui.namebox_height 姓名框高度（0 = None，按字号自适应） */
  nameboxHeight: number
}

// ---------- 图片层 ----------

export interface UiImages {
  /** 对话窗底图（相对 game/ 路径） */
  textbox: string
  /** 姓名框底图 */
  namebox: string
  /** 选择按钮常态底图 */
  choiceIdle: string
  /** 选择按钮悬停底图 */
  choiceHover: string
  /** 快捷按钮常态底图 */
  quickIdle: string
  /** 快捷按钮悬停底图 */
  quickHover: string
  /** 主菜单背景 */
  mainMenu: string
  /** 游戏菜单背景（gui.game_menu_background） */
  gameMenu: string
}

export interface UiDesignState {
  colors: UiColors
  fonts: UiFonts
  sizes: UiSizes
  layout: UiLayout
  images: UiImages
}

/** 设计器画布上可拖拽的固定元素 */
export type PreviewElementId =
  | 'window' // 对话窗口
  | 'namebox' // 姓名框
  | 'dialogue' // 对话文本
  | 'choice' // 选择菜单
  | 'quick' // 快捷菜单
  | 'nav' // 导航按钮列（标题/游戏菜单）

/** 可设计的界面（Ren'Py 屏幕）：内置主界面 + 项目 screens.rpy 中的其他屏幕 */
export type DesignScreenId = string

export const DESIGN_SCREENS: Array<{ id: DesignScreenId; name: string }> = [
  { id: 'say', name: '对话界面' },
  { id: 'choice', name: '选择菜单' },
  { id: 'main_menu', name: '标题菜单' },
  { id: 'game_menu', name: '游戏菜单' },
  { id: 'preferences', name: '设置' },
]

/** 常见 Ren'Py 屏幕的中文名（下拉列表 / 预览标题用） */
const EXTRA_SCREEN_NAMES: Record<string, string> = {
  about: '关于',
  save: '保存',
  load: '读取游戏',
  file_slots: '存档页',
  history: '历史',
  help: '帮助',
  keyboard_help: '键盘帮助',
  mouse_help: '鼠标帮助',
  gamepad_help: '手柄帮助',
  confirm: '确认',
  notify: '提示',
  input: '输入',
  quick_menu: '快捷菜单',
  skip_indicator: '快进提示',
  nvl: 'NVL 对话',
  nvl_dialogue: 'NVL 对话行',
}

/** 屏幕显示名：内置界面用中文名，其他屏幕优先常见名，缺失时用原始 screen 名 */
export function screenDisplayName(name: string): string {
  return DESIGN_SCREENS.find((d) => d.id === name)?.name ?? EXTRA_SCREEN_NAMES[name] ?? name
}

/** 每个界面可编辑的固定元素（未知 screen 为空数组，仅可放自定义控件） */
export const SCREEN_ELEMENTS: Record<string, PreviewElementId[]> = {
  say: ['window', 'namebox', 'dialogue', 'quick'],
  choice: ['choice'],
  main_menu: ['nav'],
  game_menu: ['nav'],
  preferences: [],
}

export const PREVIEW_ELEMENTS: Array<{ id: PreviewElementId; name: string }> = [
  { id: 'window', name: '对话窗口' },
  { id: 'namebox', name: '姓名框' },
  { id: 'dialogue', name: '对话文本' },
  { id: 'choice', name: '选择菜单' },
  { id: 'quick', name: '快捷菜单' },
  { id: 'nav', name: '导航按钮列' },
]

// ---------- Figma 式自定义控件 ----------

export type CustomControlType =
  | 'text' // 文本（text 语句）
  | 'label' // 标签（label 语句，强调色标题）
  | 'button' // 按钮（textbutton）
  | 'image' // 图片（add）
  | 'bar' // 滑条（bar）
  | 'vbar' // 垂直滑条（vbar）
  | 'slider' // 音量滑条（bar + style "slider"）
  | 'input' // 输入框（input）
  | 'frame' // 面板（add Frame）
  | 'imagebutton' // 图片按钮（imagebutton idle/hover）
  | 'null' // 占位（null width/height）
  | 'hotspot' // 热区按钮（hotspot）
  | 'hotbar' // 热区滑条（hotbar）

export interface CustomControl {
  /** 唯一 id（用于选中/拖拽） */
  id: string
  /** 所属界面 */
  screen: DesignScreenId
  type: CustomControlType
  /** 独立控件：画布绝对坐标；编组内控件：相对编组原点的偏移 */
  x: number
  y: number
  width: number
  height: number
  /** text / label / button / input 显示文本 */
  text?: string
  /** image 的图片路径 */
  image?: string
  /** text / label / button / input 文字颜色 */
  color?: string
  /** text / label / input 字号（button 用 textSize） */
  size?: number
  /** 水平对齐（0 左 / 0.5 中 / 1 右；写回 xalign，仅文本类控件有效） */
  xalign?: number
  /** 透明度（0..1，1 不透明；写回 alpha） */
  alpha?: number
  /** 粗体（text / button，写回 bold True） */
  bold?: boolean
  /** button 文字字号（写回 text_size） */
  textSize?: number
  /** button 悬停文字颜色（写回 hover_color） */
  hoverColor?: string
  /** bar / vbar / slider / hotbar 当前值（0..1，写回 value StaticValue(v, 1.0)） */
  value?: number
  /** imagebutton 悬停图片（写回 hover "..."） */
  hoverImage?: string
}

// ---------- 编组（Figma 式两级选中：第一次选编组，第二次选单个控件） ----------

export type GroupType = 'vbox' | 'hbox' | 'fixed' | 'button' | 'grid' | 'side' | 'window' | 'viewport'

/** 自定义控件编组。子控件坐标存为相对编组原点的偏移；
 *  vbox/hbox 由布局决定子控件位置（相对坐标仅用于解散编组时还原），fixed 直接按相对坐标摆放。
 *  button/grid/side/window/viewport 为 Ren'Py 容器语句，同样可含子控件。 */
export interface CustomGroup {
  id: string
  screen: DesignScreenId
  type: GroupType
  /** 容器左上角（画布绝对坐标） */
  x: number
  y: number
  /** 子控件间距（vbox 纵向 / hbox 横向 / grid 行列 / side 子块；其余忽略） */
  spacing: number
  /** 容器水平对齐（0 左 / 0.5 中 / 1 右；写回 xalign） */
  xalign?: number
  /** 子控件 id（有序） */
  children: string[]
  /** button/window/viewport 容器尺寸（写回 xsize/ysize） */
  width?: number
  height?: number
  /** grid 列数（行数按子控件数自动计算） */
  cols?: number
  /** side 位置字符串（如 "c r"，写回 side "..."） */
  positions?: string
  /** viewport 滚动条（"vertical" / "horizontal" / "both" / undefined 无） */
  scrollbars?: string
}

export const GROUP_TYPES: Array<{ type: GroupType; name: string; desc: string }> = [
  {
    type: 'vbox',
    name: '垂直编组 vbox',
    desc: '子控件从上到下纵向排列，自动按间距排布。适合菜单按钮列、选项列表。',
  },
  {
    type: 'hbox',
    name: '水平编组 hbox',
    desc: '子控件从左到右横向排列，自动按间距排布。适合导航栏、按钮行。',
  },
  {
    type: 'fixed',
    name: '自由编组 fixed',
    desc: '子控件保持各自位置不变，只是归为一个整体，方便一起移动。',
  },
  {
    type: 'button',
    name: '按钮容器 button',
    desc: '标准按钮：可包含文字、图片等子内容，整体可点击（动作留空为 NullAction）。',
  },
  {
    type: 'grid',
    name: '网格 grid',
    desc: '子控件按 列×行 网格排列，行数按子控件数量自动计算。适合画廊、设置面板。',
  },
  {
    type: 'side',
    name: '组合布局 side',
    desc: '按位置串排布子块（如 "c r" 表示中间+右侧）。适合头像+对话框、立绘+文字。',
  },
  {
    type: 'window',
    name: '对话框 window',
    desc: '对话框窗口容器：带背景与内边距，用于对话、提示框等。',
  },
  {
    type: 'viewport',
    name: '滚动视口 viewport',
    desc: '可滚动的显示区域，内容超出时滚动（可配垂直/水平滚动条）。适合长文本、物品栏。',
  },
]

/** 底图自动生成占位值 */
export const AUTO_IMAGE = 'auto'

export const CUSTOM_TYPES: Array<{ type: CustomControlType; name: string; desc: string }> = [
  { type: 'text', name: '文本', desc: '显示一段固定文字，适合标题、说明文字。' },
  { type: 'label', name: '标签', desc: '类似文本，默认使用强调色，常作栏目标题。' },
  { type: 'button', name: '文字按钮', desc: '带文字的按钮，点击触发动作（如开始游戏、返回）。' },
  { type: 'imagebutton', name: '图片按钮', desc: '用图片作为外观的按钮，可配置常态与悬停两张图片。' },
  { type: 'image', name: '图片', desc: '显示一张图片，适合图标、装饰或背景。' },
  { type: 'bar', name: '滑条', desc: '水平进度条，可显示或调节数值（如音量、好感度）。' },
  { type: 'vbar', name: '垂直滑条', desc: '垂直方向的进度条，用法同滑条。' },
  { type: 'slider', name: '音量滑条', desc: '预置为音量调节样式的滑条。' },
  { type: 'hotbar', name: '热区滑条', desc: '覆盖在图片上的透明滑条，玩家在图上拖动即可调节。' },
  { type: 'hotspot', name: '热区按钮', desc: '覆盖在图片上的透明可点击区域，适合给地图、立绘加隐藏入口。' },
  { type: 'input', name: '输入框', desc: '供玩家输入文本，常用于命名角色。' },
  { type: 'frame', name: '面板', desc: '带背景的容器，可包裹其他控件形成卡片区域。' },
  { type: 'null', name: '占位', desc: '透明占位，用于在布局中撑出空白。' },
]

/** 主题预设（只改 gui.rpy 主题层） */
export interface ThemePreset {
  id: string
  name: string
  colors: Partial<UiColors>
  sizes?: Partial<UiSizes>
}

// ---------- 解析写回用 ----------

/** gui.rpy 单条 define */
export interface GuiDefine {
  key: string
  /** 原始值表达式（含引号，如 '#FFE4A6' / "a.ttf" / 33 / gui.xxx） */
  raw: string
  /** 值所在行号（0 起） */
  line: number
}

/** screens.rpy 目标 style 块中的一条属性 */
export interface StyleProp {
  prop: string
  value: string
  line: number
}

/** screens.rpy 目标 style 块 */
export interface StyleBlock {
  name: string
  /** 块起始行（style 声明行，0 起） */
  start: number
  /** 块结束行（不含，0 起） */
  end: number
  props: StyleProp[]
}
