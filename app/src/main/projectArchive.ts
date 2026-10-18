// 「项目导出 / 导入」：Loom 归档（.loom，本质是 zip）
//
// 归档布局：
//   loom-project.json      ← manifest（识别来源、校验格式、回填 Loom 侧数据）
//   <项目名>/              ← 项目根内容（game/ 必需；解压后即可当作 Ren'Py 项目打开）
//
// 始终排除：builds/（打包产物）、game/cache/（字节码缓存）、game/saves/（本地存档）、
//          log.txt / errors.txt / traceback.txt、.DS_Store / ._* / *.tmp / *.old、.git/
// 可选包含：图片素材（game/images/）、音频素材（game/audio/）、视频素材（game/video|movies/）、
//          编译缓存（*.rpyc）、Loom 侧数据（.pupurin-marks.json 与 localStorage 快照）
//
// 跨平台：macOS/Linux 用 zip / unzip；Windows 用 PowerShell Compress-Archive / Expand-Archive。
// 因 PowerShell 对扩展名敏感，打包与解包都先使用 .zip 中转文件，完成后再改名/清理。
import { promises as fs } from 'node:fs'
import { join, basename, dirname, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { getDefaultProjectsDir, importProject, type Project } from './projectStore'

const execFileAsync = promisify(execFile)

export const LOOM_ARCHIVE_EXT = '.loom'
const MANIFEST_NAME = 'loom-project.json'
const CMD_TIMEOUT = 30 * 60 * 1000

// ---- 类型 ----

/** 导出勾选项 */
export interface ProjectExportOptions {
  /** 图片素材（game/images/） */
  images: boolean
  /** 音频素材（game/audio/） */
  audio: boolean
  /** 视频素材（game/video/、game/movies/） */
  video: boolean
  /** 编译缓存 *.rpyc（体积大，Ren'Py 首次运行会重建） */
  rpyc: boolean
  /** Loom 侧数据：分镜标记 .pupurin-marks.json + localStorage 配置快照 */
  loomData: boolean
}

export interface ProjectArchiveManifest {
  format: 'pupurin-loom-project'
  formatVersion: number
  appVersion: string
  /** 游戏显示名（config.name） */
  projectName: string
  /** build.version */
  buildVersion: string
  createdAt: number
  includes: ProjectExportOptions
  /** Loom 侧 localStorage 快照：key 模板（项目绝对路径替换为 {PROJECT}）→ 原始字符串值 */
  loomData?: Record<string, string>
}

/** 各分类体积（字节），用于导出弹窗的体积预估 */
export interface ExportSizeInfo {
  core: number
  images: number
  audio: number
  video: number
  rpyc: number
  loomData: number
}

export interface ArchiveProgress {
  phase: 'pack' | 'unpack'
  done?: number
  total?: number
  current?: string
}

export interface ExportResult {
  archivePath: string
  bytes: number
  files: number
}

export interface ImportResult {
  project: Project
  /** 归档内 manifest（普通 zip 归档时为 null） */
  manifest: ProjectArchiveManifest | null
}

// ---- 文件分类 ----

type Cat = 'core' | 'images' | 'audio' | 'video' | 'rpyc' | 'marks' | 'skip'

/** 始终排除的目录（相对项目根，小写） */
const SKIP_DIRS = new Set(['builds', 'game/cache', 'game/saves', '.git'])

function isSkipDir(rel: string): boolean {
  return SKIP_DIRS.has(rel.toLowerCase())
}

/** 按相对路径给文件分类；'skip' 表示始终排除 */
function categorize(rel: string): Cat {
  const lower = rel.toLowerCase()
  const name = lower.slice(lower.lastIndexOf('/') + 1)
  if (name === '.ds_store' || name.startsWith('._') || name.endsWith('.tmp') || name.endsWith('.old')) return 'skip'
  if (lower === 'log.txt' || lower === 'errors.txt' || lower === 'traceback.txt') return 'skip'
  if (rel === '.pupurin-marks.json') return 'marks'
  if (lower.endsWith('.rpyc')) return 'rpyc'
  if (lower.startsWith('game/images/')) return 'images'
  if (lower.startsWith('game/audio/')) return 'audio'
  if (lower.startsWith('game/video/') || lower.startsWith('game/movies/')) return 'video'
  return 'core'
}

/** 该分类是否被用户勾选 */
function catEnabled(cat: Cat, opts: ProjectExportOptions): boolean {
  if (cat === 'skip') return false
  if (cat === 'core') return true
  if (cat === 'images') return opts.images
  if (cat === 'audio') return opts.audio
  if (cat === 'video') return opts.video
  if (cat === 'rpyc') return opts.rpyc
  return opts.loomData
}

interface ArchiveFile {
  rel: string
  abs: string
  size: number
  cat: Cat
}

/** 递归收集待打包文件（跳过始终排除的目录与按勾选项排除的文件） */
async function collectFiles(projectPath: string, opts: ProjectExportOptions): Promise<ArchiveFile[]> {
  const out: ArchiveFile[] = []

  async function walk(relDir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(relDir ? join(projectPath, relDir) : projectPath, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const rel = relDir ? `${relDir}/${e.name}` : e.name
      if (e.isDirectory()) {
        if (isSkipDir(rel)) continue
        await walk(rel)
        continue
      }
      if (!e.isFile()) continue
      const cat = categorize(rel)
      if (!catEnabled(cat, opts)) continue
      const abs = join(projectPath, rel)
      let size = 0
      try {
        size = (await fs.stat(abs)).size
      } catch {
        continue
      }
      out.push({ rel, abs, size, cat })
    }
  }

  await walk('')
  return out
}

/** 各分类体积预估（全部勾选时计算，供导出弹窗展示） */
export async function estimateExportSizes(projectPath: string): Promise<ExportSizeInfo> {
  const files = await collectFiles(projectPath, {
    images: true,
    audio: true,
    video: true,
    rpyc: true,
    loomData: true,
  })
  const info: ExportSizeInfo = { core: 0, images: 0, audio: 0, video: 0, rpyc: 0, loomData: 0 }
  for (const f of files) {
    if (f.cat === 'skip') continue
    // 分镜标记归档时归入「Loom 侧数据」
    if (f.cat === 'marks') {
      info.loomData += f.size
      continue
    }
    info[f.cat] += f.size
  }
  return info
}

// ---- 压缩包读写 ----

function psQuote(p: string): string {
  return `'${p.replace(/'/g, "''")}'`
}

/** 打包目录内容为 zip（条目相对 dir，不含 dir 本身） */
async function createZip(dir: string, zipPath: string): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Compress-Archive -Force -Path ${psQuote(join(dir, '*'))} -DestinationPath ${psQuote(zipPath)}`,
        ],
        { timeout: CMD_TIMEOUT, maxBuffer: 8 * 1024 * 1024 }
      )
    } else {
      // cwd = dir，条目名相对 dir，避免写入绝对路径
      await execFileAsync('zip', ['-r', '-q', zipPath, '.'], {
        cwd: dir,
        timeout: CMD_TIMEOUT,
        maxBuffer: 8 * 1024 * 1024,
      })
    }
  } catch (e) {
    throw new Error(`打包归档失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

/** 列出 zip 条目名（用于解压前的路径穿越校验） */
async function listZipEntries(zipPath: string): Promise<string[]> {
  if (process.platform === 'win32') {
    const { stdout } = await execFileAsync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z = [IO.Compression.ZipFile]::OpenRead(${psQuote(zipPath)}); $z.Entries | ForEach-Object { $_.FullName }; $z.Dispose()`,
      ],
      { timeout: CMD_TIMEOUT, maxBuffer: 8 * 1024 * 1024 }
    )
    return stdout.split(/\r?\n/).filter(Boolean)
  }
  const { stdout } = await execFileAsync('unzip', ['-Z1', zipPath], {
    timeout: CMD_TIMEOUT,
    maxBuffer: 8 * 1024 * 1024,
  })
  return stdout.split(/\r?\n/).filter(Boolean)
}

/** zip slip 防护：拒绝绝对路径与含 .. 的条目 */
function assertSafeEntries(entries: string[]): void {
  for (const e of entries) {
    if (e.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(e) || e.split(/[\\/]/).includes('..')) {
      throw new Error(`归档内含非法路径条目「${e}」，已终止导入`)
    }
  }
}

/** 解压 zip 到目标目录 */
async function extractZipTo(zipPath: string, destDir: string): Promise<void> {
  try {
    if (process.platform === 'win32') {
      await execFileAsync(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          `Expand-Archive -Force -LiteralPath ${psQuote(zipPath)} -DestinationPath ${psQuote(destDir)}`,
        ],
        { timeout: CMD_TIMEOUT, maxBuffer: 8 * 1024 * 1024 }
      )
    } else {
      await execFileAsync('unzip', ['-q', '-o', zipPath, '-d', destDir], {
        timeout: CMD_TIMEOUT,
        maxBuffer: 8 * 1024 * 1024,
      })
    }
  } catch (e) {
    throw new Error(`归档解压失败：${e instanceof Error ? e.message : String(e)}`)
  }
}

// ---- 导出 ----

/**
 * 导出项目为 .loom 归档。
 * @param archivePath 目标文件绝对路径（由主进程的文件保存对话框确定）
 * @param meta.appVersion 当前应用版本号，写入 manifest
 * @param meta.loomData Loom 侧 localStorage 快照（key 模板 → 值），由渲染进程收集
 */
export async function exportProject(
  projectPath: string,
  opts: ProjectExportOptions,
  archivePath: string,
  meta: { appVersion: string; projectName: string; buildVersion: string; loomData?: Record<string, string> },
  onProgress: (p: ArchiveProgress) => void = () => {}
): Promise<ExportResult> {
  const files = await collectFiles(projectPath, opts)
  const totalBytes = files.reduce((n, f) => n + f.size, 0)

  const staging = await fs.mkdtemp(join(tmpdir(), 'loom-export-'))
  const tmpZip = join(staging, '__loom_archive__.zip')
  const projectName = basename(resolve(projectPath)) || 'project'
  const destRoot = join(staging, projectName)

  try {
    // 1) 复制待打包文件到暂存目录（<项目名>/ 下）
    let doneBytes = 0
    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const dest = join(destRoot, f.rel)
      await fs.mkdir(dirname(dest), { recursive: true })
      await fs.copyFile(f.abs, dest)
      doneBytes += f.size
      if (i % 8 === 0 || i === files.length - 1) {
        onProgress({ phase: 'pack', done: doneBytes, total: totalBytes, current: f.rel })
      }
    }
    if (!files.length) onProgress({ phase: 'pack', done: 0, total: 0 })

    // 2) 写 manifest（与项目目录同级）
    const manifest: ProjectArchiveManifest = {
      format: 'pupurin-loom-project',
      formatVersion: 1,
      appVersion: meta.appVersion,
      projectName: meta.projectName,
      buildVersion: meta.buildVersion,
      createdAt: Date.now(),
      includes: opts,
    }
    if (opts.loomData && meta.loomData && Object.keys(meta.loomData).length) manifest.loomData = meta.loomData
    await fs.writeFile(join(staging, MANIFEST_NAME), JSON.stringify(manifest, null, 2), 'utf-8')

    // 3) 打包为 zip 后改名为 .loom
    onProgress({ phase: 'pack', done: totalBytes, total: totalBytes })
    await createZip(staging, tmpZip)
    await fs.mkdir(dirname(archivePath), { recursive: true })
    await fs.rm(archivePath, { force: true })
    await fs.rename(tmpZip, archivePath)
    const bytes = (await fs.stat(archivePath)).size
    return { archivePath, bytes, files: files.length }
  } finally {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined)
  }
}

// ---- 导入 ----

/** 在解压目录内定位项目根；isArchiveRoot 表示归档根目录本身就是项目 */
async function findProjectRoot(extractDir: string): Promise<{ root: string; isArchiveRoot: boolean } | null> {
  const exists = async (p: string): Promise<boolean> =>
    fs
      .access(p)
      .then(() => true)
      .catch(() => false)

  let entries
  try {
    entries = await fs.readdir(extractDir, { withFileTypes: true })
  } catch {
    return null
  }
  const subdirs: string[] = []
  for (const e of entries) if (e.isDirectory()) subdirs.push(join(extractDir, e.name))

  // 1) 归档根目录即项目（Loom 归档也兼容这种布局，manifest 在同级）
  if (await exists(join(extractDir, 'game', 'script.rpy'))) return { root: extractDir, isArchiveRoot: true }
  if (await exists(join(extractDir, 'script.rpy'))) return { root: extractDir, isArchiveRoot: true }

  // 2) 子目录为项目根（.loom 归档的常见布局：<项目名>/game/script.rpy）
  for (const p of subdirs) {
    if (await exists(join(p, 'game', 'script.rpy'))) return { root: p, isArchiveRoot: false }
  }
  for (const p of subdirs) {
    if (await exists(join(p, 'script.rpy'))) return { root: p, isArchiveRoot: false }
  }

  // 3) 再多套一层（兼容 <外层>/<项目>/game/script.rpy）
  for (const p of subdirs) {
    let sub
    try {
      sub = await fs.readdir(p, { withFileTypes: true })
    } catch {
      continue
    }
    for (const s of sub) {
      if (!s.isDirectory()) continue
      const q = join(p, s.name)
      if (await exists(join(q, 'game', 'script.rpy'))) return { root: q, isArchiveRoot: false }
    }
  }
  return null
}

/** 目录名去非法字符 */
function sanitizeName(name: string): string {
  const s = name.replace(/[/\\:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
  return s || '导入的项目'
}

/** 在默认项目目录内取一个不冲突的名称 */
async function uniqueProjectName(name: string): Promise<string> {
  const base = sanitizeName(name)
  const dir = getDefaultProjectsDir()
  const exists = async (n: string): Promise<boolean> =>
    fs
      .access(join(dir, n))
      .then(() => true)
      .catch(() => false)
  let candidate = base
  let n = 2
  while (await exists(candidate)) {
    candidate = `${base}-${n}`
    n++
  }
  return candidate
}

/** 读取并校验 manifest；缺失返回 null */
async function readManifest(extractDir: string): Promise<ProjectArchiveManifest | null> {
  try {
    const raw = await fs.readFile(join(extractDir, MANIFEST_NAME), 'utf-8')
    const data = JSON.parse(raw)
    if (!data || data.format !== 'pupurin-loom-project') return null
    return data as ProjectArchiveManifest
  } catch {
    return null
  }
}

/**
 * 从 .loom 归档（也接受普通 zip 打包的 Ren'Py 项目）导入项目。
 * 流程：解压到临时目录 → 校验路径 → 定位项目根 → 复制注册到 userData/projects/
 */
export async function importFromArchive(
  archivePath: string,
  onProgress: (p: ArchiveProgress) => void = () => {}
): Promise<ImportResult> {
  const workDir = await fs.mkdtemp(join(tmpdir(), 'loom-import-'))
  const tmpZip = join(workDir, '__loom_archive__.zip')
  const extractDir = join(workDir, 'extracted')

  try {
    onProgress({ phase: 'unpack', done: 0, total: 1, current: basename(archivePath) })
    await fs.mkdir(extractDir, { recursive: true })
    // PowerShell 的 Expand-Archive 对扩展名敏感：统一复制为 .zip 再解压
    await fs.copyFile(archivePath, tmpZip)

    assertSafeEntries(await listZipEntries(tmpZip))
    await extractZipTo(tmpZip, extractDir)

    const manifest = await readManifest(extractDir)
    const found = await findProjectRoot(extractDir)
    if (!found) {
      throw new Error('归档内未找到有效的 Ren\'Py 项目（缺少 game/script.rpy），无法导入')
    }

    // 归档根目录即项目时用归档文件名做项目名，否则沿用项目目录名
    const nameSource = found.isArchiveRoot ? basename(archivePath).replace(/\.[^.]*$/, '') : basename(found.root)
    const name = await uniqueProjectName(nameSource || manifest?.projectName || '导入的项目')
    const project = await importProject(found.root, { name })
    onProgress({ phase: 'unpack', done: 1, total: 1 })
    return { project, manifest }
  } finally {
    await fs.rm(workDir, { recursive: true, force: true }).catch(() => undefined)
  }
}
