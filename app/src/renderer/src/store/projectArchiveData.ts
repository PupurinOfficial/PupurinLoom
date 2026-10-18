// 项目归档的 Loom 侧数据：localStorage 快照的收集与回填
//
// 项目级配置的 key 一律形如「前缀:项目绝对路径」（如 loom-versions:/Users/x/项目），
// 因此按路径扫描所有 key 即可，无需硬编码清单 —— 将来新增项目级配置会自动被包含。
//
// 导出时把路径替换为占位符 {PROJECT} 存入归档 manifest；导入后换回新路径写回，
// 使版本方案、标签色、项目简介、来点灵感、打包配置等随项目一起迁移。

const PATH_TOKEN = '{PROJECT}'

/** 收集当前项目中所有项目级 localStorage 配置（key 模板 → 原始字符串值） */
export function collectLoomData(projectPath: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!projectPath || typeof localStorage === 'undefined') return out
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i)
      if (!key || !key.includes(projectPath)) continue
      const value = localStorage.getItem(key)
      if (value === null) continue
      out[key.split(projectPath).join(PATH_TOKEN)] = value
    }
  } catch {
    /* localStorage 不可用时返回空快照 */
  }
  return out
}

/** 把归档中的 Loom 侧配置写回到新项目路径；返回写入的条目数 */
export function restoreLoomData(projectPath: string, data: Record<string, string> | undefined): number {
  if (!projectPath || !data) return 0
  let n = 0
  try {
    for (const [tpl, value] of Object.entries(data)) {
      const key = tpl.split(PATH_TOKEN).join(projectPath)
      localStorage.setItem(key, value)
      n++
    }
  } catch {
    /* ignore */
  }
  return n
}
