// 主题预设：一键套用整套配色（+可选字号），只改 gui.rpy 主题层。

import type { ThemePreset } from './types'

export const THEME_PRESETS: ThemePreset[] = [
  {
    id: 'warm',
    name: '暖光绘本（默认）',
    colors: {
      accent: '#ffe4a6',
      idle: '#888888',
      hover: '#ffe4a6',
      selected: '#ffffff',
      text: '#ffffff',
      muted: '#515100',
    },
  },
  {
    id: 'novel',
    name: '深色小说',
    colors: {
      accent: '#c8a97e',
      idle: '#8a8a8a',
      hover: '#c8a97e',
      selected: '#f2e8d5',
      text: '#e8e4da',
      muted: '#6b5b41',
    },
  },
  {
    id: 'sakura',
    name: '樱花粉',
    colors: {
      accent: '#f4a6c8',
      idle: '#9a7a8a',
      hover: '#f4a6c8',
      selected: '#ffffff',
      text: '#4a3038',
      muted: '#7a5560',
    },
  },
  {
    id: 'mono',
    name: '素净文稿',
    colors: {
      accent: '#b8b8b8',
      idle: '#777777',
      hover: '#b8b8b8',
      selected: '#ffffff',
      text: '#202020',
      muted: '#5a5a5a',
    },
  },
  {
    id: 'crt',
    name: '复古 CRT',
    colors: {
      accent: '#7cff8a',
      idle: '#4a9a52',
      hover: '#7cff8a',
      selected: '#ffffff',
      text: '#9effa8',
      muted: '#2e5a34',
    },
    sizes: { text: 36, name: 48, interface: 36, quickButton: 24, choiceButton: 36 },
  },
]

export function findPreset(id: string): ThemePreset | undefined {
  return THEME_PRESETS.find((p) => p.id === id)
}
