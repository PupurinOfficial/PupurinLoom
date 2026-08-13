// 内置插件「画廊」：管理 CG 与差分，生成 Ren'Py 官方 Gallery 代码
// main.js 以 ?raw 形式在构建时内联（electron-vite 支持），运行于渲染层插件运行时。
import galleryMain from './gallery/main.js?raw'

export const GALLERY_MANIFEST: Record<string, unknown> = {
  id: 'pupurin-gallery',
  name: '画廊',
  version: '1.2.2',
  description: '内置画廊：管理 CG 与差分，任何修改实时保存 Ren' + "'" + 'Py 官方 Gallery 代码到项目；自动从代码/导入项目同步',
  author: 'Pupurin° Loom',
  main: 'main.js',
  builtin: true,
}

export { galleryMain }
