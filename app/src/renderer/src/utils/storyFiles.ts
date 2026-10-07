// 剧情文件收集：递归遍历 .rpy 文件树，返回所有「故事」文件（含至少一个 label 定义）的相对路径
import type { RpyFileNode } from '../types'

export async function listStoryFiles(projectPath: string): Promise<string[]> {
  const tree = await window.pupurin.listRpyFiles(projectPath)
  const out: string[] = []
  const walk = (nodes: RpyFileNode[]): void => {
    for (const n of nodes) {
      if (n.isDir && n.children) walk(n.children)
      else if (n.isStoryFile) out.push(n.path)
    }
  }
  walk(tree)
  return out
}
