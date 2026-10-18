// 「不支持的媒体格式」检查与修复：用 ffmpeg 把 Ren'Py 无法播放的图片/音频/视频转成受支持格式。
//
// 判定依据（Ren'Py 官方文档）：
//  - 图片 displaying_images.html：默认 config.image_extensions = jpg/jpeg/png/webp/avif/svg
//  - 音频 audio.html：Opus / Ogg Vorbis / MP3 / MP2 / FLAC / WAV（仅未压缩 16 位有符号 PCM）
//  - 视频 movie.html：容器 WebM / Matroska / Ogg / AVI / 各类 MPEG 流；
//    编码 AV1 / VP9 / VP8 / Theora / MPEG-4 part 2 / MPEG-2 / MPEG-1；
//    明确不支持 H.264 与 AAC（文档原文：Ren'Py does not support H.264 decoding (or AAC)）
//
// 判定分两步：扩展名判定（快，无需 ffmpeg）+ 编码探测（仅对可能夹带不支持编码的容器/位深，
// 即 .mkv/.avi/.wav 用 `ffmpeg -i` 解析流信息）。没有 ffmpeg 时降级为仅扩展名判定。
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'

export type MediaKind = 'image' | 'audio' | 'video'

export interface MediaFormatItem {
  /** 相对 game/ 的目录（'' = game 根目录） */
  dir: string
  /** 原文件名（含扩展名） */
  name: string
  kind: MediaKind
  /** 判定为不支持的原因（展示给用户） */
  reason: string
  /** 系统建议的目标文件名（含目标扩展名，用户可修改） */
  suggested: string
  /** 建议的目标扩展名 */
  targetExt: string
}

export interface MediaApplyItem {
  dir: string
  name: string
  newName: string
  kind: MediaKind
}

export interface MediaConvertResult {
  logs: string[]
  /** 实际转换成功的文件数 */
  count: number
  /** 转换失败的文件与原因 */
  failed: Array<{ file: string; error: string }>
  /** 被更新引用的 .rpy 文件数 */
  patchedFiles: number
}

const KIND_LABEL: Record<MediaKind, string> = { image: '图片', audio: '音频', video: '视频' }

// ---- 扩展名分类 ----
const IMAGE_SUPPORTED = ['png', 'jpg', 'jpeg', 'webp', 'avif', 'svg']
const AUDIO_SUPPORTED = ['opus', 'ogg', 'oga', 'mp3', 'mp2', 'flac', 'wav']
const VIDEO_SUPPORTED = ['webm', 'mkv', 'avi', 'ogv', 'ogg', 'mpg', 'mpeg', 'm1v', 'm2v', 'mpv', 'm2p', 'mpe', 'ts', 'm2ts', 'vob']

// 扩展名 → 类别 + 是否受支持
const IMAGE_EXT = new Set([
  ...IMAGE_SUPPORTED,
  'gif', 'bmp', 'tif', 'tiff', 'ico', 'heic', 'heif', 'tga', 'psd', 'jp2', 'jfif', 'jpe',
  'dds', 'exr', 'ppm', 'pgm', 'pbm', 'xcf', 'hdr', 'pcx', 'emf', 'wmf',
])
const AUDIO_EXT = new Set([
  ...AUDIO_SUPPORTED,
  'm4a', 'm4b', 'aac', 'aiff', 'aif', 'aifc', 'amr', 'ape', 'mka', 'ac3', 'eac3', 'dts',
  'mid', 'midi', 'mod', 'wv', 'au', 'snd', 'ra', 'caf', 'mpc', 'tta', 'cda',
])
const VIDEO_EXT = new Set([
  ...VIDEO_SUPPORTED,
  'mp4', 'm4v', 'mov', 'flv', 'f4v', 'wmv', 'asf', 'rm', 'rmvb', '3gp', '3g2',
  'divx', 'xvid', 'swf', 'dv', 'qt', 'mxf', 'mts', 'm2t', 'vro', 'f4p', 'ogm',
])

/** 各格式的建议目标扩展名 */
const TARGET_EXT: Record<MediaKind, string> = { image: 'png', audio: 'ogg', video: 'webm' }

/** 允许作为转换目标的扩展名（必须是 Ren'Py 支持的格式） */
const CONVERTIBLE_TARGETS: Record<MediaKind, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'webp'],
  audio: ['ogg', 'opus', 'mp3', 'mp2', 'flac', 'wav'],
  video: ['webm', 'mkv', 'ogv', 'mpg'],
}

const VIDEO_CODEC_OK = new Set([
  'av1', 'vp9', 'vp8', 'theora', 'mpeg4', 'mpeg2video', 'mpeg1video', 'msmpeg4v2', 'msmpeg4v3', 'msvideo1',
])
const AUDIO_CODEC_OK = new Set(['opus', 'vorbis', 'mp3', 'mp2', 'flac'])

/** 受支持格式清单（用于弹窗说明文案） */
export const SUPPORTED_SUMMARY: Record<MediaKind, string> = {
  image: 'PNG / JPG / WEBP / AVIF / SVG',
  audio: 'OPUS / OGG Vorbis / MP3 / MP2 / FLAC / WAV（16 位 PCM）',
  video: 'WebM / Matroska(MKV) / Ogg / AVI / MPEG，编码限 AV1 / VP9 / VP8 / Theora / MPEG-4 part 2 / MPEG-1·2',
}

function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i <= 0 ? '' : name.slice(i + 1).toLowerCase()
}

/** 由扩展名判定类别；非媒体文件返回 null */
function kindOf(ext: string): MediaKind | null {
  if (IMAGE_EXT.has(ext)) return 'image'
  if (VIDEO_EXT.has(ext)) return 'video'
  if (AUDIO_EXT.has(ext)) return 'audio'
  return null
}

function isSupportedExt(kind: MediaKind, ext: string): boolean {
  if (kind === 'image') return IMAGE_SUPPORTED.includes(ext)
  if (kind === 'audio') return AUDIO_SUPPORTED.includes(ext)
  return VIDEO_SUPPORTED.includes(ext)
}

/** 建议目标扩展名：GIF 转 WEBP（保留动图），其余用类别默认值 */
function targetExtFor(kind: MediaKind, ext: string): string {
  if (kind === 'image' && ext === 'gif') return 'webp'
  return TARGET_EXT[kind]
}

/** 需要探测编码的扩展名：容器可能夹带不支持编码，WAV 可能不是 16 位 PCM */
const NEED_PROBE = new Set(['mkv', 'avi', 'wav'])

interface ProbeResult {
  video: string[]
  audio: string[]
  ok: boolean
}

/** 用 `ffmpeg -i` 读取流信息（不产出文件，ffmpeg 会以非 0 退出，属正常） */
function probeStreams(ffmpeg: string, filePath: string): ProbeResult | null {
  try {
    const r = spawnSync(ffmpeg, ['-hide_banner', '-nostdin', '-i', filePath], {
      stdio: 'pipe',
      timeout: 20000,
      encoding: 'utf-8',
    })
    const text = String(r.stderr ?? '')
    const video: string[] = []
    const audio: string[] = []
    for (const m of text.matchAll(/Stream #\d+:\d+(?:\([^)]*\))?(?:\[[^\]]*\])?: Video: ([A-Za-z0-9_]+)/g)) video.push(m[1])
    for (const m of text.matchAll(/Stream #\d+:\d+(?:\([^)]*\))?(?:\[[^\]]*\])?: Audio: ([A-Za-z0-9_]+)/g)) audio.push(m[1])
    if (!video.length && !audio.length) return null
    return { video, audio, ok: true }
  } catch {
    return null
  }
}

/** 探测结论：返回不支持的原因；受支持返回 null */
function probeReason(kind: MediaKind, ext: string, p: ProbeResult, name: string): string | null {
  if (kind === 'audio' && ext === 'wav') {
    const codec = p.audio[0] ?? ''
    if (/^pcm_s16(le|be)$/.test(codec)) return null
    return `${name} 的 WAV 编码为 ${codec || '未知'}，Ren'Py 仅支持未压缩 16 位 PCM WAV`
  }
  const badVideo = p.video.find((c) => !VIDEO_CODEC_OK.has(c))
  if (badVideo) {
    return `${name} 内含 ${badVideo} 视频编码，Ren'Py 不支持（仅支持 AV1 / VP9 / VP8 / Theora / MPEG-4 part 2 / MPEG-1·2）`
  }
  const badAudio = p.audio.find((c) => !AUDIO_CODEC_OK.has(c) && !c.startsWith('pcm_'))
  if (badAudio) {
    return `${name} 内含 ${badAudio} 音频编码，Ren'Py 不支持（仅支持 Opus / Vorbis / MP3 / MP2 / FLAC）`
  }
  return null
}

/** 组装建议文件名：换目标扩展名，同目录冲突时加 -2/-3… */
function suggestName(name: string, targetExt: string, used: Set<string>): string {
  const stem = name.replace(/\.[^.]*$/, '')
  let candidate = `${stem}.${targetExt}`
  let n = 2
  while (used.has(candidate.toLowerCase())) {
    candidate = `${stem}-${n}.${targetExt}`
    n++
  }
  used.add(candidate.toLowerCase())
  return candidate
}

/**
 * 扫描 game/ 下所有 Ren'Py 不支持的媒体文件。
 * ffmpeg 为 null 时跳过编码探测，仅按扩展名判定。
 */
export async function scanMediaFormats(projectPath: string, ffmpeg: string | null): Promise<MediaFormatItem[]> {
  const gameDir = join(projectPath, 'game')
  const items: MediaFormatItem[] = []
  const usedByDir = new Map<string, Set<string>>()

  async function usedSet(dir: string): Promise<Set<string>> {
    let s = usedByDir.get(dir)
    if (!s) {
      s = new Set<string>()
      try {
        for (const ex of await fs.readdir(dir ? join(gameDir, dir) : gameDir)) s.add(ex.toLowerCase())
      } catch {
        /* ignore */
      }
      usedByDir.set(dir, s)
    }
    return s
  }

  async function walk(relDir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(relDir ? join(gameDir, relDir) : gameDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue
      const relPath = relDir ? `${relDir}/${e.name}` : e.name
      if (e.isDirectory()) {
        await walk(relPath)
        continue
      }
      const ext = extOf(e.name)
      const kind = kindOf(ext)
      if (!kind) continue

      let reason: string | null = null
      if (!isSupportedExt(kind, ext)) {
        const support = kind === 'image' ? SUPPORTED_SUMMARY.image : kind === 'audio' ? SUPPORTED_SUMMARY.audio : ''
        reason = `Ren'Py 不支持 .${ext} 格式的${KIND_LABEL[kind]}${support ? `（${KIND_LABEL[kind]}支持：${support}）` : ''}`
      } else if (NEED_PROBE.has(ext) && ffmpeg) {
        const p = probeStreams(ffmpeg, join(gameDir, relPath))
        if (p) reason = probeReason(kind, ext, p, e.name)
      }
      if (!reason) continue

      const targetExt = targetExtFor(kind, ext)
      const used = await usedSet(relDir)
      items.push({ dir: relDir, name: e.name, kind, reason, targetExt, suggested: suggestName(e.name, targetExt, used) })
    }
  }

  await walk('')
  return items
}

// ---- 转换 ----

interface SpawnOutcome {
  code: number | null
  stderr: string
}

/** 异步执行 ffmpeg（不阻塞主进程），返回退出码与 stderr 末尾内容 */
function runFfmpeg(ffmpeg: string, args: string[], timeoutMs: number): Promise<SpawnOutcome> {
  return new Promise<SpawnOutcome>((resolve) => {
    const child = spawn(ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'] })
    let stderr = ''
    const limit = 64 * 1024
    child.stderr.on('data', (d: Buffer) => {
      stderr = (stderr + d.toString()).slice(-limit)
    })
    const timer = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* ignore */
      }
    }, timeoutMs)
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ code: -1, stderr: stderr + '\n无法启动 ffmpeg' })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stderr })
    })
  })
}

/** 按目标扩展名与类别生成编码参数（只产出 Ren'Py 支持的格式） */
function convertArgs(kind: MediaKind, srcExt: string, targetExt: string, input: string, output: string): string[] {
  const base = ['-hide_banner', '-nostdin', '-y', '-i', input]
  if (kind === 'image') {
    if (targetExt === 'png') return [...base, '-frames:v', '1', output]
    if (targetExt === 'jpg' || targetExt === 'jpeg') return [...base, '-frames:v', '1', '-q:v', '2', output]
    // webp：源为动图时保留动画，否则取单帧
    return srcExt === 'gif'
      ? [...base, '-c:v', 'libwebp', '-q:v', '80', '-loop', '0', output]
      : [...base, '-c:v', 'libwebp', '-q:v', '80', '-frames:v', '1', output]
  }
  if (kind === 'audio') {
    const a = ['-vn']
    if (targetExt === 'ogg') return [...base, ...a, '-c:a', 'libvorbis', '-q:a', '5', output]
    if (targetExt === 'opus') return [...base, ...a, '-c:a', 'libopus', '-b:a', '128k', output]
    if (targetExt === 'mp3') return [...base, ...a, '-c:a', 'libmp3lame', '-q:a', '2', output]
    if (targetExt === 'mp2') return [...base, ...a, '-c:a', 'mp2', '-b:a', '192k', output]
    if (targetExt === 'flac') return [...base, ...a, '-c:a', 'flac', output]
    return [...base, ...a, '-c:a', 'pcm_s16le', output] // wav：Ren'Py 只认 16 位 PCM
  }
  // video：偶数尺寸，避免 yuv420p 编码失败；默认 YUV420（文档提示 444 无硬件加速）
  const scale = ['-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2']
  if (targetExt === 'webm' || targetExt === 'mkv') {
    return [
      ...base, ...scale,
      '-c:v', 'libvpx-vp9', '-crf', '32', '-b:v', '0', '-row-mt', '1', '-cpu-used', '2',
      '-pix_fmt', 'yuv420p', '-c:a', 'libopus', '-b:a', '128k', output,
    ]
  }
  if (targetExt === 'ogv') {
    return [...base, ...scale, '-c:v', 'libtheora', '-q:v', '6', '-c:a', 'libvorbis', '-q:a', '5', output]
  }
  return [...base, ...scale, '-c:v', 'mpeg2video', '-b:v', '4M', '-c:a', 'mp2', '-b:a', '192k', output] // mpg
}

/** 转换单个文件：校验目标名 → 执行 ffmpeg → 删除源文件 */
async function convertOne(
  ffmpeg: string,
  gameDir: string,
  item: MediaApplyItem,
  log: (s: string) => void
): Promise<void> {
  const targetExt = extOf(item.newName)
  if (!item.newName.trim()) throw new Error('目标文件名为空')
  if (item.newName.includes('/') || item.newName.includes('\\') || item.newName.includes('..')) {
    throw new Error(`非法文件名: ${item.newName}`)
  }
  if (!CONVERTIBLE_TARGETS[item.kind].includes(targetExt)) {
    throw new Error(`目标格式 .${targetExt || '?'} 无法转换，可用：${CONVERTIBLE_TARGETS[item.kind].map((e) => '.' + e).join(' / ')}`)
  }

  const relOld = item.dir ? `${item.dir}/${item.name}` : item.name
  const relNew = item.dir ? `${item.dir}/${item.newName}` : item.newName
  const absOld = join(gameDir, relOld)
  const absNew = join(gameDir, relNew)

  if (relOld !== relNew) {
    const exists = await fs
      .access(absNew)
      .then(() => true)
      .catch(() => false)
    if (exists) throw new Error(`目标文件已存在: ${relNew}`)
  }

  const args = convertArgs(item.kind, extOf(item.name), targetExt, absOld, absNew)
  log(`转换 ${relOld} → ${relNew}`)
  const { code, stderr } = await runFfmpeg(ffmpeg, args, 30 * 60 * 1000)
  if (code !== 0) {
    const tail = stderr.trim().split('\n').slice(-3).join(' ')
    await fs.rm(absNew, { force: true }).catch(() => undefined) // 清掉半成品
    throw new Error(tail || `ffmpeg 退出码 ${String(code)}`)
  }
  if (relOld !== relNew) await fs.rm(absOld, { force: true })
}

/** 批量转换并按需同步 .rpy 中的引用（与「非 ASCII 文件名」修复一致的替换策略） */
export async function convertMediaFiles(
  projectPath: string,
  items: MediaApplyItem[],
  ffmpeg: string,
  log: (s: string) => void,
  hooks: {
    migrateMarks?: (oldRel: string, newRel: string) => Promise<void>
    onProgress?: (done: number, total: number, current: string) => void
  } = {}
): Promise<MediaConvertResult> {
  const gameDir = join(projectPath, 'game')
  const logs: string[] = []
  const push = (s: string): void => {
    logs.push(s)
    log(s)
  }
  const failed: Array<{ file: string; error: string }> = []
  const conversions: Array<{ dir: string; oldName: string; newName: string; oldRel: string; newRel: string }> = []
  let count = 0

  for (let i = 0; i < items.length; i++) {
    const it = items[i]
    const relOld = it.dir ? `${it.dir}/${it.name}` : it.name
    hooks.onProgress?.(i, items.length, relOld)
    try {
      await convertOne(ffmpeg, gameDir, it, push)
      const relNew = it.dir ? `${it.dir}/${it.newName}` : it.newName
      count++
      conversions.push({ dir: it.dir, oldName: it.name, newName: it.newName, oldRel: relOld, newRel: relNew })
      if (hooks.migrateMarks) await hooks.migrateMarks(relOld, relNew)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      failed.push({ file: relOld, error: msg })
      push(`转换失败 ${relOld}: ${msg}`)
    }
  }
  hooks.onProgress?.(items.length, items.length, '')

  // 同步 .rpy 中的引用：完整相对路径 + （根目录文件）裸文件名，长串优先替换避免部分重叠
  const replacements: Array<{ old: string; new: string }> = []
  for (const c of conversions) {
    replacements.push({ old: c.oldRel, new: c.newRel })
    if (!c.dir) replacements.push({ old: c.oldName, new: c.newName })
  }
  replacements.sort((a, b) => b.old.length - a.old.length)

  let patchedFiles = 0
  async function patchRpy(relDir: string): Promise<void> {
    let entries
    try {
      entries = await fs.readdir(relDir ? join(gameDir, relDir) : gameDir, { withFileTypes: true })
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
        for (const r of replacements) out = out.split(r.old).join(r.new)
        if (out !== content) {
          await fs.writeFile(fp, out, 'utf-8')
          patchedFiles++
          push(`已更新引用: ${relPath}`)
        }
      }
    }
  }
  if (conversions.length > 0) await patchRpy('')

  return { logs, count, failed, patchedFiles }
}
