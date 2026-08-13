// UI 设计器面板（右侧功能栏「页面专属功能」，与页面通过 store 解耦）
// 内容：选中项属性（固定在控件库上方）→ 控件库（Figma 式拖拽添加）→ 框选编组 → 固定元素 → 主题 → 布局数值

import { useEffect, useMemo, useState } from 'react'
import type { CustomControl, CustomControlType, GroupType } from './types'
import { CUSTOM_TYPES, GROUP_TYPES, SCREEN_ELEMENTS, screenDisplayName } from './types'
import { PREVIEW_ELEMENTS } from './types'
import { THEME_PRESETS } from './presets'
import { useUiDesigner } from './uiDesignerStore'
import { AUTO_IMAGE } from './types'

/** 渲染元素 kind → 中文名（脚本元素属性面板/子控件列表用） */
const KIND_NAMES: Record<string, string> = {
  text: '文本',
  button: '按钮',
  image: '图片',
  bar: '滑条',
  box: '面板',
}

const DEFAULT_CUSTOM: Record<
  CustomControlType,
  Pick<CustomControl, 'width' | 'height' | 'text' | 'color' | 'size' | 'image'>
> = {
  text: { width: 200, height: 60, text: '文本', color: '#ffffff', size: 33 },
  label: { width: 200, height: 50, text: '标签', color: '#ffffff', size: 33 },
  button: { width: 220, height: 66, text: '按钮', color: '#ffffff' },
  image: { width: 200, height: 120, image: '' },
  bar: { width: 400, height: 24 },
  vbar: { width: 24, height: 300 },
  slider: { width: 400, height: 38 },
  input: { width: 400, height: 50, text: '输入框' },
  frame: { width: 400, height: 300 },
  imagebutton: { width: 200, height: 120, image: '' },
  null: { width: 40, height: 40 },
  hotspot: { width: 200, height: 100 },
  hotbar: { width: 400, height: 38 },
}

/** 「？」提示：悬停后弹出悬浮层说明。
 *  悬浮层以 PropSection 标题行（全宽）为定位上下文：left-0 固定在侧边栏内容最左缘，
 *  max-w-full 限到标题行宽度，永不超出可视区。 */
function InfoTip({ text }: { text: string }) {
  const [show, setShow] = useState(false)
  return (
    <span className="inline-flex" onMouseEnter={() => setShow(true)} onMouseLeave={() => setShow(false)}>
      <span className="inline-flex items-center justify-center w-3.5 h-3.5 rounded-full text-[9px] font-bold text-loom-muted border border-loom-border cursor-help hover:text-loom-accent hover:border-loom-accent/60 transition-colors">
        ?
      </span>
      {show && (
        <span className="absolute top-full left-0 z-50 mt-1 w-max max-w-full px-2 py-1.5 rounded-md bg-loom-panel border border-loom-border shadow-lg text-[10px] text-loom-text leading-relaxed whitespace-normal pointer-events-none">
          {text}
        </span>
      )}
    </span>
  )
}

/** 控件库按钮：悬停显示功能说明（自定义悬浮层，无系统 tooltip）。
 *  悬浮层按所在列对齐（左列贴左缘、右列贴右缘），max-w 限宽，两侧都不会超出侧边栏。 */
function ControlButton({
  type,
  name,
  desc,
  onAdd,
  side,
}: {
  type: CustomControlType
  name: string
  desc: string
  onAdd: () => void
  side: 'left' | 'right'
}) {
  const [show, setShow] = useState(false)
  return (
    <span
      className="relative block"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <button
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('application/x-loom-custom', type)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={onAdd}
        className="w-full py-2 rounded-lg border border-loom-border bg-loom-panel2 hover:border-loom-accent-dim hover:text-loom-accent transition-colors text-xs cursor-grab active:cursor-grabbing"
      >
        {name}
      </button>
      {show && (
        <span
          className={[
            'absolute top-full z-50 mt-0.5 w-max max-w-[200px] px-2 py-1.5 rounded-md bg-loom-panel border border-loom-border shadow-lg text-[10px] text-loom-text leading-relaxed whitespace-normal pointer-events-none',
            side === 'left' ? 'left-0' : 'right-0',
          ].join(' ')}
        >
          {desc}
        </span>
      )}
    </span>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-loom-border px-3 py-2.5">
      <div className="text-[11px] font-semibold text-loom-accent mb-1.5 tracking-wider">{title}</div>
      {children}
    </div>
  )
}

/** 垃圾桶删除图标（线条 SVG，非 emoji，与整体图标风格一致） */
function TrashIcon() {
  return (
    <svg
      width="13"
      height="13"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="block mx-auto"
    >
      <path d="M3 6h18" />
      <path d="M19 6l-1.2 14.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
      <path d="M10 11v6" />
      <path d="M14 11v6" />
    </svg>
  )
}

/** 属性小节（选中项属性内部的分组）：标题样式与普通 Section 一致，仅多「？」说明 */
function PropSection({ title, children, tip }: { title: string; children: React.ReactNode; tip?: string }) {
  return (
    <div className="mt-2.5 first:mt-0">
      {/* relative：InfoTip 悬浮层以此为定位上下文，left-0 即侧边栏内容最左缘 */}
      <div className="relative flex items-start gap-1.5 mb-1.5">
        <span className="text-[11px] font-semibold text-loom-accent tracking-wider">{title}</span>
        {tip && <InfoTip text={tip} />}
      </div>
      {children}
    </div>
  )
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  const safe = /^#[0-9a-fA-F]{6}$/.test(value) ? value : '#888888'
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-loom-muted shrink-0">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="color"
          value={safe}
          onChange={(e) => onChange(e.target.value)}
          className="w-5 h-5 rounded cursor-pointer bg-transparent border-none p-0"
        />
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value.trim())}
          className="w-[74px] px-1.5 py-0.5 text-[11px] font-mono rounded bg-loom-panel2 border border-loom-border focus:outline-none focus:border-loom-accent-dim text-loom-text"
        />
      </span>
    </label>
  )
}

function NumberField({
  label,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-loom-muted shrink-0">{label}</span>
      <input
        type="number"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-[84px] px-1.5 py-0.5 text-[11px] font-mono rounded bg-loom-panel2 border border-loom-border focus:outline-none focus:border-loom-accent-dim text-loom-text text-right"
      />
    </label>
  )
}

function SelectField({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-loom-muted shrink-0">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-[150px] px-1.5 py-0.5 text-[11px] font-mono rounded bg-loom-panel2 border border-loom-border focus:outline-none focus:border-loom-accent-dim text-loom-text"
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  )
}

/** 图片选择字段：显示当前路径，点击弹出缩略图选择弹窗（gui 文件夹全部图片，按目录分组） */
function ImageField({
  label,
  value,
  onChange,
  allowAuto = false,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  /** 是否提供「自动生成（随主题色）」选项（底图用） */
  allowAuto?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <label className="flex items-center justify-between gap-2 py-0.5">
        <span className="text-xs text-loom-muted shrink-0">{label}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="max-w-[170px] truncate px-2 py-0.5 text-[11px] font-mono rounded bg-loom-panel2 border border-loom-border hover:border-loom-accent-dim hover:text-loom-accent transition-colors text-loom-text"
        >
          {value || '选择图片…'}
        </button>
      </label>
      {/* 弹窗必须渲染在 <label> 之外：label 会把点击转发给上面的「选择图片…」按钮，
          导致关闭弹窗的点击（遮罩/按钮）被转发后立即重新打开，表现为「无法退出」。 */}
      {open && (
        <ImagePickerModal
          value={value}
          allowAuto={allowAuto}
          onPick={(v) => {
            onChange(v)
            setOpen(false)
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

/** 图片选择弹窗：gui 文件夹全部图片缩略图，按目录分组网格点选（参考织机「显示」命令的选择弹窗） */
function ImagePickerModal({
  value,
  allowAuto,
  onPick,
  onClose,
}: {
  value: string
  allowAuto: boolean
  onPick: (v: string) => void
  onClose: () => void
}) {
  const { guiImages, projectPath } = useUiDesigner()
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  const [query, setQuery] = useState('')
  useEffect(() => {
    let alive = true
    void (async () => {
      const m: Record<string, string> = {}
      for (const p of guiImages) {
        try {
          m[p] = await window.pupurin.readImageBase64(projectPath, p)
        } catch {
          /* 读不到的图片保持占位 */
        }
      }
      if (alive) setThumbs(m)
    })()
    return () => {
      alive = false
    }
  }, [projectPath, guiImages])

  // 当前值若不在列表中，补到最前，保证能选中回当前值
  const items = useMemo(() => {
    const list = [...guiImages]
    if (value && value !== AUTO_IMAGE && !list.includes(value)) list.unshift(value)
    return list
  }, [guiImages, value])

  // 搜索过滤：文件名或路径包含关键词（不区分大小写），空关键词显示全部
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return items
    return items.filter((p) => p.toLowerCase().includes(q))
  }, [items, query])

  // 按目录分组（path 去掉最后一段文件名）
  const groups = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const p of filtered) {
      const i = p.lastIndexOf('/')
      const dir = i >= 0 ? p.slice(0, i) : '（根目录）'
      if (!m.has(dir)) m.set(dir, [])
      m.get(dir)!.push(p)
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
  }, [filtered])

  const cell = (p: string): JSX.Element => {
    const sel = p === value
    const name = p.slice(p.lastIndexOf('/') + 1)
    return (
      <button
        key={p}
        type="button"
        onClick={() => onPick(p)}
        className={[
          'flex flex-col items-center gap-1 p-1.5 rounded-lg border transition-colors',
          sel ? 'border-loom-accent bg-loom-accent/10' : 'border-loom-border hover:border-loom-accent-dim',
        ].join(' ')}
      >
        {thumbs[p] ? (
          <img src={thumbs[p]} alt={name} className="w-full h-16 object-contain rounded bg-black/25" />
        ) : (
          <span className="w-full h-16 rounded bg-black/25 flex items-center justify-center text-[9px] text-loom-muted">
            加载中
          </span>
        )}
        <span className={['w-full truncate text-center text-[9px]', sel ? 'text-loom-accent' : 'text-loom-muted'].join(' ')}>
          {name}
        </span>
      </button>
    )
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center" onClick={onClose}>
      <div
        className="bg-loom-panel border border-loom-border rounded-xl shadow-2xl w-[640px] max-w-[90vw] flex flex-col max-h-[75vh]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-loom-border">
          <span className="text-xs font-semibold text-loom-accent tracking-wider">选择图片 · game/gui</span>
          <button type="button" onClick={onClose} className="text-xs text-loom-muted hover:text-loom-text transition-colors">
            关闭 ✕
          </button>
        </div>
        <div className="px-4 py-2 border-b border-loom-border">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索图片…"
            className="w-full px-2.5 py-1.5 text-[11px] rounded-md bg-loom-bg border border-loom-border focus:outline-none focus:border-loom-accent-dim text-loom-text"
          />
        </div>
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {allowAuto && (
            <button
              type="button"
              onClick={() => onPick(AUTO_IMAGE)}
              className={[
                'w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors text-xs',
                value === AUTO_IMAGE
                  ? 'border-loom-accent bg-loom-accent/10 text-loom-accent'
                  : 'border-loom-border text-loom-muted hover:border-loom-accent-dim',
              ].join(' ')}
            >
              自动生成（随主题色）
            </button>
          )}
          {groups.map(([dir, paths]) => (
            <div key={dir}>
              <div className="text-[10px] font-semibold text-loom-muted mb-1.5">{dir}/</div>
              <div className="grid grid-cols-4 gap-2">{paths.map(cell)}</div>
            </div>
          ))}
          {filtered.length === 0 && (
            <p className="text-[11px] text-loom-muted py-2">
              {items.length === 0
                ? 'game/gui 文件夹下没有图片，可先到「资源管理」中导入。'
                : `没有匹配「${query.trim()}」的图片`}
            </p>
          )}
        </div>
        <div className="px-4 py-2 border-t border-loom-border">
          <span className="text-[10px] font-mono text-loom-muted truncate block">
            当前：{value === AUTO_IMAGE ? '自动生成（随主题色）' : value || '（未选择）'}
          </span>
        </div>
      </div>
    </div>
  )
}

function TextField({
  label,
  value,
  onChange,
}: {
  label: string
  value: string
  onChange: (v: string) => void
}) {
  return (
    <label className="flex items-center justify-between gap-2 py-0.5">
      <span className="text-xs text-loom-muted shrink-0">{label}</span>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-[150px] px-1.5 py-0.5 text-[11px] rounded bg-loom-panel2 border border-loom-border focus:outline-none focus:border-loom-accent-dim text-loom-text"
      />
    </label>
  )
}

function ToggleField({
  label,
  value,
  onChange,
}: {
  label: string
  value: boolean
  onChange: (v: boolean) => void
}) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-loom-muted">{label}</span>
      <button
        onClick={() => onChange(!value)}
        className={[
          'px-2.5 py-0.5 rounded text-[11px] border transition-colors',
          value
            ? 'text-loom-accent border-loom-accent-dim bg-loom-accent/10'
            : 'text-loom-muted border-loom-border hover:text-loom-text',
        ].join(' ')}
      >
        {value ? '开' : '关'}
      </button>
    </div>
  )
}

function AlignField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: number) => void
}) {
  const opts = [
    { v: 0, t: '左' },
    { v: 0.5, t: '中' },
    { v: 1, t: '右' },
  ]
  return (
    <div className="py-0.5">
      <div className="text-xs text-loom-muted mb-1">{label}</div>
      <div className="flex gap-1">
        {opts.map((o) => (
          <button
            key={o.v}
            onClick={() => onChange(o.v)}
            className={[
              'flex-1 py-0.5 rounded text-[11px] border transition-colors',
              value === o.v
                ? 'text-loom-accent border-loom-accent-dim bg-loom-accent/10'
                : 'text-loom-muted border-loom-border hover:text-loom-text hover:border-loom-accent-dim',
            ].join(' ')}
          >
            {o.t}
          </button>
        ))}
      </div>
    </div>
  )
}

export default function UiDesignerPanel() {
  const s = useUiDesigner()
  const { ui, screen, selected, custom, groups, scriptGroups, renderedEls, multiSelected, fontOptions, guiImages, projectPath } = s
  if (!ui) {
    return <div className="p-3 text-xs text-loom-muted">项目未加载 UI 配置。</div>
  }
  const { colors, fonts, sizes, layout, images } = ui

  const selectedCustom = selected ? custom.find((c) => c.id === selected) : undefined
  const selectedGroup = selected ? groups.find((g) => g.id === selected) : undefined
  const customInGroup = selectedCustom ? groups.some((g) => g.children.includes(selectedCustom.id)) : false
  // 自定义控件所属编组：非 fixed 编组内位置由布局决定，隐藏 X/Y 编辑避免误导
  const selectedCustomGroup = selectedCustom
    ? groups.find((g) => g.screen === screen && g.children.includes(selectedCustom.id))
    : undefined
  const customInFlow = selectedCustomGroup !== undefined && selectedCustomGroup.type !== 'fixed'
  const selectedScriptGroup = selected ? scriptGroups.find((g) => g.id === selected) : undefined
  const selectedElement = selected && (SCREEN_ELEMENTS[screen] ?? []).includes(selected as never) ? selected : null
  // 脚本容器内的单个元素（sel-<key>）：第二击选中
  const selectedScriptEl = selected?.startsWith('sel-')
    ? renderedEls.find((e) => `sel-${e.key}` === selected)
    : undefined
  const scriptElContainer = selectedScriptEl?.containerId
    ? scriptGroups.find((g) => g.id === selectedScriptEl.containerId)
    : undefined
  // 仅固定容器（fixed）内元素改 pos 才不会被父布局覆盖
  const scriptElMovable = scriptElContainer?.kind === 'fixed' && selectedScriptEl?.line !== undefined

  const selectedName = selected
    ? selectedCustom
      ? (CUSTOM_TYPES.find((t) => t.type === selectedCustom.type)?.name ?? selectedCustom.type)
      : selectedGroup
        ? (GROUP_TYPES.find((t) => t.type === selectedGroup.type)?.name ?? selectedGroup.type)
        : selectedScriptGroup
          ? selectedScriptGroup.kind === 'vbox'
            ? '垂直编组'
            : selectedScriptGroup.kind === 'hbox'
              ? '水平编组'
              : '自由编组'
          : selectedScriptEl
            ? (KIND_NAMES[selectedScriptEl.kind] ?? selectedScriptEl.kind)
            : selectedElement
              ? (PREVIEW_ELEMENTS.find((e) => e.id === selectedElement)?.name ?? selectedElement)
              : null
    : null

  const addCustomHere = (type: CustomControlType): void => {
    const def = DEFAULT_CUSTOM[type]
    s.addCustom({
      screen,
      type,
      x: 960 - (def.width ?? 200) / 2,
      y: 540 - (def.height ?? 60) / 2,
      width: def.width ?? 200,
      height: def.height ?? 60,
      text: def.text,
      color: def.color,
      size: def.size,
      image: def.image,
    })
  }

  const screenName = screenDisplayName(screen)

  return (
    <div className="text-loom-text">
      {/* 属性：选中项（固定在控件库上方，与整体 Section 同构；底部分割线加粗 + 强调色，与控件库形成层级区分） */}
      <div className="border-b-2 border-loom-accent/25 px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-1.5">
          <span className="w-1 h-3.5 rounded-full bg-loom-accent shrink-0" />
          <span className="text-[11px] font-semibold text-loom-accent tracking-wider">属性</span>
          {selectedName && <span className="text-[10px] text-loom-muted truncate">· {selectedName}</span>}
          {selected && (
            <button
              onClick={() => s.select(null)}
              className="ml-auto text-[10px] text-loom-muted hover:text-loom-text transition-colors shrink-0"
            >
              清除选中
            </button>
          )}
        </div>
        <div className="max-h-[45vh] overflow-y-auto">
          {!selected && (
            <p className="text-[11px] text-loom-muted py-1">在画布中点击控件、编组或固定元素，属性会显示在这里。</p>
          )}

          {/* 选中固定元素属性 */}
          {selectedElement && (
            <PropSection
              title={PREVIEW_ELEMENTS.find((e) => e.id === selectedElement)?.name ?? selectedElement}
              tip="在画布上拖拽该元素可实时调整位置，数值保存时写入 gui.rpy。"
            >
              {selectedElement === 'window' && (
                <>
                  <NumberField
                    label="窗口垂直对齐"
                    value={layout.windowYalign}
                    min={0}
                    max={1.2}
                    step={0.01}
                    onChange={(v) => s.patchUi({ layout: { windowYalign: v } })}
                  />
                  <NumberField label="窗口高度" value={layout.windowHeight} min={80} max={800} onChange={(v) => s.patchUi({ layout: { windowHeight: v } })} />
                </>
              )}
              {selectedElement === 'namebox' && (
                <>
                  <NumberField label="姓名框 X" value={layout.nameboxX} min={-120} max={1920} onChange={(v) => s.patchUi({ layout: { nameboxX: v } })} />
                  <NumberField label="姓名框 Y" value={layout.nameboxY} min={-60} max={800} onChange={(v) => s.patchUi({ layout: { nameboxY: v } })} />
                  <NumberField label="姓名框锚点" value={layout.nameboxXalign} min={0} max={1} step={0.05} onChange={(v) => s.patchUi({ layout: { nameboxXalign: v } })} />
                  <NumberField label="姓名框宽度" value={layout.nameboxWidth} min={50} max={600} onChange={(v) => s.patchUi({ layout: { nameboxWidth: v } })} />
                  <NumberField label="姓名框高度" value={layout.nameboxHeight} min={20} max={300} onChange={(v) => s.patchUi({ layout: { nameboxHeight: v } })} />
                </>
              )}
              {selectedElement === 'dialogue' && (
                <>
                  <NumberField label="对话文本 X" value={layout.dialogueX} min={0} max={1920} onChange={(v) => s.patchUi({ layout: { dialogueX: v } })} />
                  <NumberField label="对话文本 Y" value={layout.dialogueY} min={-60} max={800} onChange={(v) => s.patchUi({ layout: { dialogueY: v } })} />
                  <NumberField label="对话文本宽度" value={layout.dialogueWidth} min={100} max={1920} onChange={(v) => s.patchUi({ layout: { dialogueWidth: v } })} />
                  <NumberField label="对话文本对齐" value={layout.dialogueTextXalign} min={0} max={1} step={0.1} onChange={(v) => s.patchUi({ layout: { dialogueTextXalign: v } })} />
                </>
              )}
              {selectedElement === 'choice' && (
                <>
                  <NumberField label="选择菜单 Y" value={layout.choiceY} min={0} max={1080} onChange={(v) => s.patchUi({ layout: { choiceY: v } })} />
                  <NumberField label="选择菜单 X 对齐" value={layout.choiceXalign} min={0} max={1} step={0.01} onChange={(v) => s.patchUi({ layout: { choiceXalign: v } })} />
                  <NumberField label="按钮宽度" value={layout.choiceWidth} min={100} max={1920} onChange={(v) => s.patchUi({ layout: { choiceWidth: v } })} />
                </>
              )}
              {selectedElement === 'quick' && (
                <>
                  <NumberField label="快捷菜单 X 对齐" value={layout.quickXalign} min={0} max={1} step={0.01} onChange={(v) => s.patchUi({ layout: { quickXalign: v } })} />
                  <NumberField label="快捷菜单 Y 对齐" value={layout.quickYalign} min={0} max={1} step={0.01} onChange={(v) => s.patchUi({ layout: { quickYalign: v } })} />
                </>
              )}
              {selectedElement === 'nav' && (
                <NumberField label="导航列 X" value={layout.navX} min={-120} max={1920} onChange={(v) => s.patchUi({ layout: { navX: v } })} />
              )}
            </PropSection>
          )}

          {/* 选中自定义控件属性 */}
          {selectedCustom && (
            <PropSection title={`控件属性 · ${selectedName}`}>
              {(() => {
                const t = selectedCustom.type
                const isTextLike = t === 'text' || t === 'label' || t === 'button' || t === 'input'
                return (
                  <>
                    {(t === 'text' || t === 'label' || t === 'button' || t === 'input') && (
                      <TextField
                        label="文本"
                        value={selectedCustom.text ?? ''}
                        onChange={(v) => s.updateCustom(selectedCustom.id, { text: v })}
                      />
                    )}
                    {(t === 'text' || t === 'label' || t === 'input') && (
                      <NumberField
                        label="字号"
                        value={selectedCustom.size ?? 33}
                        min={8}
                        max={200}
                        onChange={(v) => s.updateCustom(selectedCustom.id, { size: v })}
                      />
                    )}
                    {t === 'button' && (
                      <NumberField
                        label="字号"
                        value={selectedCustom.textSize ?? Math.round((selectedCustom.height || 66) * 0.4)}
                        min={8}
                        max={200}
                        onChange={(v) => s.updateCustom(selectedCustom.id, { textSize: v })}
                      />
                    )}
                    {(t === 'text' || t === 'label' || t === 'button' || t === 'input') && (
                      <ColorField
                        label="文字颜色"
                        value={selectedCustom.color ?? '#ffffff'}
                        onChange={(v) => s.updateCustom(selectedCustom.id, { color: v })}
                      />
                    )}
                    {t === 'button' && (
                      <ColorField
                        label="悬停文字色"
                        value={selectedCustom.hoverColor ?? colors.hover}
                        onChange={(v) => s.updateCustom(selectedCustom.id, { hoverColor: v })}
                      />
                    )}
                    {(t === 'text' || t === 'button') && (
                      <ToggleField
                        label="粗体"
                        value={selectedCustom.bold ?? false}
                        onChange={(v) => s.updateCustom(selectedCustom.id, { bold: v })}
                      />
                    )}
                    {t === 'image' && (
                      <ImageField
                        label="图片"
                        value={selectedCustom.image ?? ''}
                        onChange={(v) => s.updateCustom(selectedCustom.id, { image: v })}
                      />
                    )}
                    {t === 'imagebutton' && (
                      <>
                        <ImageField
                          label="普通图片"
                          value={selectedCustom.image ?? ''}
                          onChange={(v) => s.updateCustom(selectedCustom.id, { image: v })}
                        />
                        <ImageField
                          label="悬停图片"
                          value={selectedCustom.hoverImage ?? selectedCustom.image ?? ''}
                          onChange={(v) => s.updateCustom(selectedCustom.id, { hoverImage: v })}
                        />
                      </>
                    )}
                    {(t === 'bar' || t === 'vbar' || t === 'slider' || t === 'hotbar') && (
                      <NumberField
                        label="当前值"
                        value={selectedCustom.value ?? 0.5}
                        min={0}
                        max={1}
                        step={0.05}
                        onChange={(v) => s.updateCustom(selectedCustom.id, { value: v })}
                      />
                    )}
                    {t === 'null' && (
                      <p className="text-[11px] text-loom-muted pb-1">
                        在布局中撑出指定宽高的空白区域。
                      </p>
                    )}
                    {t === 'hotspot' && (
                      <p className="text-[11px] text-loom-muted pb-1">
                        覆盖在图片上的透明可点击区域，位置与尺寸即热区范围。
                      </p>
                    )}
                    {isTextLike && (
                      <AlignField
                        label="水平对齐"
                        value={selectedCustom.xalign ?? 0}
                        onChange={(v) => s.updateCustom(selectedCustom.id, { xalign: v })}
                      />
                    )}
                    <NumberField
                      label="透明度"
                      value={selectedCustom.alpha ?? 1}
                      min={0}
                      max={1}
                      step={0.05}
                      onChange={(v) => s.updateCustom(selectedCustom.id, { alpha: v })}
                    />
                    {t !== 'text' && t !== 'label' && (
                      <>
                        <NumberField label="宽度" value={selectedCustom.width} min={10} max={1920} onChange={(v) => s.updateCustom(selectedCustom.id, { width: v })} />
                        <NumberField label="高度" value={selectedCustom.height} min={10} max={1080} onChange={(v) => s.updateCustom(selectedCustom.id, { height: v })} />
                      </>
                    )}
                    {!customInFlow ? (
                      <>
                        <NumberField label="X" value={selectedCustom.x} min={-500} max={1920} onChange={(v) => s.updateCustom(selectedCustom.id, { x: v })} />
                        <NumberField label="Y" value={selectedCustom.y} min={-500} max={1080} onChange={(v) => s.updateCustom(selectedCustom.id, { y: v })} />
                      </>
                    ) : (
                      <p className="text-[11px] text-loom-muted leading-relaxed pb-1">
                        位于{selectedCustomGroup?.type}编组内，位置由编组布局决定；上方属性可直接修改。
                      </p>
                    )}
                    <div className="flex gap-1.5 mt-1.5">
                      {customInGroup && (
                        <button
                          onClick={() => s.removeFromGroup(selectedCustom.id)}
                          className="flex-1 py-1.5 rounded text-[11px] text-loom-accent border border-loom-accent/40 hover:bg-loom-accent/10 transition-colors"
                        >
                          退出编组
                        </button>
                      )}
                      <button
                        onClick={() => s.removeCustom(selectedCustom.id)}
                        className={[
                          'py-1.5 rounded text-[11px] text-loom-err border border-loom-err/40 hover:bg-loom-err/10 transition-colors',
                          customInGroup ? 'px-2.5' : 'w-full',
                        ].join(' ')}
                      >
                        {customInGroup ? <TrashIcon /> : '删除控件'}
                      </button>
                    </div>
                  </>
                )
              })()}
            </PropSection>
          )}

          {/* 选中编组属性 */}
          {selectedGroup && (
            <PropSection title={`编组属性 · ${selectedName}`} tip={GROUP_TYPES.find((t) => t.type === selectedGroup.type)?.desc}>
              <SelectField
                label="编组类型"
                value={selectedGroup.type}
                options={GROUP_TYPES.map((t) => ({ value: t.type, label: t.name }))}
                onChange={(v) => s.updateGroup(selectedGroup.id, { type: v as GroupType })}
              />
              <AlignField
                label="水平对齐"
                value={selectedGroup.xalign ?? 0}
                onChange={(v) => s.updateGroup(selectedGroup.id, { xalign: v })}
              />
              {selectedGroup.type === 'grid' && (
                <NumberField
                  label="列数"
                  value={selectedGroup.cols ?? 2}
                  min={1}
                  max={12}
                  onChange={(v) => s.updateGroup(selectedGroup.id, { cols: Math.max(1, Math.round(v)) })}
                />
              )}
              {selectedGroup.type === 'side' && (
                <SelectField
                  label="布局位置"
                  value={selectedGroup.positions ?? 'c r'}
                  options={[
                    { value: 'c r', label: '中 + 右' },
                    { value: 'c l', label: '中 + 左' },
                    { value: 'c t', label: '中 + 上' },
                    { value: 'c b', label: '中 + 下' },
                    { value: 'l c', label: '左 + 中' },
                    { value: 'l r', label: '左 + 右' },
                    { value: 't c', label: '上 + 中' },
                    { value: 't b', label: '上 + 下' },
                  ]}
                  onChange={(v) => s.updateGroup(selectedGroup.id, { positions: v })}
                />
              )}
              {selectedGroup.type === 'viewport' && (
                <SelectField
                  label="滚动条"
                  value={selectedGroup.scrollbars ?? 'vertical'}
                  options={[
                    { value: 'vertical', label: '垂直' },
                    { value: 'horizontal', label: '水平' },
                    { value: 'both', label: '双向' },
                    { value: 'none', label: '无' },
                  ]}
                  onChange={(v) => s.updateGroup(selectedGroup.id, { scrollbars: v === 'none' ? undefined : v })}
                />
              )}
              <NumberField label="X" value={selectedGroup.x} min={-500} max={1920} onChange={(v) => s.updateGroup(selectedGroup.id, { x: v })} />
              <NumberField label="Y" value={selectedGroup.y} min={-500} max={1080} onChange={(v) => s.updateGroup(selectedGroup.id, { y: v })} />
              {(selectedGroup.type === 'button' || selectedGroup.type === 'window' || selectedGroup.type === 'viewport') && (
                <>
                  <NumberField
                    label="宽度"
                    value={selectedGroup.width ?? (selectedGroup.type === 'button' ? 220 : selectedGroup.type === 'window' ? 500 : 400)}
                    min={10}
                    max={1920}
                    onChange={(v) => s.updateGroup(selectedGroup.id, { width: v })}
                  />
                  <NumberField
                    label="高度"
                    value={selectedGroup.height ?? (selectedGroup.type === 'button' ? 66 : selectedGroup.type === 'window' ? 220 : 300)}
                    min={10}
                    max={1080}
                    onChange={(v) => s.updateGroup(selectedGroup.id, { height: v })}
                  />
                </>
              )}
              {selectedGroup.type !== 'fixed' && selectedGroup.type !== 'button' && (
                <NumberField label="子控件间距" value={selectedGroup.spacing} min={0} max={300} onChange={(v) => s.updateGroup(selectedGroup.id, { spacing: v })} />
              )}
              <div className="mt-1.5">
                <div className="text-[10px] text-loom-muted/70 mb-1">子控件（点击选中单个）</div>
                <div className="flex flex-col gap-1">
                  {selectedGroup.children.map((cid) => {
                    const c = custom.find((x) => x.id === cid)
                    if (!c) return null
                    const cname = CUSTOM_TYPES.find((t) => t.type === c.type)?.name ?? c.type
                    return (
                      <button
                        key={cid}
                        onClick={() => s.select(cid)}
                        className="px-2 py-1 rounded text-[11px] text-left truncate border border-loom-border bg-loom-panel2 hover:border-loom-accent-dim hover:text-loom-accent transition-colors"
                      >
                        {cname} · {c.text || c.image || c.id}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div className="flex gap-1.5 mt-1.5">
                <button
                  onClick={() => s.ungroup(selectedGroup.id)}
                  className="flex-1 py-1.5 rounded text-[11px] text-loom-accent border border-loom-accent/40 hover:bg-loom-accent/10 transition-colors"
                >
                  解散编组
                </button>
                <button
                  onClick={() => s.removeGroup(selectedGroup.id)}
                  className="px-2.5 py-1.5 rounded text-[11px] text-loom-err border border-loom-err/40 hover:bg-loom-err/10 transition-colors"
                >
                  <TrashIcon />
                </button>
              </div>
            </PropSection>
          )}

          {/* 选中脚本编组（screens.rpy 中的 vbox/hbox/fixed 容器） */}
          {selectedScriptGroup && (
            <PropSection
              title={`脚本编组 · ${selectedName}`}
              tip="项目 screens.rpy 里的容器。第一次点击选中整个编组；再次点击内部控件可选中单个编辑属性。"
            >
              {(() => {
                const canMove = !selectedScriptGroup.parentKind || selectedScriptGroup.parentKind === 'fixed'
                const isFlowChild = selectedScriptGroup.parentKind === 'vbox' || selectedScriptGroup.parentKind === 'hbox'
                return (
                  <>
                    {canMove ? (
                      <>
                        <NumberField
                          label="X"
                          value={selectedScriptGroup.x}
                          min={-500}
                          max={1920}
                          onChange={(v) => s.updateScriptGroupPos(selectedScriptGroup.id, v, selectedScriptGroup.y)}
                        />
                        <NumberField
                          label="Y"
                          value={selectedScriptGroup.y}
                          min={-500}
                          max={1080}
                          onChange={(v) => s.updateScriptGroupPos(selectedScriptGroup.id, selectedScriptGroup.x, v)}
                        />
                      </>
                    ) : (
                      isFlowChild && (
                        <p className="text-[11px] text-loom-muted leading-relaxed pb-1">
                          嵌套在父{selectedScriptGroup.parentKind}内，位置由父编组布局决定。
                        </p>
                      )
                    )}
                    {selectedScriptGroup.kind !== 'fixed' && (
                      <NumberField
                        label="子控件间距"
                        value={selectedScriptGroup.spacing}
                        min={0}
                        max={300}
                        onChange={(v) => s.updateScriptGroupSpacing(selectedScriptGroup.id, v)}
                      />
                    )}
                    <div className="mt-1.5">
                      <div className="text-[10px] text-loom-muted/70 mb-1">内部控件（点击选中单个）</div>
                      <div className="flex flex-col gap-1">
                        {selectedScriptGroup.children.map((k) => {
                          const el = renderedEls.find((e) => e.key === k)
                          const label = el
                            ? `${KIND_NAMES[el.kind] ?? el.kind}${el.text ? ` · ${el.text}` : el.image ? ` · ${el.image}` : ''}`
                            : k
                          return (
                            <button
                              key={k}
                              onClick={() => s.select(`sel-${k}`)}
                              className="px-2 py-1 rounded text-[11px] text-left truncate border border-loom-border bg-loom-panel2 hover:border-loom-accent-dim hover:text-loom-accent transition-colors"
                            >
                              {label}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                    <button
                      onClick={() => s.ungroupScriptGroup(selectedScriptGroup.id)}
                      className="mt-1.5 w-full py-1.5 rounded text-[11px] text-loom-accent border border-loom-accent/40 hover:bg-loom-accent/10 transition-colors"
                    >
                      解散编组（内部控件提升为独立元素，位置保留）
                    </button>
                  </>
                )
              })()}
            </PropSection>
          )}

          {/* 选中脚本容器内单个元素（sel-<key>） */}
          {selectedScriptEl && (
            <PropSection
              title={`脚本元素 · ${selectedName}`}
              tip={scriptElMovable ? undefined : `位于${scriptElContainer?.kind ?? '脚本'}编组内，位置由编组布局决定；其他属性仍可编辑。`}
            >
              {(() => {
                const el = selectedScriptEl
                const line = el.line ?? -1
                const rawLine = (() => {
                  const ls = s.sources.screens.split(/\r?\n/)
                  return line >= 0 && line < ls.length ? ls[line] : ''
                })()
                const editable = line >= 0 && rawLine.trim() !== ''
                const isTextButton = /textbutton\b/.test(rawLine)
                const isImageButton = /imagebutton\b/.test(rawLine)
                const isAdd = /^\s*(add|image)\b/.test(rawLine)
                // 文本类（text / label / textbutton）：可编辑内容、字号、颜色、粗体、对齐
                const textLike = editable && (el.kind === 'text' || (el.kind === 'button' && isTextButton))
                // 图片类（add / imagebutton）：可替换图片
                const imageLike = editable && (isAdd || isImageButton) && !!el.image
                return (
                  <>
                    {textLike && (
                      <>
                        <TextField
                          label="内容"
                          value={el.text ?? ''}
                          onChange={(v) => s.updateScriptElProp(line, 'text', v)}
                        />
                        <NumberField
                          label="字号"
                          value={el.fontSize ?? 33}
                          min={8}
                          max={200}
                          onChange={(v) => s.updateScriptElProp(line, 'size', String(v))}
                        />
                        <ColorField
                          label="文字颜色"
                          value={el.color ?? '#ffffff'}
                          onChange={(v) => s.updateScriptElProp(line, 'color', v)}
                        />
                        <ToggleField
                          label="粗体"
                          value={el.bold ?? false}
                          onChange={(v) => s.updateScriptElProp(line, 'bold', v ? 'True' : 'False')}
                        />
                        <AlignField
                          label="水平对齐"
                          value={el.align === 'right' ? 1 : el.align === 'left' ? 0 : 0.5}
                          onChange={(v) => s.updateScriptElProp(line, 'align', String(v))}
                        />
                      </>
                    )}
                    {imageLike && (
                      <ImageField
                        label="图片"
                        value={el.image!}
                        onChange={(v) => s.updateScriptElProp(line, 'image', v)}
                      />
                    )}
                    <div className="text-[11px] text-loom-muted py-0.5 flex gap-2">
                      <span className="shrink-0">位置</span>
                      <span className="font-mono">
                        ({Math.round(el.x)}, {Math.round(el.y)})
                      </span>
                      <span className="shrink-0">尺寸</span>
                      <span className="font-mono">
                        {Math.round(el.w)}×{Math.round(el.h)}
                      </span>
                    </div>
                    {scriptElMovable ? (
                      <>
                        <NumberField
                          label="X"
                          value={Math.round(el.x)}
                          min={-500}
                          max={1920}
                          onChange={(v) => s.updateScriptElementPos(`sc-${el.line}`, v, Math.round(el.y))}
                        />
                        <NumberField
                          label="Y"
                          value={Math.round(el.y)}
                          min={-500}
                          max={1080}
                          onChange={(v) => s.updateScriptElementPos(`sc-${el.line}`, Math.round(el.x), v)}
                        />
                      </>
                    ) : (
                      <p className="text-[11px] text-loom-muted leading-relaxed pb-1">
                        {scriptElContainer ? `位于${scriptElContainer.kind}编组内，位置由编组布局决定；上方属性可直接修改。` : '位置由编组布局决定。'}
                      </p>
                    )}
                    {scriptElContainer && (
                      <button
                        onClick={() => s.select(scriptElContainer.id)}
                        className="mt-1 w-full py-1.5 rounded text-[11px] text-loom-accent border border-loom-accent/40 hover:bg-loom-accent/10 transition-colors"
                      >
                        选中所属编组
                      </button>
                    )}
                    {editable && (
                      <div className="flex gap-1.5 mt-1">
                        {scriptElContainer && (
                          <button
                            onClick={() => s.exitScriptElement(line)}
                            className="flex-1 py-1.5 rounded text-[11px] text-loom-accent border border-loom-accent/40 hover:bg-loom-accent/10 transition-colors"
                          >
                            退出编组
                          </button>
                        )}
                        <button
                          onClick={() => s.removeScriptElement(line)}
                          className={[
                            'py-1.5 rounded text-[11px] text-loom-err border border-loom-err/40 hover:bg-loom-err/10 transition-colors',
                            scriptElContainer ? 'px-2.5' : 'w-full',
                          ].join(' ')}
                        >
                          {scriptElContainer ? <TrashIcon /> : '删除元素'}
                        </button>
                      </div>
                    )}
                  </>
                )
              })()}
            </PropSection>
          )}
        </div>
      </div>

      {/* 控件库（Figma 式） */}
      <Section title={`控件库 · 拖到画布 (${screenName})`}>
        <div className="grid grid-cols-2 gap-2">
          {CUSTOM_TYPES.map((t, i) => (
            <ControlButton
              key={t.type}
              type={t.type}
              name={t.name}
              desc={t.desc}
              side={i % 2 === 0 ? 'left' : 'right'}
              onAdd={() => addCustomHere(t.type)}
            />
          ))}
        </div>
      </Section>

      {/* 框选编组：在画布空白处拖拽框选多个控件后出现 */}
      {multiSelected.length > 0 && (
        <Section title={`框选 · ${multiSelected.length} 个控件`}>
          <p className="text-[10px] text-loom-muted mb-1.5 leading-relaxed">
            把框选的控件合并为一个编组（可整体移动）：
          </p>
          <div className="flex flex-col gap-1.5">
            {GROUP_TYPES.map((t) => (
              <button
                key={t.type}
                onClick={() => s.createGroup(t.type, multiSelected)}
                className="px-2.5 py-2 rounded-lg border border-loom-border bg-loom-panel2 hover:border-loom-accent-dim hover:text-loom-accent transition-colors text-left"
              >
                <div className="text-xs font-medium">{t.name}</div>
                <div className="text-[10px] text-loom-muted mt-0.5 leading-relaxed">{t.desc}</div>
              </button>
            ))}
          </div>
          <button
            onClick={s.clearMulti}
            className="mt-2 w-full py-1 rounded text-[11px] text-loom-muted border border-loom-border hover:text-loom-text hover:border-loom-accent-dim transition-colors"
          >
            取消选择
          </button>
        </Section>
      )}

      {/* 当前界面元素 */}
      <Section title="固定元素">
        {(SCREEN_ELEMENTS[screen] ?? []).length === 0 ? (
          <p className="text-[11px] text-loom-muted/70">该界面没有可拖动的固定元素，可用控件库自由添加。</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {(SCREEN_ELEMENTS[screen] ?? []).map((elId) => {
              const meta = PREVIEW_ELEMENTS.find((e) => e.id === elId)
              const active = selectedElement === elId
              return (
                <button
                  key={elId}
                  onClick={() => s.select(elId)}
                  className={[
                    'px-2 py-1 rounded text-[11px] border transition-colors',
                    active
                      ? 'text-loom-accent border-loom-accent-dim bg-loom-accent/10'
                      : 'text-loom-muted border-loom-border hover:text-loom-text hover:border-loom-accent-dim',
                  ].join(' ')}
                >
                  {meta?.name ?? elId}
                </button>
              )
            })}
          </div>
        )}
      </Section>

      {/* 主题 */}
      <Section title="主题预设">
        <select
          defaultValue=""
          onChange={(e) => e.target.value && s.applyPreset(e.target.value)}
          className="w-full px-1.5 py-1 text-[11px] rounded bg-loom-panel2 border border-loom-border focus:outline-none focus:border-loom-accent-dim text-loom-text"
        >
          <option value="">选择预设…</option>
          {THEME_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </Section>

      <Section title="主题色">
        <ColorField label="强调色" value={colors.accent} onChange={(v) => s.patchUi({ colors: { accent: v } })} />
        <ColorField label="常态文字" value={colors.idle} onChange={(v) => s.patchUi({ colors: { idle: v } })} />
        <ColorField label="悬停文字" value={colors.hover} onChange={(v) => s.patchUi({ colors: { hover: v } })} />
        <ColorField label="选中文字" value={colors.selected} onChange={(v) => s.patchUi({ colors: { selected: v } })} />
        <ColorField label="对话正文" value={colors.text} onChange={(v) => s.patchUi({ colors: { text: v } })} />
        <ColorField label="弱化文字" value={colors.muted} onChange={(v) => s.patchUi({ colors: { muted: v } })} />
      </Section>

      <Section title="字体（游戏目录 .ttf/.otf）">
        <SelectField label="对话字体" value={fonts.text} options={fontOptions.map((f) => ({ value: f, label: f }))} onChange={(v) => s.patchUi({ fonts: { text: v } })} />
        <SelectField label="姓名字体" value={fonts.name} options={fontOptions.map((f) => ({ value: f, label: f }))} onChange={(v) => s.patchUi({ fonts: { name: v } })} />
        <SelectField label="界面字体" value={fonts.interface} options={fontOptions.map((f) => ({ value: f, label: f }))} onChange={(v) => s.patchUi({ fonts: { interface: v } })} />
      </Section>

      <Section title="字号与间距">
        <NumberField label="对话字号" value={sizes.text} min={12} max={120} onChange={(v) => s.patchUi({ sizes: { text: v } })} />
        <NumberField label="姓名字号" value={sizes.name} min={12} max={120} onChange={(v) => s.patchUi({ sizes: { name: v } })} />
        <NumberField label="界面字号" value={sizes.interface} min={12} max={120} onChange={(v) => s.patchUi({ sizes: { interface: v } })} />
        <NumberField label="选择按钮字号" value={sizes.choiceButton} min={12} max={120} onChange={(v) => s.patchUi({ sizes: { choiceButton: v } })} />
        <NumberField label="快捷菜单字号" value={sizes.quickButton} min={12} max={120} onChange={(v) => s.patchUi({ sizes: { quickButton: v } })} />
        <NumberField label="选择按钮间距" value={sizes.choiceSpacing} min={0} max={200} onChange={(v) => s.patchUi({ sizes: { choiceSpacing: v } })} />
      </Section>

      <Section title="底图（缺省自动生成）">
        <ImageField label="对话窗" value={images.textbox} allowAuto onChange={(v) => s.patchUi({ images: { textbox: v } })} />
        <ImageField label="姓名框" value={images.namebox} allowAuto onChange={(v) => s.patchUi({ images: { namebox: v } })} />
        <ImageField label="主菜单背景" value={images.mainMenu} allowAuto onChange={(v) => s.patchUi({ images: { mainMenu: v } })} />
      </Section>

      {/* 当前界面布局数值 */}
      <Section title="布局数值">
        {(screen === 'say' || screen === 'choice') && (
          <NumberField label="窗口垂直对齐" value={layout.windowYalign} min={0} max={1.5} step={0.01} onChange={(v) => s.patchUi({ layout: { windowYalign: v } })} />
        )}
        {(screen === 'say' || screen === 'choice') && (
          <NumberField label="窗口高度" value={layout.windowHeight} min={80} max={800} onChange={(v) => s.patchUi({ layout: { windowHeight: v } })} />
        )}
        {screen === 'say' && (
          <>
            <NumberField label="对话文本 X" value={layout.dialogueX} min={0} max={1920} onChange={(v) => s.patchUi({ layout: { dialogueX: v } })} />
            <NumberField label="对话文本 Y" value={layout.dialogueY} min={-60} max={800} onChange={(v) => s.patchUi({ layout: { dialogueY: v } })} />
            <NumberField label="对话文本宽度" value={layout.dialogueWidth} min={100} max={1920} onChange={(v) => s.patchUi({ layout: { dialogueWidth: v } })} />
            <NumberField label="对话文本对齐" value={layout.dialogueTextXalign} min={0} max={1} step={0.1} onChange={(v) => s.patchUi({ layout: { dialogueTextXalign: v } })} />
            <NumberField label="姓名框 X" value={layout.nameboxX} min={-120} max={1920} onChange={(v) => s.patchUi({ layout: { nameboxX: v } })} />
            <NumberField label="姓名框 Y" value={layout.nameboxY} min={-60} max={800} onChange={(v) => s.patchUi({ layout: { nameboxY: v } })} />
            <NumberField label="姓名框锚点" value={layout.nameboxXalign} min={0} max={1} step={0.05} onChange={(v) => s.patchUi({ layout: { nameboxXalign: v } })} />
            <NumberField label="快捷菜单 X 对齐" value={layout.quickXalign} min={0} max={1} step={0.01} onChange={(v) => s.patchUi({ layout: { quickXalign: v } })} />
            <NumberField label="快捷菜单 Y 对齐" value={layout.quickYalign} min={0} max={1} step={0.01} onChange={(v) => s.patchUi({ layout: { quickYalign: v } })} />
          </>
        )}
        {screen === 'choice' && (
          <>
            <NumberField label="选择菜单 Y" value={layout.choiceY} min={0} max={1080} onChange={(v) => s.patchUi({ layout: { choiceY: v } })} />
            <NumberField label="选择菜单 X 对齐" value={layout.choiceXalign} min={0} max={1} step={0.01} onChange={(v) => s.patchUi({ layout: { choiceXalign: v } })} />
          </>
        )}
        {(screen === 'main_menu' || screen === 'game_menu') && (
          <NumberField label="导航列 X" value={layout.navX} min={-120} max={1920} onChange={(v) => s.patchUi({ layout: { navX: v } })} />
        )}
      </Section>
    </div>
  )
}
