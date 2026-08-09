// 官网 i18n 词典：zh 由 config.ts 派生（保证与静态渲染一致），en 手工维护。
// 运行时由 src/scripts/i18n.ts 通过 [data-i18n] 属性切换文案。
import { site, nav, features, steps } from './config'

export type Lang = 'zh' | 'en'

const zh: Record<string, string> = {
  // 导航
  'hero.download': '立即下载',
  'hero.guide': '快速上手',
  // 特性区
  'features.title': '特性',
  'features.sub': '围绕 Ren\'Py 剧本创作打造的完整工作台 —— 从剧情编排到打包发行。',
  // 下载区
  'download.title': '下载',
  'download.sub': '跨平台可视化 Ren\'Py 开发工具，支持 macOS 与 Windows。',
  'download.latest': '最新稳定版',
  'download.all': '全部版本',
  'download.dmg': '.dmg 安装包',
  'download.exe': '.exe 安装包',
  'download.note':
    '安装后应用内置「检查更新」：自动对比官方 Releases，发现新版本会展示更新详情并引导下载安装。所有发行包均在 GitHub Releases 提供，欢迎前往查看更新说明与历史版本。',
  // 插件区
  'plugins.title': '插件生态',
  'plugins.sub':
    '应用内置插件系统：命令、面板、事件钩子与右侧功能栏，还能通过插件商城一键安装社区插件。以下插件列表实时读取插件商城仓库数据。',
  'plugins.store': '插件商城',
  'plugins.contribute': '提交插件（贡献指南）',
  // 快速上手
  'guide.title': '快速上手',
  'guide.sub': '从安装到发布，四步就能织出你的第一部视觉小说。',
  // 关于
  'about.title': '关于',
  'about.subtitle': '仆仆铃°工作室',
  'about.qq': '腾讯频道',
  // 页脚
  'footer.studio': '仆仆铃°工作室',
}

// 从 config 派生的 zh 文案（与静态渲染完全一致）
nav.forEach((n) => {
  zh[`nav.${n.id}`] = n.label
})
zh['site.name'] = site.name
zh['hero.slogan'] = `「${site.slogan}」`
zh['hero.desc'] = site.description
zh['about.p1'] = `${site.name}（${site.nameEn}）是仆仆铃°工作室出品的可视化 Ren'Py 开发工具，以「${site.slogan}」为理念，希望让文字冒险游戏的创作像织布一样从容。`
zh['about.p2'] = `项目以 ${site.license} 开源，代码与发行版均托管在 GitHub；插件生态经由独立仓库维护，欢迎任何人提交插件。`
features.forEach((f) => {
  zh[`feature.${f.icon}.title`] = f.title
  zh[`feature.${f.icon}.desc`] = f.desc
})
steps.forEach((s, i) => {
  zh[`step.${i}.title`] = s.title
  zh[`step.${i}.desc`] = s.desc
})

const en: Record<string, string> = {
  // 产品名：英文下译为 Pupurin° Loom
  'site.name': 'Pupurin° Loom',
  // 导航
  'nav.features': 'Features',
  'nav.download': 'Download',
  'nav.plugins': 'Plugins',
  'nav.guide': 'Quick Start',
  'nav.about': 'About',
  // Hero
  'hero.slogan': '「Pupurin spins, stories begin.」',
  'hero.desc': "Visual Ren'Py development tool · A Pupurin° Project",
  'hero.download': 'Download',
  'hero.guide': 'Quick Start',
  // 特性区
  'features.title': 'Features',
  'features.sub':
    'A complete workbench for crafting Ren\'Py stories — from plot design to packaging and release.',
  'feature.edit.title': 'Graph / Code Dual Mode',
  'feature.edit.desc':
    'The visual canvas and the Monaco code editor stay in sync in real time, preserving the original indentation of your script.',
  'feature.graph.title': 'Cross-file Script Analysis',
  'feature.graph.desc':
    'Label jumps, dangling references, and conditional variables are resolved across files — catch errors early.',
  'feature.user.title': 'Character & Sprite Management',
  'feature.user.desc':
    'Character and sprite definitions sync automatically with your script.rpy — no more hand-writing image declarations.',
  'feature.database.title': 'Variable Management',
  'feature.database.desc':
    'Centralized definitions and default values, cross-file conditional variable resolution, and automatic script reference sync.',
  'feature.folder.title': 'Resource Manager',
  'feature.folder.desc':
    'Drag-and-drop to move assets, batch rename with automatic script reference updates, and built-in Ren\'Py ASCII naming validation.',
  'feature.puzzle.title': 'Plugin System',
  'feature.puzzle.desc':
    'Commands, panels, event hooks, and a feature sidebar — plus a plugin store for an ecosystem that grows freely.',
  'feature.box.title': 'One-click Packaging',
  'feature.box.desc':
    'Integrated Ren\'Py SDK — package a distributable build with a single click, from script to finished product.',
  'feature.terminal.title': 'Local Python Backend',
  'feature.terminal.desc':
    'Parsing and statistics run locally, never uploaded — your scripts and data stay on your machine.',
  // 下载区
  'download.title': 'Download',
  'download.sub': 'A cross-platform visual Ren\'Py development tool for macOS and Windows.',
  'download.latest': 'Latest stable release',
  'download.all': 'All versions',
  'download.dmg': '.dmg installer',
  'download.exe': '.exe installer',
  'download.note':
    'The app includes a built-in update checker: it compares against official Releases automatically and guides you to download new versions. All packages are provided on GitHub Releases — check release notes and past versions there.',
  // 插件区
  'plugins.title': 'Plugin Ecosystem',
  'plugins.sub':
    'A built-in plugin system: commands, panels, event hooks, and a feature sidebar — install community plugins from the store in one click. The plugin list below reads from the plugin store repository in real time.',
  'plugins.store': 'Plugin Store',
  'plugins.contribute': 'Submit a Plugin (Contributing)',
  // 快速上手
  'guide.title': 'Quick Start',
  'guide.sub': 'From installation to release — four steps to weave your first visual novel.',
  'step.0.title': 'Install the App & Dependencies',
  'step.0.desc':
    'Download the app from GitHub Releases and install the Ren\'Py SDK as needed to run and package your game.',
  'step.1.title': 'Create or Import a Project',
  'step.1.desc':
    'Create a new Ren\'Py project, or import an existing script directory directly.',
  'step.2.title': 'Write Your Script',
  'step.2.desc':
    'Arrange your story on the canvas, or switch to code mode for fine-grained edits.',
  'step.3.title': 'Package & Release',
  'step.3.desc':
    'Point to your Ren\'Py SDK and package a distributable game in one click.',
  // 关于
  'about.title': 'About',
  'about.subtitle': 'Pupurin°',
  'about.p1':
    'Pupurin° Loom is a visual Ren\'Py development tool by Pupurin°, with the motto 「Pupurin spins, stories begin.」 — making visual novel creation as effortless as weaving.',
  'about.p2':
    'Open-sourced under the MIT License, the code and releases are hosted on GitHub; the plugin ecosystem lives in a separate repository — contributions are welcome.',
  'about.qq': 'Tencent Channel',
  // 页脚
  'footer.studio': 'Pupurin°',
}

export const messages: Record<Lang, Record<string, string>> = { zh, en }
