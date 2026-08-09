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

  return <div ref={ref} className="w-full" />
}
