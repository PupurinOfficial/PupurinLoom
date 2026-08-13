import { useEffect, useState } from 'react'
import { useStore } from '../store/useStore'
import type { CharacterMeta, SpriteMeta } from '../types'
import { addImageDef, removeImageDef, updateImageDefPath, parseImageDefs } from '../utils/scriptImageSync'
import CharacterAvatar, { lightenColor, SpriteThumbnail } from '../components/CharacterAvatar'
import PromptDialog from '../components/ui/PromptDialog'

// 内联 prompt 模态框配置（替代被 Electron 禁用的 window.prompt）
interface PromptConfig {
  title: string
  placeholder: string
  defaultValue: string
  onSubmit: (value: string) => void | Promise<void>
}

export default function CharacterPage() {
  const characters = useStore((s) => s.characters)
  const setCharacters = useStore((s) => s.setCharacters)
  const selectedCharId = useStore((s) => s.selectedCharId)
  const setSelectedCharId = useStore((s) => s.setSelectedCharId)
  const currentProject = useStore((s) => s.currentProject)

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [promptCfg, setPromptCfg] = useState<PromptConfig | null>(null)

  const projectPath = currentProject?.path ?? ''

  // 打开 prompt 模态框
  function openPrompt(cfg: PromptConfig): void {
    setPromptCfg(cfg)
  }

  // 取消
  function cancelPrompt(): void {
    setPromptCfg(null)
  }

  // 加载角色数据
  async function loadCharacters(): Promise<void> {
    if (!projectPath) return
    setBusy(true)
    try {
      const list = await window.pupurin.loadCharacters(projectPath)
      setCharacters(list)
      if (list.length > 0 && !list.find((c) => c.id === selectedCharId)) {
        setSelectedCharId(list[0].id)
      }
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void loadCharacters()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectPath])

  // 保存
  async function save(): Promise<void> {
    if (!projectPath) return
    setBusy(true)
    setErr(null)
    try {
      await window.pupurin.saveCharacters(projectPath, characters)
      setDirty(false)
    } catch (e) {
      setErr(String(e))
    } finally {
      setBusy(false)
    }
  }

  // 更新单个角色
  function updateChar(id: string, patch: Partial<CharacterMeta>): void {
    setCharacters(characters.map((c) => (c.id === id ? { ...c, ...patch } : c)))
    setDirty(true)
  }

  // 新建角色
  function handleNew(): void {
    openPrompt({
      title: '角色名称',
      placeholder: '新角色',
      defaultValue: '新角色',
      onSubmit: async (name) => {
        const c = await window.pupurin.newCharacter(name)
        setCharacters([...characters, c])
        setSelectedCharId(c.id)
        setDirty(true)
      }
    })
  }

  // 删除角色
  function handleDelete(id: string, name: string): void {
    if (!confirm(`删除角色「${name}」？`)) return
    const remaining = characters.filter((c) => c.id !== id)
    setCharacters(remaining)
    if (selectedCharId === id) {
      setSelectedCharId(remaining[0]?.id ?? null)
    }
    setDirty(true)
  }

  // 立绘差分管理
  function handleAddSprite(charId: string): void {
    openPrompt({
      title: '差分名称',
      placeholder: 'happy',
      defaultValue: 'happy',
      onSubmit: async (name) => {
        const sp = await window.pupurin.newSprite(name)
        setCharacters(
          characters.map((c) =>
            c.id === charId ? { ...c, sprites: [...c.sprites, sp] } : c
          )
        )
        setDirty(true)
      }
    })
  }

  function updateSprite(charId: string, spriteId: string, patch: Partial<SpriteMeta>): void {
    setCharacters(
      characters.map((c) =>
        c.id === charId
          ? { ...c, sprites: c.sprites.map((s) => (s.id === spriteId ? { ...s, ...patch } : s)) }
          : c
      )
    )
    setDirty(true)
  }

  // 同步单个差分到 script.rpy（新增/更新/删除 image 定义）
  async function syncSpriteToScript(charVar: string, spriteName: string, path: string): Promise<void> {
    if (!projectPath || !charVar || !spriteName) return
    try {
      const script = await window.pupurin.readFile(projectPath, 'script.rpy')
      let newScript: string
      if (path.trim()) {
        const defs = parseImageDefs(script)
        const existing = defs.find((d) => d.charVar === charVar && d.sprite === spriteName)
        newScript = existing
          ? updateImageDefPath(script, charVar, spriteName, path)
          : addImageDef(script, charVar, spriteName, path)
      } else {
        newScript = removeImageDef(script, charVar, spriteName)
      }
      await window.pupurin.saveScript(projectPath, newScript)
    } catch (e) {
      setErr(`同步 script.rpy 失败: ${String(e)}`)
    }
  }

  // 导入差分图片：选择外部图片 → 复制到 images/ → 创建差分 → 同步 script.rpy
  async function importSpriteImage(charId: string): Promise<void> {
    if (!projectPath) return
    try {
      const files = await window.pupurin.pickFiles()
      if (files.length === 0) return
      const char = characters.find((c) => c.id === charId)
      if (!char) return
      const file = files[0]
      // 格式校验：仅允许图片文件
      const ext = file.split('.').pop()?.toLowerCase() ?? ''
      if (!['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext)) {
        setErr(`不支持的图片格式：.${ext}（仅支持 png/jpg/jpeg/gif/webp/bmp）`)
        return
      }
      // 导入到 images 文件夹，返回相对 game/ 的路径
      let importedPath = await window.pupurin.importFile(projectPath, 'images', file)
      // Ren'Py 使用正斜杠
      importedPath = importedPath.replace(/\\/g, '/')
      const finalPath = importedPath
      openPrompt({
        title: '差分名称',
        placeholder: 'happy',
        defaultValue: 'happy',
        onSubmit: async (name) => {
          const sp = await window.pupurin.newSprite(name)
          const updatedSp = { ...sp, path: finalPath }
          setCharacters(
            characters.map((c) =>
              c.id === charId ? { ...c, sprites: [...c.sprites, updatedSp] } : c
            )
          )
          // 同步 script.rpy：新增 image 定义
          await syncSpriteToScript(char.varName, name, finalPath)
          setDirty(true)
        }
      })
    } catch (e) {
      setErr(String(e))
    }
  }

  async function deleteSprite(charId: string, spriteId: string): Promise<void> {
    const char = characters.find((c) => c.id === charId)
    const sp = char?.sprites.find((s) => s.id === spriteId)
    setCharacters(
      characters.map((c) =>
        c.id === charId ? { ...c, sprites: c.sprites.filter((s) => s.id !== spriteId) } : c
      )
    )
    setDirty(true)
    // 同步 script.rpy：删除 image 定义
    if (char && sp) {
      await syncSpriteToScript(char.varName, sp.name, '')
    }
  }

  const selected = characters.find((c) => c.id === selectedCharId) ?? null

  return (
    <div className="flex h-full">
      {/* 左侧：角色列表 */}
      <aside className="w-56 flex flex-col bg-loom-panel border-r border-loom-border">
        <div className="flex items-center justify-between px-3 h-8 bg-loom-panel2 border-b border-loom-border">
          <span className="text-xs font-semibold text-loom-text">角色列表</span>
          <button
            onClick={handleNew}
            title="新建角色"
            className="w-5 h-5 flex items-center justify-center rounded bg-loom-accent/20 text-loom-accent hover:bg-loom-accent/30 text-xs"
          >
        +
      </button>
        </div>
        <div className="flex-1 overflow-auto py-1">
          {characters.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-loom-muted">暂无角色</div>
          ) : (
            characters.map((c) => (
              <button
                key={c.id}
                onClick={() => setSelectedCharId(c.id)}
                className={[
                  'w-full flex items-center gap-2 px-3 py-2 text-left transition-colors',
                  c.id === selectedCharId
                    ? 'bg-loom-panel2 border-l-2 border-loom-accent'
                    : 'border-l-2 border-transparent hover:bg-loom-panel2/50'
                ].join(' ')}
              >
                <CharacterAvatar character={c} size={28} rounded="rounded-lg" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate" style={{ color: lightenColor(c.color, 0.4) }}>
                    {c.name}
                  </div>
                  <div className="text-[10px] text-loom-muted font-mono truncate">
                    {c.varName || '—'} · {c.sprites.length} 差分
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
                    onChange={(e) => updateChar(selected.id, { name: e.target.value })}
                    className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm focus:outline-none focus:border-loom-accent"
                  />
                </div>
                <div>
                  <label className="block text-xs text-loom-muted mb-1">Ren'Py 变量名</label>
                  <input
                    type="text"
                    value={selected.varName}
                    onChange={(e) => updateChar(selected.id, { varName: e.target.value })}
                    placeholder="如 e、a、narrator"
                    className="w-full bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-loom-accent"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-loom-muted mb-1">名字颜色</label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selected.color}
                    onChange={(e) => updateChar(selected.id, { color: e.target.value })}
                    className="w-10 h-9 rounded border border-loom-border bg-transparent cursor-pointer"
                  />
                  <input
                    type="text"
                    value={selected.color}
                    onChange={(e) => updateChar(selected.id, { color: e.target.value })}
                    className="w-32 bg-loom-bg border border-loom-border rounded px-3 py-2 text-sm font-mono focus:outline-none focus:border-loom-accent"
                  />
                  <span
                    className="px-3 py-1.5 rounded text-sm font-semibold"
                    style={{ color: selected.color, background: selected.color + '22' }}
                  >
                    {selected.name || '预览'}
                  </span>
                </div>
              </div>
            </section>

            {/* 头像设置 */}
            <section className="mb-6">
              <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
                头像
              </h3>
              <div className="flex items-start gap-4">
                {/* 预览 */}
                <AvatarPreview character={selected} />

                {/* 选择来源 */}
                <div className="flex-1 space-y-2">
                  <div className="flex gap-2">
                    <button
                      onClick={() => updateChar(selected.id, { avatar: { type: 'initial' } })}
                      className={[
                        'px-3 py-1.5 text-xs rounded border transition-colors',
                        (selected.avatar?.type ?? 'initial') === 'initial'
                          ? 'bg-loom-accent text-loom-bg border-loom-accent font-semibold'
                          : 'bg-loom-bg border-loom-border text-loom-muted hover:text-loom-text'
                      ].join(' ')}
                    >
                      名称首字
                    </button>
                    <button
                      onClick={() => {
                        const firstSprite = selected.sprites[0]
                        if (firstSprite) {
                          updateChar(selected.id, { avatar: { type: 'sprite', spriteId: firstSprite.id } })
                        }
                      }}
                      disabled={selected.sprites.length === 0}
                      className={[
                        'px-3 py-1.5 text-xs rounded border transition-colors disabled:opacity-40',
                        selected.avatar?.type === 'sprite'
                          ? 'bg-loom-accent text-loom-bg border-loom-accent font-semibold'
                          : 'bg-loom-bg border-loom-border text-loom-muted hover:text-loom-text'
                      ].join(' ')}
                    >
                      立绘差分
                    </button>
                    <button
                      onClick={() => updateChar(selected.id, { avatar: { type: 'custom' } })}
                      className={[
                        'px-3 py-1.5 text-xs rounded border transition-colors',
                        selected.avatar?.type === 'custom'
                          ? 'bg-loom-accent text-loom-bg border-loom-accent font-semibold'
                          : 'bg-loom-bg border-loom-border text-loom-muted hover:text-loom-text'
                      ].join(' ')}
                    >
                      自定义
                    </button>
                  </div>

                  {/* sprite 选项 */}
                  {selected.avatar?.type === 'sprite' && selected.sprites.length > 0 && (
                    <div>
                      <label className="block text-[11px] text-loom-muted mb-1">
                        选择差分（截取头部区域）
                      </label>
                      <select
                        value={selected.avatar?.spriteId ?? ''}
                        onChange={(e) => updateChar(selected.id, {
                          avatar: { type: 'sprite', spriteId: e.target.value }
                        })}
                        className="w-full bg-loom-bg border border-loom-border rounded px-2 py-1.5 text-xs focus:outline-none focus:border-loom-accent"
                      >
                        {selected.sprites.map((sp) => (
                          <option key={sp.id} value={sp.id}>
                            {sp.name} ({sp.path || '无路径'})
                          </option>
                        ))}
                      </select>
                    </div>
                  )}

                  {/* custom 选项 */}
                  {selected.avatar?.type === 'custom' && (
                    <div>
                      <label className="block text-[11px] text-loom-muted mb-1">
                        图片路径（相对 game/）
                      </label>
                      <input
                        type="text"
                        value={selected.avatar?.customPath ?? ''}
                        onChange={(e) => updateChar(selected.id, {
                          avatar: { type: 'custom', customPath: e.target.value }
                        })}
                        placeholder="images/avatar_e.png"
                        className="w-full bg-loom-bg border border-loom-border rounded px-2 py-1.5 text-xs font-mono focus:outline-none focus:border-loom-accent"
                      />
                    </div>
                  )}

                  <p className="text-[11px] text-loom-muted/70">
                    {(selected.avatar?.type ?? 'initial') === 'initial' && '默认使用角色名称的第一个字作为头像'}
                    {selected.avatar?.type === 'sprite' && '从立绘差分截取上 1/3 区域（头部）作为头像'}
                    {selected.avatar?.type === 'custom' && '使用自定义图片作为头像（1:1 比例）'}
                  </p>
                </div>
              </div>
            </section>

            {/* 简介（注释） */}
            <section className="mb-6">
              <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide mb-2">
                简介（将作为注释）
              </h3>
              <textarea
                value={selected.description}
                onChange={(e) => updateChar(selected.id, { description: e.target.value })}
                placeholder="角色背景、性格、设定……"
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

            {/* 立绘差分 */}
            <section>
              <div className="flex items-center justify-between mb-2">
                <h3 className="text-xs font-semibold text-loom-muted uppercase tracking-wide">
                  立绘差分
                </h3>
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() => void importSpriteImage(selected.id)}
                    className="px-2 py-1 text-[11px] rounded bg-loom-accent/15 border border-loom-accent/40 text-loom-accent hover:bg-loom-accent/25 transition-colors"
                  >
                    📥 导入图片
                  </button>
                  <button
                    onClick={() => handleAddSprite(selected.id)}
                    className="px-2 py-1 text-[11px] rounded bg-loom-panel2 border border-loom-border hover:bg-loom-border/30 transition-colors"
                  >
                    + 添加差分
                  </button>
                </div>
              </div>
              {selected.sprites.length === 0 ? (
                <div className="rounded border border-loom-border border-dashed p-6 text-center text-xs text-loom-muted">
                  暂无立绘差分 · 点击「导入图片」从外部选择图片，或「添加差分」手动填写路径
                </div>
              ) : (
                <div className="space-y-2">
                  {selected.sprites.map((sp) => (
                    <div
                      key={sp.id}
                      className="flex items-center gap-2 px-3 py-2 rounded bg-loom-panel border border-loom-border"
                    >
                      <SpriteThumbnail path={sp.path} size={40} rounded="rounded" />
                      <div className="flex-1 grid grid-cols-2 gap-2">
                        <input
                          type="text"
                          value={sp.name}
                          onChange={(e) => updateSprite(selected.id, sp.id, { name: e.target.value })}
                          placeholder="差分名（happy）"
                          className="bg-loom-bg border border-loom-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-loom-accent"
                        />
                        <input
                          type="text"
                          value={sp.path}
                          onChange={(e) => updateSprite(selected.id, sp.id, { path: e.target.value })}
                          onBlur={() => void syncSpriteToScript(selected.varName, sp.name, sp.path)}
                          placeholder="images/eileen_happy.png"
                          className="bg-loom-bg border border-loom-border rounded px-2 py-1 text-xs font-mono focus:outline-none focus:border-loom-accent"
                        />
                      </div>
                      <button
                        onClick={() => void deleteSprite(selected.id, sp.id)}
                        className="px-2 py-1 text-xs text-loom-muted hover:text-loom-err transition-colors"
                        title="删除差分（同时从 script.rpy 移除 image 定义）"
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="mt-2 text-[10px] text-loom-muted/70">
                差分会同步到 script.rpy 的 image 定义（如 <code className="font-mono">image {selected.varName || 'char'} happy:</code>）。修改路径后失焦自动同步，删除差分同时移除定义。
              </p>
            </section>
          </div>
        ) : (
          <div className="h-full flex items-center justify-center text-loom-muted text-sm">
            {characters.length === 0 ? '点击左侧 + 创建角色' : '选择一个角色'}
          </div>
        )}
      </div>

      {/* 统一输入弹窗（替代 window.prompt） */}
      <PromptDialog
        open={!!promptCfg}
        title={promptCfg?.title ?? ''}
        placeholder={promptCfg?.placeholder}
        defaultValue={promptCfg?.defaultValue}
        onConfirm={async (v) => {
          const t = v.trim()
          if (t && promptCfg) {
            setPromptCfg(null)
            await promptCfg.onSubmit(t)
          }
        }}
        onCancel={cancelPrompt}
      />
    </div>
  )
}

// 头像预览：直接根据角色数据渲染 1:1 头像效果
function AvatarPreview({ character }: { character: CharacterMeta }) {
  const avatarCfg = character.avatar ?? { type: 'initial' as const }
  const label =
    avatarCfg.type === 'sprite' ? '立绘差分' :
    avatarCfg.type === 'custom' ? '自定义' : '名称首字'

  return (
    <div className="flex flex-col items-center gap-1">
      <CharacterAvatar character={character} size={80} rounded="rounded-lg" />
      <span className="text-[10px] text-loom-muted">{label}</span>
    </div>
  )
}
