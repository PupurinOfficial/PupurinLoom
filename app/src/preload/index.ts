import { contextBridge, ipcRenderer } from 'electron'

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

export interface CharacterMeta {
  id: string
  name: string
  varName: string
  color: string
  description: string
  sprites: SpriteMeta[]
}

export type VariableType = 'int' | 'float' | 'str' | 'bool'

export interface VariableMeta {
  id: string
  name: string
  varName: string
  type: VariableType
  defaultValue: string
  description: string
}

export interface RpyFileNode {
  name: string
  path: string
  isDir: boolean
  isStoryFile: boolean
  children?: RpyFileNode[]
}

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
  /** 由「创建插件」模板生成，插件页显示开发引导 */
  scaffolded?: boolean
}

// 插件商城条目（与主进程 pluginStore 对应）
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
}

const api = {
  // 后端
  getBackendPort: (): Promise<number | null> => ipcRenderer.invoke('backend:port'),
  getBackendStatus: (): Promise<{ running: boolean; port: number | null; pid: number | null }> =>
    ipcRenderer.invoke('backend:status'),

  // 项目管理
  listProjects: (): Promise<ProjectMeta[]> => ipcRenderer.invoke('projects:list'),
  createProject: (name: string, path?: string, opts?: { title?: string; buildName?: string; resolution?: string; scriptTemplate?: 'minimal' | 'basic' | 'branch' }): Promise<ProjectMeta> =>
    ipcRenderer.invoke('projects:create', name, path, opts),
  openProject: (id: string): Promise<ProjectMeta | null> =>
    ipcRenderer.invoke('projects:open', id),
  deleteProject: (id: string): Promise<void> => ipcRenderer.invoke('projects:delete', id),
  getDefaultDir: (): Promise<string> => ipcRenderer.invoke('projects:defaultDir'),
  getVisibleDir: (): Promise<string> => ipcRenderer.invoke('projects:visibleDir'),
  importProject: (sourcePath: string): Promise<ProjectMeta> =>
    ipcRenderer.invoke('projects:import', sourcePath),
  showProjectInFinder: (projectPath: string): Promise<void> =>
    ipcRenderer.invoke('projects:showInFinder', projectPath),
  runGame: (projectPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('projects:runGame', projectPath),
  runGameFromLine: (projectPath: string, filePath: string, line: number): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('projects:runGameFromLine', projectPath, filePath, line),
  packageGame: (projectPath: string, platform: string): Promise<{ logs: string[] }> =>
    ipcRenderer.invoke('projects:packageGame', projectPath, platform),
  // 网页打包（HTML5/WebAssembly）
  packageWeb: (projectPath: string, opts?: { version?: string; iconPath?: string | null; preview?: boolean }): Promise<{ logs: string[]; webDir?: string; previewUrl?: string | null }> =>
    ipcRenderer.invoke('projects:packageWeb', projectPath, opts),
  // 移动端打包：Android（APK/AAB）/ iOS
  packageMobile: (projectPath: string, opts?: { target?: 'android' | 'ios'; bundle?: boolean; version?: string; packageName?: string; appName?: string }): Promise<{ logs: string[]; outDir?: string }> =>
    ipcRenderer.invoke('projects:packageMobile', projectPath, opts),
  // Ren'Py SDK 引导
  sdkStatus: (): Promise<{ found: boolean; exe: string | null; sdkDir: string | null; platform: string; downloadUrl: string; webOk: boolean; androidOk: boolean; iosOk: boolean; androidSdkOk: boolean; jdkOk: boolean; xcodeOk: boolean; sdkWritable: boolean }> =>
    ipcRenderer.invoke('sdk:status'),
  // 打开 macOS「完全磁盘访问权限」设置页
  openPrivacySettings: (): Promise<void> => ipcRenderer.invoke('sdk:openPrivacySettings'),
  openSdkDownload: (): Promise<void> => ipcRenderer.invoke('sdk:openDownload'),
  sdkOpenLauncher: (): Promise<boolean> => ipcRenderer.invoke('sdk:openLauncher'),
  pickImageFile: (): Promise<string | null> => ipcRenderer.invoke('sdk:pickImageFile'),
  revealPath: (p: string): Promise<void> => ipcRenderer.invoke('sdk:revealPath', p),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:openExternal', url),
  // 应用设置 + 更新检查
  getSettings: (): Promise<Record<string, unknown>> => ipcRenderer.invoke('settings:get'),
  setSetting: (key: string, value: unknown): Promise<Record<string, unknown>> =>
    ipcRenderer.invoke('settings:set', key, value),
  checkUpdate: (): Promise<UpdateCheckResult> => ipcRenderer.invoke('app:checkUpdate'),
  pickDirectory: (): Promise<string | null> => ipcRenderer.invoke('dialog:pickDirectory'),
  probeFs: (dir: string): Promise<{
    target: string; testPath: string; processUid: number; processGid: number
    accessW: boolean | string
    fsMkdir: 'ok' | { code: string; message: string }
    shellMkdir: 'ok' | { code: string; message: string }
    writableLocations: { name: string; path: string; ok: boolean; code?: string }[]
    ok: boolean; error?: string; code?: string
  }> => ipcRenderer.invoke('fs:probe', dir),
  // 全屏状态变化（返回 cleanup 函数）
  onFullscreenChange: (cb: (isFullscreen: boolean) => void): (() => void) => {
    const handler = (_e: unknown, isFull: boolean): void => cb(isFull)
    ipcRenderer.on('window:fullscreen', handler)
    return () => ipcRenderer.removeListener('window:fullscreen', handler)
  },
  // 查询窗口当前是否全屏（组件重挂载时初始化红绿灯占位）
  getIsFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:isFullscreen'),
  // macOS 系统菜单动作（返回 cleanup 函数）
  onMenuAction: (cb: (action: { id: string }) => void): (() => void) => {
    const handler = (_e: unknown, action: { id: string }): void => cb(action)
    ipcRenderer.on('menu:action', handler)
    return () => ipcRenderer.removeListener('menu:action', handler)
  },
  // 窗口关闭保护：主进程询问是否有未保存更改（返回 cleanup 函数）
  onBeforeClose: (cb: () => void): (() => void) => {
    const handler = (): void => cb()
    ipcRenderer.on('app:before-close', handler)
    return () => ipcRenderer.removeListener('app:before-close', handler)
  },
  // 确认后真正关闭窗口（保存/不保存均需调用）
  confirmClose: (): Promise<void> => ipcRenderer.invoke('window:confirmClose'),
  // 弹窗点「取消」：复位主进程退出流程状态（避免 Cmd+Q 取消后残留）
  cancelClose: (): Promise<void> => ipcRenderer.invoke('window:cancelClose'),
  // 同步当前视图到「视图」菜单的 radio 勾选
  setMenuView: (view: string): void => ipcRenderer.send('menu:setView', view),

  // 插件系统
  listPlugins: (): Promise<PluginMeta[]> => ipcRenderer.invoke('plugins:list'),
  loadPluginMain: (id: string): Promise<string | null> => ipcRenderer.invoke('plugins:loadMain', id),
  setPluginEnabled: (id: string, enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('plugins:setEnabled', id, enabled),
  setPluginTrusted: (id: string, trusted: boolean): Promise<void> =>
    ipcRenderer.invoke('plugins:setTrusted', id, trusted),
  openPluginsDir: (): Promise<void> => ipcRenderer.invoke('plugins:openDir'),
  openPluginMain: (id: string): Promise<boolean> => ipcRenderer.invoke('plugins:openMain', id),
  getPluginData: (id: string): Promise<Record<string, unknown>> => ipcRenderer.invoke('plugins:getData', id),
  setPluginData: (id: string, data: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('plugins:setData', id, data),
  // 主进程能力：受限项目文件读写 / HTTP 代理 / 命令执行（exec 需确认弹窗）
  pluginFsRead: (projectPath: string, subPath: string): Promise<string | null> =>
    ipcRenderer.invoke('plugins:fsRead', projectPath, subPath),
  pluginFsWrite: (projectPath: string, subPath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('plugins:fsWrite', projectPath, subPath, content),
  pluginFsList: (projectPath: string, subDir: string): Promise<Array<{ name: string; isDir: boolean; path: string }>> =>
    ipcRenderer.invoke('plugins:fsList', projectPath, subDir),
  pluginFsUploadImage: (projectPath: string): Promise<{ path: string; name: string; cancelled: boolean }> =>
    ipcRenderer.invoke('plugins:uploadImage', projectPath),
  pluginHttp: (method: string, url: string, body?: string, headers?: Record<string, string>): Promise<{ ok: boolean; status: number; text: string }> =>
    ipcRenderer.invoke('plugins:http', method, url, body, headers),
  pluginExec: (command: string): Promise<{ code: number | null; stdout: string; stderr: string }> =>
    ipcRenderer.invoke('plugins:exec', command),
  // 插件商城（链路验证）
  storeFetchIndex: (indexUrl: string): Promise<{ ok: boolean; index?: { plugins: StorePlugin[] }; error?: string; stale?: boolean }> =>
    ipcRenderer.invoke('store:fetchIndex', indexUrl),
  storeInstall: (entry: StorePlugin): Promise<{ ok: boolean; meta?: PluginMeta; error?: string }> =>
    ipcRenderer.invoke('store:install', entry),
  createPlugin: (input: { id: string; name: string; description: string; author: string }): Promise<{ ok: boolean; meta?: PluginMeta; error?: string }> =>
    ipcRenderer.invoke('plugins:create', input),

  // 角色管理
  loadCharacters: (projectRoot: string): Promise<CharacterMeta[]> =>
    ipcRenderer.invoke('characters:load', projectRoot),
  saveCharacters: (projectRoot: string, characters: CharacterMeta[]): Promise<void> =>
    ipcRenderer.invoke('characters:save', projectRoot, characters),
  newCharacter: (name: string): Promise<CharacterMeta> =>
    ipcRenderer.invoke('characters:new', name),
  newSprite: (name: string): Promise<SpriteMeta> =>
    ipcRenderer.invoke('characters:newSprite', name),
  parseCharactersFromScript: (projectRoot: string): Promise<CharacterMeta[]> =>
    ipcRenderer.invoke('characters:parseFromScript', projectRoot),

  // 变量管理
  loadVariables: (projectRoot: string): Promise<VariableMeta[]> =>
    ipcRenderer.invoke('variables:load', projectRoot),
  saveVariables: (projectRoot: string, variables: VariableMeta[]): Promise<void> =>
    ipcRenderer.invoke('variables:save', projectRoot, variables),
  newVariable: (name: string): Promise<VariableMeta> =>
    ipcRenderer.invoke('variables:new', name),
  parseVariablesFromScript: (projectRoot: string): Promise<VariableMeta[]> =>
    ipcRenderer.invoke('variables:parseFromScript', projectRoot),

  // 文件保存
  saveScript: (projectPath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('projects:saveScript', projectPath, content),

  // 资源管理
  listFiles: (projectPath: string, subDir: string): Promise<Array<{ name: string; isDir: boolean; path: string; size: number; isStoryFile: boolean }>> =>
    ipcRenderer.invoke('fs:list', projectPath, subDir),
  createDir: (projectPath: string, subDir: string): Promise<void> =>
    ipcRenderer.invoke('fs:createDir', projectPath, subDir),
  createFile: (projectPath: string, subPath: string, content?: string): Promise<void> =>
    ipcRenderer.invoke('fs:createFile', projectPath, subPath, content),
  renameFile: (projectPath: string, oldPath: string, newName: string): Promise<void> =>
    ipcRenderer.invoke('fs:rename', projectPath, oldPath, newName),
  deleteFile: (projectPath: string, subPath: string): Promise<void> =>
    ipcRenderer.invoke('fs:delete', projectPath, subPath),
  moveFile: (projectPath: string, srcPath: string, destDir: string): Promise<void> =>
    ipcRenderer.invoke('fs:moveFile', projectPath, srcPath, destDir),
  setStoryMark: (projectPath: string, filePath: string, mark: 'story' | 'code' | null): Promise<void> =>
    ipcRenderer.invoke('fs:setStoryMark', projectPath, filePath, mark),
  readFile: (projectPath: string, subPath: string): Promise<string> =>
    ipcRenderer.invoke('fs:readFile', projectPath, subPath),
  importFile: (projectPath: string, destSubDir: string, srcFilePath: string): Promise<string> =>
    ipcRenderer.invoke('fs:importFile', projectPath, destSubDir, srcFilePath),
  importImages: (projectPath: string): Promise<Array<{ path: string; name: string }>> =>
    ipcRenderer.invoke('fs:importImages', projectPath),
  pickFiles: (): Promise<string[]> =>
    ipcRenderer.invoke('dialog:pickFiles'),
  pickAudioFiles: (): Promise<string[]> =>
    ipcRenderer.invoke('dialog:pickAudioFiles'),
  readImageBase64: (projectPath: string, subPath: string): Promise<string> =>
    ipcRenderer.invoke('fs:readImageBase64', projectPath, subPath),
  writeImageBase64: (projectPath: string, subPath: string, dataUrl: string): Promise<void> =>
    ipcRenderer.invoke('fs:writeImageBase64', projectPath, subPath, dataUrl),
  readAudioBase64: (projectPath: string, subPath: string): Promise<string> =>
    ipcRenderer.invoke('fs:readAudioBase64', projectPath, subPath),
  // 非 ASCII 文件名检查与修复（Ren'Py 要求游戏内文件名必须为 ASCII，否则安卓加载失败）
  scanNonAsciiFiles: (projectPath: string): Promise<Array<{ dir: string; oldName: string; suggested: string; isDir: boolean }>> =>
    ipcRenderer.invoke('project:scanNonAsciiFiles', projectPath),
  applyNonAsciiRename: (projectPath: string, items: Array<{ dir: string; oldName: string; newName: string; isDir: boolean }>): Promise<{ logs: string[]; count: number; patchedFiles: number }> =>
    ipcRenderer.invoke('project:applyNonAsciiRename', projectPath, items),
  listRpyFiles: (projectPath: string): Promise<RpyFileNode[]> =>
    ipcRenderer.invoke('fs:listRpyFiles', projectPath),
  saveRpyFile: (projectPath: string, subPath: string, content: string): Promise<void> =>
    ipcRenderer.invoke('fs:saveRpyFile', projectPath, subPath, content),
}

contextBridge.exposeInMainWorld('pupurin', api)

export type PupurinAPI = typeof api
