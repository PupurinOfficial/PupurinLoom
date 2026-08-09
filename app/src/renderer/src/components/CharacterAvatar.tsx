import { useStore } from '../store/useStore'
import { useProjectImage } from '../hooks/useProjectImage'
import type { CharacterMeta } from '../types'

interface CharacterAvatarProps {
  character: CharacterMeta
  size?: number
  className?: string
  rounded?: string
}

// 角色头像：根据 avatar 配置显示立绘图片（顶部1/3裁剪）或首字
// 用于角色列表、角色详情预览等场景
export default function CharacterAvatar({
  character,
  size = 24,
  className = '',
  rounded = 'rounded-full',
}: CharacterAvatarProps) {
  const projectPath = useStore((s) => s.currentProject?.path ?? '')
  const { avatar, name, color, sprites } = character
  const avatarCfg = avatar ?? { type: 'initial' as const }

  // 计算图片路径
  let imgPath: string | null = null
  if (avatarCfg.type === 'sprite' && avatarCfg.spriteId) {
    const sp = sprites.find((s) => s.id === avatarCfg.spriteId)
    imgPath = sp?.path ?? null
  } else if (avatarCfg.type === 'custom' && avatarCfg.customPath) {
    imgPath = avatarCfg.customPath
  }
  const imgUrl = useProjectImage(projectPath, imgPath)
  const wantsImage = avatarCfg.type === 'sprite' || avatarCfg.type === 'custom'

  // 有图片且需要图片模式
  if (imgUrl && wantsImage) {
    return (
      <div
        className={`overflow-hidden border border-loom-border flex-shrink-0 relative ${rounded} ${className}`}
        style={{ width: size, height: size }}
        title={name}
      >
        <img
          src={imgUrl}
          alt={name}
          className="absolute left-0 top-0"
          style={{
            width: '100%',
            height: `${size * 3}px`,
            objectFit: 'cover',
            objectPosition: 'center top',
          }}
        />
      </div>
    )
  }

  // 回退：首字头像
  return (
    <div
      className={`flex items-center justify-center font-bold flex-shrink-0 ${rounded} ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        background: color + '33',
        color: color,
      }}
      title={name}
    >
      {name.charAt(0) || '?'}
    </div>
  )
}

// 将 hex 颜色与白色混合，生成偏白的浅色版本
export function lightenColor(hex: string, amount = 0.5): string {
  const r = parseInt(hex.slice(1, 3), 16)
  const g = parseInt(hex.slice(3, 5), 16)
  const b = parseInt(hex.slice(5, 7), 16)
  const lr = Math.round(r + (255 - r) * amount)
  const lg = Math.round(g + (255 - g) * amount)
  const lb = Math.round(b + (255 - b) * amount)
  return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`
}

// 立绘差分缩略图：按头像方式裁剪（顶部1/3 + 水平居中）
interface SpriteThumbnailProps {
  path: string | null | undefined
  size?: number
  className?: string
  rounded?: string
}

export function SpriteThumbnail({ path, size = 40, className = '', rounded = 'rounded' }: SpriteThumbnailProps) {
  const projectPath = useStore((s) => s.currentProject?.path ?? '')
  const imgUrl = useProjectImage(projectPath, path)

  if (imgUrl) {
    return (
      <div
        className={`overflow-hidden border border-loom-border flex-shrink-0 relative ${rounded} ${className}`}
        style={{ width: size, height: size }}
      >
        <img
          src={imgUrl}
          alt={path ?? ''}
          className="absolute left-0 top-0"
          style={{
            width: '100%',
            height: `${size * 3}px`,
            objectFit: 'cover',
            objectPosition: 'center top',
          }}
        />
      </div>
    )
  }

  // 无图片时显示占位
  return (
    <div
      className={`flex items-center justify-center bg-loom-bg border border-loom-border text-loom-muted flex-shrink-0 ${rounded} ${className}`}
      style={{ width: size, height: size, fontSize: size * 0.22 }}
    >
      无图
    </div>
  )
}
