import { create } from 'zustand'

// 资源详情（功能栏）：资源管理器选中文件后，把预览数据放到这里供功能栏渲染。
// 避免把大段预览逻辑写进通用侧边栏容器，各页面只负责「选中 → 加载 → show」。

export interface ResourcePreviewData {
  name: string
  path: string
  isStoryFile: boolean
  isDir: boolean
  type: 'image' | 'text' | 'binary'
  content: string
}

interface ResourcePreviewState {
  data: ResourcePreviewData | null
  loading: boolean
  show: (d: ResourcePreviewData) => void
  setLoading: (b: boolean) => void
  clear: () => void
}

export const useResourcePreview = create<ResourcePreviewState>((set) => ({
  data: null,
  loading: false,
  show: (d) => set({ data: d, loading: false }),
  setLoading: (b) => set({ loading: b }),
  clear: () => set({ data: null, loading: false }),
}))
