import { useState, useEffect } from 'react'

// 模块级缓存：key = "projectPath:subPath" → 时长（秒）
const durationCache = new Map<string, number>()

// 加载项目内音频（相对 game/ 的路径），返回时长（秒）
export function useProjectAudioDuration(projectPath: string, subPath: string | null | undefined): number | null {
  const [duration, setDuration] = useState<number | null>(null)

  useEffect(() => {
    if (!projectPath || !subPath) {
      setDuration(null)
      return
    }

    const cacheKey = `${projectPath}:${subPath}`
    const cached = durationCache.get(cacheKey)
    if (cached !== undefined) {
      setDuration(cached)
      return
    }

    let cancelled = false
    let audio: HTMLAudioElement | null = null
    const targetPath = subPath

    async function load(): Promise<void> {
      try {
        const url = await window.pupurin.readAudioBase64(projectPath, targetPath)
        if (cancelled) return

        audio = new Audio()
        const onMeta = (): void => {
          if (cancelled) return
          const d = Number.isFinite(audio?.duration) ? (audio?.duration ?? 0) : 0
          durationCache.set(cacheKey, d)
          setDuration(d)
          audio?.removeEventListener('loadedmetadata', onMeta)
        }
        audio.addEventListener('loadedmetadata', onMeta)
        audio.preload = 'metadata'
        audio.src = url
      } catch {
        if (!cancelled) setDuration(null)
      }
    }

    void load()

    return () => {
      cancelled = true
      audio?.removeAttribute('src')
    }
  }, [projectPath, subPath])

  return duration
}
