// 深层浅合并工具：用于 UI 设计器属性面板的状态补丁合并
// （只合一层嵌套，UiDesignState 的每个子对象都是扁平结构）

export function patchState<T extends object>(state: T, patch: unknown): T {
  if (!patch || typeof patch !== 'object') return state
  const out: Record<string, unknown> = { ...(state as Record<string, unknown>) }
  for (const [k, pv] of Object.entries(patch as Record<string, unknown>)) {
    const sv = out[k]
    if (
      pv &&
      typeof pv === 'object' &&
      !Array.isArray(pv) &&
      sv &&
      typeof sv === 'object' &&
      !Array.isArray(sv)
    ) {
      out[k] = { ...(sv as Record<string, unknown>), ...(pv as Record<string, unknown>) }
    } else {
      out[k] = pv
    }
  }
  return out as T
}
