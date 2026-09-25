import { useEffect, useRef } from 'react'
import type { PluginPanel } from '../store/plugins'

// 插件面板视图：HTML + mount 渲染（插件页 / 功能栏共用）
export default function PluginPanelView({ panel }: { panel: PluginPanel }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    try {
      const spec = panel.render()
      el.innerHTML = spec?.html ?? ''
      try {
        spec?.mount?.(el)
      } catch (e) {
        console.error('[plugin] panel mount failed:', e)
      }
    } catch (e) {
      el.textContent = '面板渲染失败：' + String(e)
    }
    return () => {
      el.innerHTML = ''
    }
  }, [panel])

  // 撑满侧边栏可用高度（插件面板内部自行决定是否用满，如列表滚动）
  return <div ref={ref} className="w-full flex-1 flex flex-col min-h-0" />
}
