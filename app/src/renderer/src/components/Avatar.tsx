import { useStore } from '../store/useStore'
import { useProjectImage } from '../hooks/useProjectImage'
import type { CharacterMeta } from '../types'

interface AvatarProps {
  charVar: string | null | undefined
  size?: number
  className?: string
  activeSprite?: string
  spriteVisible?: boolean
}

function useCharacter(charVar: string | null | undefined): CharacterMeta | null {
  const characters = useStore((s) => s.characters)
  if (!charVar) return null
  return characters.find((c) => c.varName === charVar) ?? null
}

export default function Avatar({ charVar, size = 40, className = '', activeSprite, spriteVisible }: AvatarProps) {
  const character = useCharacter(charVar)
  const projectPath = useStore((s) => s.currentProject?.path ?? '')

  // 计算图片路径（在所有条件返回之前调用 hook）
  let imgPath: string | null = null
  if (character) {
    const avatarCfg = character.avatar ?? { type: 'initial' as const }
    if (activeSprite) {
      const sprite = character.sprites.find((s) => s.name === activeSprite)
      imgPath = sprite?.path ?? null
    } else if (avatarCfg.type === 'sprite' && avatarCfg.spriteId) {
      const sprite = character.sprites.find((s) => s.id === avatarCfg.spriteId)
      imgPath = sprite?.path ?? null
    } else if (avatarCfg.type === 'custom' && avatarCfg.customPath) {
      imgPath = avatarCfg.customPath
    }
  }
  const imgUrl = useProjectImage(projectPath, imgPath)

  if (!character) {
    return (
      <div
        className={`rounded-lg flex items-center justify-center bg-loom-panel2 border border-loom-border text-loom-muted flex-shrink-0 ${className}`}
        style={{ width: size, height: size, fontSize: size * 0.4 }}
      >
        ?
      </div>
    )
  }

  const { avatar, name, color } = character
  const avatarCfg = avatar ?? { type: 'initial' as const }
  const wantsImage = activeSprite || avatarCfg.type === 'sprite' || avatarCfg.type === 'custom'

  // 有图片且需要显示图片模式
  if (imgUrl && wantsImage) {
    const isVisible = activeSprite ? (spriteVisible ?? true) : true
    return (
      <div
        className={`rounded-lg overflow-hidden border border-loom-border flex-shrink-0 relative ${className}`}
        style={{ width: size, height: size }}
        title={`${name}${activeSprite ? ' · ' + activeSprite : ''}${!isVisible ? ' (已隐藏)' : ''}`}
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
            filter: isVisible ? 'none' : 'grayscale(100%) brightness(0.6)',
          }}
        />
        {!isVisible && (
          <div className="absolute inset-0 bg-black/30 flex items-center justify-center">
            <span className="text-[9px] text-loom-muted">已隐藏</span>
          </div>
        )}
      </div>
    )
  }

  // 无图片时回退到首字头像
  return (
    <div
      className={`rounded-lg flex items-center justify-center font-bold flex-shrink-0 ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size * 0.45,
        background: color + '33',
        color: color,
      }}
      title={name}
    >
      {name.charAt(0) || '?'}
    </div>
  )
}
