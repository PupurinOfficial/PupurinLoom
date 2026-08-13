// Vite/Rollup `?raw` 导入的类型声明（用于内置插件代码内联为字符串）
declare module '*?raw' {
  const src: string
  export default src
}
