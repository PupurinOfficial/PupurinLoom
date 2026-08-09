import { useState, useEffect } from 'react'

// 模块级缓存：key = "projectPath:subPath" → dataUrl（空字符串表示已查询但未找到）
const cache = new Map<string, string>()

// 加载项目内图片（相对 game/ 的路径），返回 base64 dataUrl
export function useProjectImage(projectPath: string, subPath: string | null | undefined): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath || !subPath) {
      setDataUrl(null)
      return
    }

    const cacheKey = `${projectPath}:${subPath}`
    const cached = cache.get(cacheKey)
    if (cached !== undefined) {
      setDataUrl(cached || null)
      return
    }

    let cancelled = false
    window.pupurin
      .readImageBase64(projectPath, subPath)
      .then((url) => {
        if (cancelled) return
        cache.set(cacheKey, url)
        setDataUrl(url)
      })
      .catch(() => {
        if (cancelled) return
        cache.set(cacheKey, '')
        setDataUrl(null)
      })

    return () => {
      cancelled = true
    }
  }, [projectPath, subPath])

  return dataUrl
}

// 尝试多个路径加载图片（用于背景等需要猜测路径的场景）
export function useProjectImagePaths(projectPath: string, subPaths: string[]): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    if (!projectPath || subPaths.length === 0) {
      setDataUrl(null)
      return
    }

    let cancelled = false

    async function tryLoad(): Promise<void> {
      for (const subPath of subPaths) {
        if (!subPath) continue
        const cacheKey = `${projectPath}:${subPath}`
        const cached = cache.get(cacheKey)
        if (cached) {
          if (!cancelled) setDataUrl(cached)
          return
        }
        if (cached === '') continue // 已查询过，不存在

        try {
          const url = await window.pupurin.readImageBase64(projectPath, subPath)
          if (cancelled) return
          cache.set(cacheKey, url)
          setDataUrl(url)
          return
        } catch {
          cache.set(cacheKey, '')
        }
      }
      if (!cancelled) setDataUrl(null)
    }

    void tryLoad()
    return () => {
      cancelled = true
    }
  }, [projectPath, subPaths.join('|')])

  return dataUrl
}
