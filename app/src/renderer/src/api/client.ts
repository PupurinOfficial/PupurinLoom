import type { ParseResult, ProjectParseResult } from '../types'

let baseUrl: string | null = null

export async function getBaseUrl(): Promise<string> {
  if (baseUrl) return baseUrl
  const port = await window.pupurin.getBackendPort()
  if (!port) throw new Error('python backend not ready')
  baseUrl = `http://127.0.0.1:${port}`
  return baseUrl
}

// 后端重启换端口时清除缓存，下次 getBaseUrl 会重新拉取
export function resetBaseUrl(): void {
  baseUrl = null
}

// fetch 包装：失败时清除 baseUrl 缓存并重试一次，规避后端重启后端口失效
async function fetchWithRetry(url: string, init?: RequestInit): Promise<Response> {
  let resp: Response
  try {
    resp = await fetch(url, init)
  } catch (e) {
    // 网络错误（后端挂了或端口失效）：清缓存重试一次
    resetBaseUrl()
    const base = await getBaseUrl()
    const newUrl = url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, base)
    resp = await fetch(newUrl, init)
    return resp
  }
  // 5xx 也可能是后端刚重启：清缓存重试
  if (resp.status >= 500) {
    resetBaseUrl()
    const base = await getBaseUrl()
    const newUrl = url.replace(/^https?:\/\/127\.0\.0\.1:\d+/, base)
    resp = await fetch(newUrl, init)
  }
  return resp
}

export async function fetchScript(projectPath: string): Promise<string> {
  const base = await getBaseUrl()
  // path 含中文/空格，必须 encodeURIComponent
  const r = await fetchWithRetry(`${base}/api/script?path=${encodeURIComponent(projectPath)}`)
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`fetchScript ${r.status}: ${detail}`)
  }
  const j = (await r.json()) as { source: string }
  return j.source
}

export async function parseSource(source?: string): Promise<ParseResult> {
  const base = await getBaseUrl()
  const r = await fetchWithRetry(`${base}/api/parse`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ source: source ?? null })
  })
  if (!r.ok) throw new Error(`parse failed: ${r.status}`)
  return (await r.json()) as ParseResult
}

// 聚合解析项目内所有 .rpy 故事文件（label 带 file、跨文件 edges、悬空跳转、条件变量引用）
export async function parseProject(projectPath: string): Promise<ProjectParseResult> {
  const base = await getBaseUrl()
  const r = await fetchWithRetry(`${base}/api/parse-project`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: projectPath })
  })
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`parseProject ${r.status}: ${detail}`)
  }
  return (await r.json()) as ProjectParseResult
}

export interface ProjectStats {
  files: number
  total_lines: number
  total_chars: number
  dialogue_chars: number
  labels: number
  menus: number
  file_stats: Array<{
    path: string
    lines: number
    chars: number
    dialogue_chars: number
    labels: number
  }>
}

export async function fetchProjectStats(projectPath: string): Promise<ProjectStats> {
  const base = await getBaseUrl()
  const r = await fetchWithRetry(`${base}/api/stats?path=${encodeURIComponent(projectPath)}`)
  if (!r.ok) {
    const detail = await r.text().catch(() => '')
    throw new Error(`fetchStats ${r.status}: ${detail}`)
  }
  return (await r.json()) as ProjectStats
}

export async function openLogSocket(onMessage: (msg: unknown) => void): Promise<WebSocket> {
  // 重试 3 次，每次间隔递增，规避后端重启窗口期
  let lastErr: unknown = null
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const base = await getBaseUrl()
      const wsUrl = base.replace(/^http/, 'ws') + '/ws/logs'
      const ws = new WebSocket(wsUrl)
      ws.onmessage = (e) => {
        try {
          onMessage(JSON.parse(e.data))
        } catch {
          /* ignore non-json */
        }
      }
      // 等待连接建立，失败则重试
      await new Promise<void>((resolve, reject) => {
        ws.onopen = () => resolve()
        ws.onerror = () => reject(new Error('ws connect failed'))
        setTimeout(() => {
          if (ws.readyState !== WebSocket.OPEN) {
            reject(new Error('ws timeout'))
          }
        }, 5000)
      })
      return ws
    } catch (e) {
      lastErr = e
      resetBaseUrl()
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)))
    }
  }
  throw lastErr ?? new Error('ws failed after retries')
}
