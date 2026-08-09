import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { existsSync } from 'node:fs'
import { resolve, dirname, join } from 'node:path'
import { app } from 'electron'

// 生产环境：优先使用内置的 PyInstaller 单文件后端（Resources/bin/）
// 找不到时回退到 python3 + 源码（Resources/python/）
function resolveBackendExe(): string | null {
  if (app.isPackaged) {
    const exeName = process.platform === 'win32' ? 'pupurin-backend.exe' : 'pupurin-backend'
    const exe = join(process.resourcesPath, 'bin', exeName)
    if (existsSync(exe)) return exe
  }
  return null
}

// 兼容 CJS / ESM 两种产物定位 python 源码目录
function resolvePythonDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'python')
  }
  try {
    if (typeof __dirname !== 'undefined') return resolve(__dirname, '../../python')
  } catch {}
  // ESM 退化路径（electron-vite 默认输出 CJS，一般不会走到这里）
  return resolve(process.cwd(), 'python')
}

function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address()
      if (addr && typeof addr === 'object') {
        const port = addr.port
        srv.close(() => resolve(port))
      } else {
        reject(new Error('failed to allocate port'))
      }
    })
  })
}

// 健康等待：PyInstaller 单文件后端首次运行需要解压到临时目录，慢机器上可能超过 15s
async function waitForHealth(port: number, timeoutMs = 30000): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
        signal: AbortSignal.timeout(2000)
      })
      if (r.ok) return
    } catch {
      /* not ready yet */
    }
    await new Promise((r) => setTimeout(r, 200))
  }
  throw new Error(`python backend did not become healthy within ${timeoutMs}ms`)
}

// 单次健康探测（带超时），用于按需检测僵尸状态
async function probeHealth(port: number): Promise<boolean> {
  try {
    const r = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(3000)
    })
    return r.ok
  } catch {
    return false
  }
}

export interface BackendHandle {
  port: number
  proc: ChildProcess
}

// 启动单个后端进程（不包含重启逻辑）
async function spawnBackend(): Promise<BackendHandle> {
  const port = await getFreePort()
  const pyDir = resolvePythonDir()
  // 优先使用内置 PyInstaller 后端，否则用 python 源码（venv → python3）
  const backendExe = resolveBackendExe()
  let exe: string
  let cwd: string
  let args: string[]
  if (backendExe) {
    exe = backendExe
    cwd = dirname(backendExe)
    args = [String(port)]
  } else {
    const venvPy = resolve(pyDir, '.venv/bin/python')
    const venvPyWin = resolve(pyDir, '.venv/Scripts/python.exe')
    exe = existsSync(venvPy)
      ? venvPy
      : existsSync(venvPyWin)
        ? venvPyWin
        : process.platform === 'win32' ? 'python' : 'python3'
    cwd = pyDir
    args = ['server.py', String(port)]
  }
  const proc = spawn(exe, args, {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  proc.stdout?.on('data', (d: Buffer) => {
    console.log('[py:out]', d.toString().trimEnd())
  })
  proc.stderr?.on('data', (d: Buffer) => {
    console.error('[py:err]', d.toString().trimEnd())
  })
  proc.on('exit', (code) => {
    console.log(`[py] exited with code ${code}`)
  })
  proc.on('error', (err) => {
    console.error('[py] spawn error:', err)
  })

  await waitForHealth(port)
  console.log(`[py] backend healthy on http://127.0.0.1:${port}`)
  return { port, proc }
}

// ---- BackendManager：封装启动/重启/健康检查 ----

export class BackendManager {
  private handle: BackendHandle | null = null
  private healthTimer: NodeJS.Timeout | null = null
  private restarting: Promise<BackendHandle> | null = null

  async start(): Promise<BackendHandle> {
    // 已有 handle 且健康：直接返回
    if (this.handle) {
      const proc = this.handle.proc
      if (!proc.killed && proc.exitCode === null && proc.signalCode === null) {
        return this.handle
      }
    }
    // 并发去重
    if (this.restarting) return this.restarting
    this.restarting = (async () => {
      this.handle = await spawnBackend()
      this.startHealthCheck()
      return this.handle
    })()
    try {
      return await this.restarting
    } finally {
      this.restarting = null
    }
  }

  // 按需确保后端健康：如果进程死了或端口失效，自动重启
  // 多个调用者并发时只重启一次（用 restarting Promise 去重）
  async ensureHealthy(): Promise<BackendHandle | null> {
    // handle 为 null：后端从未启动或被 stop()，尝试 start()
    if (!this.handle) {
      console.warn('[py] no handle, attempting start()')
      try {
        return await this.start()
      } catch (e) {
        console.error('[py] start() failed in ensureHealthy:', e)
        return null
      }
    }

    // 进程已退出（正常退出 exitCode≠null，信号杀 exitCode=null 但 signalCode≠null）
    const proc = this.handle.proc
    if (proc.killed || proc.exitCode !== null || proc.signalCode !== null) {
      console.warn(`[py] process dead (killed=${proc.killed} exit=${proc.exitCode} signal=${proc.signalCode}), restarting...`)
      return this.restart()
    }

    // 进程活着但端口可能失效（僵尸状态）
    if (!(await probeHealth(this.handle.port))) {
      console.warn(`[py] port ${this.handle.port} not responding, restarting...`)
      return this.restart()
    }

    return this.handle
  }

  // 重启后端：杀旧进程 → 启新进程 → 更新 handle
  async restart(): Promise<BackendHandle> {
    // 并发去重：如果已经在重启中，复用同一个 Promise
    if (this.restarting) return this.restarting

    this.restarting = (async () => {
      // 杀旧进程
      if (this.handle?.proc && !this.handle.proc.killed) {
        try {
          this.handle.proc.kill('SIGTERM')
          // 给 1 秒优雅退出
          await new Promise((r) => setTimeout(r, 1000))
          if (!this.handle.proc.killed && this.handle.proc.exitCode === null) {
            this.handle.proc.kill('SIGKILL')
          }
        } catch (e) {
          console.error('[py] failed to kill old process:', e)
        }
      }

      // 启新进程
      this.handle = await spawnBackend()
      return this.handle
    })()

    try {
      return await this.restarting
    } finally {
      this.restarting = null
    }
  }

  stop(): void {
    if (this.healthTimer) {
      clearInterval(this.healthTimer)
      this.healthTimer = null
    }
    if (this.handle?.proc && !this.handle.proc.killed) {
      this.handle.proc.kill('SIGTERM')
    }
    this.handle = null
  }

  getHandle(): BackendHandle | null {
    return this.handle
  }

  // 周期性健康检查：每 30 秒探测一次，失败则自动重启
  private startHealthCheck(): void {
    if (this.healthTimer) clearInterval(this.healthTimer)
    this.healthTimer = setInterval(async () => {
      if (!this.handle) return
      const healthy = await probeHealth(this.handle.port)
      if (!healthy) {
        console.warn('[py] periodic health check failed, auto-restarting...')
        try {
          await this.restart()
        } catch (e) {
          console.error('[py] auto-restart failed:', e)
        }
      }
    }, 30000)
    // 不阻止进程退出
    this.healthTimer.unref()
  }
}
