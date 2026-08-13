// 程序化生成底图（混合模式：没有图片时自动生成，随主题色）
import type { UiDesignState } from './types'

export function generateAutoImage(
  kind: 'textbox' | 'namebox' | 'mainMenu',
  state: UiDesignState
): string {
  const { colors } = state
  const dims: Record<string, [number, number]> = {
    textbox: [1920, 278],
    namebox: [400, 130],
    mainMenu: [1920, 1080],
  }
  const [w, h] = dims[kind]
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')!
  const accent = /^#[0-9a-fA-F]{6}$/.test(colors.accent) ? colors.accent : '#ffe4a6'

  if (kind === 'mainMenu') {
    const g = ctx.createLinearGradient(0, 0, 0, h)
    g.addColorStop(0, '#2b2b2e')
    g.addColorStop(0.55, '#202024')
    g.addColorStop(1, '#19191c')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, w, h)
    const glow = ctx.createRadialGradient(w / 2, -h * 0.2, 0, w / 2, -h * 0.2, h * 0.9)
    glow.addColorStop(0, `${accent}33`)
    glow.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = glow
    ctx.fillRect(0, 0, w, h)
    return canvas.toDataURL('image/png')
  }

  const r = kind === 'textbox' ? 14 : 10
  const g = ctx.createLinearGradient(0, 0, 0, h)
  if (kind === 'textbox') {
    g.addColorStop(0, 'rgba(48,48,52,0.96)')
    g.addColorStop(1, 'rgba(26,26,28,0.98)')
  } else {
    g.addColorStop(0, `${accent}59`)
    g.addColorStop(1, `${accent}24`)
  }
  ctx.clearRect(0, 0, w, h)
  ctx.beginPath()
  ctx.roundRect(2, 2, w - 4, h - 4, r)
  ctx.fillStyle = g
  ctx.fill()
  ctx.lineWidth = 2
  ctx.strokeStyle = kind === 'textbox' ? `${accent}40` : `${accent}99`
  ctx.stroke()
  ctx.beginPath()
  ctx.roundRect(6, 6, w - 12, Math.min(14, h / 4), r)
  ctx.fillStyle = 'rgba(255,255,255,0.05)'
  ctx.fill()
  return canvas.toDataURL('image/png')
}
