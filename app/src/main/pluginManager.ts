import { app, shell, dialog, net, type BrowserWindow } from 'electron'
import { join, dirname, resolve, sep, extname, basename } from 'node:path'
import { promises as fs } from 'node:fs'
import { spawn } from 'node:child_process'
import { GALLERY_MANIFEST, galleryMain } from './builtinPlugins/gallery'
import { I18N_MANIFEST, i18nMain } from './builtinPlugins/i18n'

// 插件系统（Phase 1：命令 + 面板视图）
// 目录结构：userData/plugins/<id>/{manifest.json, main.js}
// manifest.json 字段：id / name / version / description / author / main / builtin
// main.js 在渲染层通过 new Function('loom', code) 执行，注入白名单 loom API。

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
  /** 图标（manifest.icon）：emoji / data URI / SVG 字符串，供设置、插件页、功能栏、搜索展示 */
  icon?: string
  /** 由「创建插件」模板生成，插件页显示开发引导 */
  scaffolded?: boolean
}

// 插件 id 仅允许安全字符，兼作目录名校验（防路径穿越）
export const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i

export function pluginsDir(): string {
  return join(app.getPath('userData'), 'plugins')
}
function stateFile(): string {
  return join(app.getPath('userData'), 'plugin-state.json')
}
function dataFile(id: string): string {
  return join(app.getPath('userData'), 'plugin-data', `${id}.json`)
}

// ---- 插件状态（启用/信任/模板标记）----
async function readState(): Promise<Record<string, { enabled?: boolean; trusted?: boolean; scaffolded?: boolean }>> {
  try {
    return JSON.parse(await fs.readFile(stateFile(), 'utf-8'))
  } catch {
    return {}
  }
}
// 状态写入同样串行化 + 唯一临时文件名（与 settings 并发 bug 同理）
let stateWriteQueue: Promise<unknown> = Promise.resolve()
function writeState(s: Record<string, { enabled?: boolean; trusted?: boolean; scaffolded?: boolean }>): Promise<void> {
  const run = async (): Promise<void> => {
    const f = stateFile()
    const tmp = `${f}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(s, null, 2), 'utf-8')
    await fs.rename(tmp, f)
  }
  const next = stateWriteQueue.then(run, run)
  stateWriteQueue = next.catch(() => undefined)
  return next
}

// ---- 内置示例插件「喵喵语」（首次运行时创建）----
const EXAMPLE_MANIFEST: Record<string, unknown> = {
  id: 'meow-loom',
  name: '喵喵语',
  version: '3.1.0',
  description: '内置示例插件：开启全局喵语，整个界面文字末尾都会加上「喵」',
  author: 'Pupurin° Loom',
  main: 'main.js',
  builtin: true,
}

const EXAMPLE_MAIN = `// 喵喵语 —— 内置示例插件
// 演示 loom 插件 API：命令、面板、事件钩子、主进程 fs / http
// 全局喵语：把整个应用界面的文字末尾都加上「喵」
// 可复制本目录为自定义插件后自行修改（id 需唯一）。

// ---- 全局喵语：整个应用界面文字末尾加「喵」 ----
// 状态挂在 window 上，插件热重载（force 刷新）时复用，避免重复启动观察器
var G = window.__meowGlobal || (window.__meowGlobal = { on: false, observer: null, originals: new WeakMap() })

function meowEligible(node) {
  var parent = node.parentElement
  if (!parent) return false
  if (parent.closest('.monaco-editor')) return false   // 代码编辑器
  if (parent.closest('.react-flow')) return false      // 流程图
  if (parent.closest('[contenteditable]')) return false
  if (parent.isContentEditable) return false
  return true
}

function meowTextNode(node) {
  if (node.nodeType !== 3) return
  var text = node.nodeValue || ''
  var t = text.replace(/\\s+$/, '')
  if (!t) return
  if (t.charAt(t.length - 1) === '喵') return          // 已加过
  if (!meowEligible(node)) return
  G.originals.set(node, text)                          // 记录加喵前文本（供关闭时还原）
  node.nodeValue = t + '喵' + text.slice(t.length)
}

function meowScan(root) {
  var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  var list = []
  while (walker.nextNode()) list.push(walker.currentNode)
  for (var i = 0; i < list.length; i++) meowTextNode(list[i])
}

function meowStart() {
  if (G.on) return
  G.on = true
  meowScan(document.body)
  G.observer = new MutationObserver(function (muts) {
    for (var i = 0; i < muts.length; i++) {
      var m = muts[i]
      if (m.type === 'characterData') { meowTextNode(m.target); continue }
      for (var j = 0; j < m.addedNodes.length; j++) {
        var n = m.addedNodes[j]
        if (n.nodeType === 3) meowTextNode(n)
        else if (n.nodeType === 1) meowScan(n)
      }
    }
  })
  G.observer.observe(document.body, { childList: true, subtree: true, characterData: true })
}

function meowStop() {
  if (!G.on) return
  G.on = false
  if (G.observer) { G.observer.disconnect(); G.observer = null }
  // 还原为记录的原始文本
  var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  var list = []
  while (walker.nextNode()) list.push(walker.currentNode)
  for (var i = 0; i < list.length; i++) {
    var orig = G.originals.get(list[i])
    if (orig != null) list[i].nodeValue = orig
  }
}

// ---- 命令 ----
loom.commands.register('meow.global.on', '全局喵语：开启', function () {
  meowStart()
  loom.store.set('globalMeow', true)
  loom.toast('全局喵语已开启：整个界面都变得喵喵喵了！', 'success')
})

loom.commands.register('meow.global.off', '全局喵语：关闭', function () {
  meowStop()
  loom.store.set('globalMeow', false)
  loom.toast('已关闭全局喵语喵', 'info')
})

loom.commands.register('meow.options', 'options.rpy 行数（fs 演示）', function () {
  return loom.fs.read('options.rpy').then(function (content) {
    if (content == null) { loom.toast('未找到 options.rpy 喵'); return }
    loom.toast('options.rpy 共 ' + content.split('\\n').length + ' 行')
  }).catch(function (e) { loom.toast('读取失败：' + e, 'error') })
})

// ---- 面板：全局喵语开关 + HTTP 演示 ----
loom.panel.register('meow.preview', '喵语控制台', {
  render: function () {
    return {
      html:
        '<div style="padding:4px;font-size:13px">' +
        '<div style="display:flex;gap:8px;margin-bottom:10px">' +
        '<button id="meow-g-on" style="flex:1;padding:6px;border-radius:6px;border:1px solid var(--loom-border);background:var(--loom-accent);color:var(--loom-bg);cursor:pointer">开启全局喵语</button>' +
        '<button id="meow-g-off" style="flex:1;padding:6px;border-radius:6px;border:1px solid var(--loom-border);background:var(--loom-panel2);color:var(--loom-text);cursor:pointer">关闭全局喵语</button>' +
        '</div>' +
        '<div style="display:flex;gap:8px">' +
        '<button id="meow-http" style="flex:1;padding:6px;border-radius:6px;border:1px solid var(--loom-border);background:var(--loom-panel2);color:var(--loom-text);cursor:pointer">HTTP 请求测试</button>' +
        '</div>' +
        '<div id="meow-out" style="margin-top:8px;background:var(--loom-bg);border:1px solid var(--loom-border);border-radius:6px;padding:8px;min-height:24px;font-size:12px;color:var(--loom-muted);word-break:break-all"></div>' +
        '</div>',
      mount: function (el) {
        var out = el.querySelector('#meow-out')
        var httpBtn = el.querySelector('#meow-http')
        var gOn = el.querySelector('#meow-g-on')
        var gOff = el.querySelector('#meow-g-off')
        if (httpBtn && out) {
          httpBtn.addEventListener('click', function () {
            out.textContent = '请求中…'
            loom.http.get('https://example.com').then(function (r) {
              out.textContent = 'HTTP ' + r.status + '：' + String(r.text || '').slice(0, 200)
            }).catch(function (e) {
              out.textContent = '请求失败：' + e
            })
          })
        }
        if (gOn) gOn.addEventListener('click', function () {
          meowStart()
          loom.store.set('globalMeow', true)
          loom.toast('全局喵语已开启喵！', 'success')
        })
        if (gOff) gOff.addEventListener('click', function () {
          meowStop()
          loom.store.set('globalMeow', false)
          loom.toast('已关闭全局喵语喵', 'info')
        })
      }
    }
  }
})

// 上次开启过全局喵语 → 启动时自动恢复
if (loom.store.get('globalMeow') === true) {
  setTimeout(meowStart, 300)
}
`

async function ensureBuiltinPlugin(id: string, manifest: Record<string, unknown>, main: string): Promise<void> {
  const dir = join(pluginsDir(), id)
  const targetVersion = String(manifest.version)
  try {
    const existing = JSON.parse(await fs.readFile(join(dir, 'manifest.json'), 'utf-8'))
    // 内置插件：main.js 与源码内联版本以「内容+版本」双重校验。
    // 版本一致时也强制重写 main.js，保证开发迭代中用户目录始终是最新实现
    if (existing.builtin === true && String(existing.version) === targetVersion) {
      await fs.writeFile(join(dir, 'main.js'), main, 'utf-8')
      return
    }
  } catch {
    /* 目录或 manifest 不存在则创建 */
  }
  await fs.mkdir(dir, { recursive: true })
  await fs.writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  await fs.writeFile(join(dir, 'main.js'), main, 'utf-8')
}

async function ensureBuiltinPlugins(): Promise<void> {
  // 旧版示例插件 hello-loom（早期内置）升级时移除，避免残留
  try {
    const legacyManifest = JSON.parse(
      await fs.readFile(join(pluginsDir(), 'hello-loom', 'manifest.json'), 'utf-8')
    )
    if (legacyManifest.builtin === true) {
      await fs.rm(join(pluginsDir(), 'hello-loom'), { recursive: true, force: true })
    }
  } catch {
    /* 不存在则无需处理 */
  }
  await ensureBuiltinPlugin('meow-loom', EXAMPLE_MANIFEST, EXAMPLE_MAIN)
  await ensureBuiltinPlugin('pupurin-gallery', GALLERY_MANIFEST, galleryMain)
  await ensureBuiltinPlugin('pupurin-i18n', I18N_MANIFEST, i18nMain)
}

// ---- 扫描插件目录 ----
export async function listPlugins(): Promise<PluginMeta[]> {
  const base = pluginsDir()
  await fs.mkdir(base, { recursive: true })
  await ensureBuiltinPlugins()
  const state = await readState()

  const entries = await fs.readdir(base, { withFileTypes: true })
  const out: PluginMeta[] = []
  for (const e of entries) {
    if (!e.isDirectory() || !ID_RE.test(e.name)) continue
    const dir = join(base, e.name)
    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(await fs.readFile(join(dir, 'manifest.json'), 'utf-8'))
    } catch {
      continue // manifest 缺失或无效的目录跳过
    }
    const id = typeof manifest.id === 'string' ? manifest.id : e.name
    if (id !== e.name) continue

    const main = typeof manifest.main === 'string' && manifest.main ? manifest.main : 'main.js'
    let hasMain = false
    try {
      await fs.access(join(dir, main))
      hasMain = true
    } catch {
      /* main.js 缺失：仍列出但不可执行 */
    }

    const builtin = manifest.builtin === true
    const st = state[id] ?? {}
    out.push({
      id,
      name: typeof manifest.name === 'string' && manifest.name ? manifest.name : id,
      version: typeof manifest.version === 'string' ? manifest.version : '0.0.0',
      description: typeof manifest.description === 'string' ? manifest.description : '',
      author: typeof manifest.author === 'string' ? manifest.author : '',
      main,
      builtin,
      // 默认：内置插件自动信任并启用；外部插件需用户手动信任后才启用
      enabled: st.enabled === true || (builtin && st.enabled !== false),
      trusted: st.trusted === true || builtin,
      hasMain,
      icon: typeof manifest.icon === 'string' && manifest.icon ? manifest.icon : undefined,
      scaffolded: st.scaffolded === true ? true : undefined,
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  return out
}

// ---- 读取插件 main.js ----
export async function loadPluginMain(id: string): Promise<string | null> {
  if (!ID_RE.test(id)) return null
  const list = await listPlugins()
  const meta = list.find((p) => p.id === id)
  if (!meta || !meta.hasMain || !meta.enabled) return null
  try {
    return await fs.readFile(join(pluginsDir(), id, meta.main), 'utf-8')
  } catch {
    return null
  }
}

// ---- 从官方模板创建插件（商城仓库 template/ 目录，随商城一起维护更新）----
// 创建成功后自动信任并启用（创作者自己的代码，无需二次信任）。
const TEMPLATE_REPO = 'PupurinOfficial/Loom-PluginStore'

// 拉取模板文件：优先 raw CDN；失败时回退 GitHub Contents API（节点更稳，弱网更可靠）
async function fetchTemplateFile(file: string): Promise<string | null> {
  const t = Date.now()
  try {
    const res = await net.fetch(
      `https://raw.githubusercontent.com/${TEMPLATE_REPO}/main/template/${file}?t=${t}`,
      { signal: AbortSignal.timeout(20000) }
    )
    if (res.ok) {
      const text = await res.text()
      if (text.trim()) return text
    }
  } catch {
    /* 继续走 Contents API 回退 */
  }
  try {
    const res = await net.fetch(
      `https://api.github.com/repos/${TEMPLATE_REPO}/contents/template/${file}`,
      { signal: AbortSignal.timeout(20000) }
    )
    if (!res.ok) return null
    const j = (await res.json()) as { content?: string; encoding?: string }
    if (j.encoding === 'base64' && typeof j.content === 'string') {
      return Buffer.from(j.content, 'base64').toString('utf-8')
    }
    return null
  } catch {
    return null
  }
}

export async function createPluginFromTemplate(input: {
  id: string
  name: string
  description: string
  author: string
}): Promise<{ ok: boolean; meta?: PluginMeta; error?: string }> {
  const id = input.id.trim().toLowerCase()
  if (!ID_RE.test(id)) return { ok: false, error: '插件 id 不合法：小写字母/数字开头，仅含字母、数字、._-，最长 64 字符' }
  const name = input.name.trim()
  if (!name) return { ok: false, error: '插件名称不能为空' }
  if (name.length > 50) return { ok: false, error: '插件名称过长（最多 50 字）' }
  const desc = input.description.trim()
  if (desc.length > 200) return { ok: false, error: '描述过长（最多 200 字）' }

  const base = pluginsDir()
  await fs.mkdir(base, { recursive: true })
  const dest = join(base, id)
  try {
    await fs.access(dest)
    return { ok: false, error: `插件目录已存在：${id}` }
  } catch {
    /* 目录不存在，继续创建 */
  }

  // 拉取官方模板（manifest.json + main.js）
  const fetched: Array<[string, string]> = []
  for (const file of ['manifest.json', 'main.js']) {
    const text = await fetchTemplateFile(file)
    if (text == null) return { ok: false, error: `拉取模板 ${file} 失败（请检查网络后重试）` }
    fetched.push([file, text])
  }

  // 替换占位符后写入目录（name/描述/作者去掉引号与换行，避免破坏 JSON/注释）
  const clean = (s: string): string => s.replace(/["\n\r]/g, '')
  const fill = (s: string): string =>
    s
      .replaceAll('{{id}}', id)
      .replaceAll('{{name}}', clean(name))
      .replaceAll('{{description}}', clean(desc))
      .replaceAll('{{author}}', clean(input.author.trim()) || 'Anonymous')
  try {
    await fs.mkdir(dest, { recursive: true })
    for (const [file, text] of fetched) await fs.writeFile(join(dest, file), fill(text), 'utf-8')
  } catch (e) {
    await fs.rm(dest, { recursive: true, force: true }).catch(() => {})
    return { ok: false, error: `写入失败：${String(e)}` }
  }

  // 创作者自己的插件：默认信任并启用；标记为模板创建，插件页显示开发引导
  const state = await readState()
  state[id] = { ...state[id], enabled: true, trusted: true, scaffolded: true }
  await writeState(state)

  const meta = (await listPlugins()).find((p) => p.id === id) ?? null
  return { ok: true, meta: meta ?? undefined }
}

// ---- 用系统默认编辑器打开插件入口文件（方便开发者直接开改）----
export async function openPluginMain(id: string): Promise<boolean> {
  if (!ID_RE.test(id)) return false
  const list = await listPlugins()
  const meta = list.find((p) => p.id === id)
  if (!meta || !meta.hasMain) return false
  const err = await shell.openPath(join(pluginsDir(), id, meta.main))
  return !err
}

// ---- 启用/禁用 ----
export async function setPluginEnabled(id: string, enabled: boolean): Promise<void> {
  if (!ID_RE.test(id)) return
  const state = await readState()
  state[id] = { ...state[id], enabled }
  await writeState(state)
}

// ---- 信任 ----
export async function setPluginTrusted(id: string, trusted: boolean): Promise<void> {
  if (!ID_RE.test(id)) return
  const state = await readState()
  state[id] = { ...state[id], trusted }
  await writeState(state)
}

// ---- 打开插件目录（Finder/资源管理器）----
export async function openPluginsDir(): Promise<void> {
  const dir = pluginsDir()
  await fs.mkdir(dir, { recursive: true })
  await shell.openPath(dir)
}

// ---- 插件私有数据（userData/plugin-data/<id>.json）----
export async function getPluginData(id: string): Promise<Record<string, unknown>> {
  if (!ID_RE.test(id)) return {}
  try {
    return JSON.parse(await fs.readFile(dataFile(id), 'utf-8'))
  } catch {
    return {}
  }
}

let dataWriteQueue: Promise<unknown> = Promise.resolve()
export function setPluginData(id: string, data: Record<string, unknown>): Promise<void> {
  if (!ID_RE.test(id)) return Promise.resolve()
  const run = async (): Promise<void> => {
    const f = dataFile(id)
    await fs.mkdir(dirname(f), { recursive: true })
    const tmp = `${f}.${process.pid}.${Date.now()}.tmp`
    await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf-8')
    await fs.rename(tmp, f)
  }
  const next = dataWriteQueue.then(run, run)
  dataWriteQueue = next.catch(() => undefined)
  return next
}

// ---- 主进程能力（loom.fs / loom.http / loom.exec）----

// 项目内路径校验：解析后必须仍在项目目录内，防止插件越界读写
export function resolveInProject(projectPath: string, subPath: string): string {
  const base = resolve(projectPath)
  const target = resolve(base, subPath)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error(`路径越界: ${subPath}`)
  }
  return target
}

export async function pluginFsRead(projectPath: string, subPath: string): Promise<string | null> {
  try {
    return await fs.readFile(resolveInProject(projectPath, subPath), 'utf-8')
  } catch {
    return null
  }
}

export async function pluginFsWrite(projectPath: string, subPath: string, content: string): Promise<void> {
  const target = resolveInProject(projectPath, subPath)
  // 自动创建父目录，支持写入 game/tl/<语言>/ 等嵌套路径
  await fs.mkdir(dirname(target), { recursive: true })
  await fs.writeFile(target, content, 'utf-8')
  console.log('[pluginFsWrite]', target, 'bytes=' + Buffer.byteLength(content, 'utf-8'))
}

export async function pluginFsList(
  projectPath: string,
  subDir: string
): Promise<Array<{ name: string; isDir: boolean; path: string }>> {
  const dir = resolveInProject(projectPath, subDir)
  const entries = await fs.readdir(dir, { withFileTypes: true })
  const rel = subDir === '' ? '' : subDir.replace(/[\\/]+$/, '')
  return entries.map((e) => ({
    name: e.name,
    isDir: e.isDirectory(),
    path: rel ? `${rel}/${e.name}` : e.name,
  }))
}

// 上传图片到项目 game/gallery/（画廊插件使用）；返回 game/ 相对路径
export async function pluginFsUploadImage(
  win: BrowserWindow | null,
  projectPath: string
): Promise<{ path: string; name: string; cancelled: boolean }> {
  const opts: Electron.OpenDialogOptions = {
    title: '选择要上传的图片',
    properties: ['openFile'],
    filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] }],
  }
  const result = win
    ? await dialog.showOpenDialog(win, opts)
    : await dialog.showOpenDialog(opts)
  if (result.canceled || result.filePaths.length === 0) {
    return { path: '', name: '', cancelled: true }
  }
  const src = result.filePaths[0]
  const ext = extname(src).toLowerCase()
  const base = basename(src, ext).replace(/[\\/:*?"<>|]/g, '_') || 'image'
  const galleryDir = join(resolveInProject(projectPath, 'game'), 'gallery')
  await fs.mkdir(galleryDir, { recursive: true })
  let target = join(galleryDir, `${base}${ext}`)
  let n = 1
  while (await fs.access(target).then(() => true).catch(() => false)) {
    target = join(galleryDir, `${base}_${n}${ext}`)
    n++
  }
  await fs.copyFile(src, target)
  const fileName = basename(target)
  return { path: `gallery/${fileName}`, name: fileName, cancelled: false }
}

// HTTP：主进程代理请求（渲染层无 CORS 限制）
export async function pluginHttp(
  method: string,
  url: string,
  body?: string,
  headers?: Record<string, string>
): Promise<{ ok: boolean; status: number; text: string }> {
  if (!/^https?:\/\//.test(url)) throw new Error('仅支持 http/https 地址')
  const res = await net.fetch(url, {
    method: String(method || 'GET').toUpperCase(),
    headers: headers ?? undefined,
    body: body ?? undefined,
    signal: AbortSignal.timeout(15000),
  })
  return { ok: res.ok, status: res.status, text: (await res.text()).slice(0, 5000) }
}

// 执行外部命令：必须先经用户确认（拒绝即抛错）。
// 用户可在确认框勾选「记住此命令」，之后同命令静默放行（持久化到 userData）。
let execTrust: Set<string> | null = null

async function execTrustList(): Promise<Set<string>> {
  if (execTrust) return execTrust
  try {
    const arr = JSON.parse(
      await fs.readFile(join(app.getPath('userData'), 'plugin-exec-trust.json'), 'utf-8')
    ) as unknown
    execTrust = new Set(Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string') : [])
  } catch {
    execTrust = new Set()
  }
  return execTrust
}

async function saveExecTrust(): Promise<void> {
  await fs.writeFile(
    join(app.getPath('userData'), 'plugin-exec-trust.json'),
    JSON.stringify([...(execTrust ?? new Set<string>())], null, 2),
    'utf-8'
  )
}

export async function pluginExec(
  win: BrowserWindow | null,
  command: string
): Promise<{ code: number | null; stdout: string; stderr: string }> {
  const trust = await execTrustList()
  if (!trust.has(command)) {
    const { response, checkboxChecked } = win
      ? await dialog.showMessageBox(win, {
          type: 'warning',
          buttons: ['拒绝', '允许执行'],
          defaultId: 0,
          cancelId: 0,
          title: '插件请求运行命令',
          message: '插件请求运行系统命令',
          detail: `${command}\n\n仅允许执行你信任的插件发出的命令。`,
          checkboxLabel: '记住此命令，以后不再询问',
          checkboxChecked: false,
          noLink: true,
        })
      : { response: 0, checkboxChecked: false }
    if (response !== 1) throw new Error('已拒绝执行命令')
    if (checkboxChecked) {
      trust.add(command)
      await saveExecTrust()
    }
  }
  return new Promise((resolve, reject) => {
    const isWin = process.platform === 'win32'
    const proc = spawn(isWin ? 'cmd.exe' : '/bin/sh', isWin ? ['/c', command] : ['-c', command], {
      timeout: 30000,
    })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString()))
    proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()))
    proc.on('error', (err) => reject(err))
    proc.on('close', (code) => resolve({ code, stdout: stdout.slice(0, 5000), stderr: stderr.slice(0, 5000) }))
  })
}
