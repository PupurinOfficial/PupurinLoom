import { create } from 'zustand'
import type { LabelNode, FlowEdge, LogEntry, BackendStatus, ConsoleFilter, ProjectMeta, CharacterMeta, VariableMeta, StoryItem, SelectionState, EditorViewMode, VariableUsage, ProjectParseResult } from '../types'

export type ViewId = 'home' | 'flowchart' | 'script' | 'characters' | 'variables' | 'package' | 'resources' | 'plugins' | 'ui'

interface LoomState {
  labels: LabelNode[]
  edges: FlowEdge[]
  source: string
  selectedLabelId: string | null
  logs: LogEntry[]
  status: BackendStatus | null
  loading: boolean
  error: string | null
  activeView: ViewId
  consoleOpen: boolean
  consoleFilter: ConsoleFilter
  autoScroll: boolean
  dialogueChars: number
  // 项目
  currentProject: ProjectMeta | null
  projects: ProjectMeta[]
  // 角色
  characters: CharacterMeta[]
  selectedCharId: string | null
  // 变量
  variables: VariableMeta[]
  selectedVarId: string | null
  // 剧情编辑器
  storyItems: StoryItem[]
  selection: SelectionState
  editorViewMode: EditorViewMode
  sourceModified: boolean
  currentFilePath: string
  // 当前织机打开的是否为故事文件（功能栏属性图标仅在故事文件时显示）
  isStoryFile: boolean
  // 全项目聚合数据（跨文件导航 / 悬空跳转 / 条件变量引用）
  projectLabels: LabelNode[]
  projectEdges: FlowEdge[]
  variableUsages: VariableUsage[]
  // 待处理的跨文件导航请求（file + 目标行号）
  pendingNav: { file: string; line: number } | null
  // 待打开的剧本文件（从资源管理器发起，切到织机后加载）
  pendingOpenFile: { path: string; isStoryFile: boolean } | null
  // 待显示的资源文件（全局搜索非剧本/代码结果 → 资源管理器定位并预览）
  pendingRevealFile: { path: string } | null
  // 搜索跳转请求（全局搜索 → 打开文件并高亮该行文本）
  searchNav: { file: string; line: number; col: number; text: string; isStoryFile: boolean } | null
  // 右侧功能栏：当前展开的功能侧边栏 id（null = 全部收起，至多 1 个展开）
  sidebarFeature: string | null
  // 待选中的插件 id（功能栏右键「前往插件」→ 切到插件页并选中）
  pendingPluginId: string | null
  // 切到插件商城 tab 的信号（菜单「帮助 → 插件商城」→ 插件页切到商城 tab）
  pendingStoreTab: number
  // images/ 图片列表刷新信号：上传/删除图片后 bump，令 useOtherImages 等重新扫描
  imagesTick: number
  // 窗口是否全屏（共享给各页面 header 决定是否给红绿灯留位）
  isFullscreen: boolean

  setParse: (r: { labels: LabelNode[]; edges: FlowEdge[]; full_source: string; dialogue_chars: number }) => void
  setSource: (s: string) => void
  selectLabel: (id: string | null) => void
  addLog: (log: LogEntry) => void
  clearLogs: () => void
  setStatus: (s: BackendStatus | null) => void
  setLoading: (b: boolean) => void
  setError: (e: string | null) => void
  setActiveView: (v: ViewId) => void
  setConsoleOpen: (b: boolean) => void
  setConsoleFilter: (f: ConsoleFilter) => void
  setAutoScroll: (b: boolean) => void
  setProjects: (p: ProjectMeta[]) => void
  setCurrentProject: (p: ProjectMeta | null) => void
  setCharacters: (c: CharacterMeta[]) => void
  setSelectedCharId: (id: string | null) => void
  setVariables: (v: VariableMeta[]) => void
  setSelectedVarId: (id: string | null) => void
  setSelection: (s: SelectionState) => void
  setEditorViewMode: (m: EditorViewMode) => void
  setStoryItems: (items: StoryItem[]) => void
  setSourceModified: (modified: boolean) => void
  setCurrentFilePath: (path: string) => void
  setIsStoryFile: (b: boolean) => void
  setProjectParse: (r: ProjectParseResult) => void
  setVariableUsages: (usages: VariableUsage[]) => void
  requestNav: (file: string, line: number) => void
  setPendingNav: (nav: { file: string; line: number } | null) => void
  setPendingOpenFile: (f: { path: string; isStoryFile: boolean } | null) => void
  setPendingRevealFile: (f: { path: string } | null) => void
  setSearchNav: (n: { file: string; line: number; col: number; text: string; isStoryFile: boolean } | null) => void
  setPendingPluginId: (id: string | null) => void
  bumpStoreTab: () => void
  bumpImagesTick: () => void
  setIsFullscreen: (v: boolean) => void
  openSidebar: (id: string) => void
  toggleSidebar: (id: string) => void
  closeSidebar: () => void
}

export const useStore = create<LoomState>((set) => ({
  labels: [],
  edges: [],
  source: '',
  selectedLabelId: null,
  logs: [],
  status: null,
  loading: false,
  error: null,
  activeView: 'home',
  consoleOpen: true,
  consoleFilter: 'all',
  autoScroll: true,
  dialogueChars: 0,
  currentProject: null,
  projects: [],
  characters: [],
  selectedCharId: null,
  variables: [],
  selectedVarId: null,
  storyItems: [],
  selection: { type: null, id: null },
  editorViewMode: 'graphical',
  sourceModified: false,
  currentFilePath: 'script.rpy',
  isStoryFile: true,
  projectLabels: [],
  projectEdges: [],
  variableUsages: [],
  pendingNav: null,
  pendingOpenFile: null,
  pendingRevealFile: null,
  searchNav: null,
  sidebarFeature: null,
  pendingPluginId: null,
  pendingStoreTab: 0,
  imagesTick: 0,
  isFullscreen: false,

  setParse: (r) =>
    set({ labels: r.labels, edges: r.edges, source: r.full_source, dialogueChars: r.dialogue_chars }),
  setSource: (s) => set({ source: s }),
  selectLabel: (id) => set({ selectedLabelId: id }),
  addLog: (log) =>
    set((st) => ({ logs: [...st.logs.slice(-200), log] })),
  clearLogs: () => set({ logs: [] }),
  setStatus: (s) => set({ status: s }),
  setLoading: (b) => set({ loading: b }),
  setError: (e) => set({ error: e }),
  setActiveView: (v) => set({ activeView: v }),
  setConsoleOpen: (b) => set({ consoleOpen: b }),
  setConsoleFilter: (f) => set({ consoleFilter: f }),
  setAutoScroll: (b) => set({ autoScroll: b }),
  setProjects: (p) => set({ projects: p }),
  setCurrentProject: (p) => set({ currentProject: p }),
  setCharacters: (c) => set({ characters: c }),
  setSelectedCharId: (id) => set({ selectedCharId: id }),
  setVariables: (v) => set({ variables: v }),
  setSelectedVarId: (id) => set({ selectedVarId: id }),
  setSelection: (s) => set({ selection: s }),
  setEditorViewMode: (m) => set({ editorViewMode: m }),
  setStoryItems: (items) => set({ storyItems: items }),
  setSourceModified: (modified) => set({ sourceModified: modified }),
  setCurrentFilePath: (path) => set({ currentFilePath: path }),
  setIsStoryFile: (b) => set({ isStoryFile: b }),
  setProjectParse: (r) => set({ projectLabels: r.labels, projectEdges: r.edges }),
  setVariableUsages: (usages) => set({ variableUsages: usages }),
  requestNav: (file, line) => set({ pendingNav: { file, line } }),
  setPendingNav: (nav) => set({ pendingNav: nav }),
  setPendingOpenFile: (f) => set({ pendingOpenFile: f }),
  setPendingRevealFile: (f) => set({ pendingRevealFile: f }),
  setSearchNav: (n) => set({ searchNav: n }),
  setPendingPluginId: (id) => set({ pendingPluginId: id }),
  bumpStoreTab: () => set((st) => ({ pendingStoreTab: st.pendingStoreTab + 1 })),
  bumpImagesTick: () => set((st) => ({ imagesTick: st.imagesTick + 1 })),
  setIsFullscreen: (v) => set({ isFullscreen: v }),
  openSidebar: (id) => set({ sidebarFeature: id }),
  toggleSidebar: (id) => set((st) => ({ sidebarFeature: st.sidebarFeature === id ? null : id })),
  closeSidebar: () => set({ sidebarFeature: null }),
}))
