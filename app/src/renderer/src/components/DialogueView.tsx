import { useMemo, useState, useRef, useCallback, useEffect, Fragment, type KeyboardEvent } from 'react'
import { useStore } from '../store/useStore'
import { parseDialogue, computeCharSpriteStates, type DialogueBlock, type CharSpriteState, type BlockType, type IfBranch } from '../utils/dialogueParser'
import { parseRenpyText, styleToCss, type TextStyle } from '../utils/renpyTextParser'
import { extractVarNames } from '../utils/varExtractor'
import { useProjectImagePaths } from '../hooks/useProjectImage'
import { useProjectAudioDuration } from '../hooks/useProjectAudio'
import Avatar from './Avatar'
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
  addBranch,
  updateBranchCondition,
  removeBranch,
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
  const blocks = useMemo(() => parseDialogue(source), [source])

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
      onChange?.(newSource)
    },
    [onChange]
  )

  // 添加新 block（顶层）
  const handleAddBlock = useCallback(
    (type: BlockType, afterIdx: number) => {
      const newBlock = createBlock(type, afterIdx + 1)
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
    (type: BlockType, path: number[], afterChildIdx: number) => {
      const newBlock = createBlock(type, 0)
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
  const handleAddBranch = useCallback(
    (blockIdx: number, branchType: 'elif' | 'else') => {
      const newBlocks = addBranch(blocks, blockIdx, branchType)
      commitBlocks(newBlocks)
    },
    [blocks, commitBlocks]
  )

  // 更新分支条件
  const handleUpdateBranchCondition = useCallback(
    (blockIdx: number, branchIdx: number, condition: string) => {
      const newBlocks = updateBranchCondition(blocks, blockIdx, branchIdx, condition)
      commitBlocks(newBlocks)
    },
    [blocks, commitBlocks]
  )

  // 删除分支
  const handleDeleteBranch = useCallback(
    (blockIdx: number, branchIdx: number) => {
      const newBlocks = removeBranch(blocks, blockIdx, branchIdx)
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
          onSelect={(type) => handleAddBlock(type, paletteState.afterIdx)}
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
            <BlockView
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
              onAddBranch={(branchType) => handleAddBranch(i, branchType)}
              onUpdateBranchCondition={(branchIdx, condition) => handleUpdateBranchCondition(i, branchIdx, condition)}
              onDeleteBranch={(branchIdx) => handleDeleteBranch(i, branchIdx)}
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
        onSelect={(type) => handleAddChild(type, nestedPaletteState.path, nestedPaletteState.afterChildIdx)}
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
  onAddBranch: (branchType: 'elif' | 'else') => void
  onUpdateBranchCondition: (branchIdx: number, condition: string) => void
  onDeleteBranch: (branchIdx: number) => void
}

function BlockView(props: BlockViewProps) {
  const { block, isEditing, onEdit, onDelete, onUpdate, onStopEdit, blocks, charStates,
    onAddChild, onDeleteChild, onUpdateChild, onEditChild, onStopEditChild, editingPath,
    onAddBranch, onUpdateBranchCondition, onDeleteBranch } = props

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
      <BlockContent
        block={block}
        charStates={charStates}
        blockIndex={props.index}
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

// block 显示组件（只读）
function BlockContent({
  block,
  charStates,
  blockIndex,
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
  blockIndex: number
  onAddChild: (path: number[], afterChildIdx: number, rect: DOMRect) => void
  onDeleteChild: (path: number[], childIdx: number) => void
  onUpdateChild: (path: number[], patch: Partial<DialogueBlock>) => void
  onEditChild: (path: number[]) => void
  onStopEditChild: () => void
  editingPath: number[] | null
  onAddBranch: (branchType: 'elif' | 'else') => void
  onUpdateBranchCondition: (branchIdx: number, condition: string) => void
  onDeleteBranch: (branchIdx: number) => void
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
        <MenuBlock
          block={block}
          charStates={charStates}
          blockIndex={blockIndex}
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
        <IfBlock
          block={block}
          charStates={charStates}
          blockIndex={blockIndex}
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
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    case 'show':
    case 'hide':
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="flex items-center gap-2">
            <label className="text-[10px] text-loom-muted w-12">角色</label>
            <select
              value={block.showCharVar ?? ''}
              onChange={(e) => onUpdate({ showCharVar: e.target.value })}
              className="bg-loom-panel border border-loom-border rounded px-2 py-1 text-xs font-mono text-loom-text flex-1"
            >
              {characters.map((c) => (
                <option key={c.id} value={c.varName}>{c.varName} ({c.name})</option>
              ))}
              {!characters.find((c) => c.varName === block.showCharVar) && (
                <option value={block.showCharVar}>{block.showCharVar}</option>
              )}
            </select>
            <input
              type="text"
              value={block.showSprite ?? ''}
              onChange={(e) => onUpdate({ showSprite: e.target.value || undefined })}
              placeholder="差分 (可选)"
              className="bg-loom-panel border border-loom-border rounded px-2 py-1 text-xs font-mono text-loom-text w-28"
            />
          </div>
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

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
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )

    default:
      return (
        <div className="p-3 rounded-lg bg-loom-bg border border-loom-accent/50 space-y-2">
          <div className="text-xs text-loom-muted">此类型暂不支持图形编辑</div>
          <EditableActions onDelete={onDelete} onStopEdit={onStopEdit} />
        </div>
      )
  }
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
  blockIndex,
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
  blockIndex: number
  onAddChild: (path: number[], afterChildIdx: number, rect: DOMRect) => void
  onDeleteChild: (path: number[], childIdx: number) => void
  onUpdateChild: (path: number[], patch: Partial<DialogueBlock>) => void
  onEditChild: (path: number[]) => void
  onStopEditChild: () => void
  editingPath: number[] | null
  onAddBranch: (branchType: 'elif' | 'else') => void
  onUpdateBranchCondition: (branchIdx: number, condition: string) => void
  onDeleteBranch: (branchIdx: number) => void
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
          <MenuOptionItem
            key={i}
            opt={opt}
            optIndex={i}
            blockIndex={blockIndex}
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

function MenuOptionItem({
  opt,
  optIndex,
  blockIndex,
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
  opt: { text: string; target: string | null; line: number; children?: DialogueBlock[] }
  optIndex: number
  blockIndex: number
  charStates: Map<string, CharSpriteState>
  onAddChild: (path: number[], afterChildIdx: number, rect: DOMRect) => void
  onDeleteChild: (path: number[], childIdx: number) => void
  onUpdateChild: (path: number[], patch: Partial<DialogueBlock>) => void
  onEditChild: (path: number[]) => void
  onStopEditChild: () => void
  editingPath: number[] | null
  onAddBranch: (branchType: 'elif' | 'else') => void
  onUpdateBranchCondition: (branchIdx: number, condition: string) => void
  onDeleteBranch: (branchIdx: number) => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [textDraft, setTextDraft] = useState(opt.text)
  const [targetDraft, setTargetDraft] = useState(opt.target ?? '')

  const handleSave = () => {
    onUpdateChild([blockIndex, optIndex], { text: textDraft, target: targetDraft || null } as any)
    setIsEditing(false)
  }

  const path = [blockIndex, optIndex]

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
                  onClick={(rect) => onAddChild(path, ci - 1, rect)}
                />
              </div>
              <ChildBlockView
                block={child}
                charStates={charStates}
                path={[...path, ci]}
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
              onClick={(rect) => onAddChild(path, (opt.children?.length ?? 1) - 1, rect)}
            />
          </div>
        </div>
      ) : (
        <div className="border-t border-loom-border/50 px-3 py-1.5 ml-4">
          <ChildAddButton
            onClick={(rect) => onAddChild(path, -1, rect)}
          />
        </div>
      )}
    </div>
  )
}

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
        </div>
        <div className="text-sm text-loom-text font-mono truncate">
          {bg}
        </div>
      </div>
    </div>
  )
}

function ShowBlock({ block }: { block: DialogueBlock }) {
  const character = useStore((s) => s.characters).find((c) => c.varName === block.showCharVar)
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
  const character = useStore((s) => s.characters).find((c) => c.varName === block.showCharVar)
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
  onAddBranch?: (branchType: 'elif' | 'else') => void
  onUpdateBranchCondition?: (branchIdx: number, condition: string) => void
  onDeleteBranch?: (branchIdx: number) => void
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
        <BlockContent
          block={block}
          charStates={charStates}
          blockIndex={path[0]}
          onAddChild={onAddChild}
          onDeleteChild={onDeleteChild}
          onUpdateChild={onUpdateChild}
          onEditChild={onEditChild}
          onStopEditChild={onStopEdit}
          editingPath={editingPath}
          onAddBranch={onAddBranch ?? (() => {})}
          onUpdateBranchCondition={onUpdateBranchCondition ?? (() => {})}
          onDeleteBranch={onDeleteBranch ?? (() => {})}
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

// If/Elif/Else block 显示组件（合并为一个 block）
function IfBlock({
  block,
  charStates,
  blockIndex,
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
  blockIndex: number
  onAddChild: (path: number[], afterChildIdx: number, rect: DOMRect) => void
  onDeleteChild: (path: number[], childIdx: number) => void
  onUpdateChild: (path: number[], patch: Partial<DialogueBlock>) => void
  onEditChild: (path: number[]) => void
  onStopEditChild: () => void
  editingPath: number[] | null
  onAddBranch: (branchType: 'elif' | 'else') => void
  onUpdateBranchCondition: (branchIdx: number, condition: string) => void
  onDeleteBranch: (branchIdx: number) => void
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
        <BranchView
          key={branchIdx}
          branch={branch}
          branchIdx={branchIdx}
          blockIndex={blockIndex}
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
          onClick={() => onAddBranch('elif')}
          className="px-2 py-1 text-[11px] rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-accent hover:border-loom-accent transition-colors"
        >
          + 否则如果
        </button>
        <button
          onClick={() => onAddBranch('else')}
          className="px-2 py-1 text-[11px] rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-accent hover:border-loom-accent transition-colors"
        >
          + 否则
        </button>
      </div>
    </div>
  )
}

function BranchView({
  branch,
  branchIdx,
  blockIndex,
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
  blockIndex: number
  charStates: Map<string, CharSpriteState>
  onAddChild: (path: number[], afterChildIdx: number, rect: DOMRect) => void
  onDeleteChild: (path: number[], childIdx: number) => void
  onUpdateChild: (path: number[], patch: Partial<DialogueBlock>) => void
  onEditChild: (path: number[]) => void
  onStopEdit: () => void
  editingPath: number[] | null
  onAddBranch: (branchType: 'elif' | 'else') => void
  onUpdateBranchCondition: (branchIdx: number, condition: string) => void
  onDeleteBranch: (branchIdx: number) => void
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
      onUpdateBranchCondition(branchIdx, conditionDraft)
    }
    setIsEditing(false)
  }

  const borderColor = branch.type === 'if' ? '#6B9BD1' : branch.type === 'elif' ? '#9B9B6B' : '#8B8B8B'
  const labelText = branch.type === 'if' ? '如果' : branch.type === 'elif' ? '否则如果' : '否则'
  const path = [blockIndex, branchIdx]

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
              onDeleteBranch(branchIdx)
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
              <ChildBlockView
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
