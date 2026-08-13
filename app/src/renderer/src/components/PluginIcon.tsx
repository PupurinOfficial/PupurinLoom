// 插件图标
// 优先使用内置图标库（按插件 id 注册，与 Loom 整体 stroke 风格一致）；
// 插件自带自定义图标（manifest.icon 为 data URI / http / 内联 SVG）时尊重之；
// emoji 仅作第三方插件的兜底，未提供任何图标时显示默认拼图。
import { memo, type ReactNode } from 'react'

interface PluginIconProps {
  icon?: string
  pluginId?: string
  size?: number
  className?: string
}

// 内置图标库：24×24 viewBox，stroke 1.8，currentColor（随使用处颜色）
const REGISTRY: Record<string, ReactNode> = {
  // 剧本统计器：柱状图
  'script-stats': (
    <>
      <path d="M6 20v-6M12 20V8M18 20v-11" />
      <path d="M3 20h18" />
    </>
  ),
  // AI 台词灵感：星芒
  'story-ai': (
    <>
      <path d="M12 3l1.9 4.9 4.9 1.9-4.9 1.9L12 16.6l-1.9-4.9-4.9-1.9 4.9-1.9L12 3z" />
      <path d="M19 14.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9.9-2.3z" />
    </>
  ),
  // 朗读助手：喇叭
  'tts-reader': (
    <>
      <path d="M11 5L6 9H2v6h4l5 4V5z" />
      <path d="M15.5 8.5a5 5 0 010 7" />
      <path d="M18 6a8.5 8.5 0 010 12" />
    </>
  ),
  // 商城链路验证：快递箱
  'store-demo': (
    <>
      <path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16V8z" />
      <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
    </>
  ),
  // 喵喵语：猫爪
  'meow-loom': (
    <>
      <circle cx="6.5" cy="10" r="1.7" />
      <circle cx="12" cy="7.5" r="1.7" />
      <circle cx="17.5" cy="10" r="1.7" />
      <path d="M12 12.5c-3 0-5 1.8-5 4 0 1.7 1.3 2.8 3 2.8 1.2 0 1.9-.6 2-.6s.8.6 2 .6c1.7 0 3-1.1 3-2.8 0-2.2-2-4-5-4z" />
    </>
  ),
  // 画廊：相框 + 图片
  'pupurin-gallery': (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="9" r="1.5" />
      <path d="M21 15.5l-4.5-4.5L8 19" />
    </>
  ),
  // 未言未语：对话气泡 + 引号
  'weiyan-weiyu': (
    <>
      <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
      <path d="M8.5 10l-1.7 2.3h3.4L8.5 10zM15.5 10l-1.7 2.3h3.4L15.5 10z" fill="currentColor" stroke="none" />
    </>
  ),
}

function RegistrySvg({ size, className, children }: { size: number; className: string; children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={`flex-shrink-0 ${className}`}
    >
      {children}
    </svg>
  )
}

function DefaultIcon({ size, className }: { size: number; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      width={size}
      height={size}
      className={`flex-shrink-0 ${className}`}
    >
      <path d="M9.5 5A2.5 2.5 0 0014.5 5H17.5Q19 5 19 6.5V9.5A2.5 2.5 0 0119 14.5V17.5Q19 19 17.5 19H6.5Q5 19 5 17.5V14.5A2.5 2.5 0 005 9.5V6.5Q5 5 6.5 5H9.5Z" />
    </svg>
  )
}

function PluginIcon({ icon, pluginId, size = 16, className = '' }: PluginIconProps) {
  // 1) 内置图标库（按插件 id）
  const reg = pluginId ? REGISTRY[pluginId] : undefined
  if (reg) return <RegistrySvg size={size} className={className}>{reg}</RegistrySvg>

  const s = (icon ?? '').trim()
  if (!s) return <DefaultIcon size={size} className={className} />

  // 2) 图片（data URI / 远程地址）
  if (s.startsWith('data:') || s.startsWith('http://') || s.startsWith('https://')) {
    return (
      <img
        src={s}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className={`flex-shrink-0 object-contain ${className}`}
      />
    )
  }

  // 3) 内联 SVG：注入宽高
  if (s.startsWith('<svg')) {
    const sized = s.replace(/<svg([^>]*)>/i, (_, attrs: string) => {
      let out = attrs
      if (!/width=/i.test(out)) out += ` width="${size}"`
      if (!/height=/i.test(out)) out += ` height="${size}"`
      return `<svg${out}>`
    })
    return (
      <span
        className={`inline-flex items-center justify-center flex-shrink-0 ${className}`}
        style={{ width: size, height: size }}
        dangerouslySetInnerHTML={{ __html: sized }}
      />
    )
  }

  // 4) emoji / 短文本（第三方插件兜底）
  return (
    <span
      className={`inline-flex items-center justify-center flex-shrink-0 leading-none select-none ${className}`}
      style={{ width: size, height: size, fontSize: Math.round(size * 0.92) }}
    >
      {s.slice(0, 2)}
    </span>
  )
}

export default memo(PluginIcon)
