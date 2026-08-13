import type { ViewId } from '../store/useStore'

interface ActivityBarProps {
  active: ViewId
  onChange: (v: ViewId) => void
}

interface IconDef {
  id: ViewId
  name: string
  svg: JSX.Element
  badge?: string
}

const icons: IconDef[] = [
  {
    id: 'home',
    name: '主页',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <path d="M3 12l9-9 9 9" />
        <path d="M5 10v10h14V10" />
        <circle cx="12" cy="14" r="1.5" />
      </svg>
    )
  },
  {
    id: 'script',
    name: '织机',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <path d="M4 6h16M4 12h16M4 18h12" />
      </svg>
    )
  },
  {
    id: 'characters',
    name: '角色',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <circle cx="12" cy="8" r="4" />
        <path d="M4 20c0-4 4-6 8-6s8 2 8 6" />
      </svg>
    )
  },
  {
    id: 'variables',
    name: '变量',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <text x="12" y="18" textAnchor="middle" fontSize="18" fontWeight="600" stroke="none" fill="currentColor">x</text>
      </svg>
    )
  },
  {
    id: 'resources',
    name: '资源管理器',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      </svg>
    )
  },
  {
    id: 'package',
    name: '打包',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" />
        <path d="M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12" />
      </svg>
    )
  },
  {
    id: 'ui',
    name: 'UI 设计器',
    badge: 'BETA',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M8 4v5" />
        <path d="M6 13h2M10 13h2M6 16h4" />
      </svg>
    )
  },
  {
    id: 'plugins',
    name: '插件',
    svg: (
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" width="22" height="22">
        <path d="M9.5 5A2.5 2.5 0 0014.5 5H17.5Q19 5 19 6.5V9.5A2.5 2.5 0 0119 14.5V17.5Q19 19 17.5 19H6.5Q5 19 5 17.5V14.5A2.5 2.5 0 005 9.5V6.5Q5 5 6.5 5H9.5Z" />
      </svg>
    )
  },
]

export default function ActivityBar({ active, onChange }: ActivityBarProps) {
  return (
    <nav className="flex flex-col items-center w-12 bg-loom-bg border-r border-loom-border py-2 gap-1 select-none">
      {icons.map((ic) => {
        const isActive = active === ic.id
        return (
          <button
            key={ic.id}
            onClick={() => onChange(ic.id)}
            title={ic.name}
            className={[
              'relative w-10 h-10 flex items-center justify-center rounded-md transition-colors',
              isActive
                ? 'text-loom-accent bg-loom-panel2'
                : 'text-loom-muted hover:text-loom-text hover:bg-loom-panel'
            ].join(' ')}
          >
            {isActive && (
              <span className="absolute left-0 top-1 bottom-1 w-[2px] bg-loom-accent rounded-r" />
            )}
            {ic.svg}
            {ic.badge && (
              <span
                className="absolute top-0.5 right-0.5 text-[5px] font-bold leading-none px-[3px] py-[2px] rounded-sm bg-amber-500 text-white tracking-wider"
                title={`${ic.name}（${ic.badge}）`}
              >
                {ic.badge}
              </span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
