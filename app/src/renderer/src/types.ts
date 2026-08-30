// Pupurin° Loom 共享类型 — 与 python/parser.py 输出对齐

export interface UpdateCheckResult {
  configured: boolean
  current: string
  hasUpdate?: boolean
  latest?: string
  url?: string
  notes?: string
  error?: string
  /** 更新源类型：GitHub Releases / 自定义 JSON */
  source?: 'github' | 'custom'
  /** GitHub Release 页面地址（source 为 github 时有值） */
  pageUrl?: string
}

export interface MenuOption {
  text: string
  target: string | null
  line: number
}

export interface LabelNode {
  id: string
  name: string
  line: number
  end_line: number
  source: string
  doc: string
  menu_options: MenuOption[]
  /** 所属 .rpy 文件（相对 game/），聚合解析时填充 */
  file?: string
}

export interface FlowEdge {
  source: string | null
  target: string
  type: 'jump' | 'call' | 'menu'
  line: number
  option_text?: string | null
  /** 所属 .rpy 文件（相对 game/），聚合解析时填充 */
  file?: string
  /** 目标 label 是否存在于项目（聚合解析时填充） */
  resolved?: boolean
}

export interface ParseResult {
  labels: LabelNode[]
  edges: FlowEdge[]
  label_names: string[]
  line_count: number
  full_source: string
  dialogue_chars: number
}

// 条件语句中引用的变量位置（聚合解析返回）
export interface VariableUsage {
  var: string
  file: string // 相对 game/ 的 .rpy 路径
  line: number
  condition: string
}

// 全项目聚合解析结果（/api/parse-project）
export interface ProjectParseResult {
  labels: LabelNode[]
  edges: FlowEdge[]
  label_names: string[]
  files: string[]
  dialogue_chars: number
  variable_usages: VariableUsage[]
}

export interface LogEntry {
  type: string
  level?: string
  msg: string
  t?: number
}

export interface BackendStatus {
  running: boolean
  port: number | null
  pid: number | null
}

export type ConsoleFilter = 'all' | 'info' | 'system' | 'error'

export interface ProjectMeta {
  id: string
  name: string
  path: string
  createdAt: number
  lastOpenedAt: number
  _missing?: boolean
}

export interface SpriteMeta {
  id: string
  name: string
  path: string
}

// 头像来源类型
// - initial: 角色名首字（默认）
// - sprite:  从立绘差分截取头部（上 1/3）
// - custom:  自定义图片路径
export type AvatarType = 'initial' | 'sprite' | 'custom'

export interface AvatarConfig {
  type: AvatarType
  // type=sprite 时关联的差分 ID
  spriteId?: string
  // type=custom 时的图片路径（相对 game/）
  customPath?: string
}

export interface CharacterMeta {
  id: string
  name: string
  varName: string
  color: string
  description: string
  sprites: SpriteMeta[]
  avatar?: AvatarConfig
}

// ---- 剧情编辑器相关 ----

// 文件树节点：文件夹或场景
export interface StoryItem {
  id: string
  name: string
  type: 'folder' | 'scene'
  children?: StoryItem[]
  // 场景节点关联的 label（对应 LabelNode.id）
  labelId?: string
  // 场景描述（来自 label.doc）
  description?: string
  // 场景关联的角色名（从 label.source 中提取的角色对话者）
  characters?: string[]
}

// 统一选择模型：右侧属性面板根据此状态渲染
export type SelectionType = 'label' | 'character' | 'scene' | 'project' | null

export interface SelectionState {
  type: SelectionType
  id: string | null
}

// 编辑器视图模式
export type EditorViewMode = 'graphical' | 'code'

// .rpy 文件树节点
export interface RpyFileNode {
  name: string
  path: string // 相对 game/ 的路径，如 "script.rpy" 或 "chapter1/scene.rpy"
  isDir: boolean
  isStoryFile: boolean // 是否含至少一个 label 定义
  children?: RpyFileNode[]
}

// 变量定义
export type VariableType = 'int' | 'float' | 'str' | 'bool'

export interface VariableMeta {
  id: string
  name: string // 显示名
  varName: string // Ren'Py 变量名
  type: VariableType
  defaultValue: string // 默认值（字符串形式）
  description: string // 简介
}

// 变量修改操作类型
export type VariableModifyOp = 'add' | 'subtract' | 'assign'

// 变量修改操作
export interface VariableModifyAction {
  variableName: string
  operation: VariableModifyOp // add: +=, subtract: -=, assign: =
  value: string // 修改的值
}

// ---- 非 ASCII 文件名检查与修复 ----

// 扫描结果：一个需要重命名的文件/目录
export interface NonAsciiRenameItem {
  dir: string // 相对 game/ 的目录（'' = game 根目录）
  oldName: string
  suggested: string // 系统默认建议的新名称（用户可修改）
  isDir: boolean
}

// 应用重命名时提交的项目（newName 为用户确认后的名称）
export interface NonAsciiRenameApplyItem {
  dir: string
  oldName: string
  newName: string
  isDir: boolean
}

// 应用结果
export interface NonAsciiRenameResult {
  logs: string[]
  count: number // 实际重命名数量
  patchedFiles: number // 被更新引用的 .rpy 文件数
}

declare global {
  interface Window {
    pupurin: {
      getBackendPort: () => Promise<number | null>
      getBackendStatus: () => Promise<BackendStatus>
      listProjects: () => Promise<ProjectMeta[]>
      createProject: (name: string, path?: string, opts?: { title?: string; buildName?: string; resolution?: string; scriptTemplate?: 'minimal' | 'basic' | 'branch' }) => Promise<ProjectMeta>
      openProject: (id: string) => Promise<ProjectMeta | null>
      deleteProject: (id: string) => Promise<void>
      importProject: (sourcePath: string) => Promise<ProjectMeta>
      parseCharactersFromScript: (projectRoot: string) => Promise<CharacterMeta[]>
      getDefaultDir: () => Promise<string>
      getVisibleDir: () => Promise<string>
      pickDirectory: () => Promise<string | null>
      showProjectInFinder: (projectPath: string) => Promise<void>
      runGame: (projectPath: string) => Promise<{ success: boolean; error?: string }>
      // 从指定文件+行号开始运行（Ren'Py --warp）
      runGameFromLine: (projectPath: string, filePath: string, line: number) => Promise<{ success: boolean; error?: string }>
      packageGame: (projectPath: string, platform: string) => Promise<{ logs: string[]; buildsDir?: string }>
      // 网页打包（HTML5/WebAssembly）
      packageWeb: (projectPath: string, opts?: { version?: string; iconPath?: string | null; preview?: boolean }) => Promise<{ logs: string[]; webDir?: string; previewUrl?: string | null }>
      // 移动端打包：Android（APK/AAB）/ iOS
      packageMobile: (projectPath: string, opts?: { target?: 'android' | 'ios'; bundle?: boolean; version?: string; packageName?: string; appName?: string }) => Promise<{ logs: string[]; outDir?: string }>
      // Ren'Py SDK 引导
      sdkStatus: () => Promise<{ found: boolean; exe: string | null; sdkDir: string | null; platform: string; downloadUrl: string; webOk: boolean; androidOk: boolean; iosOk: boolean; androidSdkOk: boolean; jdkOk: boolean; xcodeOk: boolean; sdkWritable: boolean }>
      // 打开 macOS「完全磁盘访问权限」设置页
      openPrivacySettings: () => Promise<void>
      openSdkDownload: () => Promise<void>
      sdkOpenLauncher: () => Promise<boolean>
      pickImageFile: () => Promise<string | null>
      revealPath: (p: string) => Promise<void>
      openExternal: (url: string) => Promise<void>
      getSettings: () => Promise<Record<string, unknown>>
      setSetting: (key: string, value: unknown) => Promise<Record<string, unknown>>
      checkUpdate: () => Promise<UpdateCheckResult>
      probeFs: (dir: string) => Promise<{
        target: string; testPath: string; processUid: number; processGid: number
        accessW: boolean | string
        fsMkdir: 'ok' | { code: string; message: string }
        shellMkdir: 'ok' | { code: string; message: string }
        writableLocations: { name: string; path: string; ok: boolean; code?: string }[]
        ok: boolean; error?: string; code?: string
      }>
      onFullscreenChange: (cb: (isFullscreen: boolean) => void) => () => void
      // 查询窗口当前是否全屏（组件重挂载时初始化红绿灯占位）
      getIsFullscreen: () => Promise<boolean>
      // macOS 系统菜单动作（返回取消订阅函数）
      onMenuAction: (cb: (action: { id: string }) => void) => () => void
      // 窗口关闭保护：主进程询问是否有未保存更改（返回取消订阅函数）
      onBeforeClose: (cb: () => void) => () => void
      // 确认后真正关闭窗口（保存/不保存均需调用）
      confirmClose: () => Promise<void>
      // 弹窗点「取消」：复位主进程退出流程状态（避免 Cmd+Q 取消后残留）
      cancelClose: () => Promise<void>
      // 同步当前视图到「视图」菜单的 radio 勾选
      setMenuView: (view: string) => void
      loadCharacters: (projectRoot: string) => Promise<CharacterMeta[]>
      saveCharacters: (projectRoot: string, characters: CharacterMeta[]) => Promise<void>
      newCharacter: (name: string) => Promise<CharacterMeta>
      newSprite: (name: string) => Promise<SpriteMeta>
      saveScript: (projectPath: string, content: string) => Promise<void>
      listFiles: (projectPath: string, subDir: string) => Promise<Array<{ name: string; isDir: boolean; path: string; size: number; isStoryFile: boolean }>>
      createDir: (projectPath: string, subDir: string) => Promise<void>
      createFile: (projectPath: string, subPath: string, content?: string) => Promise<void>
      renameFile: (projectPath: string, oldPath: string, newName: string) => Promise<void>
      deleteFile: (projectPath: string, subPath: string) => Promise<void>
      moveFile: (projectPath: string, srcPath: string, destDir: string) => Promise<void>
      setStoryMark: (projectPath: string, filePath: string, mark: 'story' | 'code' | null) => Promise<void>
      readFile: (projectPath: string, subPath: string) => Promise<string>
      importFile: (projectPath: string, destSubDir: string, srcFilePath: string) => Promise<string>
      importImages: (projectPath: string) => Promise<Array<{ path: string; name: string }>>
      pickFiles: () => Promise<string[]>
      pickAudioFiles: () => Promise<string[]>
      readImageBase64: (projectPath: string, subPath: string) => Promise<string>
      writeImageBase64: (projectPath: string, subPath: string, dataUrl: string) => Promise<void>
      readAudioBase64: (projectPath: string, subPath: string) => Promise<string>
      listRpyFiles: (projectPath: string) => Promise<RpyFileNode[]>
      saveRpyFile: (projectPath: string, subPath: string, content: string) => Promise<void>
      // 变量管理
      loadVariables: (projectPath: string) => Promise<VariableMeta[]>
      saveVariables: (projectPath: string, variables: VariableMeta[]) => Promise<void>
      newVariable: (name: string) => Promise<VariableMeta>
      parseVariablesFromScript: (projectPath: string) => Promise<VariableMeta[]>
      // 非 ASCII 文件名检查与修复（Ren'Py 要求游戏内文件名必须为 ASCII）
      scanNonAsciiFiles: (projectPath: string) => Promise<NonAsciiRenameItem[]>
      applyNonAsciiRename: (projectPath: string, items: NonAsciiRenameApplyItem[]) => Promise<NonAsciiRenameResult>
      // 插件系统
      listPlugins: () => Promise<PluginMeta[]>
      loadPluginMain: (id: string) => Promise<string | null>
      setPluginEnabled: (id: string, enabled: boolean) => Promise<void>
      setPluginTrusted: (id: string, trusted: boolean) => Promise<void>
      openPluginsDir: () => Promise<void>
      openPluginMain: (id: string) => Promise<boolean>
      getPluginData: (id: string) => Promise<Record<string, unknown>>
      setPluginData: (id: string, data: Record<string, unknown>) => Promise<void>
      // 主进程能力：受限项目文件读写 / HTTP 代理 / 命令执行（exec 需确认弹窗）
      pluginFsRead: (projectPath: string, subPath: string) => Promise<string | null>
      pluginFsWrite: (projectPath: string, subPath: string, content: string) => Promise<void>
      pluginFsList: (projectPath: string, subDir: string) => Promise<Array<{ name: string; isDir: boolean; path: string }>>
      pluginFsUploadImage: (projectPath: string) => Promise<{ path: string; name: string; cancelled: boolean }>
      pluginHttp: (method: string, url: string, body?: string, headers?: Record<string, string>) => Promise<{ ok: boolean; status: number; text: string }>
      pluginExec: (command: string) => Promise<{ code: number | null; stdout: string; stderr: string }>
      // 插件商城（链路验证）
      storeFetchIndex: (indexUrl: string) => Promise<{ ok: boolean; index?: { plugins: StorePlugin[] }; error?: string; stale?: boolean }>
      storeInstall: (entry: StorePlugin) => Promise<{ ok: boolean; meta?: PluginMeta; error?: string }>
      // 从官方模板创建插件（商城仓库 template/ 目录）
      createPlugin: (input: { id: string; name: string; description: string; author: string }) => Promise<{ ok: boolean; meta?: PluginMeta; error?: string }>
    }
  }
}

export interface PluginMeta {
  id: string
  name: string
  version: string
  description: string
  author: string
  main: string
  builtin: boolean
  enabled: boolean
  trusted: boolean
  hasMain: boolean
  /** 图标（manifest.icon）：emoji / data URI / SVG 字符串 */
  icon?: string
  /** 由「创建插件」模板生成，插件页显示开发引导 */
  scaffolded?: boolean
}

// 插件商城条目
export interface StorePlugin {
  id: string
  name: string
  version: string
  description: string
  author: string
  repo: string
  subpath?: string
  tag?: string
  sha256?: string
  homepage?: string
  minLoomVersion?: string
  /** 图标（emoji / data URI / SVG 字符串），未提供时按 id 匹配内置图标库 */
  icon?: string
}
