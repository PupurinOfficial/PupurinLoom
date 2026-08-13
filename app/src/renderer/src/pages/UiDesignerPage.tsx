// UI 设计器页面：顶部界面切换（对话/选择/标题/游戏菜单/设置）+ 中间预览画布。
// 属性面板与控件库已并入右侧功能栏（页面专属功能），此处只负责画布与保存。

import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import { useUiDesigner } from '../uiDesigner/uiDesignerStore'
import GamePreview from '../uiDesigner/GamePreview'
import { DESIGN_SCREENS, screenDisplayName } from '../uiDesigner/types'
import type { CustomControlType } from '../uiDesigner/types'

const FEATURE_ID = 'ui-designer'

export default function UiDesignerPage() {
  const projectPath = useStore((s) => s.currentProject?.path ?? '')
  const s = useUiDesigner()
  const [menuOpen, setMenuOpen] = useState(false)

  // 加载项目 UI 配置；进入页面自动展开右侧「UI 设计」功能栏
  useEffect(() => {
    if (projectPath) void s.load(projectPath)
    useStore.getState().openSidebar(FEATURE_ID)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath])

  const addCustom = (x: number, y: number, type: CustomControlType): void => {
    const defs: Record<CustomControlType, { width: number; height: number; text?: string; color?: string; size?: number; image?: string }> = {
      text: { width: 200, height: 60, text: '文本', color: '#ffffff', size: 33 },
      label: { width: 200, height: 40, text: '标签', color: '#ffffff', size: 26 },
      button: { width: 220, height: 66, text: '按钮', color: '#ffffff' },
      image: { width: 200, height: 120, image: s.guiImages[0] ?? '' },
      bar: { width: 400, height: 24 },
      vbar: { width: 24, height: 300 },
      slider: { width: 400, height: 24 },
      input: { width: 320, height: 56, text: '输入框', color: '#ffffff' },
      frame: { width: 480, height: 300 },
      imagebutton: { width: 200, height: 120, image: s.guiImages[0] ?? '' },
      null: { width: 40, height: 40 },
      hotspot: { width: 200, height: 100 },
      hotbar: { width: 400, height: 38 },
    }
    const d = defs[type]
    s.addCustom({ screen: s.screen, type, x, y, width: d.width, height: d.height, text: d.text, color: d.color, size: d.size, image: d.image })
  }

  if (!s.loaded && !s.ui) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-2 text-loom-muted">
        <div className="text-sm">{s.loading ? '正在读取项目 UI 配置…' : s.error ? '加载失败' : '未加载'}</div>
        {s.error && <div className="text-[11px] font-mono max-w-md text-loom-err">{s.error}</div>}
      </div>
    )
  }
  if (!s.ui) return null

  return (
    <div className="flex flex-col h-full bg-loom-bg">
      {/* 顶栏：界面切换 + 保存 */}
      <div className="flex items-center gap-1 px-3 h-10 bg-loom-panel2 border-b border-loom-border shrink-0">
        <span
          className="mr-1 px-1.5 py-0.5 rounded text-[9px] font-bold text-white bg-amber-500 tracking-wider select-none"
          title="UI 设计器处于测试阶段"
        >
          BETA
        </span>
        {DESIGN_SCREENS.map((d) => {
          const active = s.screen === d.id
          return (
            <button
              key={d.id}
              onClick={() => s.setScreen(d.id)}
              className={[
                'px-3 h-7 rounded text-[12px] transition-colors',
                active
                  ? 'text-loom-accent bg-loom-panel2 font-medium'
                  : 'text-loom-muted hover:text-loom-text hover:bg-loom-panel',
              ].join(' ')}
            >
              {d.name}
            </button>
          )
        })}
        {/* 下拉：查看 / 选择项目里所有 screen */}
        <div className="relative">
          <button
            onClick={() => setMenuOpen((v) => !v)}
            title="查看所有 screen"
            className={[
              'px-2 h-7 rounded text-[12px] transition-colors border border-loom-border',
              menuOpen || !DESIGN_SCREENS.some((d) => d.id === s.screen)
                ? 'text-loom-accent bg-loom-panel2'
                : 'text-loom-muted hover:text-loom-text hover:bg-loom-panel',
            ].join(' ')}
          >
            ▾
          </button>
          {menuOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
              <div className="absolute right-0 top-9 z-50 w-52 max-h-80 overflow-auto rounded-lg border border-loom-border bg-loom-panel shadow-2xl py-1">
                <div className="px-3 pt-1 pb-1 text-[10px] text-loom-muted/70 tracking-wider">全部 screen（{s.allScreens.length}）</div>
                {s.allScreens.map((n) => {
                  const active = s.screen === n
                  const isPrimary = DESIGN_SCREENS.some((d) => d.id === n)
                  return (
                    <button
                      key={n}
                      onClick={() => {
                        s.setScreen(n)
                        setMenuOpen(false)
                      }}
                      className={[
                        'w-full px-3 py-1.5 text-left text-[12px] transition-colors flex items-center gap-2',
                        active ? 'text-loom-accent bg-loom-accent/10' : 'text-loom-muted hover:text-loom-text hover:bg-loom-panel',
                      ].join(' ')}
                    >
                      <span className="flex-1 truncate">{screenDisplayName(n)}</span>
                      <span className="text-[10px] font-mono text-loom-muted/60">{isPrimary ? '内置' : ''}</span>
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
        <div className="ml-auto flex items-center gap-3">
          {s.modified && (
            <span className="text-[11px] text-loom-accent flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-loom-accent" />
              未保存
            </span>
          )}
          <button
            onClick={() => void s.save()}
            disabled={!s.modified || s.saving}
            className={[
              'px-3 py-1.5 text-[12px] rounded font-semibold transition-opacity',
              s.modified && !s.saving
                ? 'bg-loom-accent text-loom-bg hover:opacity-90'
                : 'bg-loom-panel2 text-loom-muted cursor-not-allowed',
            ].join(' ')}
          >
            {s.saving ? '保存中…' : '保存到项目'}
          </button>
        </div>
      </div>
      {s.error && (
        <div className="px-4 py-1.5 text-[11px] text-loom-err bg-loom-err/10 border-b border-loom-border">
          {s.error}
        </div>
      )}

      <div className="flex flex-1 min-h-0">
        <GamePreview
          projectPath={projectPath}
          state={s.ui}
          screen={s.screen}
          custom={s.custom}
          groups={s.groups}
          multiSelected={s.multiSelected}
          sources={s.sources}
          selected={s.selected}
          onSelect={s.select}
          onSelectMulti={s.selectMulti}
          onChangeLayout={(patch) => s.patchUi({ layout: patch })}
          onCustomMove={(id, x, y) => s.updateCustom(id, { x, y })}
          onGroupMove={(id, x, y) => s.updateGroup(id, { x, y })}
          onScriptGroupMove={(id, x, y) => s.updateScriptGroupPos(id, x, y)}
          onScriptGroups={s.setScriptGroups}
          onRenderedEls={s.setRenderedEls}
          onDropCustom={addCustom}
        />
      </div>
    </div>
  )
}
