/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/renderer/index.html', './src/renderer/src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        loom: {
          // 全部基于 CSS 变量（index.css 中定义，支持明暗主题与自定义配色）
          bg: 'rgb(var(--loom-bg) / <alpha-value>)',
          panel: 'rgb(var(--loom-panel) / <alpha-value>)',
          panel2: 'rgb(var(--loom-panel2) / <alpha-value>)',
          border: 'rgb(var(--loom-border) / <alpha-value>)',
          accent: 'rgb(var(--loom-accent) / <alpha-value>)',
          accentDim: 'rgb(var(--loom-accent-dim) / <alpha-value>)',
          text: 'rgb(var(--loom-text) / <alpha-value>)',
          muted: 'rgb(var(--loom-muted) / <alpha-value>)',
          ok: 'rgb(var(--loom-ok) / <alpha-value>)',
          err: 'rgb(var(--loom-err) / <alpha-value>)'
        }
      },
      fontFamily: {
        mono: ['SF Mono', 'Menlo', 'Consolas', 'monospace']
      }
    }
  },
  plugins: []
}
