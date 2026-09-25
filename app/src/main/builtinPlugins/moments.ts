// 内置插件「铃光时刻」：用 AI 标记剧情中的高光时刻（模式一）
// main.js 以 ?raw 形式在构建时内联（electron-vite 支持），运行于渲染层插件运行时。
import momentsMain from './moments/main.js?raw'

export const MOMENTS_MANIFEST: Record<string, unknown> = {
  id: 'pupurin-moments',
  name: '铃光时刻',
  version: '1.0.0',
  description: '内置铃光时刻：用你配置的 AI（OpenAI 兼容接口）在剧情中找出最适合宣传的高光时刻，可自定义判定与输出提示词，标记可跳转、导出，并作为宣传片素材',
  author: 'Pupurin° Loom',
  main: 'main.js',
  builtin: true,
}

export { momentsMain }
