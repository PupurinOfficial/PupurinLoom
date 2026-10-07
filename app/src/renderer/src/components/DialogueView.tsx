import { useMemo, useState, useRef, useCallback, useEffect, Fragment, memo, type KeyboardEvent } from 'react'
import { useStore } from '../store/useStore'
import { useVersionSchemes } from '../store/versionSchemes'
import { usePlugins } from '../store/plugins'
import TagDropdown from './TagDropdown'
import { parseDialogue, classifyShowBlocks, computeCharSpriteStates, getTransitionLabel, type DialogueBlock, type CharSpriteState, type BlockType, type IfBranch } from '../utils/dialogueParser'
import { parseRenpyText, styleToCss, type TextStyle } from '../utils/renpyTextParser'
import { extractVarNames } from '../utils/varExtractor'
import { useProjectImage, useProjectImagePaths } from '../hooks/useProjectImage'
import { useProjectAudioDuration } from '../hooks/useProjectAudio'
import Avatar from './Avatar'
import { SpriteThumbnail } from './CharacterAvatar'
import CommandPalette from './CommandPalette'
import RichTextDialog from './RichTextDialog'
import {
  createBlock,
  insertBlockAfter,
  removeBlock,
  updateBlock,
  serializeBlocks,
  addChildBlock,
  removeChildBlock,
  updateBlockDeep,
  addBranchDeep,
  updateBranchConditionDeep,
  removeBranchDeep,
} from '../utils/blockSerializer'

interface DialogueViewProps {
  source: string
  onChange?: (newSource: string) => void
  // 从这里开始玩：lineBaseOffset 是当前 label 在文件中的绝对行号，
  // 用于把块内的相对行号换算成文件绝对行号
  lineBaseOffset?: number
  onPlayFromLine?: (absLine: number) => void
  // 定位滚动：文件绝对行号（带时间戳以便重复触发），变化时滚动到对应块
  focusLine?: { line: number; ts: number } | null
}

// 带样式渲染的文本组件
function StyledText({
  text,
  baseStyle,
  className
}: {
  text: string
  baseStyle?: TextStyle
  className?: string
}) {
  const segments = useMemo(() => parseRenpyText(text), [text])
  return (
    <span className={className}>
      {segments.map((seg, i) => {
        const merged = { ...baseStyle, ...seg.style }
        const css = styleToCss(merged)
        return (
          <span key={i} style={css}>
            {seg.text}
          </span>
        )
      })}
    </span>
  )
}

export default function DialogueView({ source, onChange, lineBaseOffset = 1, onPlayFromLine, focusLine }: DialogueViewProps) {
  // 画廊 CG 名（gallery.rpy）+ images/ 图片名：决定 show/hide 块分类为 立绘 / 画廊CG / 其他
  const cgImages = useGalleryCgNames()
  const imagesTick = useStore((s) => s.imagesTick)
  const otherImages = useOtherImages(imagesTick)
  const otherNames = useMemo(() => otherImages.map((i) => i.name), [otherImages])
  const blocks = useMemo(
    () => classifyShowBlocks(parseDialogue(source), cgImages, otherNames),
    [source, cgImages, otherNames]
  )

  // 版本标签颜色注册表（与打包发布页共享）；切换项目时加载
  const projectPath = useStore((s) => s.currentProject?.path ?? '')
  const vsLoad = useVersionSchemes((s) => s.load)
  useEffect(() => {
    if (projectPath) vsLoad(projectPath)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath])

  // 顶层块容器 ref，用于 focusLine 定位滚动
  const blockRefs = useRef<(HTMLDivElement | null)[]>([])

  // focusLine 变化时滚动到对应块（跳过不渲染的 menu_option）。
  // 注意：只依赖 focusLine，避免编辑内容（blocks 变化）触发重复滚动
  useEffect(() => {
    if (!focusLine || blocks.length === 0) return
    const targetLine = focusLine.line
    let idx = blocks.findIndex((b) => b.type !== 'menu_option' && b.line === targetLine)
    if (idx < 0) {
      let best = -1
      for (let i = 0; i < blocks.length; i++) {
        const b = blocks[i]
        if (b.type === 'menu_option') continue
        if (b.line <= targetLine) best = i
        else break
      }
      idx = best
    }
    if (idx >= 0) {
      blockRefs.current[idx]?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusLine])

  const [editingIdx, setEditingIdx] = useState<number | null>(null)
  const [paletteState, setPaletteState] = useState<{ open: boolean; afterIdx: number; rect: DOMRect | null }>({
    open: false,
    afterIdx: -1,
    rect: null,
  })

  // 嵌套编辑状态
  const [editingPath, setEditingPath] = useState<number[] | null>(null)
  const [nestedPaletteState, setNestedPaletteState] = useState<{
    open: boolean
    path: number[]
    afterChildIdx: number
    rect: DOMRect | null
  }>({
    open: false,
    path: [],
    afterChildIdx: -1,
    rect: null,
  })

  // 停止嵌套编辑
  const handleStopEditChild = useCallback(() => {
    setEditingPath(null)
  }, [])

  const charStates = useMemo(() => computeCharSpriteStates(blocks), [blocks])

  // 更新源码的回调
  const commitBlocks = useCallback(
    (newBlocks: DialogueBlock[]) => {
      const newSource = serializeBlocks(newBlocks)
      // 保留原始换行符（CRLF/LF），避免保存时整文件行尾被改写
      const eol = source.includes('\r\n') ? '\r\n' : '\n'
      onChange?.(eol === '\r\n' ? newSource.replace(/\r?\n/g, '\r\n') : newSource)
    },
    [onChange, source]
  )

  // 添加新 block（顶层）
  const handleAddBlock = useCallback(
    (type: BlockType, afterIdx: number, defaults?: Partial<DialogueBlock>) => {
      const newBlock = createBlock(type, afterIdx + 1, defaults)
      const newBlocks = insertBlockAfter(blocks, afterIdx, newBlock)
      commitBlocks(newBlocks)
      setEditingIdx(afterIdx + 1)
    },
    [blocks, commitBlocks]
  )

  // 删除 block（顶层）
  const handleDeleteBlock = useCallback(
    (idx: number) => {
      const newBlocks = removeBlock(blocks, idx)
      commitBlocks(newBlocks)
      if (editingIdx === idx) setEditingIdx(null)
      else if (editingIdx !== null && editingIdx > idx) setEditingIdx(editingIdx - 1)
    },
    [blocks, commitBlocks, editingIdx]
  )

  // 更新 block（顶层）
  const handleUpdateBlock = useCallback(
    (idx: number, patch: Partial<DialogueBlock>) => {
      const newBlocks = updateBlock(blocks, idx, patch)
      commitBlocks(newBlocks)
    },
    [blocks, commitBlocks]
  )

  // 嵌套：添加子 block
  const handleAddChild = useCallback(
    (type: BlockType, path: number[], afterChildIdx: number, defaults?: Partial<DialogueBlock>) => {
      const newBlock = createBlock(type, 0, defaults)
      const newBlocks = addChildBlock(blocks, path, afterChildIdx, newBlock)
      commitBlocks(newBlocks)
      // 设置编辑路径
      const newPath = [...path, afterChildIdx + 1]
      setEditingPath(newPath)
    },
    [blocks, commitBlocks]
  )

  // 嵌套：删除子 block
  const handleDeleteChild = useCallback(
    (path: number[], childIdx: number) => {
      const newBlocks = removeChildBlock(blocks, path, childIdx)
      commitBlocks(newBlocks)
      if (editingPath) {
        // 如果删除的是当前编辑的 block，清除编辑状态
        if (arraysEqual(editingPath, [...path, childIdx])) {
          setEditingPath(null)
        }
      }
    },
    [blocks, commitBlocks, editingPath]
  )

  // 嵌套：更新子 block
  const handleUpdateChild = useCallback(
    (path: number[], patch: Partial<DialogueBlock>) => {
      const newBlocks = updateBlockDeep(blocks, path, patch)
      commitBlocks(newBlocks)
    },
    [blocks, commitBlocks]
  )

  // 添加 elif/else 分支
  // 添加 elif/else 分支（深路径：ifPath = if 块所在路径，顶层 [i]，嵌套如 [2,0,0]）
  const handleAddBranch = useCallback(
    (ifPath: number[], branchType: 'elif' | 'else') => {
      const newBlocks = addBranchDeep(blocks, ifPath, branchType)
      commitBlocks(newBlocks)
    },
    [blocks, commitBlocks]
  )

  // 更新分支条件（深路径）
  const handleUpdateBranchCondition = useCallback(
    (ifPath: number[], branchIdx: number, condition: string) => {
      const newBlocks = updateBranchConditionDeep(blocks, ifPath, branchIdx, condition)
      commitBlocks(newBlocks)
    },
    [blocks, commitBlocks]
  )

  // 删除分支（深路径）
  const handleDeleteBranch = useCallback(
    (ifPath: number[], branchIdx: number) => {
      const newBlocks = removeBranchDeep(blocks, ifPath, branchIdx)
      commitBlocks(newBlocks)
    },
    [blocks, commitBlocks]
  )

  const openPalette = (afterIdx: number, rect: DOMRect | null): void => {
    setPaletteState({ open: true, afterIdx, rect })
  }

  const closePalette = (): void => {
    setPaletteState((s) => ({ ...s, open: false }))
  }

  const openNestedPalette = (path: number[], afterChildIdx: number, rect: DOMRect | null): void => {
    setNestedPaletteState({ open: true, path, afterChildIdx, rect })
  }

  const closeNestedPalette = (): void => {
    setNestedPaletteState((s) => ({ ...s, open: false }))
  }

  if (blocks.length === 0) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center text-loom-muted text-sm gap-3">
        <div>无对话内容</div>
        <button
          className="px-3 py-1.5 rounded bg-loom-accent text-loom-bg text-xs font-semibold hover:opacity-90"
          onClick={(e) => openPalette(-1, (e.target as HTMLElement).getBoundingClientRect())}
        >
          + 添加命令
        </button>
        <CommandPalette
          open={paletteState.open}
          onClose={closePalette}
          onSelect={(type, defaults) => handleAddBlock(type, paletteState.afterIdx, defaults)}
          anchorRect={paletteState.rect}
        />
      </div>
    )
  }

  return (
    <div className="w-full h-full overflow-auto">
      <div className="max-w-3xl mx-auto p-6 space-y-0.5">
        {blocks.map((block, i) => {
          // menu_option 已包含在 menu block 中，跳过独立渲染
          if (block.type === 'menu_option') return null
          return (
          <div
            key={i}
            ref={(el) => { blockRefs.current[i] = el }}
            className="group relative"
          >
            {/* 添加按钮（在每个 block 之前） */}
            <AddButton
              onClick={(rect) => openPalette(i - 1, rect)}
              isFirst={i === 0}
            />

            {/* block 主体 */}
            <MemoBlockView
              block={block}
              index={i}
              isEditing={editingIdx === i}
              onEdit={() => setEditingIdx(i)}
              onDelete={() => handleDeleteBlock(i)}
              onUpdate={(patch) => handleUpdateBlock(i, patch)}
              onStopEdit={() => setEditingIdx(null)}
              blocks={blocks}
              charStates={charStates}
              lineBaseOffset={lineBaseOffset}
              onPlayFromLine={onPlayFromLine}
              // 嵌套操作
              onAddChild={(childPath, afterChildIdx, rect) => openNestedPalette(childPath, afterChildIdx, rect)}
              onDeleteChild={(childPath, childIdx) => handleDeleteChild(childPath, childIdx)}
              onUpdateChild={(childPath, patch) => handleUpdateChild(childPath, patch)}
              onEditChild={(childPath) => setEditingPath(childPath)}
              onStopEditChild={handleStopEditChild}
              editingPath={editingPath}
              onAddBranch={handleAddBranch}
              onUpdateBranchCondition={handleUpdateBranchCondition}
              onDeleteBranch={handleDeleteBranch}
            />
          </div>
          )
        })}

        {/* 末尾添加按钮 */}
        <div className="group">
          <AddButton
            onClick={(rect) => openPalette(blocks.length - 1, rect)}
            isFirst={false}
            large
          />
        </div>
      </div>

      <CommandPalette
        open={paletteState.open}
        onClose={closePalette}
        onSelect={(type) => handleAddBlock(type, paletteState.afterIdx)}
        anchorRect={paletteState.rect}
      />

      <CommandPalette
        open={nestedPaletteState.open}
        onClose={closeNestedPalette}
        onSelect={(type, defaults) => handleAddChild(type, nestedPaletteState.path, nestedPaletteState.afterChildIdx, defaults)}
        anchorRect={nestedPaletteState.rect}
      />
    </div>
  )
}

// 辅助函数：比较数组是否相等
function arraysEqual(a: number[], b: number[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false
  }
  return true
}

// React.memo 比较器：path/ifPath/editingPath 等数组按内容比较（避免每次渲染的新数组引用击穿 memo），其余属性浅比较
function memoEquals<T extends object>(prev: T, next: T): boolean {
  for (const key of Object.keys(prev) as (keyof T)[]) {
    const a = prev[key] as unknown
    const b = next[key] as unknown
    if (Array.isArray(a) && Array.isArray(b)) {
      if (!arraysEqual(a as number[], b as number[])) return false
    } else if (a !== b) return false
  }
  return true
}

// 稳定的空分支处理器（ChildBlockView 未传分支 props 时回退，避免每次渲染新建闭包）
const NOOP_BRANCH = (): void => {}

// 添加按钮
function AddButton({
  onClick,
  isFirst,
  large
}: {
  onClick: (rect: DOMRect) => void
  isFirst: boolean
  large?: boolean
}) {
  const btnRef = useRef<HTMLButtonElement>(null)

  return (
    <div
      className={[
        'flex items-center justify-center relative z-10',
        isFirst ? 'h-2' : 'h-1',
      ].join(' ')}
    >
      <button
        ref={btnRef}
        onClick={() => btnRef.current && onClick(btnRef.current.getBoundingClientRect())}
        className={[
          'opacity-0 group-hover:opacity-100 bg-loom-accent/80 hover:bg-loom-accent text-loom-bg rounded transition-opacity',
          large ? 'w-6 h-6' : 'w-4 h-4',
          'flex items-center justify-center',
          'pointer-events-auto', // 始终可点击
        ].join(' ')}
        title="添加命令"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="12" height="12">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <div className="absolute inset-0 group-hover:bg-loom-accent/5 pointer-events-none" />
    </div>
  )
}

interface BlockViewProps {
  block: DialogueBlock
  index: number
  isEditing: boolean
  onEdit: () => void
  onDelete: () => void
  onUpdate: (patch: Partial<DialogueBlock>) => void
  onStopEdit: () => void
  blocks: DialogueBlock[]
  charStates: Map<string, CharSpriteState>
  lineBaseOffset?: number
  onPlayFromLine?: (absLine: number) => void
  // 嵌套操作
  onAddChild: (path: number[], afterChildIdx: number, rect: DOMRect) => void
  onDeleteChild: (path: number[], childIdx: number) => void
  onUpdateChild: (path: number[], patch: Partial<DialogueBlock>) => void
  onEditChild: (path: number[]) => void
  onStopEditChild: () => void
  editingPath: number[] | null
  onAddBranch: (ifPath: number[], branchType: 'elif' | 'else') => void
  onUpdateBranchCondition: (ifPath: number[], branchIdx: number, condition: string) => void
  onDeleteBranch: (ifPath: number[], branchIdx: number) => void
}

function BlockView(props: BlockViewProps) {
  const { block, isEditing, onEdit, onDelete, onUpdate, onStopEdit, blocks, charStates,
    onAddChild, onDeleteChild, onUpdateChild, onEditChild, onStopEditChild, editingPath,
    onAddBranch, onUpdateBranchCondition, onDeleteBranch } = props
  const tagColors = useVersionSchemes((s) => s.tagColors)

  // 编辑模式
  if (isEditing) {
    return (
      <div className="relative">
        <EditableBlock
          block={block}
          onUpdate={onUpdate}
          onDelete={onDelete}
          onStopEdit={onStopEdit}
          blocks={blocks}
          charStates={charStates}
        />
      </div>
    )
  }

  // 显示模式
  // menu 和 if 类型不在外层绑定双击，而是在各自的头部区域处理
  const isContainerType = block.type === 'menu' || block.type === 'if'

  return (
    <div
      className="relative group/block"
      onDoubleClick={isContainerType ? undefined : onEdit}
      title={isContainerType ? undefined : '双击编辑'}
    >
      <MemoBlockContent
        block={block}
        charStates={charStates}
        path={[props.index]}
        onAddChild={onAddChild}
        onDeleteChild={onDeleteChild}
        onUpdateChild={onUpdateChild}
        onEditChild={onEditChild}
        onStopEditChild={onStopEditChild}
        editingPath={editingPath}
        onAddBranch={onAddBranch}
        onUpdateBranchCondition={onUpdateBranchCondition}
        onDeleteBranch={onDeleteBranch}
        onEdit={onEdit}
      />
      {/* 版本标签（行右侧显示，颜色来自标签颜色注册表） */}
      {block.versions && block.versions.length > 0 && (
        <div className="absolute right-1 top-7 flex flex-col items-end gap-0.5 z-10 pointer-events-none">
          {block.versions.map((t) => {
            const color = tagColors[t] ?? '#8a8a8a'
            return (
              <span
                key={t}
                className="px-1 rounded text-[9px] font-mono leading-tight select-none"
                style={{ background: color + '22', border: `1px solid ${color}55`, color }}
              >
                {t}
              </span>
            )
          })}
        </div>
      )}
      {/* hover 操作按钮 */}
      <div className="absolute right-1 top-1 opacity-0 group-hover/block:opacity-100 flex gap-1">
        {props.onPlayFromLine && (
          <button
            onClick={() => props.onPlayFromLine!((props.lineBaseOffset ?? 1) + block.line - 1)}
            className="w-5 h-5 flex items-center justify-center rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-ok hover:border-loom-ok text-[10px]"
            title="从这里开始玩"
          >
            <svg viewBox="0 0 24 24" fill="currentColor" width="9" height="9">
              <polygon points="5,3 19,12 5,21" />
            </svg>
          </button>
        )}
        <button
          onClick={onEdit}
          className="w-5 h-5 flex items-center justify-center rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-accent hover:border-loom-accent text-[10px]"
          title="编辑"
        >
          ✎
        </button>
        <button
          onClick={onDelete}
          className="w-5 h-5 flex items-center justify-center rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-err hover:border-loom-err text-[10px]"
          title="删除"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// 顶层块视图：memo 化，编辑单个块/展开面板时跳过其余块的重渲染
const MemoBlockView = memo(BlockView, memoEquals)

// block 显示组件（只读）
function BlockContent({
  block,
  charStates,
  path,
  onAddChild,
  onDeleteChild,
  onUpdateChild,
  onEditChild,
  onStopEditChild,
  editingPath,
  onAddBranch,
  onUpdateBranchCondition,
  onDeleteBranch,
  onEdit,
}: {
  block: DialogueBlock
  charStates: Map<string, CharSpriteState>
  path: number[]
  onAddChild: (path: number[], afterChildIdx: number, rect: DOMRect) => void
  onDeleteChild: (path: number[], childIdx: number) => void
  onUpdateChild: (path: number[], patch: Partial<DialogueBlock>) => void
  onEditChild: (path: number[]) => void
  onStopEditChild: () => void
  editingPath: number[] | null
  onAddBranch: (ifPath: number[], branchType: 'elif' | 'else') => void
  onUpdateBranchCondition: (ifPath: number[], branchIdx: number, condition: string) => void
  onDeleteBranch: (ifPath: number[], branchIdx: number) => void
  onEdit?: () => void
}) {
  switch (block.type) {
    case 'label':
      return <LabelBlock block={block} />
    case 'dialogue':
      return <DialogueBlockView block={block} charStates={charStates} />
    case 'voice':
      return <VoiceBlock block={block} />
    case 'narration':
      return <NarrationBlock block={block} />
    case 'menu':
      return (
        <MemoMenuBlock
          block={block}
          charStates={charStates}
          path={path}
          onAddChild={onAddChild}
          onDeleteChild={onDeleteChild}
          onUpdateChild={onUpdateChild}
          onEditChild={onEditChild}
          onStopEditChild={onStopEditChild}
          editingPath={editingPath}
          onAddBranch={onAddBranch}
          onUpdateBranchCondition={onUpdateBranchCondition}
          onDeleteBranch={onDeleteBranch}
          onEdit={onEdit}
        />
      )
    case 'menu_option':
      return null
    case 'jump':
      return <JumpBlock block={block} />
    case 'call':
      return <CallBlock block={block} />
    case 'save':
      return <SaveBlock block={block} />
    case 'movie_cutscene':
      return <MovieBlock block={block} />
    case 'open_url':
      return <OpenUrlBlock block={block} />
    case 'modify_var':
      return <ModifyVarBlock block={block} />
    case 'default':
      return <DefaultBlock block={block} />
    case 'scene':
      return <SceneBlock block={block} />
    case 'show':
      return <ShowBlock block={block} />
    case 'hide':
      return <HideBlock block={block} />
    case 'if':
      return (
        <MemoIfBlock
          block={block}
          charStates={charStates}
          path={path}
          onAddChild={onAddChild}
          onDeleteChild={onDeleteChild}
          onUpdateChild={onUpdateChild}
          onEditChild={onEditChild}
          onStopEditChild={onStopEditChild}
          editingPath={editingPath}
          onAddBranch={onAddBranch}
          onUpdateBranchCondition={onUpdateBranchCondition}
          onDeleteBranch={onDeleteBranch}
          onEdit={onEdit}
        />
      )
    case 'effect':
      return (
        <div className="flex items-center gap-2 py-1 px-4">
          <svg viewBox="0 0 24 24" fill="none" stroke="#b59a52" strokeWidth="2" width="12" height="12">
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <span className="text-xs text-loom-muted">
            <span className="text-loom-accent">{getTransitionLabel(block.transition) ?? `with ${block.transition}`}</span>
          </span>
          <span className="text-[10px] text-loom-muted/50 font-mono ml-auto">L{block.line}</span>
        </div>
      )
    case 'comment':
      return (
        <div className="text-loom-muted/50 text-xs font-mono py-0.5 pl-4">
          {block.raw.trim()}
        </div>
      )
    case 'blank':
      return <div className="h-2" />
    case 'command':
      return (
        <div className="text-loom-muted/70 text-xs font-mono py-0.5 pl-4">
          {block.raw.trim()}
        </div>
      )
    default:
      return null
  }
}

// block 内容：memo 化
const MemoBlockContent = memo(BlockContent, memoEquals)

// 可编辑 block
interface EditableBlockProps {
  block: DialogueBlock
  onUpdate: (patch: Partial<DialogueBlock>) => void
  onDelete: () => void
  onStopEdit: () => void
  blocks: DialogueBlock[]
  charStates: Map<string, CharSpriteState>
}

function EditableBlock({ block, onUpdate, onDelete, onStopEdit }: EditableBlockProps) {
  const characters = useStore((s) => s.characters)
  const variables = useStore((s) => s.variables)
  // 显示/隐藏目标选择弹窗
  const [targetDialog, setTargetDialog] = useState<{ open: boolean; kind: 'sprite' | 'cg' | 'other' }>({ open: false, kind: 'sprite' })
  const [textDraft, setTextDraft] = useState(block.text ?? '')
  const textDraftRef = useRef(textDraft)
  textDraftRef.current = textDraft

  useEffect(() => {
    setTextDraft(block.text ?? '')
  }, [block.text])

  // 富文本（Markdown/BBCode → Ren'Py）转换弹窗
  const [richOpen, setRichOpen] = useState(false)
  const [richSource, setRichSource] = useState('')

  const openRichConverter = useCallback(() => {
    setRichSource(textDraftRef.current)
    setRichOpen(true)
  }, [])

  const applyRichConversion = useCallback((renpyText: string) => {
    setRichOpen(false)
    setTextDraft(renpyText)
  }, [])

  const commitText = useCallback(() => {
    if (textDraftRef.current !== (block.text ?? '')) {
      onUpdate({ text: textDraftRef.current })
    }
  }, [block.text, onUpdate])

  const commitRef = useRef(commitText)
  commitRef.current = commitText

  useEffect(() => {
    return () => commitRef.current?.()
  }, [])

  const textareaOnKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      commitText()
    }
  }

  // 根据类型渲染不同的编辑表单
  switch (block.type) {
    case 'dialogue':
      return (
        <>
          <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">角色</label>
            <select
              value={block.charVar}
              onChange={(e) => onUpdate({ charVar: e.target.value })}
              className="bg-loom-panel border border-loom-border rounded px-2 py-1 text-xs font-mono text-loom-text flex-1"
            >
              {characters.map((c) => (
                <option key={c.id} value={c.varName}>{c.varName} ({c.name})</option>
              ))}
              {!characters.find((c) => c.varName === block.charVar) && (
                <option value={block.charVar}>{block.charVar}</option>
              )}
            </select>
            <input
              type="text"
              value={block.sprite ?? ''}
              onChange={(e) => onUpdate({ sprite: e.target.value || undefined })}
              placeholder="差分 (可选)"
              className="bg-loom-panel border border-loom-border rounded px-2 py-1 text-xs font-mono text-loom-text w-28"
            />
          </div>
          <div className="flex items-start gap-2">
            <label className="text-[10px] text-loom-muted w-12 pt-1.5">对话</label>
            <textarea
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              onBlur={commitText}
              onKeyDown={textareaOnKeyDown}
              rows={2}
              className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-sm text-loom-text focus:outline-none focus:border-loom-accent resize-none"
            />
            <button
              onClick={openRichConverter}
              title="将 Markdown / BBCode 语法转换为 Ren'Py 文本标签"
              className="mt-0.5 px-1.5 py-1 text-[10px] rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-accent hover:border-loom-accent whitespace-nowrap flex-shrink-0 transition-colors"
            >
              MD/BB
            </button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12 pt-1.5">语音</label>
            <VoiceSelector
              value={block.voicePath}
              onChange={(v) => onUpdate({ voicePath: v })}
            />
          </div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
          <RichTextDialog
            open={richOpen}
            initialValue={richSource}
            onClose={() => setRichOpen(false)}
            onApply={applyRichConversion}
          />
        </>
      )

    case 'voice':
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">语音</label>
            <VoiceSelector
              value={block.voicePath}
              onChange={(v) => onUpdate({ voicePath: v })}
            />
          </div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    case 'narration':
      return (
        <>
          <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="flex items-start gap-2">
            <label className="text-[10px] text-loom-muted w-12 pt-1.5">旁白</label>
            <textarea
              value={textDraft}
              onChange={(e) => setTextDraft(e.target.value)}
              onBlur={commitText}
              onKeyDown={textareaOnKeyDown}
              rows={2}
              className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-sm text-loom-text italic focus:outline-none focus:border-loom-accent resize-none"
            />
            <button
              onClick={openRichConverter}
              title="将 Markdown / BBCode 语法转换为 Ren'Py 文本标签"
              className="mt-0.5 px-1.5 py-1 text-[10px] rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-accent hover:border-loom-accent whitespace-nowrap flex-shrink-0 transition-colors"
            >
              MD/BB
            </button>
          </div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
          <RichTextDialog
            open={richOpen}
            initialValue={richSource}
            onClose={() => setRichOpen(false)}
            onApply={applyRichConversion}
          />
        </>
      )

    case 'label':
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">场景名</label>
            <input
              type="text"
              value={block.labelName ?? ''}
              onChange={(e) => onUpdate({ labelName: e.target.value })}
              placeholder="label 名称"
              className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-sm font-mono text-loom-accent focus:outline-none focus:border-loom-accent"
            />
          </div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    case 'jump':
    case 'call':
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">目标</label>
            <input
              type="text"
              value={block.target ?? ''}
              onChange={(e) => onUpdate({ target: e.target.value })}
              placeholder="label 名称"
              className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-sm font-mono text-loom-text focus:outline-none focus:border-loom-accent"
            />
          </div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    case 'scene':
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">背景</label>
            <input
              type="text"
              value={block.background ?? ''}
              onChange={(e) => onUpdate({ background: e.target.value })}
              placeholder="背景图片名 (不含扩展名)"
              className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-sm font-mono text-loom-text focus:outline-none focus:border-loom-accent"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">特效</label>
            <EffectPicker
              value={block.transition}
              onChange={(v) => onUpdate({ transition: v })}
            />
          </div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    case 'effect':
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">特效</label>
            <EffectPicker
              value={block.transition}
              onChange={(v) => onUpdate({ transition: v })}
            />
          </div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    case 'show':
    case 'hide': {
      const targetKind: 'sprite' | 'cg' | 'other' =
        block.showKind === 'other' ? 'other' : block.showKind === 'cg' ? 'cg' : 'sprite'
      // 当前目标摘要（供按钮显示）
      const curLabel = [block.showImage, block.showCharVar, block.showSprite].filter(Boolean).join(' ')
      const kindBadge =
        targetKind === 'cg'
          ? { text: '画廊CG', cls: 'bg-loom-accent/15 text-loom-accent' }
          : targetKind === 'other'
            ? { text: '其他', cls: 'bg-loom-warn/15 text-loom-warn' }
            : { text: '立绘', cls: 'bg-loom-ok/15 text-loom-ok' }
      return (
        <>
          <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-loom-muted w-12">目标</label>
              <button
                type="button"
                onClick={() => setTargetDialog({ open: true, kind: targetKind })}
                className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded bg-loom-panel border border-loom-border hover:border-loom-accent text-left transition-colors"
              >
                <span className={`flex-shrink-0 text-[10px] px-1.5 py-0.5 rounded ${kindBadge.cls}`}>
                  {kindBadge.text}
                </span>
                <span className="flex-1 min-w-0 truncate text-xs font-mono text-loom-text">
                  {curLabel || '（未选择）'}
                </span>
                <span className="flex-shrink-0 text-[10px] text-loom-muted">选择…</span>
              </button>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-[10px] text-loom-muted w-12">特效</label>
              <EffectPicker
                value={block.transition}
                onChange={(v) => onUpdate({ transition: v })}
              />
            </div>
            <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
          </div>
          <ShowTargetDialog
            open={targetDialog.open}
            initialKind={targetKind}
            current={
              targetKind === 'cg'
                ? { kind: 'cg', name: curLabel }
                : targetKind === 'other'
                  ? { kind: 'other', name: curLabel }
                  : { kind: 'sprite', charVar: block.showCharVar ?? '', sprite: block.showSprite }
            }
            onClose={() => setTargetDialog((s) => ({ ...s, open: false }))}
            onSelect={(sel) => {
              if (sel.kind === 'cg') {
                onUpdate({
                  showKind: 'cg',
                  showImage: sel.name,
                  showCharVar: undefined,
                  showSprite: undefined,
                  showExplicit: true,
                })
              } else if (sel.kind === 'other') {
                // 其他：images/ 下的任意图片，无需 # loom: 标记（按 Ren'Py 自动图片名输出 show <name>）
                onUpdate({
                  showKind: 'other',
                  showImage: sel.name,
                  showCharVar: undefined,
                  showSprite: undefined,
                  showExplicit: false,
                })
              } else {
                onUpdate({
                  showKind: 'sprite',
                  showImage: undefined,
                  showCharVar: sel.charVar,
                  showSprite: sel.sprite || undefined,
                  showExplicit: true,
                })
              }
              setTargetDialog((s) => ({ ...s, open: false }))
            }}
          />
        </>
      )
    }

    case 'save':
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">存档</label>
            <input
              type="text"
              value={block.saveSlot ?? ''}
              onChange={(e) => onUpdate({ saveSlot: e.target.value })}
              placeholder="存档位名称"
              className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-sm font-mono text-loom-text focus:outline-none focus:border-loom-accent"
            />
          </div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    case 'movie_cutscene':
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">视频</label>
            <input
              type="text"
              value={block.videoPath ?? ''}
              onChange={(e) => onUpdate({ videoPath: e.target.value })}
              placeholder="视频文件路径"
              className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-sm font-mono text-loom-text focus:outline-none focus:border-loom-accent"
            />
          </div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    case 'open_url':
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">网址</label>
            <input
              type="text"
              value={block.urlPath ?? ''}
              onChange={(e) => onUpdate({ urlPath: e.target.value })}
              placeholder="https://example.com"
              className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-sm font-mono text-loom-text focus:outline-none focus:border-loom-accent"
            />
          </div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    case 'modify_var':
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">变量</label>
            <select
              value={block.varName ?? ''}
              onChange={(e) => onUpdate({ varName: e.target.value })}
              className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-xs font-mono text-loom-text"
            >
              <option value="">选择变量</option>
              {variables.map((v) => (
                <option key={v.id} value={v.varName}>{v.name} ({v.varName})</option>
              ))}
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">操作</label>
            <select
              value={block.modifyOp ?? 'assign'}
              onChange={(e) => onUpdate({ modifyOp: e.target.value as 'add' | 'subtract' | 'assign' })}
              className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-xs font-mono text-loom-text"
            >
              <option value="assign">赋值 (=)</option>
              <option value="add">增加 (+=)</option>
              <option value="subtract">减少 (-=)</option>
            </select>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">值</label>
            <input
              type="text"
              value={block.modifyValue ?? ''}
              onChange={(e) => onUpdate({ modifyValue: e.target.value })}
              placeholder="值"
              className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-sm font-mono text-loom-text focus:outline-none focus:border-loom-accent"
            />
          </div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    case 'menu':
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="text-xs text-loom-muted font-semibold">菜单选项</div>
          {block.options?.map((opt, i) => (
            <div key={i} className="flex items-center gap-2">
              <span className="text-[10px] text-loom-muted w-6">{i + 1}.</span>
              <input
                type="text"
                value={opt.text}
                onChange={(e) => {
                  const newOptions = [...(block.options ?? [])]
                  newOptions[i] = { ...opt, text: e.target.value }
                  onUpdate({ options: newOptions })
                }}
                placeholder="选项文本"
                className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-xs text-loom-text focus:outline-none focus:border-loom-accent"
              />
              <input
                type="text"
                value={opt.target ?? ''}
                onChange={(e) => {
                  const newOptions = [...(block.options ?? [])]
                  newOptions[i] = { ...opt, target: e.target.value || null }
                  onUpdate({ options: newOptions })
                }}
                placeholder="跳转目标"
                className="w-28 bg-loom-panel border border-loom-border rounded px-2 py-1 text-xs font-mono text-loom-text focus:outline-none focus:border-loom-accent"
              />
              <TagDropdown
                compact
                value={opt.versions ?? []}
                onChange={(v) => {
                  const newOptions = [...(block.options ?? [])]
                  newOptions[i] = { ...opt, versions: v.length > 0 ? v : undefined }
                  onUpdate({ options: newOptions })
                }}
              />
            </div>
          ))}
          <button
            onClick={() => {
              const newOptions = [...(block.options ?? []), { text: '新选项', target: null, line: block.line }]
              onUpdate({ options: newOptions })
            }}
            className="text-xs text-loom-accent hover:underline"
          >
            + 添加选项
          </button>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    case 'if':
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="text-xs text-loom-muted font-semibold">条件分支</div>
          <div className="text-xs text-loom-muted">
            双击各分支头部编辑条件，底部按钮添加 elif/else
          </div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    default:
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="text-xs text-loom-muted">此类型暂不支持图形编辑</div>
          <VersionTagsEditor
            value={block.versions ?? []}
            onChange={(v) => onUpdate({ versions: v.length > 0 ? v : undefined })}
          />
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )
  }
}

// 版本标签编辑器：所有块类型通用的属性行（回车/逗号添加标签，点击 ✕ 移除）
function VersionTagsEditor({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="flex items-center gap-2">
      <label
        className="text-[10px] text-loom-muted w-12 flex-shrink-0"
        title="版本标签：标记该剧情块属于哪些版本。未打标签的内容在所有版本中都会包含。"
      >
        版本标签
      </label>
      <div className="flex-1 min-w-0">
        <TagDropdown value={value} onChange={onChange} placeholder="选择/新建" />
      </div>
    </div>
  )
}

function EditableActions({ onDelete, onStopEdit }: { onDelete: () => void; onStopEdit: () => void }) {
  return (
    <div className="flex items-center justify-end gap-2 pt-1 border-t border-loom-border/50">
      <button
        onClick={(e) => {
          e.stopPropagation()
          onDelete()
        }}
        className="px-2 py-1 text-[11px] rounded bg-loom-err/20 text-loom-err hover:bg-loom-err/30 transition-colors"
      >
        删除
      </button>
      <button
        onClick={(e) => {
          e.stopPropagation()
          onStopEdit()
        }}
        className="px-2 py-1 text-[11px] rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 transition-opacity"
      >
        完成
      </button>
    </div>
  )
}

// 弹窗式特效选择器预设（官方内置转场 + CSS 动画预览）
interface EffectPreset {
  key: string
  label: string
  anim: string
}
const EFFECT_PRESETS: EffectPreset[] = [
  { key: 'dissolve', label: '溶解淡入', anim: 'loom-prev-fade' },
  { key: 'fade', label: '淡入淡出', anim: 'loom-prev-fadeblack' },
  { key: 'pixellate', label: '马赛克切换', anim: 'loom-prev-pixel' },
  { key: 'hpunch', label: '水平震动', anim: 'loom-prev-shake-x' },
  { key: 'vpunch', label: '垂直震动', anim: 'loom-prev-shake-y' },
  { key: 'wipeleft', label: '向左擦除', anim: 'loom-prev-wipe' },
  { key: 'wiperight', label: '向右擦除', anim: 'loom-prev-wipe-r' },
  { key: 'pushright', label: '向右推入', anim: 'loom-prev-slide-left' },
  { key: 'pushleft', label: '向左推入', anim: 'loom-prev-slide-right' },
  { key: 'irisin', label: '聚拢显现', anim: 'loom-prev-iris' },
  { key: 'irisout', label: '扩散消失', anim: 'loom-prev-iris-out' },
  { key: 'blinds', label: '百叶窗', anim: 'loom-prev-blinds' },
  { key: 'squares', label: '方块切换', anim: 'loom-prev-squares' },
  { key: 'moveinright', label: '右侧滑入', anim: 'loom-prev-slide-left' },
  { key: 'zoomin', label: '放大显现', anim: 'loom-prev-zoom' },
]

// 特效选择器：弹窗 + 动画预览，覆盖场景/立绘/全局特效三类编辑
function EffectPicker({
  value,
  onChange,
}: {
  value?: string
  onChange: (v: string | undefined) => void
}) {
  const [open, setOpen] = useState(false)
  const label = getTransitionLabel(value) ?? value
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex-1 flex items-center gap-2 px-2 py-1.5 rounded bg-loom-panel border border-loom-border hover:border-loom-accent text-left transition-colors min-w-0"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" width="12" height="12" className="flex-shrink-0 text-loom-accent">
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1" />
          <circle cx="12" cy="12" r="3" />
        </svg>
        <span className={`flex-1 truncate text-xs ${label ? 'text-loom-text' : 'text-loom-muted'}`}>
          {label ?? '无特效'}
        </span>
        <span className="flex-shrink-0 text-[10px] text-loom-muted">选择…</span>
      </button>
      <EffectPickerDialog
        open={open}
        current={value}
        onClose={() => setOpen(false)}
        onApply={(v) => {
          onChange(v)
          setOpen(false)
        }}
      />
    </>
  )
}

// 特效选择弹窗：网格卡片（动画预览 + 中文名 + 表达式），支持自定义与清除
function EffectPickerDialog({
  open,
  current,
  onClose,
  onApply,
}: {
  open: boolean
  current?: string
  onClose: () => void
  onApply: (v: string | undefined) => void
}) {
  const [custom, setCustom] = useState(false)
  const [customVal, setCustomVal] = useState(current ?? '')

  useEffect(() => {
    if (open) {
      setCustom(false)
      setCustomVal(current ?? '')
    }
  }, [open, current])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[95] flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative z-[96] w-[560px] max-h-[76vh] overflow-auto bg-loom-panel2 border border-loom-border rounded-lg shadow-2xl p-4 space-y-3">
        <style>{`
          @keyframes loom-prev-fade { 0%, 55% { opacity: 0 } 100% { opacity: 1 } }
          @keyframes loom-prev-fadeblack { 0%, 100% { opacity: .9 } 45%, 55% { opacity: 0; background: #000 } }
          @keyframes loom-prev-shake-x { 0%, 100% { transform: translateX(0) } 20%, 60% { transform: translateX(-16%) } 40%, 80% { transform: translateX(16%) } }
          @keyframes loom-prev-shake-y { 0%, 100% { transform: translateY(0) } 20%, 60% { transform: translateY(-16%) } 40%, 80% { transform: translateY(16%) } }
          @keyframes loom-prev-slide-left { 0% { transform: translateX(-100%) } 100% { transform: translateX(0) } }
          @keyframes loom-prev-slide-right { 0% { transform: translateX(100%) } 100% { transform: translateX(0) } }
          @keyframes loom-prev-zoom { 0% { transform: scale(.2); opacity: 0 } 100% { transform: scale(1); opacity: 1 } }
          @keyframes loom-prev-wipe { 0% { clip-path: inset(0 100% 0 0) } 100% { clip-path: inset(0 0 0 0) } }
          @keyframes loom-prev-wipe-r { 0% { clip-path: inset(0 0 0 100%) } 100% { clip-path: inset(0 0 0 0) } }
          @keyframes loom-prev-iris { 0% { clip-path: circle(0% at 50% 50%) } 100% { clip-path: circle(65% at 50% 50%) } }
          @keyframes loom-prev-iris-out { 0% { clip-path: circle(65% at 50% 50%) } 100% { clip-path: circle(0% at 50% 50%) } }
          @keyframes loom-prev-pixel { 0%, 100% { opacity: 0 } 50% { opacity: .95 } }
          @keyframes loom-prev-squares { 0%, 100% { opacity: 0 } 50% { opacity: .95 } }
          @keyframes loom-prev-blinds { from { background-size: 100% 0% } to { background-size: 100% 100% } }
          .loom-prev-fade { animation: loom-prev-fade 1.8s ease-in-out infinite }
          .loom-prev-fadeblack { animation: loom-prev-fadeblack 2.2s ease-in-out infinite }
          .loom-prev-shake-x { animation: loom-prev-shake-x .9s linear infinite }
          .loom-prev-shake-y { animation: loom-prev-shake-y .9s linear infinite }
          .loom-prev-slide-left { animation: loom-prev-slide-left 1.4s ease-in-out infinite }
          .loom-prev-slide-right { animation: loom-prev-slide-right 1.4s ease-in-out infinite }
          .loom-prev-zoom { animation: loom-prev-zoom 1.6s ease-in-out infinite }
          .loom-prev-wipe { animation: loom-prev-wipe 1.6s ease-in-out infinite }
          .loom-prev-wipe-r { animation: loom-prev-wipe-r 1.6s ease-in-out infinite }
          .loom-prev-iris { animation: loom-prev-iris 1.6s ease-in-out infinite }
          .loom-prev-iris-out { animation: loom-prev-iris-out 1.6s ease-in-out infinite }
          .loom-prev-pixel { animation: loom-prev-pixel 1.4s steps(2, end) infinite }
          .loom-prev-squares { animation: loom-prev-squares 1.4s steps(2, end) infinite }
          .loom-prev-blinds { background: repeating-linear-gradient(to bottom, rgba(216,172,92,.85) 0 12.5%, rgba(240,234,214,0) 12.5% 25%); animation: loom-prev-blinds 1.8s ease-in-out infinite }
        `}</style>
        <div className="flex items-center justify-between">
          <div className="text-sm font-semibold text-loom-text">选择特效</div>
          <button onClick={onClose} className="text-loom-muted hover:text-loom-text text-sm leading-none px-1">✕</button>
        </div>
        <div className="grid grid-cols-4 gap-2">
          {/* 无特效 */}
          <button
            type="button"
            onClick={() => onApply(undefined)}
            className={`rounded-lg border p-1.5 space-y-1 text-left transition-colors ${!current ? 'border-loom-accent bg-loom-accent/10' : 'border-loom-border hover:border-loom-accent/60'}`}
          >
            <div className="w-full h-14 rounded overflow-hidden bg-loom-panel flex items-center justify-center">
              <svg viewBox="0 0 24 24" fill="none" stroke="#6b6358" strokeWidth="1.5" width="20" height="20">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </div>
            <div className="text-[11px] text-loom-muted">无特效</div>
          </button>
          {EFFECT_PRESETS.map((p) => (
            <button
              type="button"
              key={p.key}
              onClick={() => onApply(p.key)}
              className={`rounded-lg border p-1.5 space-y-1 text-left transition-colors ${current === p.key ? 'border-loom-accent bg-loom-accent/10' : 'border-loom-border hover:border-loom-accent/60'}`}
            >
              <div className="w-full h-14 rounded overflow-hidden relative bg-gradient-to-br from-loom-panel to-loom-accent/25">
                <div className="absolute inset-0 flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full bg-loom-accent/40" />
                </div>
                <div className={`absolute inset-0 ${p.anim} bg-loom-accent/70`} />
              </div>
              <div className="text-[11px] text-loom-text truncate">{p.label}</div>
              <div className="text-[9px] text-loom-muted font-mono truncate">with {p.key}</div>
            </button>
          ))}
          {/* 自定义 */}
          <button
            type="button"
            onClick={() => setCustom(true)}
            className={`rounded-lg border p-1.5 space-y-1 text-left transition-colors ${custom ? 'border-loom-accent bg-loom-accent/10' : 'border-loom-border hover:border-loom-accent/60'}`}
          >
            {custom ? (
              <div className="h-14 rounded overflow-hidden bg-loom-panel flex items-center justify-center px-1">
                <input
                  autoFocus
                  type="text"
                  value={customVal}
                  onChange={(e) => setCustomVal(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && customVal.trim()) onApply(customVal.trim())
                    if (e.key === 'Escape') setCustom(false)
                  }}
                  onBlur={() => {
                    if (customVal.trim()) onApply(customVal.trim())
                    else setCustom(false)
                  }}
                  placeholder="Dissolve(1.0)"
                  className="w-full bg-loom-bg border border-loom-border rounded px-1.5 py-1 text-[10px] font-mono text-loom-text focus:outline-none focus:border-loom-accent"
                />
              </div>
            ) : (
              <div className="w-full h-14 rounded overflow-hidden bg-loom-panel flex items-center justify-center">
                <svg viewBox="0 0 24 24" fill="none" stroke="#6b6358" strokeWidth="1.8" width="20" height="20">
                  <path d="M12 20h9M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4L16.5 3.5z" />
                </svg>
              </div>
            )}
            <div className="text-[11px] text-loom-text truncate">{custom ? '自定义…' : '自定义'}</div>
            <div className="text-[9px] text-loom-muted font-mono truncate">{custom && customVal ? `with ${customVal}` : '任意表达式'}</div>
          </button>
        </div>
      </div>
    </div>
  )
}

// 语音选择器：选择 voice/ 下已有音频，或上传新音频到 voice/
function VoiceSelector({
  value,
  onChange,
}: {
  value?: string
  onChange: (v: string | undefined) => void
}) {
  const projectPath = useStore((s) => s.currentProject?.path ?? '')
  const [voices, setVoices] = useState<{ path: string; name: string }[]>([])
  const [uploading, setUploading] = useState(false)

  const refresh = useCallback(async () => {
    if (!projectPath) {
      setVoices([])
      return
    }
    try {
      const files = await window.pupurin.listFiles(projectPath, 'voice')
      setVoices(files.filter((f) => !f.isDir).map((f) => ({ path: f.path, name: f.name })))
    } catch {
      setVoices([])
    }
  }, [projectPath])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const handleUpload = async (): Promise<void> => {
    if (!projectPath) return
    const paths = await window.pupurin.pickAudioFiles()
    if (paths.length === 0) return
    setUploading(true)
    try {
      let last = ''
      for (const src of paths) {
        last = await window.pupurin.importFile(projectPath, 'voice', src)
      }
      await refresh()
      if (last) onChange(last)
    } catch (e) {
      console.error('上传语音失败:', e)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex items-center gap-1 flex-1 min-w-0">
      <select
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value || undefined)}
        className="flex-1 min-w-0 bg-loom-panel border border-loom-border rounded px-2 py-1 text-xs font-mono text-loom-text focus:outline-none focus:border-loom-accent"
        title="选择 voice/ 文件夹中的音频"
      >
        <option value="">无语音</option>
        {value && !voices.some((v) => v.path === value) && (
          <option value={value}>{value.split('/').pop()}</option>
        )}
        {voices.map((v) => (
          <option key={v.path} value={v.path}>{v.name}</option>
        ))}
      </select>
      <button
        onClick={() => void handleUpload()}
        disabled={uploading}
        className="px-2 py-1 text-[11px] rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-accent hover:border-loom-accent disabled:opacity-50 flex-shrink-0 transition-colors"
        title="上传音频到 voice/ 文件夹 (Opus / Ogg / MP3 / MP2 / FLAC / WAV)"
      >
        {uploading ? '上传中…' : '+ 上传'}
      </button>
    </div>
  )
}

// ---- 只读 block 组件 ----

function LabelBlock({ block }: { block: DialogueBlock }) {
  return (
    <div className="flex items-center gap-2 py-3 mt-2 border-b border-loom-border">
      <svg viewBox="0 0 24 24" fill="none" stroke="#FFE4A6" strokeWidth="2" width="16" height="16">
        <path d="M3 7l9-4 9 4-9 4-9-4z" />
        <path d="M3 7v10l9 4 9-4V7" />
      </svg>
      <span className="text-loom-accent font-mono font-semibold text-sm">
        label {block.labelName}
      </span>
      <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
    </div>
  )
}

function DialogueBlockView({
  block,
  charStates
}: {
  block: DialogueBlock
  charStates: Map<string, CharSpriteState>
}) {
  const characters = useStore((s) => s.characters)
  const character = characters.find((c) => c.varName === block.charVar)
  const spriteState = block.charVar ? charStates.get(block.charVar) : undefined

  return (
    <div className="flex items-start gap-3 py-2 px-2 rounded-lg hover:bg-loom-panel/50 transition-colors">
      <Avatar
        charVar={block.charVar}
        size={44}
        activeSprite={spriteState?.sprite}
        spriteVisible={spriteState?.visible}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span
            className="text-sm font-semibold"
            style={{ color: character?.color ?? '#f0ead6' }}
          >
            {character?.name ?? block.charVar}
          </span>
          {block.sprite && (
            <span className="text-[10px] px-1.5 rounded bg-loom-panel2 border border-loom-border text-loom-muted font-mono">
              {block.sprite}
            </span>
          )}
          {spriteState?.sprite && !spriteState?.visible && (
            <span className="text-[10px] px-1.5 rounded bg-loom-err/15 border border-loom-err/30 text-loom-err font-mono">
              (已隐藏)
            </span>
          )}
          {block.voicePath && (
            <VoiceBadge voicePath={block.voicePath} />
          )}
          <span className="text-[10px] text-loom-muted/50 font-mono ml-auto">
            L{block.line}
          </span>
        </div>
        <div className="text-sm text-loom-text leading-relaxed">
          <StyledText text={block.text ?? ''} />
        </div>
      </div>
    </div>
  )
}

function NarrationBlock({ block }: { block: DialogueBlock }) {
  return (
    <div className="py-2 px-4">
      <div className="flex items-center gap-2 mb-0.5">
        <span className="text-[10px] text-loom-muted/50 font-mono">
          旁白 · L{block.line}
        </span>
      </div>
      <div className="text-sm text-loom-muted italic leading-relaxed">
        <StyledText text={block.text ?? ''} baseStyle={{ italic: true }} />
      </div>
    </div>
  )
}

// 语音徽标：喇叭图案 + 时长（秒），显示在对话右侧
function VoiceBadge({ voicePath }: { voicePath: string }) {
  const projectPath = useStore((s) => s.currentProject?.path ?? '')
  const duration = useProjectAudioDuration(projectPath, voicePath)

  return (
    <span
      className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-loom-panel2 border border-loom-border text-loom-muted font-mono flex-shrink-0"
      title={voicePath}
    >
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="10" height="10">
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        <path d="M15.5 8.5a5 5 0 010 7M18.5 6a9 9 0 010 12" />
      </svg>
      {duration !== null ? `${duration.toFixed(1)}s` : '…'}
    </span>
  )
}

// 独立 voice 块（未跟在对话前的语音语句）
function VoiceBlock({ block }: { block: DialogueBlock }) {
  return (
    <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border">
      <div className="w-8 h-8 rounded-lg bg-[#9B6BB5]/20 flex items-center justify-center flex-shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="#9B6BB5" strokeWidth="2" width="16" height="16">
          <path d="M11 5 6 9H2v6h4l5 4V5z" />
          <path d="M15.5 8.5a5 5 0 010 7M18.5 6a9 9 0 010 12" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#9B6BB5]">语音</span>
          {block.voicePath && <VoiceBadge voicePath={block.voicePath} />}
          <span className="text-[10px] text-loom-muted/50 font-mono ml-auto">L{block.line}</span>
        </div>
        <div className="text-sm text-loom-text font-mono truncate">
          {block.voicePath}
        </div>
      </div>
    </div>
  )
}

function MenuBlock({
  block,
  charStates,
  path,
  onAddChild,
  onDeleteChild,
  onUpdateChild,
  onEditChild,
  onStopEditChild,
  editingPath,
  onAddBranch,
  onUpdateBranchCondition,
  onDeleteBranch,
  onEdit,
}: {
  block: DialogueBlock
  charStates: Map<string, CharSpriteState>
  path: number[]
  onAddChild: (path: number[], afterChildIdx: number, rect: DOMRect) => void
  onDeleteChild: (path: number[], childIdx: number) => void
  onUpdateChild: (path: number[], patch: Partial<DialogueBlock>) => void
  onEditChild: (path: number[]) => void
  onStopEditChild: () => void
  editingPath: number[] | null
  onAddBranch: (ifPath: number[], branchType: 'elif' | 'else') => void
  onUpdateBranchCondition: (ifPath: number[], branchIdx: number, condition: string) => void
  onDeleteBranch: (ifPath: number[], branchIdx: number) => void
  onEdit?: () => void
}) {
  return (
    <div className="py-2 px-4 my-2 rounded-lg bg-loom-panel border border-loom-border">
      <div
        className="flex items-center gap-2 mb-2 cursor-pointer"
        onDoubleClick={onEdit}
        title="双击编辑菜单"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#c084d8" strokeWidth="2" width="14" height="14">
          <path d="M4 6h16M4 12h16M4 18h16" />
        </svg>
        <span className="text-xs font-semibold text-[#c084d8]">选项</span>
        <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
      </div>
      <div className="space-y-1">
        {block.options?.map((opt, i) => (
          <MemoMenuOptionItem
            key={i}
            opt={opt}
            optIndex={i}
            path={path}
            charStates={charStates}
            onAddChild={onAddChild}
            onDeleteChild={onDeleteChild}
            onUpdateChild={onUpdateChild}
            onEditChild={onEditChild}
            onStopEditChild={onStopEditChild}
            editingPath={editingPath}
            onAddBranch={onAddBranch}
            onUpdateBranchCondition={onUpdateBranchCondition}
            onDeleteBranch={onDeleteBranch}
          />
        ))}
      </div>
    </div>
  )
}

// 选项块（menu）：memo 化
const MemoMenuBlock = memo(MenuBlock, memoEquals)

function MenuOptionItem({
  opt,
  optIndex,
  path,
  charStates,
  onAddChild,
  onDeleteChild,
  onUpdateChild,
  onEditChild,
  onStopEditChild,
  editingPath,
  onAddBranch,
  onUpdateBranchCondition,
  onDeleteBranch,
}: {
  opt: { text: string; target: string | null; line: number; children?: DialogueBlock[]; versions?: string[] }
  optIndex: number
  path: number[]
  charStates: Map<string, CharSpriteState>
  onAddChild: (path: number[], afterChildIdx: number, rect: DOMRect) => void
  onDeleteChild: (path: number[], childIdx: number) => void
  onUpdateChild: (path: number[], patch: Partial<DialogueBlock>) => void
  onEditChild: (path: number[]) => void
  onStopEditChild: () => void
  editingPath: number[] | null
  onAddBranch: (ifPath: number[], branchType: 'elif' | 'else') => void
  onUpdateBranchCondition: (ifPath: number[], branchIdx: number, condition: string) => void
  onDeleteBranch: (ifPath: number[], branchIdx: number) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [textDraft, setTextDraft] = useState(opt.text)
  const [targetDraft, setTargetDraft] = useState(opt.target ?? '')
  const tagColors = useVersionSchemes((s) => s.tagColors)
  // 本选项的完整路径 = menu 路径 + optIndex；选项 children 的增删改都用它定位
  const optPath = [...path, optIndex]

  const handleSave = () => {
    onUpdateChild(optPath, { text: textDraft, target: targetDraft || null } as any)
    setIsEditing(false)
  }

  if (isEditing) {
    return (
      <div className="rounded bg-loom-bg border border-loom-accent/50 p-2 space-y-2">
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-loom-muted w-12">文本</label>
          <input
            type="text"
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            placeholder="选项文本"
            className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-xs text-loom-text focus:outline-none focus:border-loom-accent"
          />
        </div>
        <div className="flex items-center gap-2">
          <label className="text-[10px] text-loom-muted w-12">目标</label>
          <input
            type="text"
            value={targetDraft}
            onChange={(e) => setTargetDraft(e.target.value)}
            placeholder="跳转目标 (可选)"
            className="flex-1 bg-loom-panel border border-loom-border rounded px-2 py-1 text-xs font-mono text-loom-text focus:outline-none focus:border-loom-accent"
          />
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={() => setIsEditing(false)}
            className="px-2 py-1 text-[11px] rounded bg-loom-panel2 text-loom-muted hover:text-loom-text"
          >
            取消
          </button>
          <button
            onClick={handleSave}
            className="px-2 py-1 text-[11px] rounded bg-loom-accent text-loom-bg font-semibold"
          >
            保存
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="rounded bg-loom-bg border border-loom-border group/opt">
      <div className="flex items-center gap-2 px-3 py-1.5 text-sm">
        <span className="text-loom-muted text-xs">{optIndex + 1}.</span>
        <span className="text-loom-text flex-1">
          <StyledText text={opt.text} />
        </span>
        {opt.target && (
          <span className="text-[10px] text-loom-accent font-mono">
            → {opt.target}
          </span>
        )}
        {opt.versions && opt.versions.length > 0 && (
          <span className="flex items-center gap-1">
            {opt.versions.map((t) => {
              const color = tagColors[t] ?? '#8a8a8a'
              return (
                <span
                  key={t}
                  className="px-1 rounded text-[9px] font-mono leading-tight select-none"
                  style={{ background: color + '22', border: `1px solid ${color}55`, color }}
                >
                  {t}
                </span>
              )
            })}
          </span>
        )}
        <button
          onClick={() => setIsEditing(true)}
          className="opacity-0 group-hover/opt:opacity-100 w-4 h-4 flex items-center justify-center rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-accent text-[10px]"
          title="编辑选项"
        >
          ✎
        </button>
      </div>
      {opt.children && opt.children.length > 0 ? (
        <div className="border-t border-loom-border/50 px-3 py-1.5 ml-4">
          {opt.children.map((child, ci) => (
            <Fragment key={ci}>
              {/* 子内容之前的添加按钮 */}
              <div className="group/childgap relative">
                <ChildAddButton
                  onClick={(rect) => onAddChild(optPath, ci - 1, rect)}
                />
              </div>
              <MemoChildBlockView
                block={child}
                charStates={charStates}
                path={[...optPath, ci]}
                onAddChild={onAddChild}
                onDeleteChild={onDeleteChild}
                onUpdateChild={onUpdateChild}
                onEditChild={onEditChild}
                onStopEdit={onStopEditChild}
                editingPath={editingPath}
                onAddBranch={onAddBranch}
                onUpdateBranchCondition={onUpdateBranchCondition}
                onDeleteBranch={onDeleteBranch}
              />
            </Fragment>
          ))}
          {/* 末尾添加按钮 */}
          <div className="group/childgap relative">
            <ChildAddButton
              onClick={(rect) => onAddChild(optPath, (opt.children?.length ?? 1) - 1, rect)}
            />
          </div>
        </div>
      ) : (
        <div className="border-t border-loom-border/50 px-3 py-1.5 ml-4">
          <ChildAddButton
            onClick={(rect) => onAddChild(optPath, -1, rect)}
          />
        </div>
      )}
    </div>
  )
}

// 菜单选项项：memo 化
const MemoMenuOptionItem = memo(MenuOptionItem, memoEquals)

function JumpBlock({ block }: { block: DialogueBlock }) {
  return (
    <div className="flex items-center gap-2 py-1 px-4">
      <svg viewBox="0 0 24 24" fill="none" stroke="#6b6358" strokeWidth="2" width="12" height="12">
        <path d="M5 12h14M13 5l7 7-7 7" />
      </svg>
      <span className="text-xs text-loom-muted font-mono">
        jump <span className="text-loom-accent">{block.target}</span>
      </span>
      <span className="text-[10px] text-loom-muted/50 font-mono ml-auto">L{block.line}</span>
    </div>
  )
}

function CallBlock({ block }: { block: DialogueBlock }) {
  return (
    <div className="flex items-center gap-2 py-1 px-4">
      <svg viewBox="0 0 24 24" fill="none" stroke="#b59a52" strokeWidth="2" width="12" height="12">
        <path d="M5 12h14M13 5l7 7-7 7" />
      </svg>
      <span className="text-xs text-loom-muted font-mono">
        call <span className="text-loom-accent">{block.target}</span>
      </span>
      <span className="text-[10px] text-loom-muted/50 font-mono ml-auto">L{block.line}</span>
    </div>
  )
}

function SaveBlock({ block }: { block: DialogueBlock }) {
  return (
    <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border">
      <div className="w-8 h-8 rounded-lg bg-loom-accent/20 flex items-center justify-center flex-shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="#FFE4A6" strokeWidth="2" width="16" height="16">
          <path d="M19 21H5a2 2 0 01-2-2V5a2 2 0 012-2h11l5 5v11a2 2 0 01-2 2z" />
          <path d="M17 21v-8H7v8M7 3v5h8" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-loom-accent">存档</span>
          <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
        </div>
        <div className="text-sm text-loom-text font-mono truncate">
          {block.saveSlot}
        </div>
      </div>
    </div>
  )
}

function MovieBlock({ block }: { block: DialogueBlock }) {
  return (
    <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border">
      <div className="w-8 h-8 rounded-lg bg-[#c084d8]/20 flex items-center justify-center flex-shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="#c084d8" strokeWidth="2" width="16" height="16">
          <rect x="2" y="4" width="20" height="16" rx="2" />
          <polygon points="10,8 16,12 10,16" fill="#c084d8" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#c084d8]">播放视频</span>
          <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
        </div>
        <div className="text-sm text-loom-text font-mono truncate">
          {block.videoPath}
        </div>
      </div>
    </div>
  )
}

function OpenUrlBlock({ block }: { block: DialogueBlock }) {
  return (
    <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border">
      <div className="w-8 h-8 rounded-lg bg-[#6B9BD1]/20 flex items-center justify-center flex-shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="#6B9BD1" strokeWidth="2" width="16" height="16">
          <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
          <polyline points="15 3 21 3 21 9" />
          <line x1="10" y1="14" x2="21" y2="3" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#6B9BD1]">跳转网站</span>
          <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
        </div>
        <div className="text-sm text-loom-text font-mono truncate">
          {block.urlPath}
        </div>
      </div>
    </div>
  )
}

function ModifyVarBlock({ block }: { block: DialogueBlock }) {
  const opText = block.modifyOp === 'add' ? '+=' : block.modifyOp === 'subtract' ? '-=' : '='
  return (
    <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border">
      <div className="w-8 h-8 rounded-lg bg-[#9B9B6B]/20 flex items-center justify-center flex-shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="#9B9B6B" strokeWidth="2" width="16" height="16">
          <path d="M4 7h16M4 12h16M4 17h10" />
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#9B9B6B]">修改变量</span>
          <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
        </div>
        <div className="text-sm text-loom-text font-mono truncate">
          {block.varName} {opText} {block.modifyValue}
        </div>
      </div>
    </div>
  )
}

function DefaultBlock({ block }: { block: DialogueBlock }) {
  return (
    <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border">
      <div className="w-8 h-8 rounded-lg bg-[#8B8B8B]/20 flex items-center justify-center flex-shrink-0">
        <svg viewBox="0 0 24 24" fill="none" stroke="#8B8B8B" strokeWidth="2" width="16" height="16">
          <text x="12" y="16" textAnchor="middle" fontSize="16" fontWeight="600" stroke="none" fill="#8B8B8B">x</text>
        </svg>
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#8B8B8B]">变量定义</span>
          <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
        </div>
        <div className="text-sm text-loom-text font-mono truncate">
          {block.varName} = {block.varValue}
        </div>
      </div>
    </div>
  )
}

function SceneBlock({ block }: { block: DialogueBlock }) {
  const projectPath = useStore((s) => s.currentProject?.path ?? '')
  const bg = block.background ?? ''
  const candidatePaths = useMemo(() => [
    `images/${bg}.png`,
    `images/${bg}.jpg`,
    `images/${bg}.jpeg`,
    `images/${bg}.webp`,
    `images/backgrounds/${bg}.png`,
    `images/backgrounds/${bg}.jpg`,
    `images/scenes/${bg}.png`,
  ], [bg])
  const imgUrl = useProjectImagePaths(projectPath, candidatePaths)

  return (
    <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border">
      <div className="w-12 h-12 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 bg-[#6b6358]/20">
        {imgUrl ? (
          <img src={imgUrl} alt={bg} className="w-full h-full object-cover" />
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="#6b6358" strokeWidth="2" width="20" height="20">
            <rect x="3" y="3" width="18" height="18" rx="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <path d="M21 15l-5-5L5 21" />
          </svg>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-[#6b6358]">背景</span>
          <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
          {block.transition && (
            <span className="text-[10px] font-mono text-loom-accent/90 bg-loom-accent/10 rounded px-1">{getTransitionLabel(block.transition) ?? `with ${block.transition}`}</span>
          )}
        </div>
        <div className="text-sm text-loom-text font-mono truncate">
          {bg}
        </div>
      </div>
    </div>
  )
}

// 画廊 CG 条目：名称 + 图片路径（缩略图用）
interface GalleryCgEntry {
  name: string
  path: string
}

// 画廊 CG 列表：读取项目 game/gallery.rpy 中的 image / g.unlock_image 声明
function useGalleryCgList(): GalleryCgEntry[] {
  const project = useStore((s) => s.currentProject)
  const [list, setList] = useState<GalleryCgEntry[]>([])
  // 从 gallery.rpy 提取 CG 条目（image 定义提供路径，unlock_image 提供名称）
  const extract = (src: string | null): GalleryCgEntry[] => {
    if (!src) return []
    const pathByImg = new Map<string, string>()
    const out: GalleryCgEntry[] = []
    const push = (t: string, path: string): void => {
      const v = t.trim()
      if (v && !out.some((c) => c.name === v)) out.push({ name: v, path })
    }
    let m: RegExpExecArray | null
    // image X = "path"（路径可能带引号且含空格；名称可含空格）
    const reImg = /^\s*image\s+(.+?)\s*=\s*(?:["']([^"']+)["']|(\S+))/gm
    while ((m = reImg.exec(src))) {
      const name = m[1].trim()
      const path = m[2] ?? m[3] ?? ''
      if (name) {
        pathByImg.set(name, path)
        push(name, path)
      }
    }
    const re2 = /^\s*g\.unlock_image\(\s*["']([^"']+)["']\s*\)/gm
    while ((m = re2.exec(src))) push(m[1], pathByImg.get(m[1].trim()) ?? '')
    return out
  }
  const load = (): void => {
    if (!project) {
      setList([])
      return
    }
    window.pupurin
      .readFile(project.path, 'gallery.rpy')
      .then((src) => setList(extract(src)))
      .catch(() => setList([]))
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])
  // 画廊插件保存 gallery.rpy（loom.fs.write）后实时刷新
  useEffect(() => {
    if (!project) return
    return usePlugins.getState().onHook('app:saved', (payload) => {
      const file = payload && typeof payload === 'object' ? (payload as { file?: unknown }).file : undefined
      if (file && /(^|[\\/])gallery\.rpy$/i.test(String(file))) load()
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [project])
  return list
}

// 画廊 CG 图片名列表（只取名称，供 classifyShowBlocks 分类）
// useMemo 稳定引用：避免每次渲染产生新数组，导致 blocks useMemo 反复重解析整个脚本
function useGalleryCgNames(): string[] {
  const list = useGalleryCgList()
  return useMemo(() => list.map((c) => c.name), [list])
}

// 其他图片列表：递归扫描 game/images/ 目录
// Ren'Py 自动图片命名：路径相对 images/、去扩展名、/ 变空格（如 images/bg/beach.png → bg beach）
// tick：store 里的 imagesTick，上传/删除图片后递增以触发重新扫描
function useOtherImages(tick: number): { name: string; path: string }[] {
  const project = useStore((s) => s.currentProject)
  const [list, setList] = useState<{ name: string; path: string }[]>([])
  useEffect(() => {
    if (!project) {
      setList([])
      return
    }
    let alive = true
    const IMG_EXT = /\.(png|jpe?g|webp|gif|bmp)$/i
    const out: { name: string; path: string }[] = []
    const walk = async (dir: string): Promise<void> => {
      let entries: Array<{ name: string; isDir: boolean; path: string }> = []
      try {
        entries = await window.pupurin.listFiles(project.path, dir)
      } catch {
        return
      }
      for (const e of entries) {
        if (!alive) return
        if (e.isDir) {
          await walk(e.path)
          continue
        }
        if (!IMG_EXT.test(e.name)) continue
        const rel = e.path.replace(/^images\/?/, '').replace(/\.[^.]+$/, '')
        const name = rel.replace(/\//g, ' ').trim()
        if (name) out.push({ name, path: e.path })
      }
    }
    void walk('images')
      .catch(() => {})
      .finally(() => {
        if (alive) setList(out)
      })
    return () => {
      alive = false
    }
  }, [project, tick])
  return list
}

// 显示/隐藏目标选择结果
type ShowTargetSelection =
  | { kind: 'sprite'; charVar: string; sprite?: string }
  | { kind: 'cg'; name: string }
  | { kind: 'other'; name: string }

// 显示/隐藏目标选择弹窗：立绘（角色差分）/ 画廊CG / 其他（images/ 下任意图片）三选一，网格缩略图点选
function ShowTargetDialog({
  open,
  initialKind,
  current,
  onClose,
  onSelect,
}: {
  open: boolean
  initialKind: 'sprite' | 'cg' | 'other'
  current: ShowTargetSelection
  onClose: () => void
  onSelect: (sel: ShowTargetSelection) => void
}) {
  const characters = useStore((s) => s.characters)
  const cgList = useGalleryCgList()
  const imagesTick = useStore((s) => s.imagesTick)
  const bumpImagesTick = useStore((s) => s.bumpImagesTick)
  const otherImages = useOtherImages(imagesTick)
  const projectPath = useStore((s) => s.currentProject?.path ?? '')
  const [kind, setKind] = useState<'sprite' | 'cg' | 'other'>(initialKind)
  const [uploading, setUploading] = useState(false)

  // 打开时同步到当前类型
  useEffect(() => {
    if (open) setKind(initialKind)
  }, [open, initialKind])

  // 上传图片到 images/：复制后刷新列表并直接选中最后一张
  const handleOtherUpload = async (): Promise<void> => {
    if (!projectPath || uploading) return
    setUploading(true)
    try {
      const list = await window.pupurin.importImages(projectPath)
      if (list.length > 0) {
        bumpImagesTick()
        onSelect({ kind: 'other', name: list[list.length - 1].name })
      }
    } catch (e) {
      console.error('上传图片失败:', e)
    } finally {
      setUploading(false)
    }
  }

  if (!open) return null

  // 当前选中是否命中给定条目
  const isSpriteSelected = (charVar: string, sprite?: string): boolean =>
    current.kind === 'sprite' && current.charVar === charVar && (current.sprite ?? undefined) === (sprite ?? undefined)
  const isCgSelected = (name: string): boolean => current.kind === 'cg' && current.name === name
  const isOtherSelected = (name: string): boolean => current.kind === 'other' && current.name === name

  const kindTab = (k: 'sprite' | 'cg' | 'other', label: string): JSX.Element => (
    <button
      onClick={() => setKind(k)}
      className={[
        'px-3 py-1 text-[11px] transition-colors',
        kind === k ? 'bg-loom-accent text-loom-bg font-semibold' : 'text-loom-muted hover:text-loom-text',
      ].join(' ')}
    >
      {label}
    </button>
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[620px] max-w-[92vw] max-h-[85vh] flex flex-col rounded-lg bg-loom-panel border border-loom-border shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="flex items-center px-4 py-3 border-b border-loom-border select-none">
          <span className="text-sm font-semibold text-loom-text">选择显示目标</span>
          <span className="ml-2 text-[10px] text-loom-muted font-mono">立绘 / 画廊CG / 其他</span>
          <button
            onClick={onClose}
            className="ml-auto w-6 h-6 flex items-center justify-center rounded text-loom-muted hover:text-loom-text hover:bg-loom-panel2 transition-colors"
            title="关闭"
          >
            ✕
          </button>
        </div>

        {/* 类型切换 */}
        <div className="flex items-center px-4 pt-3">
          <div className="flex rounded bg-loom-bg border border-loom-border overflow-hidden">
            {kindTab('sprite', '立绘')}
            {kindTab('cg', '画廊CG')}
            {kindTab('other', '其他')}
          </div>
        </div>

        {/* 主体：网格列表 */}
        <div className="flex-1 min-h-0 overflow-auto p-4">
          {kind === 'sprite' ? (
            <div className="space-y-3">
              {characters.length === 0 && (
                <div className="rounded border border-loom-border border-dashed p-6 text-center text-xs text-loom-muted">
                  暂无角色。请先在「角色」页创建角色与差分。
                </div>
              )}
              {characters.map((c) => (
                <div key={c.id} className="rounded-lg border border-loom-border overflow-hidden">
                  {/* 角色头 */}
                  <div className="flex items-center gap-2 px-3 py-1.5 bg-loom-panel2/60">
                    <Avatar charVar={c.varName} size={20} />
                    <span className="text-xs font-semibold text-loom-text">{c.name}</span>
                    <span className="text-[10px] text-loom-muted font-mono">{c.varName}</span>
                    <span className="ml-auto text-[10px] text-loom-muted/60">{c.sprites.length} 差分</span>
                  </div>
                  {/* 差分网格：默认（无差分）+ 各差分 */}
                  <div className="p-2 grid grid-cols-4 gap-2">
                    <TargetCard
                      selected={isSpriteSelected(c.varName)}
                      label="默认立绘"
                      onClick={() => onSelect({ kind: 'sprite', charVar: c.varName })}
                    >
                      <Avatar charVar={c.varName} size={40} />
                    </TargetCard>
                    {c.sprites.length === 0 && (
                      <div className="col-span-3 flex items-center text-[10px] text-loom-muted/60">
                        暂无差分，可在「角色」页导入图片
                      </div>
                    )}
                    {c.sprites.map((sp) => (
                      <TargetCard
                        key={sp.id}
                        selected={isSpriteSelected(c.varName, sp.name)}
                        label={sp.name}
                        onClick={() => onSelect({ kind: 'sprite', charVar: c.varName, sprite: sp.name })}
                      >
                        <SpriteThumbnail path={sp.path} size={40} rounded="rounded" />
                      </TargetCard>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : kind === 'cg' ? (
            <div className="grid grid-cols-3 gap-2">
              {cgList.length === 0 && (
                <div className="col-span-3 rounded border border-loom-border border-dashed p-6 text-center text-xs text-loom-muted">
                  暂无画廊CG。请先在「画廊」插件中添加 CG 并保存。
                </div>
              )}
              {cgList.map((cg) => (
                <TargetCard
                  key={cg.name}
                  selected={isCgSelected(cg.name)}
                  label={cg.name}
                  onClick={() => onSelect({ kind: 'cg', name: cg.name })}
                >
                  <CgThumb projectPath={projectPath} path={cg.path} />
                </TargetCard>
              ))}
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-loom-muted">
                  images/ 目录 {otherImages.length} 张图片（不含立绘/画廊CG）
                </span>
                <button
                  onClick={() => void handleOtherUpload()}
                  disabled={uploading}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-accent hover:border-loom-accent disabled:opacity-50 transition-colors flex-shrink-0"
                  title="选择本地图片复制到项目的 images/ 文件夹，复制完成后自动选用"
                >
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="11" height="11">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
                  </svg>
                  {uploading ? '上传中…' : '上传图片'}
                </button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {otherImages.length === 0 && (
                  <div className="col-span-3 rounded border border-loom-border border-dashed p-6 text-center text-xs text-loom-muted">
                    images/ 文件夹中暂无图片。可点击「上传图片」直接放入，或把图片手动放进游戏的 images/ 目录。
                  </div>
                )}
                {otherImages.map((img) => (
                  <TargetCard
                    key={img.path}
                    selected={isOtherSelected(img.name)}
                    label={img.name}
                    onClick={() => onSelect({ kind: 'other', name: img.name })}
                  >
                    <CgThumb projectPath={projectPath} path={img.path} />
                  </TargetCard>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* 底部按钮 */}
        <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-loom-border">
          <button
            onClick={onClose}
            className="px-3 py-1 text-xs rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-text transition-colors"
          >
            取消
          </button>
        </div>
      </div>
    </div>
  )
}

// 目标网格卡片：缩略图 + 名称，选中高亮
function TargetCard({
  selected,
  label,
  onClick,
  children,
}: {
  selected: boolean
  label: string
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={[
        'flex flex-col items-center gap-1 p-2 rounded border transition-colors',
        selected
          ? 'border-loom-accent bg-loom-accent/10'
          : 'border-loom-border bg-loom-bg hover:border-loom-accent/60',
      ].join(' ')}
    >
      {children}
      <span
        className={[
          'w-full text-center truncate text-[10px]',
          selected ? 'text-loom-accent font-semibold' : 'text-loom-muted',
        ].join(' ')}
        title={label}
      >
        {label}
      </span>
    </button>
  )
}

// CG 缩略图：无路径时显示占位图标
function CgThumb({ projectPath, path }: { projectPath: string; path: string }) {
  const imgUrl = useProjectImage(projectPath, path || null)
  if (imgUrl) {
    return (
      <div className="w-10 h-10 rounded overflow-hidden border border-loom-border flex-shrink-0">
        <img src={imgUrl} alt={path} className="w-full h-full object-cover" />
      </div>
    )
  }
  return (
    <div className="w-10 h-10 rounded overflow-hidden flex items-center justify-center flex-shrink-0 bg-[#6b6358]/20">
      <svg viewBox="0 0 24 24" fill="none" stroke="#6b6358" strokeWidth="2" width="18" height="18">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <circle cx="9" cy="9" r="1.5" />
        <path d="M21 15.5l-4.5-4.5L8 19" />
      </svg>
    </div>
  )
}

function ShowBlock({ block }: { block: DialogueBlock }) {
  const characters = useStore((s) => s.characters)
  const character = characters.find((c) => c.varName === block.showCharVar)
  const isCg = block.showKind === 'cg'
  // 其他：images/ 下的任意图片（如背景图等），由 classifyShowBlocks 依据 images/ 列表确定性分类
  const isOther = block.showKind === 'other'
  if (isCg) {
    const name = [block.showImage, block.showCharVar, block.showSprite].filter(Boolean).join(' ')
    return (
      <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border">
        <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 bg-[#6b6358]/20">
          <svg viewBox="0 0 24 24" fill="none" stroke="#6b6358" strokeWidth="2" width="18" height="18">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="9" r="1.5" />
            <path d="M21 15.5l-4.5-4.5L8 19" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-loom-accent">展示CG</span>
            <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
            {block.transition && (
              <span className="text-[10px] font-mono text-loom-accent/90 bg-loom-accent/10 rounded px-1">{getTransitionLabel(block.transition) ?? `with ${block.transition}`}</span>
            )}
          </div>
          <div className="text-sm text-loom-text font-mono truncate">{name}</div>
        </div>
      </div>
    )
  }
  if (isOther) {
    const name = [block.showImage, block.showCharVar, block.showSprite].filter(Boolean).join(' ')
    return (
      <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border">
        <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 bg-[#6b6358]/20">
          <svg viewBox="0 0 24 24" fill="none" stroke="#6b6358" strokeWidth="2" width="18" height="18">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="9" r="1.5" />
            <path d="M21 15.5l-4.5-4.5L8 19" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-loom-accent">展示图片</span>
            <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
            {block.transition && (
              <span className="text-[10px] font-mono text-loom-accent/90 bg-loom-accent/10 rounded px-1">{getTransitionLabel(block.transition) ?? `with ${block.transition}`}</span>
            )}
          </div>
          <div className="text-sm text-loom-text font-mono truncate">{name}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border">
      <Avatar
        charVar={block.showCharVar}
        size={32}
        activeSprite={block.showSprite}
        spriteVisible={true}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-loom-accent">展示立绘</span>
          <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
          {block.transition && (
            <span className="text-[10px] font-mono text-loom-accent/90 bg-loom-accent/10 rounded px-1">{getTransitionLabel(block.transition) ?? `with ${block.transition}`}</span>
          )}
        </div>
        <div className="text-sm text-loom-text truncate">
          <span style={{ color: character?.color ?? '#f0ead6' }}>
            {character?.name ?? block.showCharVar}
          </span>
          {block.showSprite && (
            <span className="ml-2 text-loom-muted font-mono text-xs">
              · {block.showSprite}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

function HideBlock({ block }: { block: DialogueBlock }) {
  const characters = useStore((s) => s.characters)
  const character = characters.find((c) => c.varName === block.showCharVar)
  const isCg = block.showKind === 'cg'
  // 其他：images/ 下的任意图片（如背景图等），由 classifyShowBlocks 依据 images/ 列表确定性分类
  const isOther = block.showKind === 'other'
  if (isCg) {
    const name = [block.showImage, block.showCharVar, block.showSprite].filter(Boolean).join(' ')
    return (
      <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border opacity-80">
        <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 bg-[#6b6358]/20">
          <svg viewBox="0 0 24 24" fill="none" stroke="#6b6358" strokeWidth="2" width="18" height="18">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="9" r="1.5" />
            <path d="M21 15.5l-4.5-4.5L8 19" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-loom-muted">隐藏CG</span>
            <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
            {block.transition && (
              <span className="text-[10px] font-mono text-loom-accent/90 bg-loom-accent/10 rounded px-1">{getTransitionLabel(block.transition) ?? `with ${block.transition}`}</span>
            )}
          </div>
          <div className="text-sm text-loom-muted font-mono truncate">{name}</div>
        </div>
      </div>
    )
  }
  if (isOther) {
    const name = [block.showImage, block.showCharVar, block.showSprite].filter(Boolean).join(' ')
    return (
      <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border opacity-80">
        <div className="w-8 h-8 rounded-lg overflow-hidden flex items-center justify-center flex-shrink-0 bg-[#6b6358]/20">
          <svg viewBox="0 0 24 24" fill="none" stroke="#6b6358" strokeWidth="2" width="18" height="18">
            <rect x="3" y="4" width="18" height="16" rx="2" />
            <circle cx="9" cy="9" r="1.5" />
            <path d="M21 15.5l-4.5-4.5L8 19" />
          </svg>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-loom-muted">隐藏图片</span>
            <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
            {block.transition && (
              <span className="text-[10px] font-mono text-loom-accent/90 bg-loom-accent/10 rounded px-1">{getTransitionLabel(block.transition) ?? `with ${block.transition}`}</span>
            )}
          </div>
          <div className="text-sm text-loom-muted font-mono truncate">{name}</div>
        </div>
      </div>
    )
  }
  return (
    <div className="flex items-center gap-3 py-2 px-4 my-1 rounded-lg bg-loom-panel border border-loom-border opacity-80">
      <Avatar
        charVar={block.showCharVar}
        size={32}
        activeSprite={block.showSprite}
        spriteVisible={false}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-loom-muted">隐藏立绘</span>
          <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
          {block.transition && (
            <span className="text-[10px] font-mono text-loom-accent/90 bg-loom-accent/10 rounded px-1">{getTransitionLabel(block.transition) ?? `with ${block.transition}`}</span>
          )}
        </div>
        <div className="text-sm text-loom-muted truncate">
          <span>{character?.name ?? block.showCharVar}</span>
          {block.showSprite && (
            <span className="ml-2 font-mono text-xs">· {block.showSprite}</span>
          )}
        </div>
      </div>
    </div>
  )
}

// 子 block 视图（用于嵌套显示）
function ChildBlockView({
  block,
  charStates,
  path,
  onAddChild,
  onDeleteChild,
  onUpdateChild,
  onEditChild,
  editingPath,
  onStopEdit,
  onAddBranch,
  onUpdateBranchCondition,
  onDeleteBranch,
}: {
  block: DialogueBlock
  charStates: Map<string, CharSpriteState>
  path: number[]
  onAddChild: (path: number[], afterChildIdx: number, rect: DOMRect) => void
  onDeleteChild: (path: number[], childIdx: number) => void
  onUpdateChild: (path: number[], patch: Partial<DialogueBlock>) => void
  onEditChild: (path: number[]) => void
  editingPath: number[] | null
  onStopEdit: () => void
  onAddBranch?: (ifPath: number[], branchType: 'elif' | 'else') => void
  onUpdateBranchCondition?: (ifPath: number[], branchIdx: number, condition: string) => void
  onDeleteBranch?: (ifPath: number[], branchIdx: number) => void
}) {
  const isEditing = editingPath && arraysEqual(editingPath, path)
  const containerPath = path.slice(0, -1)
  const childIdx = path[path.length - 1]

  if (isEditing) {
    return (
      <div className="relative z-20">
        <EditableBlock
          block={block}
          onUpdate={(patch) => onUpdateChild(path, patch)}
          onDelete={() => onDeleteChild(containerPath, childIdx)}
          onStopEdit={onStopEdit}
          blocks={[]}
          charStates={charStates}
        />
      </div>
    )
  }

  return (
    <div className="group/child relative">
      <div
        className="cursor-pointer"
        onDoubleClick={() => onEditChild(path)}
        title="双击编辑"
      >
        <MemoBlockContent
          block={block}
          charStates={charStates}
          path={path}
          onAddChild={onAddChild}
          onDeleteChild={onDeleteChild}
          onUpdateChild={onUpdateChild}
          onEditChild={onEditChild}
          onStopEditChild={onStopEdit}
          editingPath={editingPath}
          onAddBranch={onAddBranch ?? NOOP_BRANCH}
          onUpdateBranchCondition={onUpdateBranchCondition ?? NOOP_BRANCH}
          onDeleteBranch={onDeleteBranch ?? NOOP_BRANCH}
        />
      </div>
      {/* hover 操作按钮 */}
      <div className="absolute right-1 top-1 opacity-0 group-hover/child:opacity-100 flex gap-1">
        <button
          onClick={() => onEditChild(path)}
          className="w-4 h-4 flex items-center justify-center rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-accent text-[9px]"
          title="编辑"
        >
          ✎
        </button>
        <button
          onClick={() => onDeleteChild(containerPath, childIdx)}
          className="w-4 h-4 flex items-center justify-center rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-err text-[9px]"
          title="删除"
        >
          ✕
        </button>
      </div>
    </div>
  )
}

// 子块视图：memo 化
const MemoChildBlockView = memo(ChildBlockView, memoEquals)

// If/Elif/Else block 显示组件（合并为一个 block）
function IfBlock({
  block,
  charStates,
  path,
  onAddChild,
  onDeleteChild,
  onUpdateChild,
  onEditChild,
  onStopEditChild,
  editingPath,
  onAddBranch,
  onUpdateBranchCondition,
  onDeleteBranch,
  onEdit,
}: {
  block: DialogueBlock
  charStates: Map<string, CharSpriteState>
  path: number[]
  onAddChild: (path: number[], afterChildIdx: number, rect: DOMRect) => void
  onDeleteChild: (path: number[], childIdx: number) => void
  onUpdateChild: (path: number[], patch: Partial<DialogueBlock>) => void
  onEditChild: (path: number[]) => void
  onStopEditChild: () => void
  editingPath: number[] | null
  onAddBranch: (ifPath: number[], branchType: 'elif' | 'else') => void
  onUpdateBranchCondition: (ifPath: number[], branchIdx: number, condition: string) => void
  onDeleteBranch: (ifPath: number[], branchIdx: number) => void
  onEdit?: () => void
}) {
  const branches = block.branches ?? []

  return (
    <div className="my-2 rounded-lg bg-loom-panel border border-loom-border overflow-hidden">
      {/* 头部：双击编辑整个 if 组件 */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b border-loom-border cursor-pointer bg-loom-bg/20"
        onDoubleClick={onEdit}
        title="双击编辑条件分支"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="#6B9BD1" strokeWidth="2" width="14" height="14">
          <path d="M6 3v12M18 9l-6 6-6-6" />
        </svg>
        <span className="text-xs font-semibold text-[#6B9BD1]">条件分支</span>
        <span className="text-[10px] text-loom-muted/50 font-mono">L{block.line}</span>
      </div>
      {branches.map((branch, branchIdx) => (
        <MemoBranchView
          key={branchIdx}
          branch={branch}
          branchIdx={branchIdx}
          ifPath={path}
          charStates={charStates}
          onAddChild={onAddChild}
          onDeleteChild={onDeleteChild}
          onUpdateChild={onUpdateChild}
          onEditChild={onEditChild}
          onStopEdit={onStopEditChild}
          editingPath={editingPath}
          onAddBranch={onAddBranch}
          onUpdateBranchCondition={onUpdateBranchCondition}
          onDeleteBranch={onDeleteBranch}
          isLast={branchIdx === branches.length - 1}
        />
      ))}
      {/* 底部按钮：添加 elif/else */}
      <div className="flex items-center gap-2 px-4 py-2 border-t border-loom-border bg-loom-bg/20">
        <button
          onClick={() => onAddBranch(path, 'elif')}
          className="px-2 py-1 text-[11px] rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-accent hover:border-loom-accent transition-colors"
        >
          + 否则如果
        </button>
        <button
          onClick={() => onAddBranch(path, 'else')}
          className="px-2 py-1 text-[11px] rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-accent hover:border-loom-accent transition-colors"
        >
          + 否则
        </button>
      </div>
    </div>
  )
}

// 条件分支块：memo 化
const MemoIfBlock = memo(IfBlock, memoEquals)

function BranchView({
  branch,
  branchIdx,
  ifPath,
  charStates,
  onAddChild,
  onDeleteChild,
  onUpdateChild,
  onEditChild,
  onStopEdit,
  editingPath,
  onAddBranch,
  onUpdateBranchCondition,
  onDeleteBranch,
  isLast,
}: {
  branch: IfBranch
  branchIdx: number
  ifPath: number[]
  charStates: Map<string, CharSpriteState>
  onAddChild: (path: number[], afterChildIdx: number, rect: DOMRect) => void
  onDeleteChild: (path: number[], childIdx: number) => void
  onUpdateChild: (path: number[], patch: Partial<DialogueBlock>) => void
  onEditChild: (path: number[]) => void
  onStopEdit: () => void
  editingPath: number[] | null
  onAddBranch: (ifPath: number[], branchType: 'elif' | 'else') => void
  onUpdateBranchCondition: (ifPath: number[], branchIdx: number, condition: string) => void
  onDeleteBranch: (ifPath: number[], branchIdx: number) => void
  isLast: boolean
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [conditionDraft, setConditionDraft] = useState(branch.condition ?? '')
  const conditionInputRef = useRef<HTMLInputElement>(null)

  // 变量联动：已定义变量 chips + 未定义变量校验
  const variables = useStore((s) => s.variables)
  const definedVarNames = useMemo(
    () => new Set(variables.map((v) => v.varName).filter(Boolean)),
    [variables]
  )
  const usedVars = useMemo(() => extractVarNames(conditionDraft), [conditionDraft])
  const undefinedVars = useMemo(
    () => usedVars.filter((v) => !definedVarNames.has(v)),
    [usedVars, definedVarNames]
  )

  // 点击变量 chip：插入到光标处（无光标则追加）
  const insertVar = (name: string): void => {
    const input = conditionInputRef.current
    if (!input) {
      setConditionDraft((prev) => (prev ? `${prev} ${name}` : name))
      return
    }
    const start = input.selectionStart ?? conditionDraft.length
    const end = input.selectionEnd ?? conditionDraft.length
    const next = conditionDraft.slice(0, start) + name + conditionDraft.slice(end)
    setConditionDraft(next)
    requestAnimationFrame(() => {
      input.focus()
      const pos = start + name.length
      input.setSelectionRange(pos, pos)
    })
  }

  const handleSave = () => {
    if (branch.type !== 'else') {
      onUpdateBranchCondition(ifPath, branchIdx, conditionDraft)
    }
    setIsEditing(false)
  }

  const borderColor = branch.type === 'if' ? '#6B9BD1' : branch.type === 'elif' ? '#9B9B6B' : '#8B8B8B'
  const labelText = branch.type === 'if' ? '如果' : branch.type === 'elif' ? '否则如果' : '否则'
  const path = [...ifPath, branchIdx]

  return (
    <div className="group/branch">
      {/* 分支头部 */}
      <div
        className="flex items-center gap-2 px-4 py-2 border-b border-loom-border cursor-pointer"
        style={{ borderLeftWidth: '3px', borderLeftColor: borderColor }}
        onDoubleClick={() => {
          if (branch.type !== 'else') {
            setIsEditing(true)
          }
        }}
        title={branch.type !== 'else' ? '双击编辑条件' : undefined}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke={borderColor} strokeWidth="2" width="14" height="14">
          <path d="M6 3v12M18 9l-6 6-6-6" />
        </svg>
        <span className="text-xs font-semibold" style={{ color: borderColor }}>
          {labelText}
        </span>
        {isEditing ? (
          <div className="flex-1 min-w-0">
            <input
              ref={conditionInputRef}
              type="text"
              value={conditionDraft}
              onChange={(e) => setConditionDraft(e.target.value)}
              onBlur={handleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleSave()
                } else if (e.key === 'Escape') {
                  setIsEditing(false)
                  setConditionDraft(branch.condition ?? '')
                }
              }}
              autoFocus
              placeholder="条件表达式"
              className="w-full bg-loom-panel border border-loom-accent rounded px-2 py-0.5 text-xs font-mono text-loom-text focus:outline-none"
              onClick={(e) => e.stopPropagation()}
            />
            {/* 变量联动：已定义变量 chips，点击插入 */}
            {variables.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 mt-1">
                <span className="text-[9px] text-loom-muted/70 flex-shrink-0">变量</span>
                {variables.map((v) => (
                  <button
                    key={v.id}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={(e) => {
                      e.stopPropagation()
                      insertVar(v.varName)
                    }}
                    title={`${v.name} (${v.type})`}
                    className="px-1.5 py-px rounded bg-loom-panel2 border border-loom-border text-[10px] font-mono text-loom-accent hover:border-loom-accent transition-colors"
                  >
                    {v.varName}
                  </button>
                ))}
              </div>
            )}
            {/* 未定义变量校验 */}
            {undefinedVars.length > 0 && (
              <div className="text-[10px] text-loom-err mt-1">
                ⚠ 未定义变量：{undefinedVars.join('、')}
              </div>
            )}
          </div>
        ) : (
          <>
            {branch.condition && (
              <span className="text-xs font-mono text-loom-text flex-1 truncate">
                {branch.condition}
                {undefinedVars.length > 0 && (
                  <span className="ml-1.5 text-[9px] text-loom-err align-middle">⚠ 未定义</span>
                )}
              </span>
            )}
          </>
        )}
        {/* 删除分支按钮（if 分支不可删除，除非只有一个分支） */}
        {branch.type !== 'if' && (
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDeleteBranch(ifPath, branchIdx)
            }}
            className="opacity-0 group-hover/branch:opacity-100 w-4 h-4 flex items-center justify-center rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-err text-[10px]"
            title="删除分支"
          >
            ✕
          </button>
        )}
      </div>
      {/* 分支内容 */}
      <div className="px-4 py-2 bg-loom-bg/30">
        {branch.children && branch.children.length > 0 ? (
          branch.children.map((child, childIdx) => (
            <Fragment key={childIdx}>
              {/* 子内容之前的添加按钮 */}
              <div className="group/childgap relative">
                <ChildAddButton
                  onClick={(rect) => onAddChild(path, childIdx - 1, rect)}
                />
              </div>
              <MemoChildBlockView
                block={child}
                charStates={charStates}
                path={[...path, childIdx]}
                onAddChild={onAddChild}
                onDeleteChild={onDeleteChild}
                onUpdateChild={onUpdateChild}
                onEditChild={onEditChild}
                onStopEdit={onStopEdit}
                editingPath={editingPath}
                onAddBranch={onAddBranch}
                onUpdateBranchCondition={onUpdateBranchCondition}
                onDeleteBranch={onDeleteBranch}
              />
            </Fragment>
          ))
        ) : (
          <div className="text-xs text-loom-muted/50 py-1">（空）</div>
        )}
        {/* 末尾添加按钮 */}
        <div className="group/childgap relative">
          <ChildAddButton
            onClick={(rect) => onAddChild(path, (branch.children?.length ?? 1) - 1, rect)}
          />
        </div>
      </div>
    </div>
  )
}

// 分支视图：memo 化
const MemoBranchView = memo(BranchView, memoEquals)

// 子内容添加按钮（与顶层 AddButton 保持一致）
function ChildAddButton({ onClick }: { onClick: (rect: DOMRect) => void }) {
  const btnRef = useRef<HTMLButtonElement>(null)

  return (
    <div className="flex items-center justify-center relative z-10 h-1 group/add cursor-pointer">
      <button
        ref={btnRef}
        onClick={() => btnRef.current && onClick(btnRef.current.getBoundingClientRect())}
        className="opacity-0 group-hover/add:opacity-100 bg-loom-accent/80 hover:bg-loom-accent text-loom-bg rounded transition-opacity w-4 h-4 flex items-center justify-center pointer-events-auto"
        title="添加内容"
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" width="12" height="12">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </button>
      <div className="absolute inset-0 group-hover/add:bg-loom-accent/5 pointer-events-none" />
    </div>
  )
}
