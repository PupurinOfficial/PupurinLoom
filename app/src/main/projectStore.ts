// Pupurin° Loom — 项目元数据存储（主进程）
// 持久化到 userData/projects.json，原子写（临时文件 + rename）
import { app, dialog } from 'electron'
import { promises as fs, constants as fsConstants } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, resolve } from 'node:path'
import { randomBytes } from 'node:crypto'

const execFileAsync = promisify(execFile)

export interface Project {
  id: string
  name: string
  path: string // 项目根目录绝对路径（含 game/script.rpy）
  createdAt: number
  lastOpenedAt: number
}

// 新项目向导选项
export interface CreateProjectOptions {
  /** 游戏显示名（config.name），默认等于目录名 */
  title?: string
  /** 内部 ASCII 名（build.name），默认由目录名生成 */
  buildName?: string
  /** 屏幕分辨率，如 "1280x720" / "1080x1920"；省略则保持模板默认 */
  resolution?: string
  /** script.rpy 骨架模板：minimal 极简 / basic 简单开场 / branch 带选项分支 */
  scriptTemplate?: 'minimal' | 'basic' | 'branch'
}

// script.rpy 骨架模板（生成合法 Ren'Py 语法）
const SCRIPT_TEMPLATES: Record<'minimal' | 'basic' | 'branch', (title: string) => string> = {
  minimal: () => `# 由 铃言织机° 创建的开场脚本
label start:
    "故事从这里开始……"
    return
`,
  basic: (title) => `# 由 铃言织机° 创建的开场脚本（可编辑或替换）
define e = Character("艾琳", color="#c8ffc8")

label start:
    "清晨，阳光透过窗帘洒进房间。"
    e "欢迎来到「${title}」的世界！"
    e "在左侧的「角色」和「变量」中管理角色与数据，"
    e "在「织机」中用可视化方式编辑剧情。"
    return
`,
  branch: (title) => `# 由 铃言织机° 创建的开场脚本（带选项分支示例）
define e = Character("艾琳", color="#c8ffc8")

label start:
    "清晨，阳光透过窗帘洒进房间。"
    e "「${title}」的第一天，想做些什么呢？"

    menu:
        "出门走走":
            "你决定出门散步，呼吸新鲜空气。"
        "待在家里":
            "你决定待在家里，享受悠闲的一天。"

    e "这一天，就这样开始了。"
    return
`,
}

// 注意：必须在函数内动态获取，不能在模块顶层计算
// （因为 import 时 app.setPath 尚未执行，getPath 会返回默认的 ~/Library/.../Chromium）
function getStoreFile(): string {
  return join(app.getPath('userData'), 'projects.json')
}

// 获取项目模板文件夹路径
function getTemplateDir(): string {
  // 开发环境：从项目根目录的模板文件夹
  // 生产环境：从 resources 目录
  const isDev = process.env.NODE_ENV === 'development'
  if (isDev) {
    return join(app.getAppPath(), 'a new Pupurin Loom game')
  }
  return join(process.resourcesPath, 'a new Pupurin Loom game')
}

async function readStore(): Promise<Project[]> {
  try {
    const raw = await fs.readFile(getStoreFile(), 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data.projects) ? data.projects : []
  } catch {
    return []
  }
}

// 原子写：先写临时文件再 rename，避免竞态写坏 JSON
async function writeStore(projects: Project[]): Promise<void> {
  const storeFile = getStoreFile()
  const tmp = storeFile + '.tmp'
  await fs.writeFile(tmp, JSON.stringify({ projects }, null, 2), 'utf-8')
  await fs.rename(tmp, storeFile)
}

export async function listProjects(): Promise<Project[]> {
  const projects = await readStore()
  // 校验 path 仍存在，标记失效
  const valid: Project[] = []
  for (const p of projects) {
    try {
      await fs.access(p.path)
      valid.push(p)
    } catch {
      // path 失效，跳过（不删除记录，保留以便后续"定位"）
      valid.push({ ...p, _missing: true } as Project & { _missing?: boolean })
    }
  }
  return valid.sort((a, b) => b.lastOpenedAt - a.lastOpenedAt)
}

// 诊断：对比 fs.mkdir vs shell mkdir + 多目录可写性，定位 EPERM 根因
export interface ProbeResult {
  target: string
  testPath: string
  processUid: number
  processGid: number
  accessW: boolean | string
  fsMkdir: 'ok' | { code: string; message: string }
  shellMkdir: 'ok' | { code: string; message: string }
  // 多目录对比：哪些位置可写
  writableLocations: { name: string; path: string; ok: boolean; code?: string }[]
  ok: boolean
  error?: string
  code?: string
}

async function testMkdir(dir: string): Promise<{ ok: boolean; code?: string }> {
  const test = join(dir, '__pupurin_probe__')
  try {
    await fs.mkdir(test, { recursive: true })
    await fs.rmdir(test)
    return { ok: true }
  } catch (e) {
    return { ok: false, code: (e as NodeJS.ErrnoException).code ?? 'unknown' }
  }
}

export async function probeFs(dir: string): Promise<ProbeResult> {
  const target = resolve(dir)
  const testPath = join(target, '__pupurin_probe__')
  const result: ProbeResult = {
    target,
    testPath,
    processUid: typeof process.getuid === 'function' ? process.getuid() : -1,
    processGid: typeof process.getgid === 'function' ? process.getgid() : -1,
    accessW: false,
    fsMkdir: 'ok',
    shellMkdir: 'ok',
    writableLocations: [],
    ok: false,
  }

  // access W_OK
  try {
    await fs.access(target, fsConstants.W_OK)
    result.accessW = true
  } catch (e) {
    result.accessW = (e as NodeJS.ErrnoException).code ?? String(e)
  }

  // fs.mkdir 目标
  try {
    await fs.mkdir(testPath, { recursive: true })
    await fs.rmdir(testPath)
    result.fsMkdir = 'ok'
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    result.fsMkdir = { code: err.code ?? 'unknown', message: err.message }
  }

  // shell mkdir 目标（对比）
  try {
    await execFileAsync('mkdir', ['-p', testPath])
    await execFileAsync('rmdir', [testPath])
    result.shellMkdir = 'ok'
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    result.shellMkdir = { code: err.code ?? 'unknown', message: err.message }
  }

  // 多目录对比：确定可写范围
  const appDir = app.getAppPath()
  const userData = app.getPath('userData')
  const candidates = [
    { name: '目标目录', path: target },
    { name: '应用目录', path: appDir },
    { name: 'userData', path: userData },
    { name: 'userData父目录', path: resolve(userData, '..') },
    { name: '/tmp', path: '/tmp' },
    { name: '家目录', path: app.getPath('home') },
  ]
  for (const c of candidates) {
    const r = await testMkdir(c.path)
    result.writableLocations.push({ ...c, ...r })
  }

  // 综合判定：目标可写（fs 或 shell 任一成功）即 ok
  result.ok = result.fsMkdir === 'ok' || result.shellMkdir === 'ok'
  if (!result.ok) {
    result.code = result.fsMkdir !== 'ok' ? (result.fsMkdir as { code: string }).code : ''
    result.error = 'fs 与 shell 均失败'
  }
  return result
}

// 默认项目存储目录：userData/projects/（应用始终可写，绕开 macOS 26 路径限制）
export function getDefaultProjectsDir(): string {
  return join(app.getPath('userData'), 'projects')
}

// 获取可见的项目目录（~/Documents/Pupurin Loom Projects/）
// 用于在 Ren'Py SDK 中选择项目
export function getVisibleProjectsDir(): string {
  return join(app.getPath('home'), 'Documents', 'Pupurin Loom Projects')
}

// 确保 visible 目录存在（创建符号链接指向实际项目目录）
export async function ensureVisibleLink(): Promise<string> {
  const actualDir = getDefaultProjectsDir()
  const visibleDir = getVisibleProjectsDir()

  try {
    // 检查 visibleDir 是否已存在
    const st = await fs.lstat(visibleDir)
    if (st.isSymbolicLink()) {
      // 已是符号链接，检查是否指向正确
      const target = await fs.readlink(visibleDir)
      if (target === actualDir) {
        return visibleDir
      }
      // 指向错误位置，删除重建
      await fs.unlink(visibleDir)
    } else if (st.isDirectory()) {
      // 是真实目录，不覆盖
      return visibleDir
    }
  } catch {
    // 不存在，继续创建
  }

  // 创建符号链接
  try {
    // 确保父目录存在
    const parentDir = join(app.getPath('home'), 'Documents')
    await fs.mkdir(parentDir, { recursive: true })
    await fs.symlink(actualDir, visibleDir, 'junction')
    console.log('[projectStore] 创建符号链接:', visibleDir, '->', actualDir)
  } catch (e) {
    console.error('[projectStore] 创建符号链接失败:', e)
  }

  return visibleDir
}

export async function createProject(
  name: string,
  parentPath?: string,
  opts?: CreateProjectOptions
): Promise<Project> {
  const projectName = name.trim()
  if (!projectName) throw new Error('项目名称不能为空')

  // 默认用 userData/projects/；若指定父目录则用它
  const parent = parentPath ? resolve(parentPath) : getDefaultProjectsDir()
  const root = join(parent, projectName)

  console.log('[projectStore] 创建项目:', { parent, projectName, root })

  // 检查 root 是否已存在
  try {
    await fs.access(root)
    throw new Error(`目录「${projectName}」已存在。请更换项目名。`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
    // 不存在，继续
  }

  // 获取模板文件夹路径
  const templateDir = getTemplateDir()
  console.log('[projectStore] 模板目录:', templateDir)

  // 检查模板是否存在
  try {
    await fs.access(templateDir)
  } catch {
    throw new Error(`项目模板不存在：${templateDir}。请确保模板文件夹已正确安装。`)
  }

  // 复制整个模板文件夹到目标位置（先确保父目录存在——全新安装时 userData/projects 尚不存在）
  console.log('[projectStore] 复制模板:', templateDir, '->', root)
  try {
    await fs.mkdir(parent, { recursive: true })
    await execFileAsync('cp', ['-R', templateDir, root])
    console.log('[projectStore] 复制模板成功')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    console.error('[projectStore] 复制模板失败:', { code: err.code, message: err.message })
    throw new Error(`无法创建项目：复制模板失败（${err.message}）。请检查权限。`)
  }

  // 向导选项
  const title = opts?.title?.trim() || projectName
  const buildName = (opts?.buildName?.trim() || projectName.replace(/[^a-zA-Z0-9]/g, '')) || 'game'

  // 更新 options.rpy 中的项目名称
  const optionsPath = join(root, 'game', 'options.rpy')
  try {
    let optionsContent = await fs.readFile(optionsPath, 'utf-8')
    // 替换 config.name（游戏显示名）
    optionsContent = optionsContent.replace(
      /define config\.name = _\(".*?"\)/,
      `define config.name = _("${title}")`
    )
    // 替换 build.name（仅允许 ASCII 字符）
    optionsContent = optionsContent.replace(
      /define build\.name = ".*?"/,
      `define build.name = "${buildName}"`
    )
    // 替换 save_directory
    const saveDir = buildName.toLowerCase() + '-' + Date.now()
    optionsContent = optionsContent.replace(
      /define config\.save_directory = ".*?"/,
      `define config.save_directory = "${saveDir}"`
    )
    // 分辨率（模板默认 1280x720，指定时追加覆盖）
    if (opts?.resolution) {
      const [w, h] = opts.resolution.split('x').map((s) => Number(s.trim()))
      if (w && h) {
        optionsContent += `\n# 由 铃言织机° 向导设置的屏幕分辨率\ndefine config.screen_width = ${w}\ndefine config.screen_height = ${h}\n`
      }
    }
    await fs.writeFile(optionsPath, optionsContent, 'utf-8')
    console.log('[projectStore] 更新 options.rpy 成功')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    console.warn('[projectStore] 更新 options.rpy 失败:', { code: err.code, message: err.message })
    // 不抛出错误，继续创建项目
  }

  // 按模板覆盖 script.rpy 骨架
  try {
    const scriptPath = join(root, 'game', 'script.rpy')
    const script = SCRIPT_TEMPLATES[opts?.scriptTemplate ?? 'basic'](title)
    await fs.writeFile(scriptPath, script, 'utf-8')
    console.log('[projectStore] 写入 script.rpy 骨架成功')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    console.warn('[projectStore] 写入 script.rpy 骨架失败:', { code: err.code, message: err.message })
  }

  const now = Date.now()
  const project: Project = {
    id: randomBytes(8).toString('hex'),
    name: projectName,
    path: root,
    createdAt: now,
    lastOpenedAt: now,
  }
  const projects = await readStore()
  projects.push(project)
  await writeStore(projects)
  console.log('[projectStore] 项目创建成功:', project.id, root)
  return project
}

export async function openProject(id: string): Promise<Project | null> {
  const projects = await readStore()
  const idx = projects.findIndex((p) => p.id === id)
  if (idx < 0) return null
  projects[idx].lastOpenedAt = Date.now()
  await writeStore(projects)
  return projects[idx]
}

export async function deleteProject(id: string): Promise<void> {
  const projects = await readStore()
  await writeStore(projects.filter((p) => p.id !== id))
}

// 导入已有 Ren'Py 项目：复制到 userData/projects/ 目录后注册
// 兼容两种目录布局：
//   1. 标准布局：<root>/game/script.rpy
//   2. 扁平布局：文件夹本身就是 game 目录，直接含 script.rpy
export async function importProject(sourcePath: string): Promise<Project> {
  const sourceRoot = resolve(sourcePath)

  // 检测布局：优先标准 game/ 目录，其次把整个目录当作 game 目录
  const standardScript = join(sourceRoot, 'game', 'script.rpy')
  const flatScript = join(sourceRoot, 'script.rpy')
  let layout: 'standard' | 'flat' | null = null
  try {
    await fs.access(standardScript)
    layout = 'standard'
  } catch {
    try {
      await fs.access(flatScript)
      layout = 'flat'
    } catch {
      throw new Error(
        `路径「${sourceRoot}」下既没有 game/script.rpy，也没有直接的 script.rpy，不是有效的 Ren'Py 项目目录。`
      )
    }
  }

  const projectName = sourceRoot.split('/').pop() ?? '导入的项目'
  const targetRoot = join(getDefaultProjectsDir(), projectName)

  // 检查目标是否已存在
  try {
    await fs.access(targetRoot)
    throw new Error(`项目「${projectName}」已存在于应用目录中，请先删除或重命名。`)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e
  }

  // 复制项目到 userData/projects/（先确保父目录存在）
  console.log('[projectStore] 复制项目:', sourceRoot, '->', targetRoot, `(layout=${layout})`)
  try {
    await fs.mkdir(getDefaultProjectsDir(), { recursive: true })
    if (layout === 'flat') {
      // 扁平布局：把源目录内容复制到 targetRoot/game/，保持应用内的 game/script.rpy 约定
      await fs.mkdir(join(targetRoot, 'game'), { recursive: true })
      await execFileAsync('cp', ['-R', `${sourceRoot}/.`, join(targetRoot, 'game')])
    } else {
      await execFileAsync('cp', ['-R', sourceRoot, targetRoot])
    }
    console.log('[projectStore] 复制成功')
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    throw new Error(`复制项目失败: ${err.message}`)
  }

  // 检查是否已导入过（按 path 去重）
  const existing = await readStore()
  const now = Date.now()
  const project: Project = {
    id: randomBytes(8).toString('hex'),
    name: projectName,
    path: targetRoot, // 使用新路径
    createdAt: now,
    lastOpenedAt: now,
  }
  existing.push(project)
  await writeStore(existing)
  console.log('[projectStore] 导入项目成功:', project.id, targetRoot)
  return project
}

export async function pickDirectory(parentWindow: Electron.BrowserWindow | null): Promise<string | null> {
  const opts: Electron.OpenDialogOptions = {
    properties: ['openDirectory', 'createDirectory'],
    message: '选择项目的存放目录（项目将创建在该目录下的子文件夹）',
  }
  const result = parentWindow
    ? await dialog.showOpenDialog(parentWindow, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0]
}
