import type { DialogueBlock, IfBranch } from './dialogueParser'

// 将解析后的 blocks 序列化回 Ren'Py 源码
// 保留原始缩进，仅更新被修改的内容
export function serializeBlocks(blocks: DialogueBlock[]): string {
  const lines: string[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'label': {
        // label 声明：顶格（无缩进）
        lines.push(`label ${block.labelName}:${loomSuffix(block)}`)
        break
      }

      case 'dialogue': {
        // 从 raw 中提取原始缩进
        const indent = extractIndent(block.raw)
        const spritePart = block.sprite ? ` ${block.sprite}` : ''
        if (block.voicePath) {
          lines.push(`${indent}voice ${quoteWrap(block.voicePath)}`)
        }
        lines.push(`${indent}${block.charVar}${spritePart} ${quoteWrap(block.text ?? '')}${block.id ? ` ${block.id}` : ''}${loomSuffix(block)}`)
        break
      }

      case 'voice': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}voice ${quoteWrap(block.voicePath ?? '')}${loomSuffix(block)}`)
        break
      }

      case 'narration': {
        // 从 raw 中提取原始缩进
        const indent = extractIndent(block.raw)
        lines.push(`${indent}${quoteWrap(block.text ?? '')}${block.id ? ` ${block.id}` : ''}${loomSuffix(block)}`)
        break
      }

      case 'menu': {
        // 从 raw 中提取原始缩进
        const indent = extractIndent(block.raw)
        lines.push(`${indent}menu:${loomSuffix(block)}`)
        if (block.options) {
          const optIndent = indent + '    '
          for (const opt of block.options) {
            let line = `${optIndent}${quoteWrap(opt.text)}:`
            if (opt.target) {
              line += ` jump ${opt.target}`
            }
            line += loomSuffix({ versions: opt.versions })
            lines.push(line)
            // 序列化选项的 children
            if (opt.children && opt.children.length > 0) {
              const childLines = serializeBlocksWithIndent(opt.children, optIndent + '    ')
              lines.push(...childLines)
            }
          }
        }
        break
      }

      case 'menu_option': {
        // menu_option 由 menu 块统一处理，跳过
        break
      }

      case 'jump': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}jump ${block.target}${loomSuffix(block)}`)
        break
      }

      case 'call': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}call ${block.target}${loomSuffix(block)}`)
        break
      }

      case 'return': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}return${loomSuffix(block)}`)
        break
      }

      case 'save': {
        const indent = extractIndent(block.raw)
        const slot = quoteWrap(block.saveSlot ?? '')
        const desc = block.saveDescription ? `, ${quoteWrap(block.saveDescription)}` : ''
        lines.push(`${indent}$ renpy.save(${slot}${desc})${loomSuffix(block)}`)
        break
      }

      case 'movie_cutscene': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}$ renpy.movie_cutscene(${quoteWrap(block.videoPath ?? '')})${loomSuffix(block)}`)
        break
      }

      case 'open_url': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}$ renpy.open_url(${quoteWrap(block.urlPath ?? '')})${loomSuffix(block)}`)
        break
      }

      case 'scene': {
        const indent = extractIndent(block.raw)
        const withPart = block.transition ? ` with ${block.transition}` : ''
        lines.push(`${indent}scene ${block.background}${withPart}${loomSuffix(block)}`)
        break
      }

      case 'effect': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}with ${block.transition}${loomSuffix(block)}`)
        break
      }

      case 'show': {
        const indent = extractIndent(block.raw)
        const target =
          (block.showKind === 'cg' || block.showKind === 'other') && block.showImage
            ? block.showImage
            : [block.showCharVar, block.showSprite].filter(Boolean).join(' ')
        if (target.trim()) {
          // other 不写类型标记（按 images/ 图片自动命名确定性分类），版本标签正常写出
          const mark = loomSuffix(block)
          const withPart = block.transition ? ` with ${block.transition}` : ''
          lines.push(`${indent}show ${target}${withPart}${mark}`)
        } else {
          lines.push(block.raw)
        }
        break
      }

      case 'hide': {
        const indent = extractIndent(block.raw)
        const target =
          (block.showKind === 'cg' || block.showKind === 'other') && block.showImage
            ? block.showImage
            : [block.showCharVar, block.showSprite].filter(Boolean).join(' ')
        if (target.trim()) {
          // other 不写类型标记（按 images/ 图片自动命名确定性分类），版本标签正常写出
          const mark = loomSuffix(block)
          const withPart = block.transition ? ` with ${block.transition}` : ''
          lines.push(`${indent}hide ${target}${withPart}${mark}`)
        } else {
          lines.push(block.raw)
        }
        break
      }

      case 'default': {
        lines.push(`default ${block.varName} = ${block.varValue}${loomSuffix(block)}`)
        break
      }

      case 'modify_var': {
        const indent = extractIndent(block.raw)
        const op = block.modifyOp === 'add' ? '+=' : block.modifyOp === 'subtract' ? '-=' : '='
        lines.push(`${indent}$ ${block.varName} ${op} ${block.modifyValue}${loomSuffix(block)}`)
        break
      }

      case 'if': {
        const indent = extractIndent(block.raw)
        if (block.branches) {
          for (const branch of block.branches) {
            if (branch.type === 'if') {
              lines.push(`${indent}if ${branch.condition ?? ''}:${loomSuffix(block)}`)
            } else if (branch.type === 'elif') {
              lines.push(`${indent}elif ${branch.condition ?? ''}:`)
            } else {
              lines.push(`${indent}else:`)
            }
            if (branch.children && branch.children.length > 0) {
              const childLines = serializeBlocksWithIndent(branch.children, indent + '    ')
              lines.push(...childLines)
            }
          }
        }
        break
      }

      case 'comment': {
        // 使用原始行（保留缩进）
        lines.push(block.raw)
        break
      }

      case 'blank': {
        lines.push('')
        break
      }

      case 'command': {
        // 使用原始行（包含缩进）
        lines.push(block.raw)
        break
      }

      default:
        break
    }
  }

  return lines.join('\n')
}

// 从原始行中提取缩进，如果 raw 为空则返回默认缩进（4空格）
function extractIndent(raw: string): string {
  const match = raw.match(/^(\s*)/)
  // 如果 raw 为空或没有缩进，返回默认 4 空格（label 内的标准缩进）
  return match && match[1] ? match[1] : '    '
}

// 生成行内 `# loom:` 注释后缀（类型标记 + 版本标签合并为一条注释）：
//   show/hide 且有显式类型 → `# loom:sprite versions: r18,watch`
//   仅版本标签 → `# loom: versions: r18,watch`
//   都没有 → 空字符串
function loomSuffix(block: { showKind?: 'sprite' | 'cg' | 'other'; showExplicit?: boolean; versions?: string[] }): string {
  const parts: string[] = []
  if (block.showExplicit && block.showKind && block.showKind !== 'other') {
    parts.push(block.showKind)
  }
  if (block.versions && block.versions.length > 0) {
    parts.push(`versions: ${block.versions.join(',')}`)
  }
  if (parts.length === 0) return ''
  const joined = parts.join(' ')
  // 类型标记紧跟 loom:（# loom:sprite）；仅版本标签时在 loom: 后加空格保持可读
  const sep = parts[0] === block.showKind ? '' : ' '
  return `  # loom:${sep}${joined}`
}

// 以指定缩进序列化 blocks（用于子内容）
function serializeBlocksWithIndent(blocks: DialogueBlock[], baseIndent: string): string[] {
  const lines: string[] = []
  for (const block of blocks) {
    const indent = extractIndent(block.raw)
    // 新建块（raw 为空或没有前导空格，如 show/hide 模板 "show char normal"）使用容器基准缩进；
    // 已从源码解析的块保留其原始缩进
    const leadingWs = /^\s*/.exec(block.raw)?.[0] ?? ''
    const actualIndent = leadingWs ? indent : baseIndent
    switch (block.type) {
      case 'dialogue': {
        const spritePart = block.sprite ? ` ${block.sprite}` : ''
        if (block.voicePath) {
          lines.push(`${actualIndent}voice ${quoteWrap(block.voicePath)}`)
        }
        lines.push(`${actualIndent}${block.charVar}${spritePart} ${quoteWrap(block.text ?? '')}${block.id ? ` ${block.id}` : ''}${loomSuffix(block)}`)
        break
      }
      case 'voice': {
        lines.push(`${actualIndent}voice ${quoteWrap(block.voicePath ?? '')}${loomSuffix(block)}`)
        break
      }
      case 'narration': {
        lines.push(`${actualIndent}${quoteWrap(block.text ?? '')}${block.id ? ` ${block.id}` : ''}${loomSuffix(block)}`)
        break
      }
      case 'jump': {
        lines.push(`${actualIndent}jump ${block.target}${loomSuffix(block)}`)
        break
      }
      case 'call': {
        lines.push(`${actualIndent}call ${block.target}${loomSuffix(block)}`)
        break
      }
      case 'save': {
        const slot = quoteWrap(block.saveSlot ?? '')
        const desc = block.saveDescription ? `, ${quoteWrap(block.saveDescription)}` : ''
        lines.push(`${actualIndent}$ renpy.save(${slot}${desc})${loomSuffix(block)}`)
        break
      }
      case 'movie_cutscene': {
        lines.push(`${actualIndent}$ renpy.movie_cutscene(${quoteWrap(block.videoPath ?? '')})${loomSuffix(block)}`)
        break
      }
      case 'open_url': {
        lines.push(`${actualIndent}$ renpy.open_url(${quoteWrap(block.urlPath ?? '')})${loomSuffix(block)}`)
        break
      }
      case 'scene': {
        const withPart = block.transition ? ` with ${block.transition}` : ''
        lines.push(`${actualIndent}scene ${block.background}${withPart}${loomSuffix(block)}`)
        break
      }
      case 'effect': {
        lines.push(`${actualIndent}with ${block.transition}${loomSuffix(block)}`)
        break
      }
      case 'show': {
        const target =
          (block.showKind === 'cg' || block.showKind === 'other') && block.showImage
            ? block.showImage
            : [block.showCharVar, block.showSprite].filter(Boolean).join(' ')
        if (target.trim()) {
          // other 不写类型标记（按 images/ 图片自动命名确定性分类），版本标签正常写出
          const mark = loomSuffix(block)
          const withPart = block.transition ? ` with ${block.transition}` : ''
          lines.push(`${actualIndent}show ${target}${withPart}${mark}`)
        } else {
          lines.push(block.raw)
        }
        break
      }
      case 'hide': {
        const target =
          (block.showKind === 'cg' || block.showKind === 'other') && block.showImage
            ? block.showImage
            : [block.showCharVar, block.showSprite].filter(Boolean).join(' ')
        if (target.trim()) {
          // other 不写类型标记（按 images/ 图片自动命名确定性分类），版本标签正常写出
          const mark = loomSuffix(block)
          const withPart = block.transition ? ` with ${block.transition}` : ''
          lines.push(`${actualIndent}hide ${target}${withPart}${mark}`)
        } else {
          lines.push(block.raw)
        }
        break
      }
      case 'default': {
        lines.push(`${actualIndent}default ${block.varName} = ${block.varValue}${loomSuffix(block)}`)
        break
      }
      case 'modify_var': {
        const op = block.modifyOp === 'add' ? '+=' : block.modifyOp === 'subtract' ? '-=' : '='
        lines.push(`${actualIndent}$ ${block.varName} ${op} ${block.modifyValue}${loomSuffix(block)}`)
        break
      }
      case 'if': {
        if (block.branches) {
          for (const branch of block.branches) {
            if (branch.type === 'if') {
              lines.push(`${actualIndent}if ${branch.condition ?? ''}:${loomSuffix(block)}`)
            } else if (branch.type === 'elif') {
              lines.push(`${actualIndent}elif ${branch.condition ?? ''}:`)
            } else {
              lines.push(`${actualIndent}else:`)
            }
            if (branch.children && branch.children.length > 0) {
              const childLines = serializeBlocksWithIndent(branch.children, actualIndent + '    ')
              lines.push(...childLines)
            }
          }
        }
        break
      }
      case 'menu': {
        lines.push(`${actualIndent}menu:${loomSuffix(block)}`)
        if (block.options) {
          const optIndent = actualIndent + '    '
          for (const opt of block.options) {
            let line = `${optIndent}${quoteWrap(opt.text)}:`
            if (opt.target) {
              line += ` jump ${opt.target}`
            }
            line += loomSuffix({ versions: opt.versions })
            lines.push(line)
            if (opt.children && opt.children.length > 0) {
              const childLines = serializeBlocksWithIndent(opt.children, optIndent + '    ')
              lines.push(...childLines)
            }
          }
        }
        break
      }
      case 'comment': {
        lines.push(baseIndent + block.raw.trim())
        break
      }
      case 'blank': {
        lines.push('')
        break
      }
      case 'command': {
        lines.push(baseIndent + block.raw.trim())
        break
      }
      default: {
        lines.push(baseIndent + block.raw.trim())
        break
      }
    }
  }
  return lines
}

function escapeString(s: string): string {
  // 在 Ren'Py 中，字符串可以用 " 或 ' 包裹
  // 如果文本包含双引号，使用单引号包裹；否则使用双引号
  // 这里只需要在字符串内部转义同类型的引号
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

// 根据文本内容选择引号类型
function quoteWrap(s: string): string {
  if (s.includes('"') && !s.includes("'")) {
    return `'${s}'`
  }
  return `"${s.replace(/"/g, '\\"')}"`
}

// 从 blocks 中移除指定索引的 block
export function removeBlock(blocks: DialogueBlock[], index: number): DialogueBlock[] {
  return blocks.filter((_, i) => i !== index)
}

// 在指定索引后插入新 block
export function insertBlockAfter(
  blocks: DialogueBlock[],
  afterIndex: number,
  newBlock: DialogueBlock
): DialogueBlock[] {
  const result = [...blocks]
  result.splice(afterIndex + 1, 0, newBlock)
  return result
}

// 更新指定索引的 block
export function updateBlock(
  blocks: DialogueBlock[],
  index: number,
  patch: Partial<DialogueBlock>
): DialogueBlock[] {
  const target = blocks[index]
  if (!target) return blocks

  // menu block 的 options 直接存储在 menu 块内部，无需重建单独的 menu_option blocks
  return blocks.map((b, i) => (i === index ? { ...b, ...patch } : b))
}

// 创建新 block 的工厂函数（defaults 用于命令面板预设不同特效）
export function createBlock(
  type: DialogueBlock['type'],
  line: number,
  defaults?: Partial<DialogueBlock>
): DialogueBlock {
  const base: DialogueBlock = { type, line, raw: '' }
  return { ...createDefaultBlock(type, line, base), ...defaults }
}

function createDefaultBlock(type: DialogueBlock['type'], line: number, base: DialogueBlock): DialogueBlock {
  switch (type) {
    case 'label':
      return { ...base, labelName: 'new_label' }
    case 'dialogue':
      return { ...base, charVar: 'e', text: '' }
    case 'narration':
      return { ...base, text: '' }
    case 'jump':
      return { ...base, target: 'label_name' }
    case 'call':
      return { ...base, target: 'label_name' }
    case 'scene':
      return { ...base, background: 'background' }
    case 'show':
      return { ...base, showKind: 'sprite', showCharVar: 'char', showSprite: 'normal', raw: 'show char normal' }
    case 'hide':
      return { ...base, showKind: 'sprite', showCharVar: 'char', showSprite: 'normal', raw: 'hide char normal' }
    case 'effect':
      // 无默认特效：创建后由编辑弹窗挑选具体转场/震动
      return { ...base }
    case 'default':
      return { ...base, varName: 'variable', varValue: '0' }
    case 'modify_var':
      return { ...base, varName: 'variable', modifyOp: 'assign', modifyValue: '0' }
    case 'save':
      return { ...base, saveSlot: 'slot' }
    case 'movie_cutscene':
      return { ...base, videoPath: 'video.webm' }
    case 'open_url':
      return { ...base, urlPath: 'https://example.com' }
    case 'menu':
      return {
        ...base,
        options: [
          { text: '选项1', target: null, line, children: [] },
          { text: '选项2', target: null, line, children: [] },
        ],
      }
    case 'if':
      return {
        ...base,
        branches: [
          { type: 'if' as const, condition: 'variable == "value"', children: [] },
        ],
      }
    case 'comment':
      return { ...base, raw: '# 注释' }
    case 'blank':
      return { ...base }
    default:
      return base
  }
}

// 递归更新嵌套 block
// path 格式：[blockIdx, ...] 对于顶层；
// 对于 if block 内的分支：[blockIdx, branchIdx, childIdx, ...]
// 对于 menu block 内的选项：[blockIdx, optIdx, childIdx, ...]
export function updateBlockDeep(
  blocks: DialogueBlock[],
  path: number[],
  patch: Partial<DialogueBlock>
): DialogueBlock[] {
  if (path.length === 0) return blocks
  if (path.length === 1) {
    // 直接更新顶层 block
    return updateBlock(blocks, path[0], patch)
  }

  const [blockIdx, secondIdx, ...restPath] = path
  const block = blocks[blockIdx]
  if (!block) return blocks

  // if block: secondIdx 是 branchIdx
  if (block.type === 'if' && block.branches) {
    const branchIdx = secondIdx
    const branch = block.branches[branchIdx]
    if (!branch) return blocks

    if (restPath.length === 0) {
      // path = [blockIdx, branchIdx]，不应直接更新 branch（branch 不是 DialogueBlock）
      return blocks
    }

    // restPath 指向 branch.children 中的子 block
    const newChildren = updateBlockDeep(branch.children, restPath, patch)
    const newBranches = [...block.branches]
    newBranches[branchIdx] = { ...branch, children: newChildren }
    return blocks.map((b, i) => (i === blockIdx ? { ...b, branches: newBranches } : b))
  }

  // menu block: secondIdx 是 optIdx
  if (block.type === 'menu' && block.options) {
    const optIdx = secondIdx
    const opt = block.options[optIdx]
    if (!opt) return blocks

    if (restPath.length === 0) {
      // 直接更新 menu option 的属性（text, target）
      const newOptions = [...block.options]
      newOptions[optIdx] = { ...opt, ...patch }
      return blocks.map((b, i) => (i === blockIdx ? { ...b, options: newOptions } : b))
    }

    const newChildren = updateBlockDeep(opt.children ?? [], restPath, patch)
    const newOptions = [...block.options]
    newOptions[optIdx] = { ...opt, children: newChildren }
    return blocks.map((b, i) => (i === blockIdx ? { ...b, options: newOptions } : b))
  }

  // 普通有 children 的 block
  if (block.children) {
    const newChildren = updateBlockDeep(block.children, [secondIdx, ...restPath], patch)
    return blocks.map((b, i) => (i === blockIdx ? { ...b, children: newChildren } : b))
  }

  return blocks
}

// 在嵌套 block 中添加子 block
// path 指向"容器"，afterChildIndex 是在容器 children 中的插入位置
// 对于顶层：path = []，afterChildIndex 是顶层索引
// 对于 if branch 内：path = [blockIdx, branchIdx]，afterChildIndex 是 branch.children 索引
// 对于 menu option 内：path = [blockIdx, optIdx]，afterChildIndex 是 opt.children 索引
export function addChildBlock(
  blocks: DialogueBlock[],
  path: number[],
  afterChildIndex: number,
  newBlock: DialogueBlock
): DialogueBlock[] {
  if (path.length === 0) {
    return insertBlockAfter(blocks, afterChildIndex, newBlock)
  }

  const [blockIdx, secondIdx, ...restPath] = path
  const block = blocks[blockIdx]
  if (!block) return blocks

  // if block
  if (block.type === 'if' && block.branches) {
    const branchIdx = secondIdx
    const branch = block.branches[branchIdx]
    if (!branch) return blocks

    if (restPath.length === 0) {
      // 直接插入到 branch.children
      const newChildren = insertBlockAfter(branch.children, afterChildIndex, newBlock)
      const newBranches = [...block.branches]
      newBranches[branchIdx] = { ...branch, children: newChildren }
      return blocks.map((b, i) => (i === blockIdx ? { ...b, branches: newBranches } : b))
    }

    const newChildren = addChildBlock(branch.children, restPath, afterChildIndex, newBlock)
    const newBranches = [...block.branches]
    newBranches[branchIdx] = { ...branch, children: newChildren }
    return blocks.map((b, i) => (i === blockIdx ? { ...b, branches: newBranches } : b))
  }

  // menu block
  if (block.type === 'menu' && block.options) {
    const optIdx = secondIdx
    const opt = block.options[optIdx]
    if (!opt) return blocks

    if (restPath.length === 0) {
      const newChildren = insertBlockAfter(opt.children ?? [], afterChildIndex, newBlock)
      const newOptions = [...block.options]
      newOptions[optIdx] = { ...opt, children: newChildren }
      return blocks.map((b, i) => (i === blockIdx ? { ...b, options: newOptions } : b))
    }

    const newChildren = addChildBlock(opt.children ?? [], restPath, afterChildIndex, newBlock)
    const newOptions = [...block.options]
    newOptions[optIdx] = { ...opt, children: newChildren }
    return blocks.map((b, i) => (i === blockIdx ? { ...b, options: newOptions } : b))
  }

  // 普通有 children 的 block
  if (block.children) {
    const newChildren = addChildBlock(block.children, [secondIdx, ...restPath], afterChildIndex, newBlock)
    return blocks.map((b, i) => (i === blockIdx ? { ...b, children: newChildren } : b))
  }

  return blocks
}

// 从嵌套 block 中删除子 block
// path 指向"容器"，childIndex 是要删除的 children 索引
export function removeChildBlock(
  blocks: DialogueBlock[],
  path: number[],
  childIndex: number
): DialogueBlock[] {
  if (path.length === 0) {
    return removeBlock(blocks, childIndex)
  }

  const [blockIdx, secondIdx, ...restPath] = path
  const block = blocks[blockIdx]
  if (!block) return blocks

  // if block
  if (block.type === 'if' && block.branches) {
    const branchIdx = secondIdx
    const branch = block.branches[branchIdx]
    if (!branch) return blocks

    if (restPath.length === 0) {
      const newChildren = branch.children.filter((_, i) => i !== childIndex)
      const newBranches = [...block.branches]
      newBranches[branchIdx] = { ...branch, children: newChildren }
      return blocks.map((b, i) => (i === blockIdx ? { ...b, branches: newBranches } : b))
    }

    const newChildren = removeChildBlock(branch.children, restPath, childIndex)
    const newBranches = [...block.branches]
    newBranches[branchIdx] = { ...branch, children: newChildren }
    return blocks.map((b, i) => (i === blockIdx ? { ...b, branches: newBranches } : b))
  }

  // menu block
  if (block.type === 'menu' && block.options) {
    const optIdx = secondIdx
    const opt = block.options[optIdx]
    if (!opt) return blocks

    if (restPath.length === 0) {
      const newChildren = (opt.children ?? []).filter((_, i) => i !== childIndex)
      const newOptions = [...block.options]
      newOptions[optIdx] = { ...opt, children: newChildren }
      return blocks.map((b, i) => (i === blockIdx ? { ...b, options: newOptions } : b))
    }

    const newChildren = removeChildBlock(opt.children ?? [], restPath, childIndex)
    const newOptions = [...block.options]
    newOptions[optIdx] = { ...opt, children: newChildren }
    return blocks.map((b, i) => (i === blockIdx ? { ...b, options: newOptions } : b))
  }

  // 普通有 children 的 block
  if (block.children) {
    const newChildren = removeChildBlock(block.children, [secondIdx, ...restPath], childIndex)
    return blocks.map((b, i) => (i === blockIdx ? { ...b, children: newChildren } : b))
  }

  return blocks
}

// 在 if block 中添加 elif/else branch
export function addBranch(
  blocks: DialogueBlock[],
  blockIndex: number,
  branchType: 'elif' | 'else',
  condition?: string
): DialogueBlock[] {
  const block = blocks[blockIndex]
  if (!block || block.type !== 'if') return blocks

  const branches = [...(block.branches ?? [])]
  const newBranch: IfBranch = {
    type: branchType,
    condition: branchType === 'elif' ? (condition ?? 'variable == "value"') : undefined,
    children: [],
  }
  if (branchType === 'elif') {
    // elif 必须插到最后一个 else 之前（Ren'Py 要求 if→elif→else 顺序）
    const lastElseIdx = branches.reduce((acc, b, i) => (b.type === 'else' ? i : acc), -1)
    if (lastElseIdx >= 0) {
      branches.splice(lastElseIdx, 0, newBranch)
    } else {
      branches.push(newBranch)
    }
  } else {
    branches.push(newBranch)
  }

  return blocks.map((b, i) => (i === blockIndex ? { ...b, branches } : b))
}

// ---- 深路径版本：支持嵌套 if 块（位于 option/branch children 内）的分支操作 ----
// ifPath = if 块在顶层 blocks 中的深路径（顶层 if 时长度 1，如 [1]；嵌套时如 [2, 0, 0]）

// 沿 ifPath 递归进入容器，定位 if 块后应用 leaf 操作（leaf 接收容器 blocks + 该块索引）
function mapDeepIfContainer(
  blocks: DialogueBlock[],
  ifPath: number[],
  leaf: (containerBlocks: DialogueBlock[], idx: number) => DialogueBlock[]
): DialogueBlock[] {
  if (ifPath.length === 1) return leaf(blocks, ifPath[0])
  const [blockIdx, secondIdx, ...restPath] = ifPath
  const block = blocks[blockIdx]
  if (!block) return blocks

  // if 块作为容器：进入 branch.children
  if (block.type === 'if' && block.branches) {
    const branch = block.branches[secondIdx]
    if (!branch) return blocks
    const newChildren = mapDeepIfContainer(branch.children, restPath, leaf)
    const newBranches = [...block.branches]
    newBranches[secondIdx] = { ...branch, children: newChildren }
    return blocks.map((b, i) => (i === blockIdx ? { ...b, branches: newBranches } : b))
  }
  // menu 块作为容器：进入 option.children
  if (block.type === 'menu' && block.options) {
    const opt = block.options[secondIdx]
    if (!opt) return blocks
    const newChildren = mapDeepIfContainer(opt.children ?? [], restPath, leaf)
    const newOptions = [...block.options]
    newOptions[secondIdx] = { ...opt, children: newChildren }
    return blocks.map((b, i) => (i === blockIdx ? { ...b, options: newOptions } : b))
  }
  // 普通有 children 的块
  if (block.children) {
    const newChildren = mapDeepIfContainer(block.children, [secondIdx, ...restPath], leaf)
    return blocks.map((b, i) => (i === blockIdx ? { ...b, children: newChildren } : b))
  }
  return blocks
}

// 在嵌套 if 块中添加 elif/else 分支
export function addBranchDeep(
  blocks: DialogueBlock[],
  ifPath: number[],
  branchType: 'elif' | 'else',
  condition?: string
): DialogueBlock[] {
  return mapDeepIfContainer(blocks, ifPath, (bs, idx) => addBranch(bs, idx, branchType, condition))
}

// 更新嵌套 if 块的某个 branch 条件
export function updateBranchConditionDeep(
  blocks: DialogueBlock[],
  ifPath: number[],
  branchIndex: number,
  condition: string
): DialogueBlock[] {
  return mapDeepIfContainer(blocks, ifPath, (bs, idx) => updateBranchCondition(bs, idx, branchIndex, condition))
}

// 删除嵌套 if 块的某个 branch
export function removeBranchDeep(
  blocks: DialogueBlock[],
  ifPath: number[],
  branchIndex: number
): DialogueBlock[] {
  return mapDeepIfContainer(blocks, ifPath, (bs, idx) => removeBranch(bs, idx, branchIndex))
}

// 更新 if block 的某个 branch 的条件
export function updateBranchCondition(
  blocks: DialogueBlock[],
  blockIndex: number,
  branchIndex: number,
  condition: string
): DialogueBlock[] {
  const block = blocks[blockIndex]
  if (!block || block.type !== 'if' || !block.branches) return blocks

  const branches = [...block.branches]
  const branch = branches[branchIndex]
  if (!branch) return blocks

  branches[branchIndex] = { ...branch, condition }

  return blocks.map((b, i) => (i === blockIndex ? { ...b, branches } : b))
}

// 删除 if block 的某个 branch
export function removeBranch(
  blocks: DialogueBlock[],
  blockIndex: number,
  branchIndex: number
): DialogueBlock[] {
  const block = blocks[blockIndex]
  if (!block || block.type !== 'if' || !block.branches) return blocks

  const branches = block.branches.filter((_, i) => i !== branchIndex)

  // 如果没有 branches 了，删除整个 if block
  if (branches.length === 0) {
    return removeBlock(blocks, blockIndex)
  }

  return blocks.map((b, i) => (i === blockIndex ? { ...b, branches } : b))
}
