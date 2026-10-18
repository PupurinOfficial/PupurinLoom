// 项目简介（标签 + 简介）：按项目隔离持久化，并统一拼成 AI 提示词上下文
// - 由主页「项目简介」板块读写；铃光时刻、来点灵感等 AI 功能在此基础上构建提示词
// - projectProfileBlock() 是唯一入口：有简介时返回可直接拼进 system 消息的文本块，无简介返回空串
import { useStore } from './useStore'

export interface ProjectProfile {
  tags: string[]
  intro: string
}

const KEY_PREFIX = 'loom-project-profile:'
export const profileKey = (projectPath: string): string => KEY_PREFIX + projectPath

/** 标签解析：按空白 / 逗号 / 顿号 / # 切分，去重保序 */
export function parseTags(text: string): string[] {
  return Array.from(
    new Set(
      String(text || '')
        .split(/[\s,，#、;；|]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  )
}

/** 读取该项目的标签与简介（localStorage，按项目隔离） */
export function readProfile(projectPath: string): ProjectProfile {
  try {
    const raw = localStorage.getItem(profileKey(projectPath))
    if (!raw) return { tags: [], intro: '' }
    const data = JSON.parse(raw) as { tags?: unknown; intro?: unknown }
    return {
      tags: Array.isArray(data.tags) ? data.tags.filter((t): t is string => typeof t === 'string' && !!t) : [],
      intro: typeof data.intro === 'string' ? data.intro : '',
    }
  } catch {
    return { tags: [], intro: '' }
  }
}

/** 写入该项目的标签与简介 */
export function writeProfile(projectPath: string, profile: ProjectProfile): void {
  try {
    localStorage.setItem(profileKey(projectPath), JSON.stringify(profile))
  } catch {
    /* ignore */
  }
}

/** 当前打开项目的简介（未打开项目时返回空简介） */
export function currentProfile(): ProjectProfile {
  const p = useStore.getState().currentProject?.path ?? ''
  return p ? readProfile(p) : { tags: [], intro: '' }
}

/**
 * 项目简介提示词块：供各 AI 功能拼进 system 消息，让输出贴合作品基调。
 * 项目没有标签也没有简介时返回空串（调用方直接忽略即可）。
 */
export function projectProfileBlock(projectPath?: string | null): string {
  const p = projectPath ?? useStore.getState().currentProject?.path ?? ''
  if (!p) return ''
  const { tags, intro } = readProfile(p)
  const body = intro.trim()
  if (tags.length === 0 && !body) return ''
  const lines = ['【项目简介（本作的设定与基调，输出时请保持一致）】']
  if (tags.length > 0) lines.push('标签：' + tags.map((t) => '#' + t).join(' '))
  if (body) lines.push('简介：' + body)
  return lines.join('\n')
}

/** 未配置简介时的空块：可直接拼进提示词，语义为「无项目背景」 */
export function profilePromptSuffix(block: string): string {
  return block ? '\n\n' + block : ''
}
