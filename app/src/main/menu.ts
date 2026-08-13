import { app, Menu, shell, type BrowserWindow, type MenuItemConstructorOptions } from 'electron'

// macOS 系统菜单栏（应用顶部）
// 所有「自定义动作」菜单项统一通过 webContents.send('menu:action', { id }) 派发给渲染层，
// 渲染层 App.tsx 中按 id 分发到对应操作。radio 视图菜单的勾选状态由渲染层 activeView 回传同步。

export type LoomViewId = 'home' | 'script' | 'characters' | 'variables' | 'resources' | 'package' | 'plugins' | 'ui'

const VIEWS: Array<{ id: LoomViewId; label: string }> = [
  { id: 'home', label: '主页' },
  { id: 'script', label: '织机' },
  { id: 'characters', label: '角色' },
  { id: 'variables', label: '变量' },
  { id: 'resources', label: '资源管理器' },
  { id: 'package', label: '打包' },
  { id: 'plugins', label: '插件' },
  { id: 'ui', label: 'UI 设计器' },
]

export function buildApplicationMenu(win: BrowserWindow): void {
  const send = (id: string) => (): void => {
    if (!win.isDestroyed()) win.webContents.send('menu:action', { id })
  }
  const isMac = process.platform === 'darwin'

  const template: MenuItemConstructorOptions[] = [
    // 应用菜单（macOS 惯例：首个菜单为应用名）
    ...(isMac
      ? ([
          {
            label: app.name,
            submenu: [
              { role: 'about', label: `关于 ${app.name}` },
              { type: 'separator' },
              { role: 'services', label: '服务' },
              { type: 'separator' },
              { role: 'hide', label: `隐藏 ${app.name}` },
              { role: 'hideOthers', label: '隐藏其他' },
              { role: 'unhide', label: '全部显示' },
              { type: 'separator' },
              { role: 'quit', label: `退出 ${app.name}` },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),
    {
      label: '文件',
      submenu: [
        { label: '返回项目选择', accelerator: 'CmdOrCtrl+Shift+O', click: send('backToProjects') },
        // 保存：不设加速键（渲染层已有 ⌘S 快捷键处理，避免双触发）
        { label: '保存', click: send('save') },
        { type: 'separator' },
        { label: '在 Finder 中显示', accelerator: 'CmdOrCtrl+Shift+F', click: send('showInFinder') },
        ...(isMac
          ? []
          : ([{ type: 'separator' }, { role: 'quit', label: '退出' }] as MenuItemConstructorOptions[])),
      ],
    },
    {
      label: '视图',
      submenu: [
        ...VIEWS.map(
          (v) =>
            ({
              label: v.label,
              type: 'radio',
              id: `view:${v.id}`,
              click: send(`view:${v.id}`),
            }) as MenuItemConstructorOptions
        ),
        { type: 'separator' },
        { label: '重新解析', click: send('reparse') },
        { label: '切换主题', click: send('toggleTheme') },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: '运行',
      submenu: [{ label: '运行游戏', accelerator: 'CmdOrCtrl+R', click: send('runGame') }],
    },
    { role: 'windowMenu', label: '窗口' },
    {
      label: '帮助',
      submenu: [
        { label: '打开插件目录', click: send('openPluginsDir') },
        { label: '插件商城', click: send('openStore') },
        {
          label: '插件提交指南',
          click: () => {
            void shell.openExternal(
              'https://github.com/PupurinOfficial/Loom-PluginStore/blob/main/CONTRIBUTING.md'
            )
          },
        },
      ],
    },
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

// 渲染层 activeView 变化时同步视图菜单的 radio 勾选
export function setViewMenu(view: string): void {
  const menu = Menu.getApplicationMenu()
  if (!menu) return
  const viewMenu = menu.items.find((i) => i.label === '视图')
  if (!viewMenu?.submenu) return
  for (const sub of viewMenu.submenu.items) {
    if (sub.type === 'radio' && sub.id === `view:${view}`) {
      sub.checked = true
    }
  }
}
