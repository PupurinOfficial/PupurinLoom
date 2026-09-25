// 官网站点配置 —— 所有可编辑内容集中于此
export const site = {
  name: '铃言织机°',
  nameEn: 'Pupurin° Loom',
  slogan: '以言为线，铃织成篇',
  description: '可视化 Ren\'Py 开发工具 · A Pupurin° Project · 仆仆铃°工作室',
  // 版本号：构建时由 CI 从 GitHub Releases 自动注入（PUBLIC_APP_VERSION），本地开发/构建失败时回退到写死值
  version: import.meta.env.PUBLIC_APP_VERSION || '0.5.0',
  license: 'MIT License',
  // 图片素材：放入 public/images/ 后在此填写对应路径（以站点 base 开头），留空则隐藏图片位
  images: {
    hero: '/PupurinLoom/images/hero.png', // Hero 区产品截图（织机页）
    showcase: '/PupurinLoom/images/showcase.png', // 特性区展示图（主页）
  },
  urls: {
    appRepo: 'https://github.com/PupurinOfficial/PupurinLoom',
    releases: 'https://github.com/PupurinOfficial/PupurinLoom/releases',
    storeRepo: 'https://github.com/PupurinOfficial/Loom-PluginStore',
    contributing: 'https://github.com/PupurinOfficial/Loom-PluginStore/blob/main/CONTRIBUTING.md',
    bilibili: 'https://space.bilibili.com/3546379813129005',
    org: 'https://github.com/PupurinOfficial',
    androidRepo: 'https://github.com/Explore0416/PupurinLoomAndroid',
  },
}

// 下载区轮播「特点展示」：grad/icon 为视觉字段，其余文案的 en 版见 src/i18n.ts
export interface DownloadSlide {
  grad: string // 渐变配色类（.dl-slide.g1 ~ g4）
  icon: string // Icon.astro 图标名
  t1: string // 大标题第一行
  t2: string // 大标题第二行（强调）
  desc: string // 描述
  extra?: string // 追加脚注（展示为独立小段落）
  link?: { url: string; text: string } // 描述后的链接
}
export const downloadSlides: DownloadSlide[] = [
  {
    grad: 'g1',
    icon: 'magic',
    t1: '轻松上手',
    t2: '织机°势在必得',
    desc: '以图形化的方式编辑剧本、设计UI、管理变量…\n轻松上手制作Galgame，铃言织机°势在必得。',
  },
  {
    grad: 'g2',
    icon: 'cog',
    t1: '专器专用',
    t2: "Ren'py不在话下",
    desc: "Ren'py是专为视觉小说设计的引擎，内置了几乎所有核心功能。对话框、存读档、分支选项等，统统不在话下。",
  },
  {
    grad: 'g3',
    icon: 'globe',
    t1: '全平台*传播',
    t2: 'ぜんぜん大丈夫',
    desc: '使用织机°内置的一键打包，将您的作品发布至Windows、macOS、Linux、Android、iOS，还有Web端。\n*不支持鸿蒙系统',
  },
  {
    grad: 'g4',
    icon: 'phone',
    t1: '手机做Galgame',
    t2: '织机°能行',
    desc: '第三方安卓测试版现已上线，前往仓库：',
    extra:
      '° 安卓版由第三方提供技术支持与维护，\n仆仆铃°工作室不对其更新、安全性、完整性、可运行性等任何内容作保证。',
    link: { url: 'https://github.com/Explore0416/PupurinLoomAndroid', text: 'Explore0416/PupurinLoomAndroid' },
  },
]

export interface Feature {
  icon: string // 图标 id（见 global.css 中 .ico-* 内联 svg）
  title: string
  desc: string
}

export const features: Feature[] = [
  {
    icon: 'edit',
    title: '图形 / 代码双模式',
    desc: '图形画布与 Monaco 代码编辑器实时同步，尊重并保留剧本原始缩进。',
  },
  {
    icon: 'graph',
    title: '跨文件剧本解析',
    desc: 'label 跳转、悬空引用、条件变量跨文件联动解析，错误早发现。',
  },
  {
    icon: 'user',
    title: '角色与差分管理',
    desc: '角色、差分定义与应用内 script.rpy 自动同步，立绘声明不再手写。',
  },
  {
    icon: 'database',
    title: '变量管理',
    desc: '定义与默认值集中管理，条件变量跨文件解析联动，脚本引用自动同步。',
  },
  {
    icon: 'folder',
    title: '资源管理器',
    desc: '拖拽移动资源、批量重命名并同步脚本引用，内置 Ren\'Py ASCII 命名校验。',
  },
  {
    icon: 'puzzle',
    title: '插件系统',
    desc: '命令、面板、事件钩子与功能侧边栏，附插件商城，生态自由生长。',
  },
  {
    icon: 'box',
    title: '一键打包发布',
    desc: '集成 Ren\'Py SDK，打包发行版一气呵成，从剧本到成品只差一次点击。',
  },
  {
    icon: 'terminal',
    title: '本地 Python 后端',
    desc: '语法解析与统计在本地运行，不传云端，剧本与数据全程留在你的电脑。',
  },
]

export interface Plugin {
  id: string
  icon: string
  name: string
  desc: string
}

export const plugins: Plugin[] = [
  { id: 'script-stats', icon: 'chart', name: '剧本统计器', desc: '字数、对话/旁白占比与各角色台词数量一览。' },
  { id: 'story-ai', icon: 'spark', name: 'AI 台词灵感', desc: '输入场景描述，生成角色台词草稿。' },
  { id: 'tts-reader', icon: 'voice', name: '朗读助手 TTS', desc: '系统 TTS 朗读台词，零依赖。' },
  { id: 'meow-loom', icon: 'paw', name: '喵喵语', desc: '内置示例插件：整个界面都会喵喵喵。' },
  { id: 'weiyan-weiyu', icon: 'bubble', name: '未言未语', desc: '界面文字全员「未言未语」，哒拾叭木有嘛。' },
]

export interface Step {
  title: string
  desc: string
}

export const steps: Step[] = [
  { title: '安装应用与依赖', desc: '前往 GitHub Releases 下载应用安装包，并按需安装 Ren\'Py SDK 以支持运行与打包。' },
  { title: '创建或导入项目', desc: '新建 Ren\'Py 项目，或直接导入已有的剧本目录。' },
  { title: '编辑剧本', desc: '图形画布拖拽编排剧情，或切换到代码模式精细修改。' },
  { title: '打包发布', desc: '指定 Ren\'Py SDK，一键打包成可发行的游戏版本。' },
]

export const nav = [
  { id: 'features', label: '特性' },
  { id: 'download', label: '下载' },
  { id: 'plugins', label: '插件' },
  { id: 'guide', label: '快速上手' },
  { id: 'about', label: '关于' },
]
