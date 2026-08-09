import { join, resolve, sep } from 'node:path'
import { promises as fs } from 'node:fs'
import { createHash } from 'node:crypto'
import { gunzipSync } from 'node:zlib'
import { net } from 'electron'
import { ID_RE, pluginsDir, type PluginMeta } from './pluginManager'

// 插件商城（Phase 0：链路验证）
// 分发约定：商城仓库 = 官方索引仓库（PR 收录），仓库根下每个插件一个子目录（默认子目录名 = 插件 id），
// 插件内容（manifest.json + main.js）放在子目录内；插件版本 = git tag（vX.Y.Z）。
// GitHub codeload 直接生成 tar.gz，无需作者打包上传 zip。
// 商城索引 = 仓库根 plugins.json。

export interface StorePlugin {
  id: string
  name: string
  version: string
  description: string
  author: string
  repo: string // https://github.com/{owner}/{repo}
  subpath?: string // 插件在仓库内的子目录（默认 = 插件 id）
  tag?: string // 默认 v{version}
  sha256?: string // tar.gz 校验和（可选）
  homepage?: string
  minLoomVersion?: string
  icon?: string // 图标（emoji / data URI / SVG 字符串），未提供时按 id 匹配内置图标库
}

export interface StoreIndex {
  plugins: StorePlugin[]
}

const MAX_TARBALL = 20 * 1024 * 1024 // 20MB 上限，防恶意大包

// ---- tar.gz 解析（零依赖：Node zlib + 自写 ustar 解析）----

interface TarFile {
  path: string // 相对路径（剥离顶层目录后）
  data: Buffer
}

function parseTar(buf: Buffer): TarFile[] {
  const out: TarFile[] = []
  let off = 0
  while (off + 512 <= buf.length) {
    const name = buf.subarray(off, off + 100).toString('utf-8').replace(/\0.*$/, '')
    if (!name) break
    const sizeField = buf.subarray(off + 124, off + 136).toString('utf-8').replace(/\0.*$/, '').trim()
    const typeflag = buf[off + 156]
    const size = parseInt(sizeField, 8) || 0
    if (size < 0 || off + 512 + size > buf.length) break
    // 0 / '0' 为普通文件；'5' 为目录；其余（符号链接/设备等）跳过
    if (typeflag === 0 || typeflag === 0x30) {
      // 只保留普通文件路径，去掉顶层目录（codeload 顶层为 {repo}-{tag}/）
      const parts = name.split('/')
      if (parts[0] === '' || parts.length < 2) {
        off += 512 + Math.ceil(size / 512) * 512
        continue
      }
      parts.shift()
      const rel = parts.join('/')
      // 路径穿越防护：拒绝 ../、空段与绝对路径
      if (!rel || parts.some((p) => p === '..' || p === '.' || !p)) {
        off += 512 + Math.ceil(size / 512) * 512
        continue
      }
      out.push({ path: rel, data: Buffer.from(buf.subarray(off + 512, off + 512 + size)) })
    }
    off += 512 + Math.ceil(size / 512) * 512
  }
  return out
}

// ---- GitHub 仓库 URL 解析 ----

function parseRepo(repoUrl: string): { owner: string; repo: string } | null {
  const m = /^https?:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?$/i.exec(repoUrl.trim())
  if (!m) return null
  return { owner: m[1], repo: m[2] }
}

function tagOf(entry: StorePlugin): string {
  return entry.tag ?? `v${entry.version}`
}

// 子目录规范：去掉首尾斜杠，拒绝路径穿越/空段
function normalizeSubpath(sub: string): string | undefined {
  const s = sub.replace(/^\/+|\/+$/g, '')
  if (!s) return undefined
  const parts = s.split('/')
  if (parts.some((p) => p === '..' || p === '.' || !p)) return undefined
  return s
}

// ---- 索引拉取（raw CDN，无速率限制）----

// 上次成功拉取的索引（内存兜底：网络不佳时仍可展示，避免完全加载不出来）
let lastIndex: { url: string; index: StoreIndex } | null = null

export async function fetchStoreIndex(indexUrl: string): Promise<{
  ok: boolean
  index?: StoreIndex
  error?: string
  stale?: boolean
}> {
  if (!/^https?:\/\//.test(indexUrl)) return { ok: false, error: '仅支持 http/https 地址' }
  try {
    // 不带 no-store（部分 Electron 版本 net.fetch 对其支持不稳定），改由调用方加时间戳参数绕过 HTTP 缓存
    const res = await net.fetch(indexUrl, { signal: AbortSignal.timeout(30000) })
    if (!res.ok) {
      const error = `索引请求失败：HTTP ${res.status}`
      return lastIndex?.index ? { ok: true, index: lastIndex.index, error, stale: true } : { ok: false, error }
    }
    const text = await res.text()
    if (text.length > 2 * 1024 * 1024) return { ok: false, error: '索引文件过大' }
    const data = JSON.parse(text) as unknown
    if (!data || typeof data !== 'object' || !Array.isArray((data as StoreIndex).plugins)) {
      return { ok: false, error: '索引格式无效：缺少 plugins 数组' }
    }
    const plugins: StorePlugin[] = []
    for (const raw of (data as StoreIndex).plugins) {
      const p = raw as Partial<StorePlugin>
      if (typeof p.id !== 'string' || !ID_RE.test(p.id)) continue
      if (typeof p.repo !== 'string' || !parseRepo(p.repo)) continue
      plugins.push({
        id: p.id,
        name: typeof p.name === 'string' ? p.name : p.id,
        version: typeof p.version === 'string' && p.version ? p.version : '0.0.0',
        description: typeof p.description === 'string' ? p.description : '',
        author: typeof p.author === 'string' ? p.author : '',
        repo: p.repo,
        subpath: typeof p.subpath === 'string' && p.subpath ? normalizeSubpath(p.subpath) : undefined,
        tag: typeof p.tag === 'string' ? p.tag : undefined,
        sha256: typeof p.sha256 === 'string' ? p.sha256.toLowerCase() : undefined,
        homepage: typeof p.homepage === 'string' ? p.homepage : undefined,
        minLoomVersion: typeof p.minLoomVersion === 'string' ? p.minLoomVersion : undefined,
        icon: typeof p.icon === 'string' && p.icon ? p.icon : undefined,
      })
    }
    lastIndex = { url: indexUrl, index: { plugins } }
    return { ok: true, index: { plugins } }
  } catch (e) {
    const error = String(e)
    return lastIndex?.index ? { ok: true, index: lastIndex.index, error, stale: true } : { ok: false, error }
  }
}

// ---- 从 GitHub 仓库 tag 安装插件 ----

export async function installPluginFromStore(
  entry: StorePlugin
): Promise<{ ok: boolean; meta?: PluginMeta; error?: string }> {
  const repo = parseRepo(entry.repo)
  if (!repo) return { ok: false, error: '仓库地址无效' }
  if (!ID_RE.test(entry.id)) return { ok: false, error: '插件 id 不合法' }
  const tag = tagOf(entry)
  const url = `https://codeload.github.com/${repo.owner}/${repo.repo}/tar.gz/refs/tags/${tag}`

  let raw: Buffer
  try {
    const res = await net.fetch(url, { signal: AbortSignal.timeout(60000) })
    if (!res.ok) return { ok: false, error: `下载失败：HTTP ${res.status}（请确认仓库与 tag ${tag} 存在且为公开仓库）` }
    const ab = await res.arrayBuffer()
    raw = Buffer.from(ab)
  } catch (e) {
    return { ok: false, error: `下载失败：${String(e)}` }
  }
  if (raw.length > MAX_TARBALL) return { ok: false, error: '插件包超过 20MB 上限' }
  if (entry.sha256) {
    const actual = createHash('sha256').update(raw).digest('hex')
    if (actual !== entry.sha256) return { ok: false, error: 'sha256 校验失败，包可能被篡改' }
  }

  // 解压 tar.gz
  let files: TarFile[]
  try {
    files = parseTar(gunzipSync(raw))
  } catch (e) {
    return { ok: false, error: `解压失败：${String(e)}` }
  }
  if (files.length === 0) return { ok: false, error: '包内没有文件' }

  // 定位插件子目录（默认子目录名 = 插件 id），其余文件（索引/README 等）忽略
  const sub = normalizeSubpath(entry.subpath ?? entry.id) ?? entry.id
  const prefix = `${sub}/`
  const pluginFiles: TarFile[] = files
    .filter((f) => f.path.startsWith(prefix))
    .map((f) => ({ path: f.path.slice(prefix.length), data: f.data }))
  if (pluginFiles.length === 0) return { ok: false, error: `仓库内未找到插件目录 ${sub}` }

  // 校验 manifest
  const manifestFile = pluginFiles.find((f) => f.path === 'manifest.json')
  if (!manifestFile) return { ok: false, error: '缺少 manifest.json' }
  let manifest: Record<string, unknown>
  try {
    manifest = JSON.parse(manifestFile.data.toString('utf-8'))
  } catch {
    return { ok: false, error: 'manifest.json 解析失败' }
  }
  const manifestId = manifest.id
  if (manifestId !== entry.id) return { ok: false, error: 'manifest.id 与索引不一致' }
  const main = typeof manifest.main === 'string' && manifest.main ? manifest.main : 'main.js'
  if (!pluginFiles.some((f) => f.path === main)) return { ok: false, error: `缺少入口文件 ${main}` }

  // 写入临时目录后原子替换（防半成品）
  const base = pluginsDir()
  const tmp = join(base, `.store-tmp-${entry.id}-${Date.now()}`)
  try {
    for (const f of pluginFiles) {
      const target = resolve(tmp, f.path)
      if (target !== tmp && !target.startsWith(tmp + sep)) {
        return { ok: false, error: `包内含非法路径：${f.path}` }
      }
      await fs.mkdir(resolve(target, '..'), { recursive: true })
      await fs.writeFile(target, f.data)
    }
    const dest = join(base, entry.id)
    await fs.rm(dest, { recursive: true, force: true })
    await fs.rename(tmp, dest)
  } catch (e) {
    await fs.rm(tmp, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: `写入失败：${String(e)}` }
  }

  // 新安装的外部插件默认未启用、未信任（沿用现有信任机制）
  const meta: PluginMeta = {
    id: manifestId as string,
    name: (manifest.name as string) || entry.name,
    version: (manifest.version as string) || entry.version,
    description: (manifest.description as string) || entry.description,
    author: (manifest.author as string) || entry.author,
    main,
    builtin: false,
    enabled: false,
    trusted: false,
    hasMain: true,
  }
  return { ok: true, meta }
}
