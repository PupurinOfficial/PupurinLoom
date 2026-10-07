// 版本过滤引擎：按「版本方案」对解析后的剧情块做编译期静态过滤
// 规则：
//   1. 块无版本标签 → 所有版本都保留；有标签 → 仅当标签与方案标签有交集时保留
//   2. menu 选项同样按标签过滤，过滤后至少保留 1 个选项（保证 Ren'Py 语法合法）
//   3. 跳转断链修复：jump/call/菜单选项指向的 label 被移除时，重定向到最近仍存活的 label
//   4. 本文件内从未定义过的目标（跨文件/外部 label）不修改，保持原样

import type { DialogueBlock, MenuOptionBlock } from './dialogueParser'

export interface VersionFilterStats {
  /** 过滤后保留的块数（含嵌套） */
  keptBlocks: number
  /** 被移除的块数（含嵌套） */
  removedBlocks: number
  /** 被移除的 label 数 */
  removedLabels: number
  /** 被重定向的跳转数（jump/call/menu 选项） */
  redirectedJumps: number
}

export interface VersionFilterResult {
  blocks: DialogueBlock[]
  stats: VersionFilterStats
}

interface LabelRef {
  name: string
  line: number
}

// 递归收集所有 label 声明
function collectLabels(blocks: DialogueBlock[], out: LabelRef[] = []): LabelRef[] {
  for (const b of blocks) {
    if (b.type === 'label' && b.labelName) {
      out.push({ name: b.labelName, line: b.line })
    }
    if (b.type === 'menu' && b.options) {
      for (const opt of b.options) {
        if (opt.children) collectLabels(opt.children, out)
      }
    }
    if (b.type === 'if' && b.branches) {
      for (const br of b.branches) collectLabels(br.children, out)
    }
    if (b.children) collectLabels(b.children, out)
  }
  return out
}

// 统计块数量（含嵌套）
function countBlocks(blocks: DialogueBlock[]): number {
  let n = 0
  for (const b of blocks) {
    n += 1
    if (b.type === 'menu' && b.options) {
      n += b.options.length
      for (const opt of b.options) {
        if (opt.children) n += countBlocks(opt.children)
      }
    }
    if (b.type === 'if' && b.branches) {
      for (const br of b.branches) n += countBlocks(br.children)
    }
    if (b.children) n += countBlocks(b.children)
  }
  return n
}

// 块是否属于当前方案（无标签 = 全版本通用）
function inScheme(versions: string[] | undefined, tags: Set<string>): boolean {
  if (!versions || versions.length === 0) return true
  return versions.some((v) => tags.has(v))
}

// 递归过滤 blocks；stats 记录移除情况。
// 注意：label 被过滤时，其「场景内容」（紧随其后的更深缩进行）会变成无主的孤儿行仍然执行，
// 因此把 label 之后缩进更深的内容一并移除（直到下一个同级/更浅缩进的行）。
function filterRecursive(
  blocks: DialogueBlock[],
  tags: Set<string>,
  stats: VersionFilterStats
): DialogueBlock[] {
  const kept: DialogueBlock[] = []
  const indentOf = (b: DialogueBlock): number => b.raw.length - b.raw.replace(/^\s+/, '').length
  let i = 0
  while (i < blocks.length) {
    const b = blocks[i]
    if (!inScheme(b.versions, tags)) {
      stats.removedBlocks += countBlocks([b])
      if (b.type === 'label') {
        stats.removedLabels += 1
        // 移除该 label 的整个场景内容（缩进更深且在下一个同级行之前）
        const baseIndent = indentOf(b)
        i++
        while (i < blocks.length && indentOf(blocks[i]) > baseIndent) {
          stats.removedBlocks += countBlocks([blocks[i]])
          i++
        }
      } else {
        i++
      }
      continue
    }
    stats.keptBlocks += 1
    kept.push(filterChildren(b, tags, stats))
    i++
  }
  return kept
}

// 过滤块的嵌套内容（menu 选项 / if 分支 / 通用 children）
function filterChildren(b: DialogueBlock, tags: Set<string>, stats: VersionFilterStats): DialogueBlock {
  if (b.type === 'menu' && b.options) {
    const options: MenuOptionBlock[] = []
    for (const opt of b.options) {
      // 选项本身无标签时跟随 menu 块（menu 块已通过过滤，选项保留）
      if (!inScheme(opt.versions, tags)) {
        stats.removedBlocks += 1
        continue
      }
      stats.keptBlocks += 1
      const children = opt.children && opt.children.length > 0 ? filterRecursive(opt.children, tags, stats) : opt.children
      options.push({ ...opt, children })
    }
    // 选项全部被过滤时至少保留 1 个（原第一个），避免 menu 空选项语法错误
    const finalOptions = options.length > 0 ? options : b.options.slice(0, 1)
    return { ...b, options: finalOptions }
  }
  if (b.type === 'if' && b.branches) {
    return {
      ...b,
      branches: b.branches.map((br) => ({ ...br, children: filterRecursive(br.children, tags, stats) })),
    }
  }
  if (b.children) {
    return { ...b, children: filterRecursive(b.children, tags, stats) }
  }
  return b
}

// 修复跳转断链：目标 label 被移除时，重定向到最近的存活 label
function fixBrokenTargets(blocks: DialogueBlock[], originalLabels: LabelRef[], stats: VersionFilterStats): DialogueBlock[] {
  const survivors = collectLabels(blocks)
  const survivorNames = new Set(survivors.map((s) => s.name))
  const originalLineBy = new Map(originalLabels.map((l) => [l.name, l.line]))

  const nearestSurvivor = (removedName: string): string | null => {
    const removedLine = originalLineBy.get(removedName)
    // 本文件从未定义过的目标（外部 label），不动
    if (removedLine === undefined) return null
    let best: string | null = null
    let bestDist = Infinity
    let bestLine = Infinity
    for (const s of survivors) {
      const d = Math.abs(s.line - removedLine)
      if (d < bestDist || (d === bestDist && s.line < bestLine)) {
        best = s.name
        bestDist = d
        bestLine = s.line
      }
    }
    return best
  }

  const fixName = (name: string | undefined): string | undefined => {
    if (!name) return name
    if (survivorNames.has(name) || !originalLineBy.has(name)) return name
    const next = nearestSurvivor(name)
    if (next && next !== name) {
      stats.redirectedJumps += 1
      return next
    }
    return name
  }

  const fixBlock = (b: DialogueBlock): DialogueBlock => {
    if ((b.type === 'jump' || b.type === 'call') && b.target) {
      const t = fixName(b.target)
      if (t !== b.target) return { ...b, target: t }
      return b
    }
    if (b.type === 'menu' && b.options) {
      const options = b.options.map((opt) => {
        const target = fixName(opt.target ?? undefined)
        const children = opt.children ? fixList(opt.children) : opt.children
        if (target !== opt.target) return { ...opt, target: target ?? null, children }
        if (children !== opt.children) return { ...opt, children }
        return opt
      })
      return { ...b, options }
    }
    if (b.type === 'if' && b.branches) {
      return { ...b, branches: b.branches.map((br) => ({ ...br, children: fixList(br.children) })) }
    }
    if (b.children) {
      return { ...b, children: fixList(b.children) }
    }
    return b
  }

  const fixList = (list: DialogueBlock[]): DialogueBlock[] => list.map(fixBlock)
  return fixList(blocks)
}

/** 按版本方案过滤剧情块序列：
 *  @param tags 方案包含的版本标签集合（空集合 = 只保留无标签块，一般不会这样用）
 *  @returns 过滤 + 断链修复后的块与统计 */
export function filterBlocksByVersions(blocks: DialogueBlock[], tags: string[]): VersionFilterResult {
  const tagSet = new Set(tags)
  const stats: VersionFilterStats = { keptBlocks: 0, removedBlocks: 0, removedLabels: 0, redirectedJumps: 0 }
  const originalLabels = collectLabels(blocks)
  const filtered = filterRecursive(blocks, tagSet, stats)
  const fixed = fixBrokenTargets(filtered, originalLabels, stats)
  return { blocks: fixed, stats }
}
