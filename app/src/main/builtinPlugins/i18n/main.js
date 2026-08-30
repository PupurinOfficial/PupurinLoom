// 多语言 —— Pupurin Loom 内置插件
// 右侧功能栏「多语言」：为游戏添加翻译语言。
//  - 一键「提取当前脚本」：给对话行自动追加 `id <label>_<行号>` 子句（幂等），
//    并为每个语言生成/更新 game/tl/<语言>/<脚本>.rpy 的 translate 骨架与菜单字符串块。
//  - 面板内逐条编辑译文，保存时按行替换回 tl 文件（不破坏手写结构）。
//  - 设置 config.default_language 默认语言，提供游戏内切换语言的示例代码。
// 参考官方文档：https://www.renpy.org/doc/html/translation.html
(function () {
  const KEY = 'i18n'
  // 保留关键字开头的语句不是对话行（voice 等）
  const NON_CHAR_KEYWORDS = new Set(['voice', 'play', 'queue', 'stop', 'extend', 'centered', 'nvl'])

  // ---------- 工具 ----------
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
  // Ren'Py 字符串字面量（双引号 + JSON 转义，与 Ren'Py 转义规则兼容）
  function q(s) {
    return JSON.stringify(String(s))
  }
  function langOk(name) {
    return /^[A-Za-z_]\w*$/.test(String(name || ''))
  }
  // 状态持久化（按项目隔离）
  function stateKey() {
    const p = loom.project.getPath()
    return p ? KEY + ':' + p : KEY
  }
  function loadState() {
    const s = loom.store.get(stateKey())
    const langs = Array.isArray(s && s.langs) ? s.langs.filter((x) => langOk(x)) : []
    return {
      langs: langs,
      defaultLang: langs.includes(s && s.defaultLang) ? s.defaultLang : (langs[0] || ''),
    }
  }
  function saveState(s) {
    loom.store.set(stateKey(), s)
  }
  // 解析单行对话/菜单选项
  function parseSayLine(line) {
    const t = String(line).trim()
    if (!t || t.startsWith('#') || t.startsWith('$') || t.startsWith('label ') || t.startsWith('screen ')) return null
    // 已有显式 id 子句的行（如图形编辑器生成的 `... "..." id node_xxx_6`）：
    // 提取时直接沿用其 id，不再追加（幂等）
    const idMatch = t.match(/\bid\s+([\w.]+)\s*$/)
    const existingId = idMatch ? idMatch[1] : null
    // 定位第一个引号
    let qi = -1
    let qc = ''
    for (let i = 0; i < t.length; i++) {
      const c = t[i]
      if (c === '"' || c === "'") {
        qi = i
        qc = c
        break
      }
    }
    if (qi < 0) return null
    // 找闭合引号（处理转义）
    let text = ''
    let escaped = false
    let j = qi + 1
    for (; j < t.length; j++) {
      const c = t[j]
      if (escaped) {
        text += c
        escaped = false
        continue
      }
      if (c === '\\') {
        text += c
        escaped = true
        continue
      }
      if (c === qc) break
      text += c
    }
    if (j >= t.length) return null // 未闭合（多行 say），跳过
    const head = t.slice(0, qi).trim()
    const tail = t.slice(j + 1).trim()
    if (!head) {
      if (tail === ':') return { kind: 'menu', text, tail: '' }
      if (!tail || tail.startsWith('#') || existingId)
        return { kind: 'say', char: '', text, tail: tail.startsWith('#') ? tail : '', id: existingId }
      return null
    }
    if (NON_CHAR_KEYWORDS.has(head.toLowerCase())) return null
    // 已有 id 的行其 tail 就是 `id xxx` 子句，放行；否则行尾只能是注释
    if (tail && !tail.startsWith('#') && !existingId) return null
    return { kind: 'say', char: head.replace(/^["']|["']$/g, ''), text, tail: tail.startsWith('#') ? tail : '', id: existingId }
  }
  // 扫描脚本：收集对话单元 + 菜单字符串，并返回「追加了 id 子句」的脚本
  function extractScript(content) {
    const lines = String(content || '').split('\n')
    const units = [] // { id, line, char, text }
    const strings = [] // { text }
    const out = []
    let label = ''
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i]
      const lm = raw.match(/^\s*label\s+([\w.]+)\s*(?:hide)?\s*:/)
      if (lm) {
        label = lm[1]
        out.push(raw)
        continue
      }
      const info = parseSayLine(raw)
      if (!info) {
        out.push(raw)
        continue
      }
      if (info.kind === 'menu') {
        strings.push({ text: info.text })
        out.push(raw)
        continue
      }
      const lineNo = i + 1
      const id = info.id || (label || 'line') + '_' + lineNo
      units.push({ id, line: lineNo, char: info.char, text: info.text })
      if (info.id) {
        // 已有 id 的行保持原样（沿用其 id，幂等）
        out.push(raw)
        continue
      }
      // 行尾追加 id 子句。
      // id 必须插在行尾注释之前，否则会被 Ren'Py 当成注释内容
      let head = raw.replace(/\s+$/, '')
      let comment = ''
      if (info.tail) {
        const idx = head.lastIndexOf(info.tail)
        if (idx > 0) {
          head = head.slice(0, idx).replace(/\s+$/, '')
          comment = info.tail
        }
      }
      out.push(head + ' id ' + id + (comment ? ' ' + comment : ''))
    }
    return { units, strings, content: out.join('\n') }
  }
  // 读取已有 tl 文件中的译文（用于合并，重新提取不丢译文）
  function parseTl(content) {
    const trans = {} // id -> text
    const lines = String(content || '').split('\n')
    let curId = null
    for (let i = 0; i < lines.length; i++) {
      // strings 块必须先排除（它的 old/new 行不是对话译文）
      if (/^translate\s+\w+\s+strings:\s*$/.test(lines[i])) {
        curId = null
        continue
      }
      const m = lines[i].match(/^translate\s+\w+\s+([\w.]+):\s*$/)
      if (m) {
        curId = m[1]
        continue
      }
      if (curId) {
        // 跳过注释行（含 `# 角色 "原文"` 的原文注释），否则会把原文误当译文
        if (/^\s*#/.test(lines[i])) continue
        // translate 块内第一条 say 行：取引号内容作为译文
        const say = /^\s*(?:\w+\s+)?(["'])((?:\\.|(?!\1).)*?)\1/.exec(lines[i])
        if (say) {
          trans[curId] = say[2]
          curId = null
        }
      }
    }
    // strings 块成对解析（old 紧跟 new）
    const strings = []
    for (let i = 0; i < lines.length; i++) {
      const om = lines[i].match(/^\s*old\s+(["'])((?:\\.|(?!\1).)*?)\1\s*$/)
      if (!om) continue
      const nm = lines[i + 1] ? lines[i + 1].match(/^\s*new\s+(["'])((?:\\.|(?!\1).)*?)\1\s*$/) : null
      strings.push({ text: om[2], newText: nm ? nm[2] : '' })
    }
    return { trans, strings }
  }
  // 生成单个语言的 tl 文件（合并已有译文）
  function generateTlFile(scriptFile, units, strings, lang, existing) {
    const L = []
    L.push('################################################################################')
    L.push('## 翻译 —— ' + lang + '（由 Pupurin Loom「多语言」插件生成）')
    L.push('## 脚本：' + scriptFile)
    L.push('################################################################################')
    L.push('')
    units.forEach((u) => {
      L.push('# game/' + scriptFile + ':' + u.line)
      L.push('translate ' + lang + ' ' + u.id + ':')
      L.push('    # ' + (u.char ? u.char + ' ' : '') + q(u.text))
      const t = existing && existing.trans && existing.trans[u.id] !== undefined ? existing.trans[u.id] : ''
      L.push('    ' + (u.char ? u.char + ' ' : '') + q(t))
      L.push('')
    })
    const all = strings.slice()
    if (existing && existing.strings) {
      existing.strings.forEach((s) => {
        if (!all.some((x) => x.text === s.text)) all.push(s)
      })
    }
    if (all.length > 0) {
      L.push('translate ' + lang + ' strings:')
      L.push('')
      all.forEach((s) => {
        L.push('    old ' + q(s.text))
        const nt = s.newText !== undefined ? s.newText : ''
        L.push('    new ' + q(nt))
        L.push('')
      })
    }
    return L.join('\n')
  }
  // 保存译文：把 transMap { id -> text } 按行替换回 tl 文件（保留其他结构）
  function applyTranslations(tlContent, transMap) {
    const lines = String(tlContent || '').split('\n')
    let curId = null
    for (let i = 0; i < lines.length; i++) {
      // strings 块必须先排除（它的 old/new 行不是对话译文）
      if (/^translate\s+\w+\s+strings:\s*$/.test(lines[i])) {
        curId = null
        continue
      }
      const m = lines[i].match(/^translate\s+\w+\s+([\w.]+):\s*$/)
      if (m) {
        curId = m[1]
        continue
      }
      if (curId) {
        // 注释行（含 `# 角色 "原文"` 形式的原文注释）不是译文，必须跳过，
        // 否则会被下面的 say 正则误命中，导致真正的译文行永远不被替换
        if (/^\s*#/.test(lines[i])) continue
        const say = lines[i].match(/^(\s*(?:\w+\s+)?)(["'])((?:\\.|(?!\2).)*?)\2/)
        if (say) {
          if (transMap[curId] !== undefined) {
            lines[i] = say[1] + say[2] + String(transMap[curId]).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + say[2] + lines[i].slice(say[0].length)
          }
          curId = null
        }
      }
    }
    return lines.join('\n')
  }
  // 生成默认语言配置
  function generateOptions(lang) {
    return [
      '################################################################################',
      '## 多语言（由 Pupurin Loom「多语言」插件生成）',
      '################################################################################',
      '',
      'define config.default_language = ' + q(lang || ''),
      '',
    ].join('\n')
  }

  // ---------- 面板 UI ----------
  let state = { langs: [], defaultLang: '' }
  let currentLang = ''
  // 当前语言的面板数据：{ units: [{id, line, char, orig, text}], strings: [...] }
  let editorData = null
  // 当前挂载的面板根元素（作用域查询，避免多面板实例 id 冲突）
  let rootEl = null
  // 提取时记录的故事脚本（game/ 相对路径）：保存/加载译文固定用它，防止 currentFile 漂移
  let scriptFile = null

  const STATIC_HTML =
    '<style>' +
    '.i18n{display:flex;flex-direction:column;gap:12px;padding:12px;font-size:12px;color:rgb(var(--loom-text));}' +
    '.i18n h3{margin:0;font-size:12px;color:rgb(var(--loom-accent));font-weight:600;}' +
    '.i18n .hint{font-size:11px;color:rgb(var(--loom-muted));line-height:1.5;}' +
    '.i18n .row{display:flex;gap:6px;align-items:center;}' +
    '.i18n input,.i18n select{background:rgb(var(--loom-panel));border:1px solid rgb(var(--loom-border));border-radius:6px;color:rgb(var(--loom-text));padding:5px 8px;font-size:12px;outline:none;}' +
    '.i18n input:focus,.i18n select:focus{border-color:rgb(var(--loom-accent));}' +
    '.i18n input{flex:1;min-width:0;}' +
    '.i18n button{background:rgb(var(--loom-accent));color:rgb(var(--loom-bg));border:none;border-radius:6px;padding:6px 10px;font-size:12px;font-weight:600;cursor:pointer;white-space:nowrap;}' +
    '.i18n button:disabled{opacity:.4;cursor:default;}' +
    '.i18n button.ghost{background:transparent;border:1px solid rgb(var(--loom-border));color:rgb(var(--loom-text));font-weight:400;}' +
    '.i18n .chips{display:flex;flex-wrap:wrap;gap:6px;}' +
    '.i18n .chip{display:inline-flex;align-items:center;gap:4px;background:rgb(var(--loom-panel));border:1px solid rgb(var(--loom-border));border-radius:999px;padding:2px 8px;font-size:11px;}' +
    '.i18n .chip button{background:none;border:none;color:rgb(var(--loom-muted));cursor:pointer;font-size:12px;padding:0 2px;}' +
    '.i18n .chip button:hover{color:rgb(var(--loom-err));}' +
    '.i18n .units{display:flex;flex-direction:column;gap:8px;max-height:320px;overflow-y:auto;}' +
    '.i18n .unit{background:rgb(var(--loom-panel));border:1px solid rgb(var(--loom-border));border-radius:8px;padding:8px;}' +
    '.i18n .unit .id{font-family:monospace;font-size:10px;color:rgb(var(--loom-muted));margin-bottom:4px;}' +
    '.i18n .unit .orig{font-size:11px;color:rgb(var(--loom-muted));margin-bottom:4px;word-break:break-all;}' +
    '.i18n .unit textarea{width:100%;box-sizing:border-box;background:rgb(var(--loom-bg));border:1px solid rgb(var(--loom-border));border-radius:6px;color:rgb(var(--loom-text));font-size:12px;padding:5px 8px;resize:vertical;min-height:44px;outline:none;}' +
    '.i18n .unit textarea:focus{border-color:rgb(var(--loom-accent));}' +
    '.i18n .empty{color:rgb(var(--loom-muted));text-align:center;padding:12px 0;font-size:11px;}' +
    '.i18n pre{background:rgb(var(--loom-bg));border:1px solid rgb(var(--loom-border));border-radius:6px;padding:8px;font-size:10px;color:rgb(var(--loom-muted));overflow-x:auto;white-space:pre-wrap;}' +
    '.i18n .sep{height:1px;background:rgb(var(--loom-border));margin:2px 0;}' +
    '</style>' +
    '<div class="i18n">' +
    '<h3>多语言</h3>' +
    '<div class="hint">为游戏添加翻译语言，提取对话后生成 Ren\'Py translate 代码到 game/tl/。</div>' +
    '<div class="row"><input id="i18n-newlang" placeholder="语言名，如 english / japanese" /><button id="i18n-addlang">添加</button></div>' +
    '<div class="chips" id="i18n-chips"></div>' +
    '<div class="row"><span style="white-space:nowrap">默认语言</span><select id="i18n-default"></select></div>' +
    '<div class="sep"></div>' +
    '<button id="i18n-extract" class="ghost" style="width:100%">提取当前脚本翻译</button>' +
    '<div class="hint" id="i18n-extract-hint">为当前打开的故事脚本的对话行追加 id 并生成翻译骨架。</div>' +
    '<div class="sep"></div>' +
    '<h3>译文编辑</h3>' +
    '<div class="row"><span style="white-space:nowrap">语言</span><select id="i18n-langsel"></select></div>' +
    '<div class="units" id="i18n-units"></div>' +
    '<button id="i18n-save" disabled>保存译文</button>' +
    '<div class="sep"></div>' +
    '<details><summary style="cursor:pointer;font-size:11px;color:#8a857b">游戏内切换语言示例</summary>' +
    '<div class="hint">在偏好设置界面添加切换按钮（可复制到 screens.rpy）：</div>' +
    '<pre>textbutton "English" action Language("english")</pre>' +
    '<div class="hint">脚本中运行时切换：</div>' +
    '<pre>renpy.change_language("english")</pre>' +
    '</details>' +
    '</div>'

  function tlPath(lang) {
    // 以「提取时记录的脚本文件」为准，避免用户在织机中切到翻译文件后
    // 把译文写进 game/tl/<lang>/tl/... 嵌套路径
    const f = scriptFile || loom.project.currentFile() || 'script.rpy'
    return 'game/tl/' + lang + '/' + f
  }

  // 渲染语言 chips + 默认语言下拉 + 译文语言下拉
  function renderLangs() {
    const root = rootEl || document
    const chips = root.querySelector('#i18n-chips')
    chips.innerHTML = state.langs
      .map(
        (l) =>
          '<span class="chip">' +
          esc(l) +
          '<button data-del="' +
          esc(l) +
          '" title="删除语言">×</button></span>'
      )
      .join('') || '<span class="empty">还没有语言，先在上方添加</span>'
    const opts = state.langs
      .map((l) => '<option value="' + esc(l) + '">' + esc(l) + '</option>')
      .join('')
    const def = root.querySelector('#i18n-default')
    def.innerHTML = '<option value="">(无，保持脚本语言)</option>' + opts
    def.value = state.defaultLang
    const sel = root.querySelector('#i18n-langsel')
    sel.innerHTML = opts || '<option value="">(请先添加语言)</option>'
    sel.value = currentLang && state.langs.includes(currentLang) ? currentLang : (state.langs[0] || '')
    currentLang = sel.value
  }

  // 取「当前可见」的面板根元素：rootEl 可能指向已隐藏/卸载的面板（detached DOM），
  // 导致提取/保存/切换文件后渲染到用户看不到的地方。
  // 因此优先使用文档中「可见」的 .i18n 面板，避免渲染目标与用户看到的不一致。
  function panelRoot() {
    const all = Array.from(document.querySelectorAll('.i18n'))
    const visible = all.find((el) => el.offsetParent !== null)
    if (visible) return visible
    if (rootEl && document.contains(rootEl)) return rootEl
    return all[all.length - 1] || rootEl || document
  }

  // 加载当前语言的译文并渲染列表
  function loadEditor(lang) {
    const root = panelRoot()
    const box = root.querySelector('#i18n-units')
    const saveBtn = root.querySelector('#i18n-save')
    if (!box || !saveBtn) return
    if (!lang) {
      editorData = null
      box.innerHTML = '<div class="empty">请先添加并选择语言</div>'
      saveBtn.disabled = true
      return
    }
    loom.fs
      .read(tlPath(lang))
      .then((content) => {
        const r = panelRoot()
        const b = r.querySelector('#i18n-units')
        const s = r.querySelector('#i18n-save')
        if (!b || !s) return
        if (content === null) {
          editorData = null
          b.innerHTML =
            '<div class="empty">还没有翻译文件，先点击「提取当前脚本翻译」</div>'
          s.disabled = true
          return
        }
        const parsed = parseTl(content)
        // 提取每个 translate 块（含原文注释）用于展示
        const units = []
        const lines = content.split('\n')
        let curId = null
        let orig = ''
        for (let i = 0; i < lines.length; i++) {
          // strings 块先排除（old/new 行不是对话译文）
          if (/^translate\s+\w+\s+strings:\s*$/.test(lines[i])) {
            curId = null
            continue
          }
          const m = lines[i].match(/^translate\s+\w+\s+([\w.]+):\s*$/)
          if (m) {
            curId = m[1]
            orig = ''
            continue
          }
          if (curId) {
            const cm = lines[i].match(/^\s*#\s+(?:\w+\s+)?"((?:[^"\\]|\\.)*)"\s*$/)
            if (cm && !orig) {
              orig = cm[1]
              continue
            }
            const say = /^\s*(?:\w+\s+)?(["'])((?:\\.|(?!\1).)*?)\1/.exec(lines[i])
            if (say) {
              units.push({ id: curId, orig, text: parsed.trans[curId] !== undefined ? parsed.trans[curId] : '' })
              curId = null
            }
          }
        }
        editorData = { units, strings: parsed.strings }
        renderUnits()
        // 诊断：确认渲染目标与内容（devtools Console 可见）
        console.log('[i18n] loadEditor', lang, 'units=' + units.length, 'root=', rootEl && rootEl.offsetParent !== null ? 'visible' : 'hidden')
      })
      .catch((e) => {
        const r = panelRoot()
        const b = r.querySelector('#i18n-units')
        if (b) b.innerHTML = '<div class="empty">读取翻译失败：' + esc(String(e)) + '</div>'
      })
  }

  function renderUnits() {
    const root = panelRoot()
    const box = root.querySelector('#i18n-units')
    const saveBtn = root.querySelector('#i18n-save')
    if (!box || !saveBtn) return
    if (!editorData || editorData.units.length === 0) {
      box.innerHTML = '<div class="empty">该语言没有可翻译的对话</div>'
      saveBtn.disabled = true
      return
    }
    editorData.units.forEach((u) => {
      const div = document.createElement('div')
      div.className = 'unit'
      div.innerHTML =
        '<div class="id">' +
        esc(u.id) +
        '</div>' +
        '<div class="orig">' +
        (u.orig ? '原文：' + esc(u.orig) : '&nbsp;') +
        '</div>'
      const ta = document.createElement('textarea')
      ta.value = u.text
      ta.placeholder = '输入 ' + (state.defaultLang || '译文') + ' 译文…'
      ta.addEventListener('input', () => {
        u.text = ta.value
      })
      div.appendChild(ta)
      box.appendChild(div)
    })
    saveBtn.disabled = false
  }

  // 提取当前脚本 → 加 id + 为所有语言生成/合并 tl 文件
  async function doExtract() {
    if (state.langs.length === 0) {
      loom.toast('请先添加至少一个语言', 'error')
      return
    }
    const file = loom.project.currentFile()
    if (!file || !/\.rpy$/i.test(file)) {
      loom.toast('请先在织机中打开一个故事脚本', 'error')
      return
    }
    // 拦截在翻译文件（game/tl/...）上提取，否则 tlPath 会嵌套生成 game/tl/<lang>/tl/...
    if (/^(game\/)?tl\//i.test(file)) {
      loom.toast('请先在织机中打开故事脚本（不要选中翻译文件）', 'error')
      return
    }
    scriptFile = file
    const btn = panelRoot().querySelector('#i18n-extract') || null
    if (!btn) return
    btn.disabled = true
    btn.textContent = '提取中…'
    try {
      const content = await loom.project.readScript()
      if (content === null) throw new Error('无法读取当前脚本')
      const { units, strings, content: newContent } = extractScript(content)
      // 统计新增 id 数量
      let idCount = 0
      const oldLines = content.split('\n')
      const newLines = newContent.split('\n')
      oldLines.forEach((l, i) => {
        if (newLines[i] && newLines[i] !== l) idCount++
      })
      if (idCount > 0) {
        await loom.project.writeScript(newContent)
      }
      // 为每个语言生成/合并 tl 文件
      for (const lang of state.langs) {
        const existingContent = await loom.fs.read(tlPath(lang))
        const existing = existingContent ? parseTl(existingContent) : { trans: {}, strings: [] }
        const code = generateTlFile(file, units, strings, lang, existing)
        await loom.fs.write(tlPath(lang), code)
      }
      loom.toast(
        '已提取 ' +
          file +
          '：' +
          units.length +
          ' 条对话、' +
          strings.length +
          ' 个菜单项（语言：' +
          currentLang +
          '）',
        'success'
      )
      // 提取后延迟到当前 React 渲染周期结束再刷新编辑区：
      // writeScript 会触发织机重渲染，若立即 loadEditor 可能渲染到
      // 即将被替换的旧 DOM，导致「提取后编辑区不更新，重开面板才更新」
      setTimeout(() => loadEditor(currentLang), 100)
    } catch (e) {
      loom.toast('提取失败：' + e, 'error')
    } finally {
      if (btn) {
        btn.disabled = false
        btn.textContent = '提取当前脚本翻译'
      }
    }
  }

  // 保存当前语言译文
  async function doSave() {
    if (!editorData || !currentLang) return
    const root = panelRoot()
    const btn = root.querySelector('#i18n-save')
    if (!btn) return
    btn.disabled = true
    try {
      const content = await loom.fs.read(tlPath(currentLang))
      if (content === null) throw new Error('翻译文件不存在')
      // 从整个文档收集（不限于当前 rootEl）：用户可能在侧边栏或插件页任一面板输入
      // 只收集非空译文——空串进 map 会让 applyTranslations 把所有行「替换成相同内容」，
      // 导致 next === content、写入无变化，看起来像「保存了但文件没变」
      const map = {}
      document.querySelectorAll('.i18n .unit').forEach((unitEl) => {
        const idEl = unitEl.querySelector('.id')
        const ta = unitEl.querySelector('textarea')
        if (idEl && ta) {
          const id = idEl.textContent.trim()
          if (id && ta.value.trim() !== '') map[id] = ta.value
        }
      })
      const filled = Object.keys(map).length
      const next = applyTranslations(content, map)
      await loom.fs.write(tlPath(currentLang), next)
      // 写入后立即读回校验：确保落盘内容与预期一致（定位「提示成功但文件没变」类问题）
      const verify = await loom.fs.read(tlPath(currentLang))
      if (verify !== next) {
        throw new Error('写入后读回内容不一致（' + tlPath(currentLang) + '）')
      }
      loom.toast('已保存 ' + filled + '/' + editorData.units.length + ' 条译文 → ' + tlPath(currentLang), 'success')
      loadEditor(currentLang)
    } catch (e) {
      loom.toast('保存失败：' + e, 'error')
      btn.disabled = false
    }
  }

  function mount(el) {
    // 每次挂载全量绑定事件（PluginPanelView 重渲染时会重新 mount，
    // 若跳过会导致按钮无响应）；事件随旧 DOM 一起销毁
    rootEl = el
    state = loadState()
    // 事件绑定
    el.querySelector('#i18n-addlang').addEventListener('click', () => {
      const input = el.querySelector('#i18n-newlang')
      const name = input.value.trim()
      if (!langOk(name)) {
        loom.toast('语言名需为字母/下划线开头的标识符', 'error')
        return
      }
      if (state.langs.includes(name)) {
        loom.toast('该语言已存在', 'info')
        return
      }
      state.langs.push(name)
      state.defaultLang = state.defaultLang || name
      saveState(state)
      input.value = ''
      renderLangs()
      loadEditor(state.langs[0])
    })
    el.querySelector('#i18n-chips').addEventListener('click', (e) => {
      const btn = e.target.closest('[data-del]')
      if (!btn) return
      const name = btn.getAttribute('data-del')
      state.langs = state.langs.filter((l) => l !== name)
      if (state.defaultLang === name) state.defaultLang = state.langs[0] || ''
      if (currentLang === name) currentLang = state.langs[0] || ''
      saveState(state)
      renderLangs()
      loadEditor(currentLang)
    })
    el.querySelector('#i18n-default').addEventListener('change', (e) => {
      state.defaultLang = e.target.value
      saveState(state)
      void syncDefaultLang()
    })
    el.querySelector('#i18n-langsel').addEventListener('change', (e) => {
      currentLang = e.target.value
      loadEditor(currentLang)
    })
    el.querySelector('#i18n-extract').addEventListener('click', () => void doExtract())
    el.querySelector('#i18n-save').addEventListener('click', () => void doSave())
    renderLangs()
    loadEditor(state.langs[0] || '')
    void syncDefaultLang()
  }

  // 生成/更新 game/tl_options.rpy 中的默认语言
  function syncDefaultLang() {
    const lang = state.defaultLang
    const content = generateOptions(lang)
    return loom.fs
      .write('game/tl_options.rpy', content)
      .catch((e) => loom.toast('写入默认语言配置失败：' + e, 'error'))
  }

  // ---------- 注册 ----------
  loom.panel.register(
    'i18n.main',
    '多语言',
    { render: () => ({ html: STATIC_HTML, mount }) },
    { sidebar: true }
  )

  // 项目打开/切换：重新加载该项目语言配置
  loom.hooks.on('app:projectOpened', () => {
    state = loadState()
    scriptFile = null
  })

  // 织机切换文件：编辑区跟随当前文件刷新（该文件已提取过则显示其翻译单元，否则显示空态）
  loom.hooks.on('app:fileOpened', ({ file }) => {
    scriptFile = null
    // 先给出即时反馈，让用户明确看到编辑区正在跟随当前文件
    const root = panelRoot()
    const box = root.querySelector('#i18n-units')
    if (box) box.innerHTML = '<div class="empty">切换文件：' + esc(file || '') + '，正在加载…</div>'
    setTimeout(() => {
      try {
        loadEditor(currentLang)
      } catch (e) {
        const r = panelRoot()
        const b = r.querySelector('#i18n-units')
        if (b) b.innerHTML = '<div class="empty">刷新失败：' + esc(String(e)) + '</div>'
      }
    }, 50)
  })

  // 调试/测试钩子
  if (typeof window !== 'undefined') {
    window.__i18nPlugin = { extractScript, generateTlFile, parseTl, applyTranslations, loadState, saveState, parseSayLine }
  }
})()
