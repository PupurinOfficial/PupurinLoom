import { app, BrowserWindow, ipcMain, dialog, shell, Notification, net, type BrowserWindow as BW } from 'electron'
import { join, resolve, extname, basename, dirname } from 'node:path'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir, homedir } from 'node:os'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { BackendManager } from './pythonBridge'
import { buildApplicationMenu, setViewMenu } from './menu'
import {
  listProjects,
  createProject,
  openProject,
  deleteProject,
  pickDirectory,
  probeFs,
  getDefaultProjectsDir,
  getVisibleProjectsDir,
  ensureVisibleLink,
  importProject,
  type CreateProjectOptions,
} from './projectStore'
import {
  loadCharacters,
  saveCharacters,
  newCharacter,
  newSprite,
  parseCharactersFromScript,
  type Character,
} from './characterStore'
import {
  loadVariables,
  saveVariables,
  newVariable,
  parseVariablesFromScript,
  saveVariablesToScript,
  type Variable,
} from './variableStore'
import {
  listPlugins,
  loadPluginMain,
  setPluginEnabled,
  setPluginTrusted,
  openPluginsDir,
  getPluginData,
  setPluginData,
  pluginFsRead,
  pluginFsWrite,
  pluginFsList,
  pluginFsUploadImage,
  pluginHttp,
  pluginExec,
  createPluginFromTemplate,
  openPluginMain,
} from './pluginManager'
import { fetchStoreIndex, installPluginFromStore, type StorePlugin } from './pluginStore'

// 退出阶段兜底：stdout/stderr 管道已关闭时（write EIO）写日志会抛未捕获异常。
// 这类错误是退出流程的无害噪声，静默忽略；其余错误仍打印（并避免 Electron 默认错误对话框）。
process.on('uncaughtException', (err) => {
  const e = err as NodeJS.ErrnoException
  if (e && e.code === 'EIO') return
  console.error('[uncaughtException]', err)
})
process.on('unhandledRejection', (reason) => {
  const e = reason instanceof Error ? (reason as NodeJS.ErrnoException) : null
  if (e && e.code === 'EIO') return
  console.error('[unhandledRejection]', reason)
})

let mainWindow: BW | null = null
const backendMgr = new BackendManager()
// 关闭保护状态：forceClose 表示渲染层已确认（允许真正关闭）；
// quitting 表示正处于 Cmd+Q 退出流程（确认后需继续退出应用，而非仅关窗口）
let forceClose = false
let quitting = false
// 渲染层无响应时的强制关闭兜底定时器
let closeRequestTimer: NodeJS.Timeout | null = null

// 打包完成后发送系统通知（macOS 通知中心 / Windows 通知中心）
function sendCompletionNotification(title: string, body: string): void {
  try {
    if (Notification.isSupported()) {
      new Notification({ title, body }).show()
    }
  } catch {
    /* 通知失败不影响打包结果 */
  }
}

// 检测 Ren'Py SDK，返回可执行文件路径和 SDK 根目录
async function findRenpySdk(): Promise<{ exe: string; sdkDir: string } | null> {
  const home = app.getPath('home')
  const isWin = process.platform === 'win32'

  // 优先使用设置中手动指定的 SDK 目录（设置页可配置）
  try {
    const s = await readSettings()
    const manual = typeof s.sdkPath === 'string' ? s.sdkPath.trim() : ''
    if (manual) {
      const exe = isWin ? join(manual, 'renpy.exe') : join(manual, 'renpy.app', 'Contents', 'MacOS', 'renpy')
      try {
        await fs.access(exe)
        return { exe, sdkDir: manual }
      } catch {
        /* 手动路径失效时回退到自动检测 */
      }
    }
  } catch {
    /* 读取设置失败时继续自动检测 */
  }

  // 常见安装位置（macOS: /Applications；Windows: 用户目录 RenPy/ 或 C:\RenPy）
  const roots = isWin
    ? [join(home, 'RenPy'), 'C:\\RenPy', join(home, 'Downloads')]
    : ['/Applications', join(home, 'Applications')]

  // 各 SDK 版本目录名
  const sdkNames = [
    'renpy-8.5.2-sdk',
    'renpy-8.4.0-sdk',
    'renpy-8.3.0-sdk',
    'renpy-8.2.3-sdk',
    'renpy-8.1.3-sdk',
    'renpy-8.0.3-sdk',
    'renpy-sdk',
  ]

  const candidates: string[] = []
  for (const root of roots) {
    for (const name of sdkNames) {
      candidates.push(join(root, name))
    }
  }

  for (const p of candidates) {
    try {
      if (isWin) {
        const exe = join(p, 'renpy.exe')
        await fs.access(exe)
        return { exe, sdkDir: p }
      } else {
        const renpyApp = join(p, 'renpy.app')
        await fs.access(renpyApp)
        return {
          exe: join(p, 'renpy.app', 'Contents', 'MacOS', 'renpy'),
          sdkDir: p,
        }
      }
    } catch {
      continue
    }
  }

  return null
}

// Ren'Py SDK 官方下载页
const RENPY_DOWNLOAD_URL = 'https://www.renpy.org/latest.html'

// 运行 Ren'Py 游戏
async function runRenpyGame(projectPath: string): Promise<{ success: boolean; error?: string }> {
  const sdk = await findRenpySdk()
  if (!sdk) {
    return {
      success: false,
      error: '未找到 Ren\'Py SDK，请先在「打包」页查看引导并安装 Ren\'Py。',
    }
  }

  return new Promise((resolve) => {
    const proc = spawn(sdk.exe, [projectPath], {
      detached: true,
      stdio: 'ignore',
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: `启动失败: ${err.message}` })
    })

    // 分离进程，让 Ren'Py 独立运行
    proc.unref()

    // 给一点时间确认启动成功
    setTimeout(() => {
      if (!proc.killed) {
        resolve({ success: true })
      }
    }, 500)
  })
}

// 从指定文件+行号开始运行（Ren'Py --warp，需 developer 模式）
async function runRenpyGameFromLine(
  projectPath: string,
  filePath: string,
  line: number
): Promise<{ success: boolean; error?: string }> {
  const sdk = await findRenpySdk()
  if (!sdk) {
    return {
      success: false,
      error: '未找到 Ren\'Py SDK，请先在「打包」页查看引导并安装 Ren\'Py。',
    }
  }

  // warp 需要 config.developer = True；自动在 options.rpy 中补齐
  try {
    const optionsPath = join(projectPath, 'game', 'options.rpy')
    let content = await fs.readFile(optionsPath, 'utf-8')
    if (!/config\.developer\s*=\s*True/.test(content)) {
      content =
        content.trimEnd() +
        '\n\n# Pupurin° Loom：启用开发者模式以支持「从这里开始玩」\ndefine config.developer = True\n'
      const tmp = optionsPath + '.tmp'
      await fs.writeFile(tmp, content, 'utf-8')
      await fs.rename(tmp, optionsPath)
    }
  } catch {
    /* options.rpy 不存在时跳过（warp 会因 developer 关闭而失败并给出明确报错） */
  }

  return new Promise((resolve) => {
    const spec = `${filePath}:${line}`
    const proc = spawn(sdk.exe, [projectPath, '--warp', spec], {
      detached: true,
      stdio: 'ignore',
    })

    proc.on('error', (err) => {
      resolve({ success: false, error: `启动失败: ${err.message}` })
    })

    // 分离进程，让 Ren'Py 独立运行
    proc.unref()

    // 给一点时间确认启动成功
    setTimeout(() => {
      if (!proc.killed) {
        resolve({ success: true })
      }
    }, 500)
  })
}

async function bootstrap(): Promise<void> {
  try {
    await backendMgr.start()
  } catch (e) {
    console.error('[main] failed to start python backend:', e)
  }
  createWindow()
}

function createWindow(): void {
  // 防重入：bootstrap 异步启动后端期间，activate 可能抢先创建了窗口，
  // 此时不重复创建，直接聚焦已有窗口（否则会出现两个编辑器窗口）
  const existing = BrowserWindow.getAllWindows()[0]
  if (existing) {
    mainWindow = existing
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 600,
    title: '铃言织机° · Pupurin° Loom',
    backgroundColor: '#1f1d1a',
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  // dev: electron-vite 注入 ELECTRON_RENDERER_URL；prod: 加载打包文件
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (devUrl) {
    void mainWindow.loadURL(devUrl)
    mainWindow.webContents.openDevTools({ mode: 'detach' })
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }

  mainWindow.on('closed', () => {
    mainWindow = null
  })

  // 关闭保护：
  // - macOS 红绿灯（非退出流程）→ 隐藏窗口而非销毁，保留全部编辑状态，Dock 点开即还原
  // - Cmd+Q（退出流程）/ Windows 点 X → 询问渲染层是否有未保存更改（确认后经 window:confirmClose 放行）
  mainWindow.on('close', (e) => {
    if (forceClose) return
    // 渲染层已崩溃/销毁时直接放行，避免窗口永远关不掉
    if (mainWindow?.webContents.isDestroyed() || mainWindow?.webContents.isCrashed()) return
    e.preventDefault()
    if (process.platform === 'darwin' && !quitting) {
      mainWindow?.hide()
      return
    }
    mainWindow?.webContents.send('app:before-close')
    // 兜底：渲染层无响应（黑屏/加载失败/进程卡死）时 3 秒后强制放行，避免「无法退出」
    if (closeRequestTimer) clearTimeout(closeRequestTimer)
    closeRequestTimer = setTimeout(() => {
      closeRequestTimer = null
      if (forceClose) return
      forceClose = true
      for (const w of BrowserWindow.getAllWindows()) {
        if (!w.isDestroyed()) w.destroy()
      }
      if (quitting) app.quit()
    }, 3000)
  })

  // 全屏状态变化通知渲染层（用于调整红绿灯区域的 padding）
  mainWindow.on('enter-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen', true)
  })
  mainWindow.on('leave-full-screen', () => {
    mainWindow?.webContents.send('window:fullscreen', false)
  })

  // macOS 系统菜单栏（自定义动作经 menu:action 派发给渲染层）
  buildApplicationMenu(mainWindow)
}

// 渲染层确认后的真正关闭入口：仅 Cmd+Q（退出流程）或 Windows 点 X 会走到这里，
// 确认后关窗口并退出应用。遍历关闭所有 BrowserWindow（即使异常情况下存在多个窗口也能全部退出）
ipcMain.handle('window:confirmClose', () => {
  if (closeRequestTimer) {
    clearTimeout(closeRequestTimer)
    closeRequestTimer = null
  }
  forceClose = true
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.destroy()
  }
  app.quit()
})

// 渲染层在弹窗中点了「取消」：复位退出流程状态（避免 Cmd+Q 取消后残留）
ipcMain.handle('window:cancelClose', () => {
  if (closeRequestTimer) {
    clearTimeout(closeRequestTimer)
    closeRequestTimer = null
  }
  quitting = false
  forceClose = false
})

// 渲染层同步菜单：activeView 变化 → 更新「视图」菜单 radio 勾选
ipcMain.on('menu:setView', (_e, view: string) => {
  setViewMenu(view)
})

// 查询窗口当前是否全屏（渲染层组件重挂载时用于初始化红绿灯占位状态）
ipcMain.handle('window:isFullscreen', () => mainWindow?.isFullScreen() ?? false)

// ad-hoc 签名下 Chromium 沙箱无法初始化，禁用沙箱
app.commandLine.appendSwitch('no-sandbox')
app.commandLine.appendSwitch('disable-gpu-sandbox')
app.commandLine.appendSwitch('in-process-gpu')
// userData 目录：
// - 开发环境：项目内 .userdata（方便查看和清理）
// - 生产环境：显式固定到 ~/Library/Application Support/pupurin-loom
//   （不依赖 Electron 默认名称检测——特殊环境下会回退到 "Chromium" 等错误目录）
if (!app.isPackaged) {
  try {
    app.setPath('userData', resolve(__dirname, '../../.userdata'))
  } catch {
    /* ignore */
  }
} else {
  try {
    app.setPath('userData', join(app.getPath('appData'), 'pupurin-loom'))
  } catch {
    /* ignore */
  }
}

// 单实例锁：重复启动（Finder/双击 .app / 命令行再跑一次）时聚焦已有窗口，
// 而不是启动第二个实例导致出现两个主窗口
const gotSingleLock = app.requestSingleInstanceLock()
if (!gotSingleLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  void bootstrap()
  // 创建符号链接到 ~/Documents/Pupurin Loom Projects/
  void ensureVisibleLink()
})

app.on('window-all-closed', () => {
  // macOS: 窗口全关时不退出 app（也不停后端，避免 HMR 重载时反复杀后端）
  if (process.platform !== 'darwin') {
    backendMgr.stop()
    app.quit()
  }
})

app.on('activate', () => {
  // macOS Dock 点击：优先聚焦已有窗口（可能被红绿灯隐藏），没有才创建
  const win = BrowserWindow.getAllWindows()[0]
  if (win) {
    mainWindow = win
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  } else {
    createWindow()
  }
})

// 终端退出（关闭终端窗口，dev 模式下 app 是终端的子进程）时随之一并退出，
// 避免 app 残留 Dock 图标、点开黑窗口无法退出
process.on('SIGHUP', () => {
  forceClose = true
  if (closeRequestTimer) {
    clearTimeout(closeRequestTimer)
    closeRequestTimer = null
  }
  app.quit()
})

app.on('before-quit', () => {
  quitting = true
  backendMgr.stop()
})

// ---- IPC 暴露给渲染层 ----
// 关键：每次请求端口/状态时先 ensureHealthy，自动检测并恢复僵尸后端
ipcMain.handle('backend:port', async () => {
  try {
    const h = await backendMgr.ensureHealthy()
    const port = h?.port ?? null
    if (!port) console.warn('[ipc] backend:port returning null')
    return port
  } catch (e) {
    console.error('[ipc] backend:port error:', e)
    return null
  }
})
ipcMain.handle('backend:status', async () => {
  try {
    const h = await backendMgr.ensureHealthy()
    return {
      running: !!h,
      port: h?.port ?? null,
      pid: h?.proc?.pid ?? null,
    }
  } catch (e) {
    console.error('[ipc] backend:status error:', e)
    return { running: false, port: null, pid: null }
  }
})

// ---- 项目管理 IPC ----
ipcMain.handle('projects:list', () => listProjects())
ipcMain.handle('projects:create', (_e, name: string, path?: string, opts?: CreateProjectOptions) =>
  createProject(name, path, opts)
)
ipcMain.handle('projects:open', (_e, id: string) => openProject(id))
ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id))
ipcMain.handle('projects:defaultDir', () => getDefaultProjectsDir())
ipcMain.handle('projects:visibleDir', () => getVisibleProjectsDir())
// 导入已有 Ren'Py 项目（选择目录 → 验证 → 注册）
ipcMain.handle('projects:import', async (_e, sourcePath: string) => importProject(sourcePath))
// 在 Finder 中显示项目文件夹（优先显示可见目录）
ipcMain.handle('projects:showInFinder', async (_e, projectPath: string) => {
  // 尝试构建可见路径
  const visibleBase = getVisibleProjectsDir()
  const actualBase = getDefaultProjectsDir()
  let targetPath = projectPath

  // 如果项目在实际目录中，转换为可见目录路径
  if (projectPath.startsWith(actualBase)) {
    targetPath = projectPath.replace(actualBase, visibleBase)
  }

  const gameDir = join(targetPath, 'game')
  // 优先打开 game 目录，若不存在则打开项目根目录
  try {
    await fs.access(gameDir)
    shell.showItemInFolder(gameDir)
  } catch {
    shell.showItemInFolder(targetPath)
  }
})
// 运行 Ren'Py 游戏
ipcMain.handle('projects:runGame', async (_e, projectPath: string) => runRenpyGame(projectPath))

// 从指定文件+行号开始运行（图形编辑器「从这里开始玩」）
ipcMain.handle('projects:runGameFromLine', async (_e, projectPath: string, filePath: string, line: number) =>
  runRenpyGameFromLine(projectPath, filePath, line)
)

// 确定打包产物目录：优先项目内 builds/，若不可写则回退到应用自有可写目录（userData）
// 规避 macOS 上项目目录偶发的 EPERM 权限问题
async function resolveBuildsDir(projectPath: string): Promise<{ dir: string; usedFallback: boolean }> {
  const primary = join(projectPath, 'builds')
  try {
    await fs.mkdir(primary, { recursive: true })
    const probe = join(primary, `.loom-probe-${Date.now()}`)
    await fs.writeFile(probe, '')
    await fs.rm(probe, { force: true })
    return { dir: primary, usedFallback: false }
  } catch {
    const fallback = join(app.getPath('userData'), 'builds', basename(projectPath))
    await fs.mkdir(fallback, { recursive: true })
    return { dir: fallback, usedFallback: true }
  }
}

// 打包 Ren'Py 游戏
ipcMain.handle('projects:packageGame', async (_e, projectPath: string, platform: string) => {
  const logs: string[] = []
  const log = (s: string): void => { logs.push(s) }
  try {
    const sdk = await findRenpySdk()
    if (!sdk) {
      throw new Error('未找到 Ren\'Py SDK')
    }

    const { dir: buildsDir, usedFallback } = await resolveBuildsDir(projectPath)
    if (usedFallback) log(`项目目录 builds/ 不可写，产物已输出到: ${buildsDir}`)
    const backupDir = join(tmpdir(), `loom-builds-${Date.now()}`)

    log(`正在打包 (${platform})...`)
    log(`SDK: ${sdk.exe}`)
    log(`项目: ${projectPath}`)

    // 关键修复：Ren'Py 打包时会扫描整个项目目录（包括 builds/），且默认把所有未排除文件
    // 打进发行包。若 builds/ 下残留上次的打包产物，它们会被重新打进新包，导致体积、耗时
    // 和内存指数级膨胀（越打包越慢）。因此打包前把旧产物移出项目目录，打包完成后再清理。
    let hadOldBuilds = false
    try {
      await fs.access(buildsDir)
      hadOldBuilds = true
      try {
        await fs.rename(buildsDir, backupDir)
      } catch {
        // 跨卷 rename 失败时退化为复制
        await fs.cp(buildsDir, backupDir, { recursive: true })
        await fs.rm(buildsDir, { recursive: true, force: true })
      }
    } catch {
      // builds 目录不存在，无需处理
    }
    await fs.mkdir(buildsDir, { recursive: true })
    log(hadOldBuilds ? '已暂存上次的打包产物，开始全新打包' : '开始全新打包')

    // Ren'Py 命令行打包命令：launcher distribute
    // 参考：https://www.renpy.org/doc/html/cli.html
    const args = [
      'launcher',
      'distribute',
      projectPath,
      '--destination',
      buildsDir
    ]

    // cwd 设为 SDK 根目录，确保 Ren'Py 能找到其内置的 launcher 项目
    const sdkDir = sdk.sdkDir

    try {
      // stdio 忽略 stdin：避免 Ren'Py 在异常时等待键盘输入（如 "Press Enter"）导致打包无限挂起
      const child = spawn(sdk.exe, args, {
        cwd: sdkDir,
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
      })
      child.stdout?.on('data', (data) => {
        logs.push(data.toString())
      })
      child.stderr?.on('data', (data) => {
        logs.push(`[error] ${data.toString()}`)
      })

      // 兜底超时：防止异常情况下打包进程无限运行并占用大量内存
      const TIMEOUT_MS = 30 * 60 * 1000
      let timedOut = false
      const timer = setTimeout(() => {
        timedOut = true
        log('打包超时，正在终止打包进程…')
        try {
          if (child.pid !== undefined) {
            process.kill(-child.pid, 'SIGTERM')
          } else {
            child.kill('SIGKILL')
          }
        } catch {
          try { child.kill('SIGKILL') } catch { /* ignore */ }
        }
        // 5 秒后仍未退出的进程强制结束
        setTimeout(() => {
          try {
            if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL')
          } catch { /* ignore */ }
        }, 5000).unref()
      }, TIMEOUT_MS)
      timer.unref()

      await new Promise<void>((resolve, reject) => {
        child.on('close', (code) => {
          clearTimeout(timer)
          if (timedOut) {
            reject(new Error('打包超时（30 分钟），已强制终止'))
          } else if (code === 0) {
            log('打包完成')
            sendCompletionNotification('桌面应用打包完成', `已生成 ${platform} 平台的发行包。`)
            resolve()
          } else {
            reject(new Error(`打包失败，退出码: ${code}`))
          }
        })
        child.on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
      })

      // 打包成功：删除暂存的旧产物
      await fs.rm(backupDir, { recursive: true, force: true })
      log('已清理旧的打包产物')

      return { logs, buildsDir }
    } catch (e) {
      // 打包失败：恢复旧的打包产物，避免用户丢失历史构建
      try {
        await fs.rm(buildsDir, { recursive: true, force: true })
        if (hadOldBuilds) {
          try {
            await fs.rename(backupDir, buildsDir)
          } catch {
            await fs.cp(backupDir, buildsDir, { recursive: true })
            await fs.rm(backupDir, { recursive: true, force: true })
          }
        }
      } catch { /* 恢复失败时保留 tmp 中的备份 */ }
      throw e
    }
  } catch (e) {
    logs.push(`错误: ${String(e)}`)
    return { logs }
  }
})

// ---- Ren'Py SDK 引导 ----
// SDK 状态检测：前端「打包」页首次使用引导用
ipcMain.handle('sdk:status', async () => {
  const sdk = await findRenpySdk()
  let webOk = false
  let androidOk = false
  let iosOk = false
  let androidSdkOk = false
  if (sdk) {
    // Web 打包需要 SDK 内置 web 平台（web/ 目录，含 Emscripten 编译产物）
    try {
      await fs.access(join(sdk.sdkDir, 'web'))
      webOk = true
    } catch { /* Web 平台包未安装 */ }
    // Android 打包需要 RAPT（rapt/android.py）
    try {
      await fs.access(join(sdk.sdkDir, 'rapt', 'android.py'))
      androidOk = true
    } catch { /* Android 平台包未安装 */ }
    // Android SDK 本体：launcher 首次安装会解压到 rapt/Sdk
    try {
      await fs.access(join(sdk.sdkDir, 'rapt', 'Sdk'))
      androidSdkOk = true
    } catch { /* Android SDK 尚未通过 launcher 安装 */ }
    // iOS 打包需要 renios
    try {
      await fs.access(join(sdk.sdkDir, 'renios'))
      iosOk = true
    } catch { /* iOS 平台包未安装 */ }
  }
  // 工具链检测：优先 PATH 命令，失败时回退到 macOS 标准安装位置
  let jdkOk = false
  let xcodeOk = false
  try {
    const r = spawnSync('java', ['-version'], { stdio: 'pipe', timeout: 5000 })
    jdkOk = r.status === 0
  } catch { /* java 未在 PATH */ }
  if (!jdkOk) {
    // macOS：检查 /usr/libexec/java_home -v 21（标准 JDK 注册位置，安装后无需配 PATH）
    try {
      const r = spawnSync('/usr/libexec/java_home', ['-v', '21'], { stdio: 'pipe', timeout: 5000 })
      jdkOk = r.status === 0
    } catch { /* java 未安装 */ }
  }
  try {
    const r = spawnSync('xcodebuild', ['-version'], { stdio: 'pipe', timeout: 5000 })
    xcodeOk = r.status === 0
  } catch { /* xcodebuild 未在 PATH */ }
  if (!xcodeOk) {
    // macOS：Xcode.app 已安装但命令行工具未激活也视为可用（首次打开会引导）
    try {
      await fs.access('/Applications/Xcode.app')
      xcodeOk = true
    } catch { /* Xcode 未安装 */ }
  }
  // SDK 目录可写性探测：Android 的 RAPT 会把编译中间文件写进 SDK（rapt/buildlib），
  // macOS 会拦截未授权应用的写入（Operation not permitted）
  let sdkWritable = false
  if (sdk) {
    const testFile = join(sdk.sdkDir, '.loom-write-test')
    try {
      await fs.writeFile(testFile, 'ok')
      await fs.rm(testFile, { force: true })
      sdkWritable = true
    } catch { /* 应用进程对 SDK 目录无写权限 */ }
  }
  return {
    found: !!sdk,
    exe: sdk?.exe ?? null,
    sdkDir: sdk?.sdkDir ?? null,
    platform: process.platform,
    downloadUrl: RENPY_DOWNLOAD_URL,
    webOk,
    androidOk,
    iosOk,
    androidSdkOk,
    jdkOk,
    xcodeOk,
    sdkWritable,
  }
})
// 打开 macOS「完全磁盘访问权限」设置页（解决 SDK 目录 Operation not permitted）
ipcMain.handle('sdk:openPrivacySettings', async () => {
  await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_AllFiles')
})
// 打开 Ren'Py 官方下载页
ipcMain.handle('sdk:openDownload', async () => {
  await shell.openExternal(RENPY_DOWNLOAD_URL)
})
// 启动 Ren'Py launcher（GUI）：用于首次 Android SDK 下载 / 签名配置
// 直接执行 renpy 二进制而非 shell.openPath，避免 macOS TCC 拦截
// （openPath 会把无扩展名的可执行文件当「文稿」用 LaunchServices 打开，被系统拒绝）
ipcMain.handle('sdk:openLauncher', async () => {
  const sdk = await findRenpySdk()
  if (!sdk) return false
  try {
    const child = spawn(sdk.exe, [], { cwd: sdk.sdkDir, detached: true, stdio: 'ignore' })
    child.on('error', () => { /* ignore */ })
    child.unref()
    return true
  } catch {
    return false
  }
})
// 选择图片文件（网页图标等）
ipcMain.handle('sdk:pickImageFile', async () => {
  const r = await dialog.showOpenDialog({
    title: '选择图片文件',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }],
  })
  return r.canceled ? null : (r.filePaths[0] ?? null)
})

// ---- Web 打包（HTML5/WebAssembly）----

// 简易静态文件服务器：用于 Web 打包后的本地浏览器预览
function startStaticServer(rootDir: string): Promise<{ url: string; close: () => void }> {
  return new Promise((resolvePromise, reject) => {
    const server = createServer((req, res) => {
      try {
        let urlPath = decodeURIComponent((req.url ?? '/').split('?')[0])
        if (urlPath === '/') urlPath = '/index.html'
        const filePath = resolve(rootDir, '.' + urlPath)
        if (!filePath.startsWith(resolve(rootDir))) {
          res.writeHead(403)
          res.end('Forbidden')
          return
        }
        fs.readFile(filePath)
          .then((data) => {
            const mime: Record<string, string> = {
              '.html': 'text/html; charset=utf-8',
              '.js': 'application/javascript',
              '.wasm': 'application/wasm',
              '.zip': 'application/zip',
              '.png': 'image/png',
              '.jpg': 'image/jpeg',
              '.jpeg': 'image/jpeg',
              '.webp': 'image/webp',
              '.json': 'application/json',
              '.css': 'text/css',
              '.svg': 'image/svg+xml',
            }
            res.writeHead(200, { 'Content-Type': mime[extname(filePath).toLowerCase()] ?? 'application/octet-stream' })
            res.end(data)
          })
          .catch(() => {
            res.writeHead(404)
            res.end('Not Found')
          })
      } catch {
        res.writeHead(500)
        res.end('Error')
      }
    })
    server.on('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address()
      if (addr && typeof addr === 'object') {
        resolvePromise({ url: `http://127.0.0.1:${addr.port}/`, close: () => server.close() })
      } else {
        reject(new Error('无法获取预览端口'))
      }
    })
  })
}

// 在 options.rpy 中写入/更新 build.version
async function ensureBuildVersion(projectPath: string, version: string): Promise<void> {
  const optionsPath = join(projectPath, 'game', 'options.rpy')
  try {
    let content = await fs.readFile(optionsPath, 'utf-8')
    if (/define build\.version\s*=/.test(content)) {
      content = content.replace(/define build\.version\s*=\s*".*?"/, `define build.version = "${version}"`)
    } else {
      content = content.replace(/define build\.name\s*=\s*".*?"/, (m) => `${m}\ndefine build.version = "${version}"`)
    }
    await fs.writeFile(optionsPath, content, 'utf-8')
  } catch { /* 写入失败不影响打包 */ }
}

// 定位 Web 产物根目录（web_build 可能生成在 name-version-web 子目录）
async function findWebRoot(dir: string): Promise<string> {
  try {
    await fs.access(join(dir, 'index.html'))
    return dir
  } catch { /* 继续查找子目录 */ }
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true })
    for (const e of entries) {
      if (!e.isDirectory()) continue
      try {
        await fs.access(join(dir, e.name, 'index.html'))
        return join(dir, e.name)
      } catch { /* 继续 */ }
    }
  } catch { /* 目录不存在 */ }
  return dir
}

// 复制项目到可写工作区（排除 builds/ 等构建产物），用于打包，绕开项目目录可能的写权限问题
async function copyProjectForBuild(projectPath: string, baseDir: string): Promise<string> {
  const dest = join(baseDir, `loom-build-${Date.now()}`)
  await fs.mkdir(dest, { recursive: true })
  const entries = await fs.readdir(projectPath, { withFileTypes: true })
  for (const e of entries) {
    if (e.name === 'builds' || e.name === '.git' || e.name === '.DS_Store') continue
    await fs.cp(join(projectPath, e.name), join(dest, e.name), { recursive: true })
  }
  return dest
}

// 网页打包：Ren'Py launcher web_build（HTML5/WebAssembly）
ipcMain.handle('projects:packageWeb', async (_e, projectPath: string, opts: { version?: string; iconPath?: string | null; preview?: boolean }) => {
  const logs: string[] = []
  const log = (s: string): void => { logs.push(s) }
  const workBase = join(app.getPath('userData'), 'tmp-build')
  try {
    const sdk = await findRenpySdk()
    if (!sdk) {
      throw new Error('未找到 Ren\'Py SDK')
    }
    // Web 平台包检查：SDK 根目录需有 web/（含 Emscripten 编译产物）
    try {
      await fs.access(join(sdk.sdkDir, 'web'))
    } catch {
      throw new Error('Ren\'Py SDK 缺少 Web 平台支持（web/ 目录）。请到官方下载页安装 Ren\'Py Web 平台包并解压到 SDK 根目录。')
    }

    const version = (opts?.version ?? '1.0').replace(/"/g, '').trim() || '1.0'
    log(`SDK: ${sdk.exe}`)
    log(`项目: ${projectPath}`)
    log(`版本号: ${version}`)

    // 在可写副本上打包，绕开项目目录的写入权限问题
    await fs.mkdir(workBase, { recursive: true })
    const workDir = await copyProjectForBuild(projectPath, workBase)
    log('已复制项目到可写工作区')

    // 网页图标：复制到副本根目录 web-icon.png（官方要求 512x512 正方形）
    if (opts?.iconPath) {
      try {
        await fs.copyFile(resolve(opts.iconPath), join(workDir, 'web-icon.png'))
        log('已安装网页图标 web-icon.png')
      } catch (e) {
        log(`网页图标复制失败: ${String(e)}`)
      }
    }

    await ensureBuildVersion(workDir, version)

    const outDir = join(workDir, 'builds', 'web')
    await fs.mkdir(outDir, { recursive: true })
    log('开始网页应用打包…')

    // Ren'Py 命令行：launcher web_build <project> --destination <dir>
    // PYTHONDONTWRITEBYTECODE=1：避免向 SDK 写 __pycache__，规避 SDK 目录写入限制
    const args = ['launcher', 'web_build', workDir, '--destination', outDir]
    const child = spawn(sdk.exe, args, {
      cwd: sdk.sdkDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
    })
    child.stdout?.on('data', (data) => { logs.push(data.toString()) })
    child.stderr?.on('data', (data) => { logs.push(`[error] ${data.toString()}`) })

    const TIMEOUT_MS = 30 * 60 * 1000
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      log('打包超时，正在终止打包进程…')
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM')
      } catch {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
      }
      setTimeout(() => {
        try { if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL') } catch { /* ignore */ }
      }, 5000).unref()
    }, TIMEOUT_MS)
    timer.unref()

    await new Promise<void>((resolvePromise, reject) => {
      child.on('close', (code) => {
        clearTimeout(timer)
        if (timedOut) {
          reject(new Error('打包超时（30 分钟），已强制终止'))
        } else if (code === 0) {
          log('打包完成')
          sendCompletionNotification('网页应用打包完成', '网页版游戏已打包完成，可部署到任意平台。')
          resolvePromise()
        } else {
          reject(new Error(`打包失败，退出码: ${code}`))
        }
      })
      child.on('error', (err) => {
        clearTimeout(timer)
        reject(err)
      })
    })

    // 把产物搬运到用户可访问的目录（优先项目 builds/，不可写则回退 userData）
    const { dir: finalDir, usedFallback } = await resolveBuildsDir(projectPath)
    const webDir = join(finalDir, 'web')
    await fs.rm(webDir, { recursive: true, force: true })
    await fs.mkdir(finalDir, { recursive: true })
    await fs.cp(outDir, webDir, { recursive: true })
    if (usedFallback) log(`项目目录 builds/ 不可写，产物已输出到: ${finalDir}`)
    log(`产物目录: ${webDir}`)

    // 可选：本地浏览器预览
    let previewUrl: string | null = null
    if (opts?.preview) {
      try {
        const webRoot = await findWebRoot(webDir)
        const server = await startStaticServer(webRoot)
        previewUrl = server.url
        log(`本地预览: ${previewUrl}`)
        await shell.openExternal(previewUrl)
      } catch (e) {
        log(`预览启动失败: ${String(e)}`)
      }
    }

    return { logs, webDir, previewUrl }
  } catch (e) {
    logs.push(`错误: ${String(e)}`)
    return { logs }
  } finally {
    // 清理打包工作区副本
    try {
      await fs.rm(workBase, { recursive: true, force: true })
    } catch { /* ignore */ }
  }
})

// base36(MD5(distributionUrl))：Gradle wrapper 缓存子目录名的算法
function gradleWrapperHash(distUrl: string): string {
  const digest = createHash('md5').update(distUrl).digest()
  let n = BigInt('0x' + digest.toString('hex'))
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz'
  let s = ''
  while (n > 0n) {
    s = chars[Number(n % 36n)] + s
    n /= 36n
  }
  return s
}

// 用 curl 下载单个文件到指定路径，返回是否成功
function downloadWithCurl(url: string, dest: string): Promise<boolean> {
  const tmp = dest + '.part'
  return new Promise((resolvePromise) => {
    const child = spawn('curl', ['-fL', '--connect-timeout', '15', '--max-time', '900', '-o', tmp, url], {
      stdio: ['ignore', 'ignore', 'pipe'],
    })
    child.stderr?.on('data', () => { /* 静默下载 */ })
    const cleanup = (): void => { fs.rm(tmp, { force: true }).catch(() => { /* ignore */ }) }
    child.on('close', (code) => {
      if (code === 0) {
        fs.rename(tmp, dest).then(() => resolvePromise(true), () => resolvePromise(false))
      } else {
        cleanup()
        resolvePromise(false)
      }
    })
    child.on('error', () => {
      cleanup()
      resolvePromise(false)
    })
  })
}

// 预下载 Gradle 发行包到 wrapper 缓存。
// RAPT 的 gradle-wrapper.properties 指向 services.gradle.org（会重定向到 GitHub）。
// 在国内网络或本地 HTTPS 拦截（如 SteamTools）环境下，Java 常因不信任拦截证书而下载失败
// （javax.net.ssl.SSLHandshakeException）。这里用 curl（信任系统钥匙串）预先下载到
// wrapper 缓存目录，Gradle 发现发行包已存在即跳过网络下载。
async function ensureGradleDist(sdkDir: string, log: (s: string) => void): Promise<void> {
  const propsPath = join(sdkDir, 'rapt', 'project', 'gradle', 'wrapper', 'gradle-wrapper.properties')
  let distUrl = ''
  try {
    const content = await fs.readFile(propsPath, 'utf-8')
    const m = content.match(/^distributionUrl\s*=\s*(.+)$/m)
    if (m) distUrl = m[1].trim().replace(/\\([.:/])/g, '$1')
  } catch { /* 读不到配置则跳过预下载 */ }
  if (!distUrl) return

  const zipName = distUrl.split('/').pop() ?? ''
  if (!zipName.endsWith('.zip')) return
  const baseName = zipName.replace(/\.zip$/, '')
  const cacheDir = join(homedir(), '.gradle', 'wrapper', 'dists', baseName, gradleWrapperHash(distUrl))
  const dest = join(cacheDir, zipName)

  try {
    await fs.access(dest)
    return // 已在缓存中
  } catch { /* 需要下载 */ }

  // 清理残留的 .part / .lck 锁文件，避免 Gradle 误判
  try {
    const entries = await fs.readdir(cacheDir)
    for (const e of entries) {
      if (e !== zipName) await fs.rm(join(cacheDir, e), { recursive: true, force: true })
    }
  } catch { /* ignore */ }

  // 官方源会重定向到 GitHub（可能被本地工具拦截且极慢），先试国内镜像，再退回官方源
  const mirrors = [
    `https://mirrors.huaweicloud.com/gradle/${zipName}`,
    `https://mirrors.cloud.tencent.com/gradle/${zipName}`,
    `https://mirrors.aliyun.com/macports/distfiles/gradle/${zipName}`,
    distUrl,
  ]
  for (const url of mirrors) {
    log(`下载 Gradle 发行包（${url}）…`)
    if (await downloadWithCurl(url, dest)) {
      log(`Gradle 发行包已就绪: ${baseName}`)
      return
    }
    log('下载失败，尝试下一个源…')
  }
  log('Gradle 发行包下载失败，继续尝试构建（Ren\'Py 会给出具体错误）')
}

// 检查并安装 Ren'Py iOS 平台包（renios）。
// iOS 打包（launcher ios_create）依赖 SDK 根目录的 renios/，launcher 只会在图形界面
// 提示下载；命令行直接调用时若缺失会报 "Command ios_build is unknown"。
// 这里自动从官网下载并安装，同时校验 hash 与 launcher 的 renios_hash.txt 一致。
async function ensureRenios(sdkDir: string, log: (s: string) => void): Promise<void> {
  const reniosDir = join(sdkDir, 'renios')
  const hashRefPath = join(sdkDir, 'launcher', 'game', 'renios_hash.txt')

  const valid = async (): Promise<boolean> => {
    try {
      const hashRef = (await fs.readFile(hashRefPath, 'utf-8')).trim()
      const hashCur = (await fs.readFile(join(reniosDir, 'hash.txt'), 'utf-8')).trim()
      if (!hashRef || hashRef !== hashCur) return false
      // buildlib 里必须有实际模块文件（纯 __pycache__ 视为损坏）
      const entries = await fs.readdir(join(reniosDir, 'buildlib'))
      return entries.some((e) => e !== '__pycache__')
    } catch {
      return false
    }
  }

  if (await valid()) return

  const ver = /renpy-([\d.]+)-sdk/.exec(sdkDir)?.[1] ?? '8.5.2'
  const url = `https://www.renpy.org/dl/${ver}/renpy-${ver}-renios.zip`
  const tmpZip = join(tmpdir(), `renios-${ver}.zip`)
  const tmpDir = join(tmpdir(), `renios-${ver}-unzip`)
  log(`SDK 缺少可用的 iOS 平台包（renios），自动下载安装（${url}）…`)
  try {
    await fs.rm(tmpDir, { recursive: true, force: true })
    await fs.rm(tmpZip, { force: true })
    if (!(await downloadWithCurl(url, tmpZip))) {
      throw new Error('下载失败（网络异常或下载源不可达）')
    }
    const uz = spawnSync('unzip', ['-q', tmpZip, '-d', tmpDir], { stdio: 'pipe', timeout: 10 * 60 * 1000 })
    if (uz.status !== 0) throw new Error('解压失败')
    // zip 内含 renios/ 目录
    const extracted = join(tmpDir, 'renios')
    try {
      await fs.access(extracted)
    } catch {
      throw new Error('压缩包结构异常（未找到 renios/ 目录）')
    }
    // 备份旧的损坏目录，再整体替换
    try {
      await fs.access(reniosDir)
      await fs.rm(join(sdkDir, 'renios.bak'), { recursive: true, force: true })
      await fs.rename(reniosDir, join(sdkDir, 'renios.bak'))
    } catch { /* 原本不存在则跳过 */ }
    await fs.rename(extracted, reniosDir)
    await fs.rm(tmpZip, { force: true }).catch(() => { /* ignore */ })
    await fs.rm(tmpDir, { recursive: true, force: true }).catch(() => { /* ignore */ })
  } catch (e) {
    throw new Error(
      `iOS 平台包（renios）安装失败: ${e instanceof Error ? e.message : String(e)}。` +
      `可手动下载 ${url}，解压出 renios/ 文件夹放入 ${sdkDir} 后重试。`
    )
  }
  if (!(await valid())) {
    throw new Error(`iOS 平台包（renios）安装后校验失败，请从 Ren'Py 官网重新下载。`)
  }
  log('iOS 平台包（renios）安装完成')
}

// Android 打包需要 android.keystore / bundle.keystore 签名文件。
// Ren'Py launcher 的图形界面才会交互式生成密钥；命令行构建遇到缺失会直接失败
// （validateSigningRelease: Keystore file not found）。这里用 keytool 静默生成，
// 与 launcher 生成的一致：别名 android、密码 android、有效期 20000 天。
// 生成后会验证文件确实存在，失败则直接抛出明确错误，避免 Gradle 阶段才报错。
async function ensureAndroidKeystores(workDir: string, log: (s: string) => void): Promise<void> {
  const keystore = join(workDir, 'android.keystore')
  const bundleKeystore = join(workDir, 'bundle.keystore')

  // 定位 keytool：优先 JAVA_HOME/bin，其次 /usr/bin（macOS 系统 stub），最后 PATH
  async function resolveKeytool(): Promise<string> {
    const candidates: string[] = []
    if (process.env.JAVA_HOME) candidates.push(join(process.env.JAVA_HOME, 'bin', 'keytool'))
    candidates.push('/usr/bin/keytool')
    for (const c of candidates) {
      try {
        await fs.access(c)
        return c
      } catch { /* 继续找 */ }
    }
    return 'keytool' // 最后靠 PATH
  }

  let generated = false
  try {
    await fs.access(keystore)
  } catch {
    const keytool = await resolveKeytool()
    const r = spawnSync(
      keytool,
      ['-genkey', '-keystore', keystore, '-alias', 'android', '-keyalg', 'RSA', '-keysize', '2048',
        '-keypass', 'android', '-storepass', 'android', '-dname', "CN=A Ren'Py Creator", '-validity', '20000'],
      { stdio: 'pipe', timeout: 60000 }
    )
    if (r.status !== 0) {
      const detail = (r.stderr?.toString() ?? r.stdout?.toString() ?? r.error?.message ?? '').trim()
      throw new Error(`Android 签名密钥生成失败（${detail || 'keytool 不可用'}）。请确认已安装 JDK 21（Temurin）后重试。`)
    }
    generated = true
  }

  // 生成后必须验证文件真实存在，避免 Gradle 阶段报 keystore 缺失
  try {
    await fs.access(keystore)
  } catch {
    throw new Error('Android 签名密钥文件未生成，请确认 JDK 的 keytool 可用（安装 JDK 21 / Temurin）后重试。')
  }
  if (generated) log('已生成 Android 签名密钥（android.keystore，密码 android，请妥善备份）')

  try {
    await fs.access(bundleKeystore)
  } catch {
    await fs.copyFile(keystore, bundleKeystore).catch(() => { /* ignore */ })
  }
}

// 移动端打包：Android（RAPT）/ iOS（renios），与网页打包相同的副本打包方案
ipcMain.handle('projects:packageMobile', async (_e, projectPath: string, opts: { target?: 'android' | 'ios'; bundle?: boolean; version?: string; packageName?: string; appName?: string }) => {
  const logs: string[] = []
  const log = (s: string): void => { logs.push(s) }
  // 移动端打包工作区必须使用纯 ASCII 路径：RAPT 会把 keystore 的绝对路径写入
  // local.properties，而 Java 的 Properties 默认按 ISO-8859-1 解码。若路径含中文
  // （如用户目录「程序」），会被解码成乱码，导致 Gradle 报 keystore 找不到。
  // tmpdir()（macOS 上为 /var/folders/...）是纯 ASCII，可安全使用。
  const workBase = join(tmpdir(), 'loom-builds')
  const target = opts?.target === 'ios' ? 'ios' : 'android'
  const bundle = target === 'android' && !!opts?.bundle
  try {
    const sdk = await findRenpySdk()
    if (!sdk) {
      throw new Error('未找到 Ren\'Py SDK')
    }

    const version = (opts?.version ?? '1.0').replace(/"/g, '').trim() || '1.0'
    log(`SDK: ${sdk.exe}`)
    log(`项目: ${projectPath}`)
    log(`目标: ${target === 'ios' ? 'iOS' : bundle ? 'Android（AAB）' : 'Android（APK）'}`)
    log(`版本号: ${version}`)

    // 平台包与工具链检查
    if (target === 'android') {
      try {
        await fs.access(join(sdk.sdkDir, 'rapt', 'android.py'))
      } catch {
        throw new Error('SDK 缺少 Android 平台包（rapt/），请安装 Ren\'Py Android 平台包。')
      }
      try {
        const r = spawnSync('java', ['-version'], { stdio: 'pipe', timeout: 5000 })
        if (r.status !== 0) log('警告: 未检测到 Java（Ren\'Py 8.5 需要 JDK 21），Android 打包可能失败')
      } catch { log('警告: 未检测到 Java（Ren\'Py 8.5 需要 JDK 21），Android 打包可能失败') }
      // Android SDK 本体：launcher 首次安装会解压到 rapt/Sdk
      try {
        await fs.access(join(sdk.sdkDir, 'rapt', 'Sdk'))
      } catch {
        throw new Error('尚未安装 Android SDK。请先启动 Ren\'Py launcher，在其 Android 页点击 Install SDK（约数 GB）完成安装后再打包。')
      }
      if (!process.env.ANDROID_HOME && !process.env.ANDROID_SDK_ROOT) {
        log('提示: 未检测到 ANDROID_HOME；若 launcher 尚未下载过 Android SDK，请先运行 Ren\'Py launcher 的 Android 页完成初始化')
      }
    } else {
      if (process.platform !== 'darwin') {
        throw new Error('iOS 打包只能在 macOS 上进行。')
      }
      // iOS 平台包（renios）缺失/损坏时自动从官网下载安装
      await ensureRenios(sdk.sdkDir, log)
      // iOS 编译依赖完整 Xcode（含 iOS SDK）
      let xcodeVer = ''
      try {
        const r = spawnSync('xcodebuild', ['-version'], { stdio: 'pipe', timeout: 5000 })
        if (r.status === 0) xcodeVer = (r.stdout?.toString() ?? '').trim().split('\n')[0] ?? ''
      } catch { /* 未安装 */ }
      if (!xcodeVer) {
        throw new Error('未检测到 Xcode。iOS 打包需要完整 Xcode（含 iOS SDK），请从 App Store 安装 Xcode 后重试。')
      }
      log(`Xcode 已就绪: ${xcodeVer}`)
    }

    // Gradle 发行包预下载：绕开 Java 证书校验失败（本地 HTTPS 拦截/网络问题）
    await ensureGradleDist(sdk.sdkDir, log)

    // 副本打包：绕开项目目录写入权限问题
    await fs.mkdir(workBase, { recursive: true })
    const workDir = await copyProjectForBuild(projectPath, workBase)
    log('已复制项目到可写工作区')
    await ensureBuildVersion(workDir, version)

    // Android：项目级配置（android.json：包名 / 应用名 / 版本），自动生成，
    // 避免 launcher「请先配置」中止；同时预生成签名密钥，避免 CLI 构建报 keystore 缺失
    if (target === 'android') {
      const pkg = (opts?.packageName ?? 'com.pupurin.loom.game')
        .toLowerCase()
        .replace(/[^a-z0-9.]/g, '')
        .replace(/\.{2,}/g, '.')
        .replace(/^\.+|\.+$/g, '')
        .slice(0, 120)
      const appName = (opts?.appName ?? 'Pupurin Game').replace(/'/g, "\\'")
      const androidCfg = {
        package: pkg || 'com.pupurin.loom.game',
        name: appName,
        icon_name: appName,
        version,
        numeric_version: 1,
        orientation: 'sensorLandscape',
        permissions: ['VIBRATE'],
        include_pil: false,
        include_sqlite: false,
        store: 'none',
        update_icons: true,
        update_always: true,
        update_keystores: true,
        source: false,
        expansion: false,
      }
      await fs.writeFile(join(workDir, 'android.json'), JSON.stringify(androidCfg, null, 4))
      log(`已写入 Android 配置: ${androidCfg.package} v${version}`)
      await ensureAndroidKeystores(workDir, log)
    }

    const outDir = join(workDir, 'builds', target)
    await fs.mkdir(outDir, { recursive: true })

    // 统一的「运行构建命令并等待完成」逻辑：日志收集 + 超时强杀 + 退出码上报
    const runBuild = (cmd: string, args: string[], cwd: string, stepName: string, timeoutMs: number): Promise<void> =>
      new Promise<void>((resolvePromise, reject) => {
        const child = spawn(cmd, args, {
          cwd,
          stdio: ['ignore', 'pipe', 'pipe'],
          detached: true,
          env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
        })
        child.stdout?.on('data', (data) => { logs.push(data.toString()) })
        child.stderr?.on('data', (data) => { logs.push(`[error] ${data.toString()}`) })
        let timedOut = false
        const timer = setTimeout(() => {
          timedOut = true
          log(`${stepName}超时（${Math.round(timeoutMs / 60000)} 分钟），正在终止进程…`)
          try {
            if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM')
          } catch {
            try { child.kill('SIGKILL') } catch { /* ignore */ }
          }
          setTimeout(() => {
            try { if (child.pid !== undefined) process.kill(-child.pid, 'SIGKILL') } catch { /* ignore */ }
          }, 5000).unref()
        }, timeoutMs)
        timer.unref()
        child.on('close', (code) => {
          clearTimeout(timer)
          if (timedOut) {
            reject(new Error(`${stepName}超时，已强制终止`))
          } else if (code === 0) {
            resolvePromise()
          } else {
            reject(new Error(`${stepName}失败，退出码: ${code}`))
          }
        })
        child.on('error', (err) => {
          clearTimeout(timer)
          reject(err)
        })
      })

    if (target === 'android') {
      log('开始 Android 打包…')
      const args = bundle
        ? ['launcher', 'android_build', workDir, '--destination', outDir, '--bundle']
        : ['launcher', 'android_build', workDir, '--destination', outDir]
      await runBuild(sdk.exe, args, sdk.sdkDir, 'Android 打包', 60 * 60 * 1000)
      log('Android 打包完成')
      sendCompletionNotification('移动应用打包完成', `${bundle ? 'Android (AAB)' : 'Android (APK)'} 应用已打包完成。`)
    } else {
      // iOS：renios 生成 Xcode 工程，再用 xcodebuild 编译（模拟器、无签名）。
      // 注意：CLI 没有 ios_build 命令，正确流程是 launcher ios_create + xcodebuild。
      const xcodeDir = join(outDir, 'xcode-project')
      // 注意：renios 要求目标工程目录不存在（已存在会直接 fail），不能提前 mkdir
      log('开始 iOS 打包…（步骤 1/2：renios 生成 Xcode 工程）')
      await runBuild(sdk.exe, ['launcher', 'ios_create', workDir, xcodeDir], sdk.sdkDir, '生成 Xcode 工程', 30 * 60 * 1000)
      log('Xcode 工程已生成。（步骤 2/2：xcodebuild 编译，模拟器无签名）')
      // renios 会把 prototype.xcodeproj 重命名为 <项目名>.xcodeproj，需动态查找
      const entries = await fs.readdir(xcodeDir).catch(() => [] as string[])
      const projName = entries.find((n) => n.endsWith('.xcodeproj'))
      if (!projName) {
        throw new Error('未找到 Xcode 工程（.xcodeproj），请检查 renios 生成结果。')
      }
      await runBuild(
        'xcodebuild',
        [
          '-project', join(xcodeDir, projName),
          '-configuration', 'Release',
          // renios 预编译库只有真机 arm64 版本（无模拟器 slice），且仅支持 arm64 架构
          '-sdk', 'iphoneos',
          'ARCHS=arm64',
          'CODE_SIGNING_ALLOWED=NO',
          // 显式指定 SYMROOT：避免默认输出到 DerivedData，保证产物位于工程内 build/
          `SYMROOT=${join(xcodeDir, 'build')}`,
          'build',
        ],
        xcodeDir,
        'xcodebuild 编译',
        30 * 60 * 1000
      )
      // 搬运 .app 产物到输出目录（未签名真机构建，可导入 Xcode 配置签名后上架/安装）
      const appDir = join(xcodeDir, 'build', 'Release-iphoneos')
      let appName = ''
      try {
        const apps = await fs.readdir(appDir)
        appName = apps.find((n) => n.endsWith('.app')) ?? ''
      } catch { /* 下面统一报错 */ }
      if (!appName) {
        throw new Error('xcodebuild 已成功，但未找到 .app 产物，请检查 Xcode 工程。')
      }
      await fs.cp(join(appDir, appName), join(outDir, appName), { recursive: true })
      log(`iOS 打包完成（产物: ${appName}，未签名真机构建）`)
      sendCompletionNotification('移动应用打包完成', 'iOS 应用（真机未签名）已打包完成。')
    }

    // 把产物搬运到用户可访问的目录
    const { dir: finalDir, usedFallback } = await resolveBuildsDir(projectPath)
    const finalOut = join(finalDir, target)
    await fs.rm(finalOut, { recursive: true, force: true })
    await fs.mkdir(finalDir, { recursive: true })
    await fs.cp(outDir, finalOut, { recursive: true })
    if (usedFallback) log(`项目目录 builds/ 不可写，产物已输出到: ${finalDir}`)
    log(`产物目录: ${finalOut}`)

    return { logs, outDir: finalOut }
  } catch (e) {
    logs.push(`错误: ${String(e)}`)
    return { logs }
  } finally {
    // 清理打包工作区副本
    try {
      await fs.rm(workBase, { recursive: true, force: true })
    } catch { /* ignore */ }
  }
})
// 在系统文件管理器中显示指定路径
ipcMain.handle('sdk:revealPath', async (_e, p: string) => {
  shell.showItemInFolder(p)
})
ipcMain.handle('shell:openExternal', async (_e, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) {
    await shell.openExternal(url)
  }
})

// ---- 应用设置存储（userData/settings.json，原子写） ----
function getSettingsFile(): string {
  return join(app.getPath('userData'), 'settings.json')
}
async function readSettings(): Promise<Record<string, unknown>> {
  try {
    return JSON.parse(await fs.readFile(getSettingsFile(), 'utf-8'))
  } catch {
    return {}
  }
}
// 设置写入必须串行化：并发调用若共用同一 .tmp 路径，后写者会截断并 rename 走前者的临时文件，
// 导致前者的 rename 报 ENOENT（设置丢失）。这里用唯一临时文件名 + 写队列彻底规避。
let settingsWriteQueue: Promise<unknown> = Promise.resolve()
function writeSettings(s: Record<string, unknown>): Promise<void> {
  const run = async (): Promise<void> => {
    const f = getSettingsFile()
    const tmp = `${f}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(s, null, 2), 'utf-8')
    await fs.rename(tmp, f)
  }
  const next = settingsWriteQueue.then(run, run)
  settingsWriteQueue = next.catch(() => undefined)
  return next
}
ipcMain.handle('settings:get', async () => readSettings())
ipcMain.handle('settings:set', async (_e, key: string, value: unknown) => {
  // 只允许写入白名单键，避免渲染层污染任意配置
  const allowed = new Set(['sdkPath', 'themeMode', 'themePreset', 'themeCustomAccent', 'editorFontSize'])
  if (!allowed.has(key)) throw new Error(`不允许的设置项: ${key}`)
  const s = await readSettings()
  // sdkPath 需要校验：指向的目录必须包含可用的 Ren'Py SDK 可执行文件
  if (key === 'sdkPath' && typeof value === 'string' && value.trim()) {
    const isWin = process.platform === 'win32'
    const exe = isWin ? join(value, 'renpy.exe') : join(value, 'renpy.app', 'Contents', 'MacOS', 'renpy')
    try {
      await fs.access(exe)
    } catch {
      throw new Error('SDK 目录无效：未找到 ' + (isWin ? 'renpy.exe' : 'renpy.app') + '，请选择 Ren\'Py SDK 根目录')
    }
  }
  s[key] = value
  await writeSettings(s)
  return s
})

// ---- 插件系统 IPC（目录：userData/plugins/<id>/{manifest.json, main.js}）----
ipcMain.handle('plugins:list', () => listPlugins())
ipcMain.handle('plugins:loadMain', (_e, id: string) => loadPluginMain(id))
ipcMain.handle('plugins:setEnabled', (_e, id: string, enabled: boolean) => setPluginEnabled(id, enabled))
ipcMain.handle('plugins:setTrusted', (_e, id: string, trusted: boolean) => setPluginTrusted(id, trusted))
ipcMain.handle('plugins:openDir', () => openPluginsDir())
ipcMain.handle('plugins:openMain', (_e, id: string) => openPluginMain(id))
ipcMain.handle('plugins:getData', (_e, id: string) => getPluginData(id))
ipcMain.handle('plugins:setData', (_e, id: string, data: Record<string, unknown>) => setPluginData(id, data))
// 主进程能力：受限项目文件读写 / HTTP 代理 / 命令执行（exec 需确认弹窗）
ipcMain.handle('plugins:fsRead', (_e, projectPath: string, subPath: string) => pluginFsRead(projectPath, subPath))
ipcMain.handle('plugins:fsWrite', (_e, projectPath: string, subPath: string, content: string) =>
  pluginFsWrite(projectPath, subPath, content)
)
ipcMain.handle('plugins:fsList', (_e, projectPath: string, subDir: string) => pluginFsList(projectPath, subDir))
ipcMain.handle('plugins:uploadImage', (_e, projectPath: string) => pluginFsUploadImage(mainWindow, projectPath))
ipcMain.handle('plugins:http', (_e, method: string, url: string, body?: string, headers?: Record<string, string>) =>
  pluginHttp(method, url, body, headers))
ipcMain.handle('plugins:exec', (_e, command: string) => pluginExec(mainWindow, command))
// 插件商城（链路验证）：拉取索引 / 从 GitHub 仓库 tag 安装
ipcMain.handle('store:fetchIndex', (_e, indexUrl: string) => fetchStoreIndex(indexUrl))
ipcMain.handle('store:install', (_e, entry: StorePlugin) => installPluginFromStore(entry))
// 从官方模板创建插件（拉取商城仓库 template/ 目录）
ipcMain.handle('plugins:create', (_e, input: { id: string; name: string; description: string; author: string }) =>
  createPluginFromTemplate(input))

// ---- 检查更新（GitHub Releases 源，轻量免签名方案） ----
// 更新源固定为官方仓库 PupurinOfficial/PupurinLoom 的最新 Release，
// 读取 tag_name（版本）/ body（更新说明）/ assets（发行包）/ html_url（Release 页面）。
// 发现新版本后由用户点击链接下载安装（免签名，兼容 ad-hoc 构建）。
const DEFAULT_UPDATE_SOURCE = 'https://api.github.com/repos/PupurinOfficial/PupurinLoom/releases/latest'
function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map((n) => Number(n) || 0)
  const pb = b.split('.').map((n) => Number(n) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}
// 按平台挑选发行包资产：macOS 优先 dmg，Windows 优先 exe/msi，Linux 优先 AppImage/deb
function pickReleaseAsset(
  assets: Array<{ name?: string; browser_download_url?: string }>,
  platform: string
): { name?: string; browser_download_url?: string } | null {
  const prefer: RegExp[] =
    platform === 'darwin'
      ? [/\.dmg$/i, /\.zip$/i]
      : platform === 'win32'
        ? [/\.exe$/i, /\.msi$/i]
        : [/\.AppImage$/i, /\.deb$/i, /\.tar\.gz$/i]
  for (const re of prefer) {
    const hit = assets.find((a) => a.name && re.test(a.name))
    if (hit?.browser_download_url) return hit
  }
  return assets.find((a) => a.browser_download_url) ?? null
}
ipcMain.handle('app:checkUpdate', async () => {
  const current = app.getVersion()
  try {
    // 用 Electron net.fetch（Chromium 网络栈，遵循系统代理），全局 fetch 不走系统代理会失败
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'PupurinLoom' }
    const res = await net.fetch(DEFAULT_UPDATE_SOURCE, { headers, signal: AbortSignal.timeout(15000) })
    if (!res.ok) {
      // 仓库还没有 Release 时 latest 返回 404，视为「暂无发布」而非错误
      if (res.status === 404) {
        return { configured: true, hasUpdate: false, current, notes: '暂无发布版本', source: 'github' }
      }
      return { configured: true, error: `更新源响应异常（HTTP ${res.status}）`, current }
    }
    const data = (await res.json()) as Record<string, unknown>

    // GitHub Releases 源：tag_name → 版本，body → 更新说明，assets → 发行包，html_url → Release 页面
    const latest = String(data.tag_name ?? '').trim().replace(/^v/i, '')
    if (!latest) {
      return { configured: true, error: '更新源格式无效（缺少 tag_name）', current }
    }
    const assets = Array.isArray(data.assets)
      ? (data.assets as Array<{ name?: string; browser_download_url?: string }>)
      : []
    const asset = pickReleaseAsset(assets, process.platform)
    const hasUpdate = compareVersions(latest, current) > 0
    return {
      configured: true,
      hasUpdate,
      current,
      latest,
      url: asset?.browser_download_url ?? '',
      pageUrl: typeof data.html_url === 'string' ? data.html_url : '',
      notes: typeof data.body === 'string' ? data.body : '',
      source: 'github',
    }
  } catch (e) {
    // fetch 失败统一归类为网络问题，避免把底层 TypeError: Failed to fetch 直接抛给用户
    return {
      configured: true,
      error: '无法连接到更新源，请检查网络连接或地址是否正确',
      current,
    }
  }
})
// 从 .rpy 文件解析角色和差分，保存到 characters.json
ipcMain.handle('characters:parseFromScript', async (_e, projectRoot: string) =>
  parseCharactersFromScript(projectRoot)
)
ipcMain.handle('dialog:pickDirectory', () => pickDirectory(mainWindow))
// 诊断：测试指定目录的读写权限
ipcMain.handle('fs:probe', (_e, dir: string) => probeFs(dir))

// ---- 角色管理 IPC ----
ipcMain.handle('characters:load', (_e, projectRoot: string) =>
  loadCharacters(projectRoot)
)
ipcMain.handle('characters:save', (_e, projectRoot: string, characters: Character[]) =>
  saveCharacters(projectRoot, characters)
)
ipcMain.handle('characters:new', (_e, name: string) => newCharacter(name))
ipcMain.handle('characters:newSprite', (_e, name: string) => newSprite(name))

// ---- 变量管理 IPC ----
ipcMain.handle('variables:load', (_e, projectRoot: string) =>
  loadVariables(projectRoot)
)
ipcMain.handle('variables:save', async (_e, projectRoot: string, variables: Variable[]) => {
  await saveVariables(projectRoot, variables)
  await saveVariablesToScript(projectRoot, variables)
})
ipcMain.handle('variables:new', (_e, name: string) => newVariable(name))
ipcMain.handle('variables:parseFromScript', (_e, projectRoot: string) =>
  parseVariablesFromScript(projectRoot)
)

// ---- 文件保存 IPC ----
// 保存项目的 script.rpy 内容（原子写：临时文件 + rename）
ipcMain.handle('projects:saveScript', async (_e, projectPath: string, content: string) => {
  const scriptPath = join(projectPath, 'game', 'script.rpy')
  const tmp = scriptPath + '.tmp'
  await fs.writeFile(tmp, content, 'utf-8')
  await fs.rename(tmp, scriptPath)
  console.log('[ipc] saved script.rpy:', scriptPath)
})

// ---- 资源管理 IPC ----
// 故事/代码手动标记：持久化到 <项目根>/.pupurin-marks.json
// key 为相对 game/ 的路径（如 "script.rpy"、"chapter1/scene.rpy"），值为 'story' | 'code'
function getMarksFile(projectPath: string): string {
  return join(projectPath, '.pupurin-marks.json')
}

async function readStoryMarks(projectPath: string): Promise<Record<string, 'story' | 'code'>> {
  try {
    const raw = await fs.readFile(getMarksFile(projectPath), 'utf-8')
    const data = JSON.parse(raw)
    return data && typeof data.marks === 'object' ? data.marks : {}
  } catch {
    return {}
  }
}

async function writeStoryMarks(projectPath: string, marks: Record<string, 'story' | 'code'>): Promise<void> {
  const file = getMarksFile(projectPath)
  const tmp = file + '.tmp'
  await fs.writeFile(tmp, JSON.stringify({ marks }, null, 2), 'utf-8')
  await fs.rename(tmp, file)
}

// 自动判定：.rpy 是否含至少一个 label 定义
function isAutoStoryFile(content: string): boolean {
  return /^\s*label\s+\w+/m.test(content)
}

// 重命名/移动后同步迁移标记键
async function migrateStoryMarks(projectPath: string, oldKey: string, newKey: string): Promise<void> {
  if (oldKey === newKey) return
  const marks = await readStoryMarks(projectPath)
  const changed: Record<string, 'story' | 'code'> = {}
  let dirty = false
  for (const [k, v] of Object.entries(marks)) {
    if (k === oldKey || k.startsWith(oldKey + '/')) {
      changed[k.replace(oldKey, newKey)] = v
      dirty = true
    } else {
      changed[k] = v
    }
  }
  if (dirty) await writeStoryMarks(projectPath, changed)
}

// 删除后清理标记键
async function removeStoryMarks(projectPath: string, key: string): Promise<void> {
  const marks = await readStoryMarks(projectPath)
  const changed: Record<string, 'story' | 'code'> = {}
  let dirty = false
  for (const [k, v] of Object.entries(marks)) {
    if (k === key || k.startsWith(key + '/')) {
      dirty = true
      continue
    }
    changed[k] = v
  }
  if (dirty) await writeStoryMarks(projectPath, changed)
}

// 列出 game 目录下的文件和文件夹（递归一层）
ipcMain.handle('fs:list', async (_e, projectPath: string, subDir: string = '') => {
  const target = join(projectPath, 'game', subDir)
  try {
    const marks = await readStoryMarks(projectPath)
    const entries = await fs.readdir(target, { withFileTypes: true })
    const nodes = await Promise.all(
      entries
        .filter((e) => !e.name.startsWith('.'))
        .map(async (e) => {
          const rel = subDir ? join(subDir, e.name) : e.name
          if (e.isDirectory()) {
            return { name: e.name, isDir: true, path: rel, size: 0, isStoryFile: false }
          }
          let isStoryFile = false
          if (e.name.endsWith('.rpy')) {
            const mark = marks[rel]
            if (mark) {
              isStoryFile = mark === 'story'
            } else {
              try {
                const content = await fs.readFile(join(target, e.name), 'utf-8')
                isStoryFile = isAutoStoryFile(content)
              } catch { /* ignore */ }
            }
          }
          return { name: e.name, isDir: false, path: rel, size: 0, isStoryFile }
        })
    )
    return nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
  } catch (e) {
    const err = e as NodeJS.ErrnoException
    if (err.code === 'ENOENT') return []
    throw e
  }
})

// 设置/清除 .rpy 文件的故事/代码标记（null = 清除，恢复自动检测）
ipcMain.handle('fs:setStoryMark', async (_e, projectPath: string, filePath: string, mark: 'story' | 'code' | null) => {
  const marks = await readStoryMarks(projectPath)
  if (mark) {
    marks[filePath] = mark
  } else {
    delete marks[filePath]
  }
  await writeStoryMarks(projectPath, marks)
})

// 创建文件夹
ipcMain.handle('fs:createDir', async (_e, projectPath: string, subDir: string) => {
  const target = join(projectPath, 'game', subDir)
  await fs.mkdir(target, { recursive: true })
})

// 创建文件
ipcMain.handle('fs:createFile', async (_e, projectPath: string, subPath: string, content: string = '') => {
  const target = join(projectPath, 'game', subPath)
  await fs.writeFile(target, content, 'utf-8')
})

// 重命名
ipcMain.handle('fs:rename', async (_e, projectPath: string, oldPath: string, newName: string) => {
  const oldFull = join(projectPath, 'game', oldPath)
  const newFull = join(oldFull, '..', newName)
  await fs.rename(oldFull, newFull)
  // 同步迁移故事/代码标记
  const parent = oldPath.includes('/') ? oldPath.slice(0, oldPath.lastIndexOf('/')) : ''
  await migrateStoryMarks(projectPath, oldPath, parent ? `${parent}/${newName}` : newName)
})

// 删除（文件或文件夹）
ipcMain.handle('fs:delete', async (_e, projectPath: string, subPath: string) => {
  const target = join(projectPath, 'game', subPath)
  const stat = await fs.stat(target)
  if (stat.isDirectory()) {
    await fs.rm(target, { recursive: true })
  } else {
    await fs.unlink(target)
  }
  await removeStoryMarks(projectPath, subPath)
})

// 移动（拖拽到不同文件夹）
ipcMain.handle('fs:move', async (_e, projectPath: string, srcPath: string, destDir: string) => {
  const srcFull = join(projectPath, 'game', srcPath)
  const fileName = srcPath.split('/').pop() ?? ''
  const destFull = join(projectPath, 'game', destDir, fileName)
  await fs.rename(srcFull, destFull)
  await migrateStoryMarks(projectPath, srcPath, destDir ? `${destDir}/${fileName}` : fileName)
})

// 读取文件内容（文本）
ipcMain.handle('fs:readFile', async (_e, projectPath: string, subPath: string) => {
  const target = join(projectPath, 'game', subPath)
  return await fs.readFile(target, 'utf-8')
})

// 导入外部文件（从应用外拖拽或选择）
ipcMain.handle('fs:importFile', async (_e, projectPath: string, destSubDir: string, srcFilePath: string) => {
  const fileName = srcFilePath.split('/').pop() ?? 'imported'
  const destFull = join(projectPath, 'game', destSubDir, fileName)
  await fs.mkdir(join(projectPath, 'game', destSubDir), { recursive: true })
  await fs.copyFile(srcFilePath, destFull)
  return join(destSubDir, fileName)
})

// 上传图片到 game/images/（图形编辑器「其他」目标）：系统多选图片 → 复制到 images/，
// 同名文件自动追加 _1/_2 后缀避免覆盖。返回 game/ 相对路径 + Ren'Py 自动图片名（去扩展名）。
ipcMain.handle('fs:importImages', async (e, projectPath: string) => {
  const opts: Electron.OpenDialogOptions = {
    title: '选择要上传的图片（将复制到项目的 images/ 文件夹）',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) return []
  const imagesDir = join(projectPath, 'game', 'images')
  await fs.mkdir(imagesDir, { recursive: true })
  const out: Array<{ path: string; name: string }> = []
  for (const src of result.filePaths) {
    const ext = extname(src).toLowerCase()
    const base = basename(src, ext).replace(/[\\/:*?"<>|]/g, '_') || 'image'
    let target = join(imagesDir, `${base}${ext}`)
    let n = 1
    while (await fs.access(target).then(() => true).catch(() => false)) {
      target = join(imagesDir, `${base}_${n}${ext}`)
      n++
    }
    await fs.copyFile(src, target)
    const fileName = basename(target)
    out.push({ path: `images/${fileName}`, name: fileName.replace(/\.[^.]+$/, '') })
  }
  return out
})

// 移动文件/文件夹（拖拽移动）
ipcMain.handle('fs:moveFile', async (_e, projectPath: string, srcPath: string, destDir: string) => {
  console.log('[moveFile] projectPath:', projectPath)
  console.log('[moveFile] srcPath:', srcPath)
  console.log('[moveFile] destDir:', destDir)
  const srcFull = join(projectPath, 'game', srcPath)
  const destFull = join(projectPath, 'game', destDir, srcPath.split('/').pop() ?? 'moved')
  console.log('[moveFile] srcFull:', srcFull)
  console.log('[moveFile] destFull:', destFull)
  try {
    await fs.mkdir(join(projectPath, 'game', destDir), { recursive: true })
    await fs.rename(srcFull, destFull)
    const fileName = srcPath.split('/').pop() ?? ''
    await migrateStoryMarks(projectPath, srcPath, destDir ? `${destDir}/${fileName}` : fileName)
    console.log('[moveFile] success')
    return destFull
  } catch (e) {
    console.error('[moveFile] error:', e)
    throw e
  }
})

// ---- 非 ASCII 文件名检查与修复 ----
// Ren'Py 官方要求游戏内所有文件名必须为 ASCII：安卓 APK 是 zip，文件名无编码标准，
// 中文等非 ASCII 文件名打进 APK 后会乱码、无法加载（字体/影片/图片都会失效）。

// 按扩展名给出通用回退名前缀
function asciiFallbackPrefix(name: string): string {
  const ext = extname(name).toLowerCase()
  if (['.ttf', '.otf', '.ttc'].includes(ext)) return 'font'
  if (['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'].includes(ext)) return 'image'
  if (['.webm', '.mp4', '.mov'].includes(ext)) return 'video'
  if (['.wav', '.ogg', '.mp3', '.m4a'].includes(ext)) return 'audio'
  return 'asset'
}

// 生成 ASCII 建议名：保留原名的 ASCII 字符；若全为非 ASCII，用扩展名前缀回退（如 font.ttf）
function suggestAsciiName(name: string): string {
  const ext = extname(name)
  const stem = name.slice(0, name.length - ext.length)
  const cleaned = stem.replace(/[^A-Za-z0-9_-]/g, '')
  return (cleaned || asciiFallbackPrefix(name)) + ext
}

// 扫描 game/ 下所有非 ASCII 文件名（含目录），生成建议名（同目录内冲突自动加 -2/-3…）
ipcMain.handle('project:scanNonAsciiFiles', async (_e, projectPath: string) => {
  const gameDir = join(projectPath, 'game')
  const items: Array<{ dir: string; oldName: string; suggested: string; isDir: boolean }> = []
  const usedByDir = new Map<string, Set<string>>()

  async function usedSet(dir: string): Promise<Set<string>> {
    let s = usedByDir.get(dir)
    if (!s) {
      s = new Set<string>()
      try {
        const full = dir ? join(gameDir, dir) : gameDir
        for (const ex of await fs.readdir(full)) {
          s.add(ex.toLowerCase())
        }
      } catch { /* ignore */ }
      usedByDir.set(dir, s)
    }
    return s
  }

  async function walk(relDir: string): Promise<void> {
    const full = relDir ? join(gameDir, relDir) : gameDir
    let entries
    try {
      entries = await fs.readdir(full, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name === '.DS_Store') continue
      const relPath = relDir ? `${relDir}/${e.name}` : e.name
      if (!/^[\x00-\x7F]*$/.test(e.name)) {
        const used = await usedSet(relDir)
        let final = suggestAsciiName(e.name)
        let n = 2
        while (used.has(final.toLowerCase())) {
          final = suggestAsciiName(e.name).replace(/(\.[^.]*)?$/, `-${n}$1`)
          n++
        }
        used.add(final.toLowerCase())
        items.push({ dir: relDir, oldName: e.name, suggested: final, isDir: e.isDirectory() })
      }
      if (e.isDirectory()) {
        await walk(relPath)
      }
    }
  }

  await walk('')
  return items
})

// 应用重命名：改源项目文件 + 同步修改所有 .rpy 中的引用
ipcMain.handle('project:applyNonAsciiRename', async (_e, projectPath: string, items: Array<{ dir: string; oldName: string; newName: string; isDir: boolean }>) => {
  const gameDir = join(projectPath, 'game')
  const logs: string[] = []

  const mappings = items
    .filter((it) => it.oldName !== it.newName)
    .map((it) => ({
      dir: it.dir,
      isDir: it.isDir,
      oldName: it.oldName,
      newName: it.newName,
      oldPath: it.dir ? `${it.dir}/${it.oldName}` : it.oldName,
      newPath: it.dir ? `${it.dir}/${it.newName}` : it.newName,
    }))

  // 校验：新名必须为 ASCII、不能为空、不能带路径分隔符
  for (const m of mappings) {
    if (!m.newName.trim()) throw new Error('存在空的名称')
    if (!/^[\x00-\x7F]*$/.test(m.newName)) throw new Error(`新名称仍含非 ASCII 字符: ${m.newName}`)
    if (m.newName.includes('/') || m.newName.includes('\\') || m.newName.includes('..')) {
      throw new Error(`非法名称: ${m.newName}`)
    }
  }

  // 冲突检查：同一目录内新名不得相互冲突，也不得撞上未参与重命名的现有文件
  const dirs = new Set(mappings.map((m) => m.dir))
  for (const dir of dirs) {
    const group = mappings.filter((m) => m.dir === dir)
    const existing = new Set<string>()
    try {
      for (const ex of await fs.readdir(dir ? join(gameDir, dir) : gameDir)) {
        existing.add(ex.toLowerCase())
      }
    } catch { /* ignore */ }
    const removed = new Set(group.map((m) => m.oldName.toLowerCase()))
    const added = new Set<string>()
    for (const m of group) {
      const k = m.newName.toLowerCase()
      if (added.has(k) || (existing.has(k) && !removed.has(k))) {
        throw new Error(`名称冲突: ${m.newName}（同目录已有同名文件）`)
      }
      added.add(k)
    }
  }

  // 1) 先重命名所有文件（目录改名放在最后，避免父目录先改名导致路径失效）
  const files = mappings.filter((m) => !m.isDir)
  const dirsToRename = mappings.filter((m) => m.isDir).sort((a, b) => b.oldPath.length - a.oldPath.length)
  for (const m of files) {
    await fs.rename(join(gameDir, m.oldPath), join(gameDir, m.newPath))
    logs.push(`重命名 ${m.oldPath} → ${m.newPath}`)
  }
  for (const m of dirsToRename) {
    await fs.rename(join(gameDir, m.oldPath), join(gameDir, m.newPath))
    logs.push(`重命名目录 ${m.oldPath} → ${m.newPath}`)
  }

  // 2) 同步迁移故事/代码标记键
  for (const m of mappings) {
    await migrateStoryMarks(projectPath, m.oldPath, m.newPath)
  }

  // 3) 修改所有 .rpy/.rpym 中的引用（长串优先替换，避免部分重叠）
  const replacements: Array<{ old: string; new: string }> = []
  for (const m of mappings) {
    replacements.push({ old: m.oldPath, new: m.newPath })
    // 根目录文件的裸文件名引用（如 gui.rpy 里的 "字体.ttf"）
    if (!m.dir && !m.isDir) {
      replacements.push({ old: m.oldName, new: m.newName })
    }
  }
  replacements.sort((a, b) => b.old.length - a.old.length)

  let patchedFiles = 0
  async function patchRpy(relDir: string): Promise<void> {
    const full = relDir ? join(gameDir, relDir) : gameDir
    let entries
    try {
      entries = await fs.readdir(full, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      const relPath = relDir ? `${relDir}/${e.name}` : e.name
      if (e.isDirectory()) {
        await patchRpy(relPath)
      } else if (/\.rpy$/i.test(e.name)) {
        const fp = join(gameDir, relPath)
        const content = await fs.readFile(fp, 'utf-8')
        let out = content
        for (const r of replacements) {
          out = out.split(r.old).join(r.new)
        }
        if (out !== content) {
          await fs.writeFile(fp, out, 'utf-8')
          patchedFiles++
          logs.push(`已更新引用: ${relPath}`)
        }
      }
    }
  }
  await patchRpy('')

  return { logs, count: mappings.length, patchedFiles }
})

// 选择外部文件导入
ipcMain.handle('dialog:pickFiles', async (_e) => {
  const opts: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    message: '选择要导入的文件',
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled) return []
  return result.filePaths
})

// 选择音频文件（角色语音）
ipcMain.handle('dialog:pickAudioFiles', async (_e) => {
  const opts: Electron.OpenDialogOptions = {
    properties: ['openFile', 'multiSelections'],
    title: '选择音频文件',
    filters: [
      { name: '音频', extensions: ['opus', 'ogg', 'mp3', 'mp2', 'flac', 'wav'] },
      { name: '所有文件', extensions: ['*'] },
    ],
  }
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled) return []
  return result.filePaths
})

// 读取图片为 base64（用于预览）
ipcMain.handle('fs:readImageBase64', async (_e, projectPath: string, subPath: string) => {
  const target = join(projectPath, 'game', subPath)
  const data = await fs.readFile(target)
  const ext = subPath.split('.').pop()?.toLowerCase() ?? 'png'
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'jpeg' : ext === 'webp' ? 'webp' : 'png'
  return `data:image/${mime};base64,${data.toString('base64')}`
})

// 写入图片（dataURL 形式）——UI 设计器「自动生成底图」落地到 gui/
ipcMain.handle('fs:writeImageBase64', async (_e, projectPath: string, subPath: string, dataUrl: string) => {
  const m = /^data:image\/(png|jpeg|webp);base64,(.+)$/.exec(dataUrl)
  if (!m) throw new Error('invalid image data url')
  const target = join(projectPath, 'game', subPath)
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.writeFile(target, Buffer.from(m[2], 'base64'))
})

// 读取音频为 base64（用于预览/时长）
ipcMain.handle('fs:readAudioBase64', async (_e, projectPath: string, subPath: string) => {
  const target = join(projectPath, 'game', subPath)
  const data = await fs.readFile(target)
  const ext = subPath.split('.').pop()?.toLowerCase() ?? 'ogg'
  const mimeMap: Record<string, string> = {
    opus: 'ogg',
    ogg: 'ogg',
    mp3: 'mpeg',
    mp2: 'mpeg',
    flac: 'flac',
    wav: 'wav',
  }
  const mime = mimeMap[ext] ?? 'ogg'
  return `data:audio/${mime};base64,${data.toString('base64')}`
})

// 递归列出 game/ 下所有 .rpy 文件，检测是否为故事文件（含 label 定义，可被手动标记覆盖）
ipcMain.handle('fs:listRpyFiles', async (_e, projectPath: string) => {
  const gameDir = join(projectPath, 'game')
  const marks = await readStoryMarks(projectPath)

  async function scanDir(dir: string, relPath: string): Promise<unknown[]> {
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return []
    }
    const nodes: Array<{ name: string; path: string; isDir: boolean; isStoryFile: boolean; children?: unknown[] }> = []

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue
      const fullPath = join(dir, entry.name)
      const rel = relPath ? join(relPath, entry.name) : entry.name

      if (entry.isDirectory()) {
        const children = await scanDir(fullPath, rel)
        // 只返回含 .rpy 文件的文件夹（空文件夹/纯资源文件夹不显示）
        if (children.length > 0) {
          nodes.push({ name: entry.name, path: rel, isDir: true, isStoryFile: false, children })
        }
      } else if (entry.name.endsWith('.rpy')) {
        let isStoryFile = false
        const mark = marks[rel]
        if (mark) {
          isStoryFile = mark === 'story'
        } else {
          try {
            const content = await fs.readFile(fullPath, 'utf-8')
            isStoryFile = isAutoStoryFile(content)
          } catch { /* ignore */ }
        }
        nodes.push({ name: entry.name, path: rel, isDir: false, isStoryFile })
      }
      // 非 .rpy 文件不显示在织机文件树中
    }

    nodes.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    return nodes
  }

  return scanDir(gameDir, '')
})

// 保存任意 .rpy 文件（原子写）
ipcMain.handle('fs:saveRpyFile', async (_e, projectPath: string, subPath: string, content: string) => {
  const target = join(projectPath, 'game', subPath)
  const tmp = target + '.tmp'
  await fs.writeFile(tmp, content, 'utf-8')
  await fs.rename(tmp, target)
  console.log('[ipc] saved:', subPath)
})
