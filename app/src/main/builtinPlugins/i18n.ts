// 内置插件「多语言」：为游戏添加翻译语言，一键提取对话生成 Ren'Py translate 代码
// main.js 以 ?raw 形式在构建时内联（electron-vite 支持），运行于渲染层插件运行时。
import i18nMain from './i18n/main.js?raw'

export const I18N_MANIFEST: Record<string, unknown> = {
  id: 'pupurin-i18n',
  name: '多语言',
  version: '1.0.1',
  description:
    '内置多语言：管理翻译语言、提取对话生成 Ren' +
    "'" +
    'Py translate 代码到 game/tl/，并在面板中逐条编辑译文、设置默认语言',
  author: 'Pupurin° Loom',
  main: 'main.js',
  builtin: true,
}

export { i18nMain }
