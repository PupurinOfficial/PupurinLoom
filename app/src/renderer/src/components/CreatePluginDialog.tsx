import { useEffect, useState } from 'react'
import type { PluginMeta } from '../types'

interface Props {
  open: boolean
  onClose: () => void
  onCreated: (meta: PluginMeta) => void
}

// 插件 id 规则（与主进程 ID_RE 一致）
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/

// 从插件名称自动推导 id（仅英文/数字有效，中文名回退为提示）
function deriveId(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

// 从官方模板创建插件弹窗（模板来自商城仓库 template/ 目录，随商城一起维护更新）
export default function CreatePluginDialog({ open, onClose, onCreated }: Props) {
  const [name, setName] = useState('')
  const [id, setId] = useState('')
  const [description, setDescription] = useState('')
  const [author, setAuthor] = useState('')
  const [idTouched, setIdTouched] = useState(false)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setId('')
    setDescription('')
    setAuthor('')
    setIdTouched(false)
    setCreating(false)
    setError(null)
  }, [open])

  // 名称变化时自动推导 id（用户手动改过 id 后不再覆盖）
  const onNameChange = (v: string): void => {
    setName(v)
    if (!idTouched) setId(deriveId(v))
  }

  const canSubmit = name.trim().length > 0 && ID_RE.test(id.trim().toLowerCase()) && !creating

  const submit = async (): Promise<void> => {
    if (!canSubmit) return
    setCreating(true)
    setError(null)
    try {
      const r = await window.pupurin.createPlugin({
        id: id.trim().toLowerCase(),
        name: name.trim(),
        description: description.trim(),
        author: author.trim(),
      })
      if (!r.ok || !r.meta) {
        setError(r.error ?? '创建失败，请重试')
        return
      }
      onCreated(r.meta)
    } catch (e) {
      setError('创建失败：' + String(e))
    } finally {
      setCreating(false)
    }
  }

  if (!open) return null

  const inputCls =
    'w-full px-2.5 py-1.5 rounded border border-loom-border bg-loom-bg text-sm text-loom-text placeholder-loom-muted/50 focus:outline-none focus:border-loom-accent/60 transition-colors'
  const labelCls = 'text-xs text-loom-muted mb-1 flex-shrink-0'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="w-[440px] max-w-[94vw] rounded-lg bg-loom-panel border border-loom-border shadow-2xl flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 标题栏 */}
        <div className="px-4 py-3 border-b border-loom-border flex items-center flex-shrink-0">
          <h3 className="text-sm font-semibold">创建插件</h3>
          <span className="ml-2 text-xs text-loom-muted/70">面向开发者 · 从官方模板生成</span>
          <button
            onClick={onClose}
            className="ml-auto p-1 rounded text-loom-muted hover:text-loom-text hover:bg-loom-border/30 transition-colors"
            title="关闭"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" width="16" height="16">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* 表单 */}
        <div className="flex-1 min-h-0 overflow-auto px-4 py-4 space-y-3">
          <div className="flex flex-col gap-1">
            <label className={labelCls}>插件名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="例如：剧本统计器"
              maxLength={50}
              className={inputCls}
              autoFocus
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>插件 id *</label>
            <input
              type="text"
              value={id}
              onChange={(e) => {
                setIdTouched(true)
                setId(e.target.value.toLowerCase())
              }}
              placeholder="小写字母/数字开头，仅含 a-z0-9._-"
              className={`${inputCls} font-mono ${id && !ID_RE.test(id) ? 'border-loom-err/60' : ''}`}
            />
            <span className="text-[10px] text-loom-muted/60">
              由名称自动生成（英文名生效），可手动修改；用于插件目录名，创建后不可更改
            </span>
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>描述</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="这个插件是做什么的？（将写入 manifest.json 与模板头部注释）"
              rows={2}
              maxLength={200}
              className={`${inputCls} resize-none`}
            />
          </div>

          <div className="flex flex-col gap-1">
            <label className={labelCls}>作者</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              placeholder="你的名字 / GitHub 用户名"
              maxLength={40}
              className={inputCls}
            />
          </div>

          <div className="text-[11px] text-loom-muted/70 leading-relaxed pt-1">
            模板（manifest.json + 带 loom API 注释的 main.js 骨架）从官方商城仓库拉取，随商城生态更新；创建后自动信任并启用。
          </div>

          {error && (
            <div className="px-3 py-2 rounded bg-loom-err/15 border border-loom-err/40 text-loom-err text-xs">
              {error}
            </div>
          )}
        </div>

        {/* 底部操作 */}
        <div className="px-4 py-3 border-t border-loom-border flex items-center justify-end gap-2 flex-shrink-0">
          <button
            onClick={onClose}
            disabled={creating}
            className="px-3 py-1.5 rounded bg-loom-panel2 border border-loom-border text-xs hover:bg-loom-border/30 transition-colors disabled:opacity-50"
          >
            取消
          </button>
          <button
            onClick={() => void submit()}
            disabled={!canSubmit}
            className="px-3 py-1.5 rounded bg-loom-accent text-loom-bg text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {creating ? '创建中…' : '创建'}
          </button>
        </div>
      </div>
    </div>
  )
}
