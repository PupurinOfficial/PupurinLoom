import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { VariableMeta, VariableType } from '../types'

// 内联 prompt 模态框配置
interface PromptConfig {
  title: string
  placeholder: string
  defaultValue: string
  onSubmit: (value: string) => void | Promise<void>
}

export default function VariablePage() {
  const variables = useStore((s) => s.variables)
  const setVariables = useStore((s) => s.setVariables)
  const selectedVarId = useStore((s) => s.selectedVarId)
  const setSelectedVarId = useStore((s) => s.setSelectedVarId)
  const currentProject = useStore((s) => s.currentProject)
  // 反向引用：if/elif 条件中使用该变量的位置（聚合解析）
  const variableUsages = useStore((s) => s.variableUsages)
  const setActiveView = useStore((s) => s.setActiveView)
  const requestNav = useStore((s) => s.requestNav)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [promptCfg, setPromptCfg] = useState<PromptConfig | null>(null)
  const [promptValue, setPromptValue] = useState('')

  const projectPath = currentProject?.path ?? ''

  // 打开 prompt 模态框
  function openPrompt(cfg: PromptConfig): void {
    setPromptValue(cfg.defaultValue)
    setPromptCfg(cfg)
  }

  // 确认提交
  async function confirmPrompt(): Promise<void> {
    if (!promptCfg) return
    const v = promptValue
    setPromptCfg(null)
    setPromptValue('')
    if (v.trim()) {
      await promptCfg.onSubmit(v.trim())
    }
  }

  // 取消
  function cancelPrompt(): void {
    setPromptCfg(null)
    setPromptValue('')
  }

  // 加载变量数据
  async function loadVariables(): Promise<void> {
    if (!projectPath) return
    setBusy(true)
    try {
      const list = await window.pupurin.loadVariables(projectPath)
      setVariables(list)
      if (list.length > 0 && !list.find((v) => v.id === selectedVarId)) {
        setSelectedVarId(list[0].id)
      }
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void loadVariables()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath])

  // 保存
  async function save(): Promise<void> {
    if (!projectPath) return
    setBusy(true)
    setErr(null)
    try {
      await window.pupurin.saveVariables(projectPath, variables)
      setDirty(false)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  // 更新单个变量
  function updateVar(id: string, patch: Partial<VariableMeta>): void {
    setVariables(variables.map((v) => (v.id === id ? { ...v, ...patch } : v)))
    setDirty(true)
  }

  // 新建变量
  function handleNew(): void {
    openPrompt({
      title: '变量名称',
      placeholder: '新变量',
      defaultValue: '新变量',
      onSubmit: async (name) => {
        const v = await window.pupurin.newVariable(name)
        setVariables([...variables, v])
        setSelectedVarId(v.id)
        setDirty(true)
      }
    })
  }

  // 删除变量
  function handleDelete(id: string, name: string): void {
    if (!confirm(`删除变量「${name}」？`)) return
    const remaining = variables.filter((v) => v.id !== id)
    setVariables(remaining)
    if (selectedVarId === id) {
      setSelectedVarId(remaining[0]?.id ?? null)
    }
    setDirty(true)
  }

  // 从 script.rpy 解析变量
  async function handleParseFromScript(): Promise<void> {
    if (!projectPath) return
    setBusy(true)
    setErr(null)
    try {
      const list = await window.pupurin.parseVariablesFromScript(projectPath)
      setVariables(list)
      setDirty(true)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  const selected = variables.find((v) => v.id === selectedVarId) ?? null

  // 类型选项
  const typeOptions: { value: VariableType; label: string }[] = [
    { value: 'int', label: '整数 (int)' },
    { value: 'float', label: '浮点数 (float)' },
    { value: 'str', label: '字符串 (str)' },
    { value: 'bool', label: '布尔值 (bool)' },
  ]

  return (
    <div className="flex h-full">
      {/* 左侧：变量列表 */}
      <aside className="w-56 flex flex-col bg-loom-panel border-r border-loom-border">
        <div className="flex items-center justify-between px-3 py-2 border-b border-loom-border">
          <span className="text-xs font-semibold text-loom-text">变量列表</span>
          <button
            onClick={handleNew}
            title="新建变量"
            className="w-5 h-5 flex items-center justify-center rounded bg-loom-accent/20 text-loom-accent hover:bg-loom-accent/30 text-xs"
          >
            +
          </button>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {variables.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-loom-muted">暂无变量</div>
          ) : (
            variables.map((v) => (
              <button
                key={v.id}
                onClick={() => setSelectedVarId(v.id)}
                className={[
                  'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
                  v.id === selectedVarId
                    ? 'bg-loom-panel2 border-l-2 border-loom-accent'
                    : 'border-l-2 border-transparent hover:bg-loom-panel2/50'
                ].join(' ')}
              >
                <div className="w-8 h-8 flex items-center justify-center rounded bg-loom-accent/10 text-loom-accent font-mono text-sm">
                  {v.type === 'int' && '∫'}
                  {v.type === 'float' && 'ƒ'}
                  {v.type === 'str' && 'S'}
                  {v.type === 'bool' && '?'}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate text-loom-text">
                    {v.name}
                  </div>
                  <div className="text-[10px] text-loom-muted font-mono truncate">
                    {v.varName || '—'} · {v.type}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      {/* 右侧：编辑区 */}
      <div className="flex-1 min-w-0 overflow-auto">
        {selected ? (
          <div className="p-6 max-w-2xl">
            {/* 顶部操作 */}
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-semibold">{selected.name}</h2>
              <div className="flex items-center gap-2">
                {dirty && (
                  <span className="text-[11px] text-loom-accent font-mono">● 未保存</span>
                )}
                <button
                  onClick={save}
                  disabled={busy || !dirty}
                  className="px-3 py-1 text-xs rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 disabled:opacity-40 transition-opacity"
                >
                  {busy ? '保存中…' : '保存'}
                </button>
                <button
                  onClick={() => handleDelete(selected.id, selected.name)}
                  className="px-3 py-1 text-xs rounded bg-loom-err/20 text-loom-err hover:bg-loom-err/30 transition-colors"
                >
                  删除
                </button>
              </div>
            </div>

            {err && (
              <div className="mb-4 px-3 py-2 rounded bg-loom-err/15 border border-loom-err/40 text-loom-err text-sm">
                {err}
              </div>
            )}

            {/* 基本信息 */}
            <section className="mb-6 space-y-4">
              <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide">基本信息</h3>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-loom-muted mb-1">显示名称</label>
                  <input
                    type="text"
                    value={selected.name}
                    onChange={(e) => updateVar(selected.id, { name: e.target.value })}
                    className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm focus:outline-none focus:border-loom-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-loom-muted mb-1">Ren'Py 变量名</label>
                  <input
                    type="text"
                    value={selected.varName}
                    onChange={(e) => updateVar(selected.id, { varName: e.target.value })}
                    placeholder="如 affection、score"
                    className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-loom-accent"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-loom-muted mb-1">类型</label>
                  <select
                    value={selected.type}
                    onChange={(e) => updateVar(selected.id, { type: e.target.value as VariableType })}
                    className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm focus:outline-none focus:border-loom-accent"
                  >
                    {typeOptions.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-loom-muted mb-1">默认值</label>
                  <input
                    type="text"
                    value={selected.defaultValue}
                    onChange={(e) => updateVar(selected.id, { defaultValue: e.target.value })}
                    placeholder={selected.type === 'str' ? '文本内容' : '0'}
                    className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-loom-accent"
                  />
                </div>
              </div>
            </section>

            {/* 简介 */}
            <section className="mb-6">
              <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
                简介
              </h3>
              <textarea
                value={selected.description}
                onChange={(e) => updateVar(selected.id, { description: e.target.value })}
                placeholder="变量用途、取值范围……"
                rows={4}
                className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm focus:outline-none focus:border-loom-accent resize-y"
              />
              {selected.description && (
                <div className="mt-2 px-3 py-2 rounded bg-loom-panel border border-loom-border text-xs font-mono text-loom-muted whitespace-pre-wrap">
                  {selected.description.split('\n').map((line, i) => (
                    <div key={i}># {line}</div>
                  ))}
                </div>
              )}
            </section>

            {/* 条件引用（反向引用） */}
            <section className="mb-6">
              <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
                条件引用（{selected.varName ? variableUsages.filter((u) => u.var === selected.varName).length : 0}）
              </h3>
              {selected.varName && variableUsages.filter((u) => u.var === selected.varName).length > 0 ? (
                <div className="space-y-1">
                  {variableUsages
                    .filter((u) => u.var === selected.varName)
                    .map((u, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setActiveView('script')
                          requestNav(u.file, u.line)
                        }}
                        title="在脚本编辑器中定位"
                        className="w-full text-left px-2.5 py-1.5 rounded bg-loom-panel border border-loom-border hover:border-loom-accent transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-loom-muted font-mono">
                            {u.file}:L{u.line}
                          </span>
                          <span className="text-xs font-mono text-loom-accent truncate">
                            if {u.condition}
                          </span>
                        </div>
                      </button>
                    ))}
                </div>
              ) : (
                <div className="text-[11px] text-loom-muted/60">
                  {selected.varName
                    ? '该变量尚未在任何条件分支中被使用'
                    : "请先填写 Ren'Py 变量名"}
                </div>
              )}
            </section>

            {/* Ren'Py 代码预览 */}
            <section>
              <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
                Ren'Py 代码预览
              </h3>
              <div className="px-3 py-2 rounded bg-loom-panel border border-loom-border text-xs font-mono text-loom-muted">
                <div className="text-loom-accent">default {selected.varName || 'variable'} = {
                  selected.type === 'bool'
                    ? (selected.defaultValue === 'true' ? 'True' : 'False')
                    : selected.type === 'str'
                      ? `"${selected.defaultValue}"`
                      : selected.defaultValue
                }</div>
                {selected.description && (
                  <div className="text-loom-muted mt-1"># {selected.description}</div>
                )}
              </div>
              <p className="mt-2 text-[10px] text-loom-muted/70">
                保存后，这行 default 语句会添加到 script.rpy 顶部
              </p>
            </section>
          </div>
        ) : (
          <div className="h-full flex flex-col items-center justify-center text-loom-muted text-sm gap-3">
            {variables.length === 0 ? (
              <>
                <div>暂无变量</div>
                <div className="flex gap-2">
                  <button
                    onClick={handleNew}
                    className="px-3 py-1.5 text-xs rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90"
                  >
                    创建变量
                  </button>
                  <button
                    onClick={() => void handleParseFromScript()}
                    disabled={busy}
                    className="px-3 py-1.5 text-xs rounded bg-loom-panel2 border border-loom-border hover:bg-loom-border/30 disabled:opacity-40"
                  >
                    {busy ? '解析中…' : '从脚本解析'}
                  </button>
                </div>
              </>
            ) : (
              '选择一个变量'
            )}
          </div>
        )}
      </div>

      {/* 内联 prompt 模态框 */}
      {promptCfg && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
          onClick={cancelPrompt}
        >
          <div
            className="w-80 rounded-lg bg-loom-panel border border-loom-border shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-4 py-3 border-b border-loom-border">
              <span className="text-sm font-semibold text-loom-text">{promptCfg.title}</span>
            </div>
            <div className="p-4">
              <input
                type="text"
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                placeholder={promptCfg.placeholder}
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmPrompt()
                  if (e.key === 'Escape') cancelPrompt()
                }}
                className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm focus:outline-none focus:border-loom-accent"
              />
            </div>
            <div className="flex justify-end gap-2 px-4 py-3 border-t border-loom-border">
              <button
                onClick={cancelPrompt}
                className="px-3 py-1 text-xs rounded text-loom-muted hover:text-loom-text transition-colors"
              >
                取消
              </button>
              <button
                onClick={() => void confirmPrompt()}
                className="px-3 py-1 text-xs rounded bg-loom-accent text-loom-bg font-semibold hover:opacity-90 transition-opacity"
              >
                确定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}