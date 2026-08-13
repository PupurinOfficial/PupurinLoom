import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import PageHeader from '../components/ui/PageHeader'
import Button from '../components/ui/Button'
import type { VariableMeta, VariableType } from '../types'

// 验证 Python 变量名
function isValidPythonVarName(name: string): boolean {
  if (!name) return false
  // Python 变量名规则：以字母或下划线开头，后面可以是字母、数字或下划线
  const pattern = /^[a-zA-Z_][a-zA-Z0-9_]*$/
  return pattern.test(name)
}

const VARIABLE_TYPES: { value: VariableType; label: string }[] = [
  { value: 'int', label: '整数' },
  { value: 'float', label: '浮点数' },
  { value: 'str', label: '字符串' },
  { value: 'bool', label: '布尔值' },
]

export default function VariablesPage() {
  const currentProject = useStore((s) => s.currentProject)
  const [variables, setVariables] = useState<VariableMeta[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editForm, setEditForm] = useState<{
    name: string
    varName: string
    type: VariableType
    defaultValue: string
    description: string
  }>({
    name: '',
    varName: '',
    type: 'int',
    defaultValue: '',
    description: '',
  })
  const [error, setError] = useState<string | null>(null)

  // 加载变量
  useEffect(() => {
    if (!currentProject?.path) return
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const vars = await window.pupurin.loadVariables(currentProject.path)
        setVariables(vars)
      } catch (e) {
        setError('加载变量失败: ' + String(e))
      } finally {
        setLoading(false)
      }
    })()
  }, [currentProject?.path])

  // 保存变量（主进程会自动同步到 script.rpy）
  async function handleSave(): Promise<void> {
    if (!currentProject?.path) return
    setSaving(true)
    setError(null)
    try {
      await window.pupurin.saveVariables(currentProject.path, variables)
      setEditingId(null)
    } catch (e) {
      setError('保存失败: ' + String(e))
    } finally {
      setSaving(false)
    }
  }

  // 新增变量
  async function handleAdd(): Promise<void> {
    if (!currentProject?.path) return
    try {
      const newVar = await window.pupurin.newVariable('')
      setVariables([...variables, newVar])
      setEditingId(newVar.id)
      setEditForm({
        name: newVar.name,
        varName: newVar.varName,
        type: newVar.type,
        defaultValue: newVar.defaultValue,
        description: newVar.description,
      })
    } catch (e) {
      setError('创建变量失败: ' + String(e))
    }
  }

  // 从脚本解析变量
  async function handleParseFromScript(): Promise<void> {
    if (!currentProject?.path) return
    try {
      const parsedVars = await window.pupurin.parseVariablesFromScript(currentProject.path)
      if (parsedVars.length === 0) {
        setError('未在 script.rpy 中找到 default 语句')
        return
      }
      // 合并解析的变量（保留已有的，添加新的）
      const existingIds = new Set(variables.map((v) => v.id))
      const existingVarNames = new Set(variables.map((v) => v.varName))
      const newVars = parsedVars.filter((v) => !existingVarNames.has(v.varName))
      if (newVars.length === 0) {
        setError('所有变量已存在')
        return
      }
      setVariables([...variables, ...newVars])
      setError(null)
    } catch (e) {
      setError('解析脚本失败: ' + String(e))
    }
  }

  // 开始编辑
  function handleEdit(varItem: VariableMeta): void {
    setEditingId(varItem.id)
    setEditForm({
      name: varItem.name,
      varName: varItem.varName,
      type: varItem.type,
      defaultValue: varItem.defaultValue,
      description: varItem.description || '',
    })
  }

  // 取消编辑
  function handleCancelEdit(): void {
    setEditingId(null)
    setEditForm({
      name: '',
      varName: '',
      type: 'int',
      defaultValue: '',
      description: '',
    })
    setError(null)
  }

  // 确认编辑
  function handleConfirmEdit(): void {
    // 验证变量名
    if (!editForm.varName.trim()) {
      setError('Ren\'Py 变量名不能为空')
      return
    }
    if (!isValidPythonVarName(editForm.varName)) {
      setError('变量名不合法：必须以字母或下划线开头，只能包含字母、数字和下划线')
      return
    }

    // 检查变量名是否重复
    const isDuplicate = variables.some(
      (v) => v.id !== editingId && v.varName === editForm.varName.trim()
    )
    if (isDuplicate) {
      setError('变量名已存在')
      return
    }

    setVariables((vars) =>
      vars.map((v) =>
        v.id === editingId
          ? {
              ...v,
              name: editForm.name.trim() || editForm.varName.trim(),
              varName: editForm.varName.trim(),
              type: editForm.type,
              defaultValue: editForm.defaultValue,
              description: editForm.description.trim(),
            }
          : v
      )
    )
    setEditingId(null)
    setError(null)
  }

  // 删除变量
  function handleDelete(id: string): void {
    setVariables((vars) => vars.filter((v) => v.id !== id))
    if (editingId === id) {
      setEditingId(null)
    }
  }

  // 格式化默认值显示
  function formatDefaultValue(varItem: VariableMeta): string {
    switch (varItem.type) {
      case 'bool':
        return varItem.defaultValue === 'true' ? 'True' : 'False'
      case 'str':
        return `"${varItem.defaultValue}"`
      default:
        return varItem.defaultValue
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* 页头 */}
      <PageHeader
        title="变量管理"
        actions={
          <>
            {error && (
              <span className="text-xs text-loom-err px-2 py-0.5 rounded bg-loom-err/10">
                {error}
              </span>
            )}
            <Button variant="secondary" size="xs" onClick={() => void handleParseFromScript()}>
              从脚本解析
            </Button>
            <Button variant="primary" size="xs" onClick={() => void handleAdd()}>
              + 新增变量
            </Button>
            <Button variant="primary" size="xs" onClick={() => void handleSave()} loading={saving}>
              {saving ? '保存中…' : '保存'}
            </Button>
          </>
        }
      />

      {/* 主内容 */}
      <div className="flex-1 p-6 overflow-auto">
        {loading ? (
          <div className="flex items-center justify-center h-full text-loom-muted text-sm">
            加载中…
          </div>
        ) : variables.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-loom-muted text-sm gap-3">
            <div>暂无变量</div>
            <div className="flex gap-2">
              <button
                onClick={() => void handleParseFromScript()}
                className="px-3 py-1.5 rounded bg-loom-panel border border-loom-border text-loom-text text-xs font-semibold hover:bg-loom-panel2"
              >
                从脚本解析
              </button>
              <button
                onClick={() => void handleAdd()}
                className="px-3 py-1.5 rounded bg-loom-accent text-loom-bg text-xs font-semibold hover:opacity-90"
              >
                + 新增变量
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            {variables.map((varItem) => (
              <div
                key={varItem.id}
                className="bg-loom-panel border border-loom-border rounded-lg p-3"
              >
                {editingId === varItem.id ? (
                  // 编辑模式
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-loom-muted w-24">显示名</label>
                      <input
                        type="text"
                        value={editForm.name}
                        onChange={(e) => setEditForm({ ...editForm, name: e.target.value })}
                        placeholder="显示名（如：好感度）"
                        className="flex-1 bg-loom-bg border border-loom-border rounded px-2 py-1 text-xs text-loom-text"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-loom-muted w-24">
                        Ren'Py 变量名 *
                      </label>
                      <input
                        type="text"
                        value={editForm.varName}
                        onChange={(e) => setEditForm({ ...editForm, varName: e.target.value })}
                        placeholder="变量名（如: affection）"
                        className="flex-1 bg-loom-bg border border-loom-border rounded px-2 py-1 text-xs font-mono text-loom-text"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-loom-muted w-24">类型</label>
                      <select
                        value={editForm.type}
                        onChange={(e) =>
                          setEditForm({
                            ...editForm,
                            type: e.target.value as VariableType,
                            defaultValue:
                              e.target.value === 'bool'
                                ? 'false'
                                : e.target.value === 'str'
                                  ? ''
                                  : '0',
                          })
                        }
                        className="flex-1 bg-loom-bg border border-loom-border rounded px-2 py-1 text-xs text-loom-text"
                      >
                        {VARIABLE_TYPES.map((t) => (
                          <option key={t.value} value={t.value}>
                            {t.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-loom-muted w-24">默认值</label>
                      <input
                        type="text"
                        value={editForm.defaultValue}
                        onChange={(e) => setEditForm({ ...editForm, defaultValue: e.target.value })}
                        placeholder={getDefaultValuePlaceholder(editForm.type)}
                        className="flex-1 bg-loom-bg border border-loom-border rounded px-2 py-1 text-xs font-mono text-loom-text"
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-loom-muted w-24">描述（可选）</label>
                      <input
                        type="text"
                        value={editForm.description}
                        onChange={(e) => setEditForm({ ...editForm, description: e.target.value })}
                        placeholder="变量的描述说明"
                        className="flex-1 bg-loom-bg border border-loom-border rounded px-2 py-1 text-xs text-loom-text"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        onClick={handleCancelEdit}
                        className="px-2 py-1 text-[10px] rounded bg-loom-panel2 text-loom-muted hover:text-loom-text"
                      >
                        取消
                      </button>
                      <button
                        onClick={handleConfirmEdit}
                        className="px-2 py-1 text-[10px] rounded bg-loom-accent text-loom-bg hover:opacity-90"
                      >
                        确认
                      </button>
                    </div>
                  </div>
                ) : (
                  // 显示模式
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-semibold text-loom-text">
                          {varItem.name || <span className="text-loom-muted">(未命名)</span>}
                        </span>
                        <span className="text-xs font-mono text-loom-accent">
                          {varItem.varName}
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-loom-panel2 text-loom-muted">
                          {VARIABLE_TYPES.find((t) => t.value === varItem.type)?.label}
                        </span>
                      </div>
                      <div className="text-xs font-mono text-loom-muted mt-0.5">
                        default {varItem.varName} = {formatDefaultValue(varItem)}
                      </div>
                      {varItem.description && (
                        <div className="text-[11px] text-loom-muted mt-1">
                          {varItem.description}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleEdit(varItem)}
                        className="w-6 h-6 flex items-center justify-center rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-accent hover:border-loom-accent text-xs"
                        title="编辑"
                      >
                        ✎
                      </button>
                      <button
                        onClick={() => handleDelete(varItem.id)}
                        className="w-6 h-6 flex items-center justify-center rounded bg-loom-panel2 border border-loom-border text-loom-muted hover:text-loom-err hover:border-loom-err text-xs"
                        title="删除"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function getDefaultValuePlaceholder(type: VariableType): string {
  switch (type) {
    case 'int':
      return '0'
    case 'float':
      return '0.0'
    case 'str':
      return '文本内容'
    case 'bool':
      return 'true 或 false'
    default:
      return ''
  }
}