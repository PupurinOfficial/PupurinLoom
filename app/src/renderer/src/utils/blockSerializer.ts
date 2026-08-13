import type { DialogueBlock, IfBranch } from './dialogueParser'

// 将解析后的 blocks 序列化回 Ren'Py 源码
// 保留原始缩进，仅更新被修改的内容
export function serializeBlocks(blocks: DialogueBlock[]): string {
  const lines: string[] = []

  for (const block of blocks) {
    switch (block.type) {
      case 'label': {
        // label 声明：顶格（无缩进）
        lines.push(`label ${block.labelName}:`)
        break
      }

      case 'dialogue': {
        // 从 raw 中提取原始缩进
        const indent = extractIndent(block.raw)
        const spritePart = block.sprite ? ` ${block.sprite}` : ''
        if (block.voicePath) {
          lines.push(`${indent}voice ${quoteWrap(block.voicePath)}`)
        }
        lines.push(`${indent}${block.charVar}${spritePart} ${quoteWrap(block.text ?? '')}`)
        break
      }

      case 'voice': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}voice ${quoteWrap(block.voicePath ?? '')}`)
        break
      }

      case 'narration': {
        // 从 raw 中提取原始缩进
        const indent = extractIndent(block.raw)
        lines.push(`${indent}${quoteWrap(block.text ?? '')}`)
        break
      }

      case 'menu': {
        // 从 raw 中提取原始缩进
        const indent = extractIndent(block.raw)
        lines.push(`${indent}menu:`)
        if (block.options) {
          const optIndent = indent + '    '
          for (const opt of block.options) {
            let line = `${optIndent}${quoteWrap(opt.text)}:`
            if (opt.target) {
              line += ` jump ${opt.target}`
            }
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
        lines.push(`${indent}jump ${block.target}`)
        break
      }

      case 'call': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}call ${block.target}`)
        break
      }

      case 'return': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}return`)
        break
      }

      case 'save': {
        const indent = extractIndent(block.raw)
        const slot = quoteWrap(block.saveSlot ?? '')
        const desc = block.saveDescription ? `, ${quoteWrap(block.saveDescription)}` : ''
        lines.push(`${indent}$ renpy.save(${slot}${desc})`)
        break
      }

      case 'movie_cutscene': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}$ renpy.movie_cutscene(${quoteWrap(block.videoPath ?? '')})`)
        break
      }

      case 'open_url': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}$ renpy.open_url(${quoteWrap(block.urlPath ?? '')})`)
        break
      }

      case 'scene': {
        const indent = extractIndent(block.raw)
        lines.push(`${indent}scene ${block.background}`)
        break
      }

      case 'show': {
        const indent = extractIndent(block.raw)
        const target =
          (block.showKind === 'cg' || block.showKind === 'other') && block.showImage
            ? block.showImage
            : [block.showCharVar, block.showSprite].filter(Boolean).join(' ')
        if (target.trim()) {
          // other 不写 # loom: 标记（按 images/ 图片自动命名确定性分类）
          const mark = block.showExplicit && block.showKind && block.showKind !== 'other' ? `  # loom:${block.showKind}` : ''
          lines.push(`${indent}show ${target}${mark}`)
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
          // other 不写 # loom: 标记（按 images/ 图片自动命名确定性分类）
          const mark = block.showExplicit && block.showKind && block.showKind !== 'other' ? `  # loom:${block.showKind}` : ''
          lines.push(`${indent}hide ${target}${mark}`)
        } else {
          lines.push(block.raw)
        }
        break
      }

      case 'default': {
        lines.push(`default ${block.varName} = ${block.varValue}`)
        break
      }

      case 'modify_var': {
        const indent = extractIndent(block.raw)
        const op = block.modifyOp === 'add' ? '+=' : block.modifyOp === 'subtract' ? '-=' : '='
        lines.push(`${indent}$ ${block.varName} ${op} ${block.modifyValue}`)
        break
      }

      case 'if': {
        const indent = extractIndent(block.raw)
        if (block.branches) {
          for (const branch of block.branches) {
            if (branch.type === 'if') {
              lines.push(`${indent}if ${branch.condition ?? ''}:`)
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

// 以指定缩进序列化 blocks（用于子内容）
function serializeBlocksWithIndent(blocks: DialogueBlock[], baseIndent: string): string[] {
  const lines: string[] = []
  for (const block of blocks) {
    const indent = extractIndent(block.raw)
    // 如果 raw 为空或没有缩进，使用基础缩进
    const actualIndent = (indent === '    ' && block.raw === '') ? baseIndent : indent
    switch (block.type) {
      case 'dialogue': {
        const spritePart = block.sprite ? ` ${block.sprite}` : ''
        if (block.voicePath) {
          lines.push(`${actualIndent}voice ${quoteWrap(block.voicePath)}`)
        }
        lines.push(`${actualIndent}${block.charVar}${spritePart} ${quoteWrap(block.text ?? '')}`)
        break
      }
      case 'voice': {
        lines.push(`${actualIndent}voice ${quoteWrap(block.voicePath ?? '')}`)
        break
      }
      case 'narration': {
        lines.push(`${actualIndent}${quoteWrap(block.text ?? '')}`)
        break
      }
      case 'jump': {
        lines.push(`${actualIndent}jump ${block.target}`)
        break
      }
      case 'call': {
        lines.push(`${actualIndent}call ${block.target}`)
        break
      }
      case 'save': {
        const slot = quoteWrap(block.saveSlot ?? '')
        const desc = block.saveDescription ? `, ${quoteWrap(block.saveDescription)}` : ''
        lines.push(`${actualIndent}$ renpy.save(${slot}${desc})`)
        break
      }
      case 'movie_cutscene': {
        lines.push(`${actualIndent}$ renpy.movie_cutscene(${quoteWrap(block.videoPath ?? '')})`)
        break
      }
      case 'open_url': {
        lines.push(`${actualIndent}$ renpy.open_url(${quoteWrap(block.urlPath ?? '')})`)
        break
      }
      case 'scene': {
        lines.push(`${actualIndent}scene ${block.background}`)
        break
      }
      case 'show': {
        const target =
          (block.showKind === 'cg' || block.showKind === 'other') && block.showImage
            ? block.showImage
            : [block.showCharVar, block.showSprite].filter(Boolean).join(' ')
        if (target.trim()) {
          // other 不写 # loom: 标记（按 images/ 图片自动命名确定性分类）
          const mark = block.showExplicit && block.showKind && block.showKind !== 'other' ? `  # loom:${block.showKind}` : ''
          lines.push(`${actualIndent}show ${target}${mark}`)
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
          // other 不写 # loom: 标记（按 images/ 图片自动命名确定性分类）
          const mark = block.showExplicit && block.showKind && block.showKind !== 'other' ? `  # loom:${block.showKind}` : ''
          lines.push(`${actualIndent}hide ${target}${mark}`)
        } else {
          lines.push(block.raw)
        }
        break
      }
      case 'default': {
        lines.push(`${actualIndent}default ${block.varName} = ${block.varValue}`)
        break
      }
      case 'modify_var': {
        const op = block.modifyOp === 'add' ? '+=' : block.modifyOp === 'subtract' ? '-=' : '='
        lines.push(`${actualIndent}$ ${block.varName} ${op} ${block.modifyValue}`)
        break
      }
      case 'if': {
        if (block.branches) {
          for (const branch of block.branches) {
            if (branch.type === 'if') {
              lines.push(`${actualIndent}if ${branch.condition ?? ''}:`)
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
        lines.push(`${actualIndent}menu:`)
        if (block.options) {
          const optIndent = actualIndent + '    '
          for (const opt of block.options) {
            let line = `${optIndent}${quoteWrap(opt.text)}:`
            if (opt.target) {
              line += ` jump ${opt.target}`
            }
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

// 创建新 block 的工厂函数
export function createBlock(type: DialogueBlock['type'], line: number): DialogueBlock {
  const base: DialogueBlock = { type, line, raw: '' }

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
  branches.push(newBranch)

  return blocks.map((b, i) => (i === blockIndex ? { ...b, branches } : b))
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
