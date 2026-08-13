// 画廊 —— Pupurin Loom 内置插件
// 右侧功能栏「画廊」：管理 CG（一个 CG 可对应多个差分），
// 任何修改（增删改、排序、列数）都会实时自动覆盖写入 game/gallery.rpy；
// 自动检测项目脚本中已定义的图片（image 语句），已定义的差分不再重复生成并做标记提示。
// 参考官方文档：https://www.renpy.org/doc/html/rooms.html#image-gallery
(function () {
  const KEY = 'gallery'
  const IMG_RE = /\.(png|jpe?g|webp|gif|bmp)$/i

  // ---------- 工具 ----------
  const thumbCache = new Map()
  let definedImages = null // Set<string> | null：项目 rpy 中已定义图片名（null = 尚未检测）
  let listEl = null
  let projectHookBound = false
  function uid() {
    return 'g' + Math.random().toString(36).slice(2, 10)
  }
  function basename(p) {
    const parts = String(p || '').split('/')
    const f = parts[parts.length - 1] || ''
    return f.replace(/\.[^.]+$/, '')
  }
  // HTML 转义（用户输入的名称可能含特殊字符）
  function esc(s) {
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }
  // 图片名清洗：去掉会破坏 Ren'Py 语句的字符，保留空格（tag 与 attribute 的分隔）
  function san(s) {
    return String(s)
      .trim()
      .replace(/["'#:;,()\\]/g, '')
  }
  // Ren'Py 字符串字面量（双引号 + 转义）
  function q(s) {
    return JSON.stringify(String(s))
  }

  // ---------- 数据（loom.store 持久化）----------
  function normalize(s) {
    if (!s || typeof s !== 'object') s = {}
    const cgs = Array.isArray(s.cgs) ? s.cgs : []
    return {
      columns:
        typeof s.columns === 'number' && s.columns >= 1 && s.columns <= 8
          ? Math.floor(s.columns)
          : 3,
      cgs: cgs.map((cg) => ({
        id: String(cg.id || uid()),
        name: String(cg.name || 'CG'),
        diffs: (Array.isArray(cg.diffs) ? cg.diffs : []).map((d) => ({
          id: String(d.id || uid()),
          path: String(d.path || ''),
          imgName: String(d.imgName || basename(d.path)),
        })),
      })),
    }
  }
  // ---------- 状态持久化（按项目隔离：gallery:<项目路径>）----------
  function stateKey() {
    const p = loom.project.getPath()
    return p ? KEY + ':' + p : KEY
  }
  function load() {
    return normalize(loom.store.get(stateKey()))
  }
  // 保存面板状态，并触发实时保存（防抖后重新生成并覆盖写入 game/gallery.rpy）
  function save(s) {
    loom.store.set(stateKey(), s)
    schedulePersist()
  }

  // 实时保存：任何变更后 400ms 防抖，重新检测已定义图片 → 生成 → 覆盖写 gallery.rpy。
  // 串行化（persistChain）避免快速连续操作时写入交错。
  let persistTimer = null
  let persistChain = Promise.resolve()
  function schedulePersist() {
    if (persistTimer) clearTimeout(persistTimer)
    persistTimer = setTimeout(() => {
      if (!loom.project.getPath()) return
      persistChain = persistChain
        .then(refreshDefined)
        .then(() => generateCode(load(), definedImages))
        .then((code) => loom.fs.write('game/gallery.rpy', code))
        .then(ensureNavEntryForProject)
        .catch((e) => loom.toast('自动保存 gallery.rpy 失败：' + e, 'error'))
    }, 400)
  }

  // ---------- 代码生成（Ren'Py 官方 Gallery 写法）----------
  // definedImages：项目 rpy 中已存在的图片定义（Set），存在则跳过对应 image 语句
  function generateCode(state, definedImages) {
    const cols = Math.max(1, Math.min(8, state.columns || 3))
    const cgs = (state.cgs || []).filter((cg) => cg.diffs.length > 0)
    const rows = Math.max(1, Math.ceil(cgs.length / cols))
    const L = []

    L.push('################################################################################')
    L.push('## 画廊（Gallery）')
    L.push('##')
    L.push('## 由 Pupurin Loom「画廊」插件生成并维护，「保存」即覆盖写入本文件。')
    L.push('## 参考官方文档：https://www.renpy.org/doc/html/rooms.html#image-gallery')
    L.push('##')
    L.push('## 用法：')
    L.push('##   1. 在剧本中用 show 语句显示差分画面，看过即自动解锁画廊对应条目：')
    cgs.slice(0, 3).forEach((cg) => {
      L.push('##        show ' + cg.diffs[0].imgName)
    })
    L.push('##   2. 在「标题菜单 / 导航」中加入入口：')
    L.push('##        textbutton _("画廊") action ShowMenu("gallery")')
    L.push('################################################################################')

    const defs = []
    state.cgs.forEach((cg) => {
      cg.diffs.forEach((d) => {
        if (d.imgName && d.path && !(definedImages && definedImages.has(d.imgName))) {
          defs.push('image ' + d.imgName + ' = ' + q(d.path))
        }
      })
    })
    if (defs.length) {
      L.push('')
      L.push('# ---- 差分图片定义（项目中已定义过的自动跳过）----')
      defs.forEach((ln) => L.push(ln))
    }

    L.push('')
    L.push('init python:')
    L.push('')
    L.push('    # 画廊对象（若与现有变量冲突可改名，需同步下方 screen）')
    L.push('    g = Gallery()')
    L.push('')
    L.push('    # 未解锁条目的占位显示（可替换为自备的 locked 图片路径）')
    L.push('    g.locked_button = Text(_("未解锁"), size=20, color="#888888")')
    L.push('')
    L.push('    # 切换差分时的过渡')
    L.push('    g.transition = dissolve')
    L.push('')
    L.push('    # 查看差分时显示 上一张 / 下一张 / 自动播放 按钮')
    L.push('    g.navigation = True')
    L.push('')
    L.push('    # ---- CG 条目：一个按钮 = 一张 CG，可含多个差分（unlock_image）----')
    cgs.forEach((cg) => {
      L.push('    g.button(' + q(cg.name) + ')')
      cg.diffs.forEach((d) => {
        L.push('    g.unlock_image(' + q(d.imgName) + ')')
      })
      L.push('')
    })

    L.push('')
    L.push('screen gallery():')
    L.push('')
    L.push('    ## 确保替换掉任何其他菜单屏幕。')
    L.push('    tag menu')
    L.push('')
    L.push('    use game_menu(_("画廊"), scroll="viewport"):')
    L.push('')
    L.push('        grid ' + cols + ' ' + rows + ':')
    L.push('            xfill True')
    L.push('            yfill True')
    L.push('            spacing 15')
    L.push('')
    if (cgs.length === 0) {
      L.push('            text _("暂未配置画廊内容，请在「画廊」插件中添加 CG")')
    } else {
      cgs.forEach((cg) => {
        L.push(
          '            add g.make_button(' +
            q(cg.name) +
            ', ' +
            q(cg.diffs[0].imgName) +
            ', xalign=0.5, yalign=0.5)'
        )
      })
    }
    return L.join('\n')
  }

  // ---------- 游戏内入口：确保 navigation 屏幕有「画廊」按钮 ----------
  // 在 navigation 屏幕「关于」按钮后插入 `textbutton _("画廊") action ShowMenu("gallery")`，
  // 这样标题菜单与游戏内菜单（game_menu 均 use navigation）都能进画廊。
  // 幂等：navigation 内已存在 ShowMenu("gallery") 时返回 null（不做修改）。
  function ensureNavEntry(src) {
    const text = String(src || '')
    const lines = text.split(/\r?\n/)
    let navStart = -1
    for (let i = 0; i < lines.length; i++) {
      // 识别 `screen navigation:`、`screen navigation():`、`screen navigation(unfirstpage):`（带参数）
      // \b 避免误匹配 navigation_big 之类的其它屏幕
      if (/^screen\s+navigation\b\s*(\([^)]*\))?\s*:/.test(lines[i])) {
        navStart = i
        break
      }
    }
    if (navStart < 0) return null
    let navEnd = lines.length
    for (let i = navStart + 1; i < lines.length; i++) {
      const ln = lines[i]
      if (ln.trim() === '') continue
      if (!/^\s/.test(ln)) {
        navEnd = i
        break
      }
    }
    let anchor = -1
    let indent = '        '
    for (let i = navStart + 1; i < navEnd; i++) {
      const ln = lines[i]
      // 已有画廊入口（用户手加或本插件加的）→ 幂等返回
      if (/ShowMenu\(\s*["']gallery["']\s*\)/.test(ln)) return null
      // 定位「关于」按钮作为插入锚点（画廊通常放在关于之前）
      if (anchor < 0 && /textbutton\s+_\(\s*["']关于["']\s*\)\s+action\s+ShowMenu\(\s*["']about["']\s*\)/.test(ln)) {
        anchor = i
        indent = /^\s*/.exec(ln)[0]
      }
    }
    const entry = indent + 'textbutton _("画廊") action ShowMenu("gallery")'
    if (anchor >= 0) {
      lines.splice(anchor + 1, 0, '', entry)
      return lines.join('\n')
    }
    // 无「关于」按钮：插到 navigation 内首个实际语句之后（跳过空行与注释）。
    // 首语句是容器（vbox 等）→ 按钮进容器内（缩进 +4）；否则同级插入。
    for (let i = navStart + 1; i < navEnd; i++) {
      const ln = lines[i]
      if (ln.trim() === '' || ln.trim().startsWith('#')) continue
      if (/^\s+\S/.test(ln)) {
        const isContainer = /^\s*(vbox|hbox|grid|fixed|side|frame|window|viewport)\s*:/.test(ln)
        const childIndent = /^\s*/.exec(ln)[0]
        const indent = isContainer ? childIndent + '    ' : childIndent
        lines.splice(i + 1, 0, '', indent + 'textbutton _("画廊") action ShowMenu("gallery")')
        return lines.join('\n')
      }
    }
    return null
  }

  // 确保 navigation 屏幕有「画廊」入口（幂等；只要打开过画廊面板即注入，
  // 未配置 CG 时进入画廊显示「暂未配置」占位，而不是连入口都没有）
  function ensureNavEntryForProject() {
    return loom.fs
      .read('game/screens.rpy')
      .then((src) => {
        const next = ensureNavEntry(src)
        if (next === null || next === src) return
        return loom.fs.write('game/screens.rpy', next).then(() => {
          loom.toast('已为画廊在导航中添加「画廊」入口', 'success')
        })
      })
      .catch(() => {})
  }

  // ---------- 图片扫描（递归 game/ 下所有图片）----------
  function scanImages() {
    function walk(dir) {
      return loom.project.listFiles(dir || '').then((items) => {
        const out = []
        const tasks = (items || []).map((it) => {
          if (it.isDir) {
            return walk(it.path).then((sub) => {
              out.push.apply(out, sub)
            })
          }
          if (IMG_RE.test(it.name)) out.push({ path: it.path, name: it.name })
          return null
        })
        return Promise.all(tasks).then(() => out)
      })
    }
    return walk('').then((list) =>
      list.sort((a, b) => a.path.localeCompare(b.path))
    )
  }

  // ---------- 已定义图片检测：扫描项目所有 .rpy 中的 image 语句 ----------
  function scanDefinedImages() {
    function walkRpy(dir) {
      return loom.project.listFiles(dir || '').then((items) => {
        const out = []
        const tasks = (items || []).map((it) => {
          if (it.isDir) {
            return walkRpy(it.path).then((sub) => {
              out.push.apply(out, sub)
            })
          }
          if (/\.rpy$/i.test(it.name)) out.push(it.path)
          return null
        })
        return Promise.all(tasks).then(() => out)
      })
    }
    return walkRpy('').then((files) =>
      Promise.all(
        files.map((f) =>
          loom.fs
            .read('game/' + f)
            .then((content) => {
              const set = new Set()
              if (!content) return set
              content.split(/\r?\n/).forEach((ln) => {
                const m = /^\s*image\s+(.+?)\s*=\s*/.exec(ln)
                if (m) {
                  const name = m[1].trim().replace(/\s+/g, ' ')
                  if (name) set.add(name)
                }
              })
              return set
            })
            .catch(() => new Set())
        )
      ).then((sets) => {
        const all = new Set()
        sets.forEach((s) => s.forEach((v) => all.add(v)))
        return all
      })
    )
  }
  // 重新检测已定义图片，并刷新面板标记
  function refreshDefined() {
    return scanDefinedImages()
      .then((set) => {
        definedImages = set
        if (listEl) renderList(listEl)
      })
      .catch(() => {
        definedImages = new Set()
      })
  }

  // ---------- 从真实代码反向同步 ----------
  // 解析 gallery.rpy（本插件生成的格式，或用户按同格式手写的）→ { columns, cgs }
  // 无法识别（无 screen gallery / 无任何 g.button）时返回 null，不覆盖面板状态
  function parseGalleryCode(src) {
    const imgDefs = new Map() // 图片名 → 路径（image X = "path"）
    let columns = 3
    let inGalleryScreen = false
    const cgs = []
    let cur = null
    const lines = String(src).split(/\r?\n/)
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i].trim()
      if (ln === '' || ln.startsWith('#')) continue
      // image 定义（文件任意位置）
      const im = /^image\s+(.+?)\s*=\s*["']?([^"'\s]+)/.exec(ln)
      if (im) {
        const name = im[1].trim().replace(/^["']|["']$/g, '').replace(/\s+/g, ' ')
        if (name) imgDefs.set(name, im[2])
        continue
      }
      // screen gallery()：进入块；其他顶层 screen 退出块
      if (/^screen\s+gallery\s*\(/.test(ln)) {
        inGalleryScreen = true
        continue
      }
      if (inGalleryScreen && /^screen\s+\w/.test(ln)) {
        inGalleryScreen = false
      }
      if (inGalleryScreen) {
        const gm = /^grid\s+(\d+)\s+(\d+)\s*:/.exec(ln)
        if (gm) columns = parseInt(gm[1], 10)
      }
      // init python 里的 button / unlock_image
      const bm = /^g\.button\(\s*["']([^"']+)["']\s*\)/.exec(ln)
      if (bm) {
        cgs.push({ id: 'cg-' + (cgs.length + 1), name: bm[1], diffs: [] })
        cur = cgs[cgs.length - 1]
        continue
      }
      const um = /^g\.unlock_image\(\s*["']([^"']+)["']\s*\)/.exec(ln)
      if (um && cur) {
        const imgName = um[1]
        cur.diffs.push({
          id: 'diff-' + cgs.length + '-' + (cur.diffs.length + 1),
          imgName,
          path: imgDefs.get(imgName) ?? '',
        })
      }
    }
    if (!/screen\s+gallery\s*\(/.test(String(src)) || cgs.length === 0) return null
    return { columns, cgs }
  }
  // 读取 game/gallery.rpy 同步到面板状态；内容有变化才提示
  function syncFromCode() {
    return loom.fs
      .read('game/gallery.rpy')
      .then((src) => {
        if (!src || !src.trim()) return
        const parsed = parseGalleryCode(src)
        if (!parsed) return
        const s = load()
        // 面板中无差分的新建 CG（尚未配图）在文件里没有对应的 g.button
        // （generateCode 会过滤空 CG），解析结果不会包含它们。
        // 合并回来，否则「添加CG」后 400ms 写盘 → app:saved → 同步时会被立刻删掉。
        const pendingEmpty = (s.cgs || []).filter((cg) => !(cg.diffs && cg.diffs.length > 0))
        parsed.cgs = parsed.cgs.concat(pendingEmpty)
        const changed =
          s.columns !== parsed.columns || JSON.stringify(s.cgs) !== JSON.stringify(parsed.cgs)
        if (!changed) return
        s.columns = parsed.columns
        s.cgs = parsed.cgs
        save(s)
        if (listEl) renderList(listEl)
      })
      .catch(() => {})
  }

  // ---------- 缩略图（懒加载 + 缓存）----------
  function loadThumb(img) {
    const path = img && img.getAttribute('data-path')
    if (!path) return
    if (thumbCache.has(path)) {
      img.src = thumbCache.get(path)
      return
    }
    loom.project
      .readImage(path)
      .then((url) => {
        if (!url) return
        thumbCache.set(path, url)
        if (img.getAttribute('data-path') === path) img.src = url
      })
      .catch(() => {})
  }

  // ---------- 模态框 ----------
  let modalStack = []
  function openModal(cardHtml) {
    const overlay = document.createElement('div')
    overlay.className = 'gal-modal'
    overlay.innerHTML =
      '<div class="gal-modal-card">' + cardHtml + '</div>'
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) closeModal(overlay)
    })
    document.body.appendChild(overlay)
    modalStack.push(overlay)
    return overlay
  }
  function closeModal(overlay) {
    const i = modalStack.indexOf(overlay)
    if (i >= 0) modalStack.splice(i, 1)
    if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay)
    const top = modalStack[modalStack.length - 1]
    if (top) {
      const inp = top.querySelector('input.gal-search')
      if (inp) inp.focus()
    }
  }
  function modalHead(title) {
    return (
      '<div class="gal-modal-head"><span>' +
      esc(title) +
      '</span><button type="button" class="gal-x" data-act="close">✕</button></div>'
    )
  }
  function modalFoot(btnsHtml) {
    return '<div class="gal-modal-foot">' + (btnsHtml || '') + '</div>'
  }

  // 确认框 → Promise<boolean>
  function confirmModal(msg) {
    return new Promise((resolve) => {
      const overlay = openModal(
        modalHead('确认') +
          '<div class="gal-modal-body" style="font-size:13px;line-height:1.6">' +
          esc(msg) +
          '</div>' +
          modalFoot(
            '<button type="button" class="gal-btn gal-primary" style="flex:none;padding:5px 14px" data-act="ok">确定</button>' +
              '<button type="button" class="gal-btn" style="flex:none;padding:5px 14px" data-act="cancel">取消</button>'
          )
      )
      overlay.querySelector('[data-act="ok"]').addEventListener('click', () => {
        closeModal(overlay)
        resolve(true)
      })
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => {
        closeModal(overlay)
        resolve(false)
      })
      overlay.querySelector('[data-act="close"]').addEventListener('click', () => {
        closeModal(overlay)
        resolve(false)
      })
    })
  }

  // 图片选择框 → Promise<{path,name}|null>
  function pickImageModal() {
    return new Promise((resolve) => {
      let images = []
      let settled = false
      const overlay = openModal(
        modalHead('选择差分图片') +
          '<div class="gal-modal-body">' +
          '<input type="text" class="gal-search" placeholder="搜索图片…" />' +
          '<div class="gal-grid"></div>' +
          '</div>' +
          modalFoot(
            '<span class="gal-count"></span>' +
              '<button type="button" class="gal-btn" style="flex:none;padding:5px 12px" data-act="upload">上传图片…</button>' +
              '<button type="button" class="gal-btn" style="flex:none;padding:5px 14px" data-act="cancel">取消</button>'
          )
      )
      const grid = overlay.querySelector('.gal-grid')
      const search = overlay.querySelector('.gal-search')
      const count = overlay.querySelector('.gal-count')

      function done(r) {
        if (settled) return
        settled = true
        closeModal(overlay)
        resolve(r)
      }
      overlay.querySelector('[data-act="cancel"]').addEventListener('click', () => done(null))
      overlay.querySelector('[data-act="close"]').addEventListener('click', () => done(null))
      overlay.querySelector('[data-act="upload"]').addEventListener('click', () => {
        // 上传：打开系统选择框，复制到项目 game/gallery/，成功后直接选用
        loom.fs
          .uploadImage()
          .then((r) => {
            if (r.cancelled) return
            loom.toast('已上传到 ' + r.path, 'success')
            done({ path: r.path, name: r.name })
          })
          .catch((e) => loom.toast('上传失败：' + e, 'error'))
      })

      function renderGrid(filter) {
        const kw = (filter || '').trim().toLowerCase()
        const list = kw
          ? images.filter((im) => im.path.toLowerCase().includes(kw))
          : images
        count.textContent = '共 ' + images.length + ' 张图片'
        grid.innerHTML = ''
        list.forEach((im, idx) => {
          const item = document.createElement('div')
          item.className = 'gal-item'
          item.innerHTML =
            '<img data-path="' + esc(im.path) + '" alt="" /><span>' + esc(im.path) + '</span>'
          item.addEventListener('click', () => done({ path: im.path, name: im.name }))
          grid.appendChild(item)
          // 延迟加载缩略图，避免一次性解码过多
          const imEl = item.querySelector('img')
          setTimeout(() => loadThumb(imEl), Math.min(idx, 200) * 8)
        })
      }
      search.addEventListener('input', () => renderGrid(search.value))
      scanImages().then((list) => {
        images = list
        renderGrid('')
      })
    })
  }

  // ---------- 面板 ----------
  const expanded = new Set()
  let rootEl = null

  const STATIC_HTML =
    '<style>' +
    '.gal-root{display:flex;flex-direction:column;gap:8px;font-size:12px;color:rgb(var(--loom-text))}' +
    '.gal-toolbar{display:flex;gap:6px}' +
    '.gal-btn{flex:1;padding:5px 0;border-radius:6px;border:1px solid rgb(var(--loom-border));background:rgb(var(--loom-panel2));color:rgb(var(--loom-text));cursor:pointer;font-size:12px}' +
    '.gal-btn:hover{border-color:rgb(var(--loom-accent));color:rgb(var(--loom-accent))}' +
    '.gal-primary{background:rgb(var(--loom-accent));color:rgb(var(--loom-bg));border-color:transparent;font-weight:600}' +
    '.gal-list{display:flex;flex-direction:column;gap:6px;max-height:62vh;overflow-y:auto}' +
    '.gal-empty{color:rgb(var(--loom-muted));padding:8px 2px;line-height:1.6}' +
    '.gal-cg{border:1px solid rgb(var(--loom-border));border-radius:8px;background:rgb(var(--loom-panel));overflow:hidden}' +
    '.gal-cg-head{display:flex;align-items:center;gap:6px;padding:5px 6px;cursor:pointer;user-select:none}' +
    '.gal-cg-head:hover{background:rgb(var(--loom-panel2))}' +
    '.gal-thumb{width:34px;height:34px;object-fit:cover;border-radius:5px;border:1px solid rgb(var(--loom-border));background:rgb(var(--loom-bg));flex-shrink:0}' +
    '.gal-cg-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600}' +
    '.gal-badge{flex-shrink:0;font-size:10px;color:rgb(var(--loom-muted));background:rgb(var(--loom-panel2));border:1px solid rgb(var(--loom-border));border-radius:9px;padding:1px 6px}' +
    '.gal-ops{display:flex;gap:1px;flex-shrink:0}' +
    '.gal-op{width:19px;height:19px;border:0;background:transparent;color:rgb(var(--loom-muted));cursor:pointer;border-radius:4px;font-size:11px;line-height:1;padding:0}' +
    '.gal-op:hover{color:rgb(var(--loom-text));background:rgb(var(--loom-panel2))}' +
    '.gal-op.danger:hover{color:rgb(var(--loom-err));background:rgb(var(--loom-err)/0.12)}' +
    '.gal-diffs{border-top:1px dashed rgb(var(--loom-border));padding:5px 6px;display:flex;flex-direction:column;gap:4px}' +
    '.gal-diff{display:flex;align-items:center;gap:6px;padding:3px 4px;border-radius:6px;background:rgb(var(--loom-bg))}' +
    '.gal-diff .gal-thumb{width:26px;height:26px}' +
    '.gal-diff-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;font-family:ui-monospace,Menlo,monospace}' +
    '.gal-flag{flex-shrink:0;font-size:10px;padding:1px 6px;border-radius:8px;border:1px solid rgb(var(--loom-accent)/0.45);color:rgb(var(--loom-accent));background:rgb(var(--loom-accent)/0.1);white-space:nowrap}' +
    '.gal-add{width:100%;margin-top:2px;padding:4px 0;border:1px dashed rgb(var(--loom-border));border-radius:6px;background:transparent;color:rgb(var(--loom-muted));cursor:pointer;font-size:11px}' +
    '.gal-add:hover{color:rgb(var(--loom-accent));border-color:rgb(var(--loom-accent))}' +
    '.gal-foot{display:flex;align-items:center;gap:8px;color:rgb(var(--loom-muted));padding-top:2px}' +
    '.gal-cols{display:flex;align-items:center;gap:6px}' +
    '.gal-hint{font-size:10px;color:rgb(var(--loom-muted));padding-top:3px;line-height:1.5}' +
    '.gal-num{width:46px;padding:2px 5px;border-radius:5px;border:1px solid rgb(var(--loom-border));background:rgb(var(--loom-bg));color:rgb(var(--loom-text));font-size:12px}' +
    '.gal-name-input{flex:1;min-width:0;font:inherit;font-weight:600;background:rgb(var(--loom-bg));color:rgb(var(--loom-text));border:1px solid rgb(var(--loom-accent));border-radius:4px;padding:2px 5px}' +
    '.gal-diff .gal-name-input{font-weight:400;font-family:ui-monospace,Menlo,monospace;font-size:11px}' +
    '.gal-modal{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,0.5);display:flex;align-items:center;justify-content:center;padding:24px}' +
    '.gal-modal-card{background:rgb(var(--loom-panel));border:1px solid rgb(var(--loom-border));border-radius:10px;width:min(620px,92vw);max-height:84vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 12px 40px rgba(0,0,0,0.35)}' +
    '.gal-modal-head{padding:8px 12px;font-weight:600;font-size:13px;border-bottom:1px solid rgb(var(--loom-border));display:flex;justify-content:space-between;align-items:center}' +
    '.gal-x{border:0;background:transparent;color:rgb(var(--loom-muted));cursor:pointer;font-size:13px;padding:2px 4px;border-radius:4px}' +
    '.gal-x:hover{color:rgb(var(--loom-text));background:rgb(var(--loom-panel2))}' +
    '.gal-modal-body{padding:10px 12px;overflow-y:auto;min-height:80px}' +
    '.gal-modal-foot{padding:8px 12px;border-top:1px solid rgb(var(--loom-border));display:flex;justify-content:flex-end;gap:8px;align-items:center}' +
    '.gal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:8px}' +
    '.gal-item{border:1px solid rgb(var(--loom-border));border-radius:8px;overflow:hidden;cursor:pointer;background:rgb(var(--loom-panel2))}' +
    '.gal-item:hover{border-color:rgb(var(--loom-accent))}' +
    '.gal-item img{width:100%;height:72px;object-fit:cover;display:block;background:rgb(var(--loom-bg))}' +
    '.gal-item span{display:block;font-size:10px;color:rgb(var(--loom-muted));padding:3px 4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}' +
    '.gal-search{width:100%;box-sizing:border-box;padding:5px 8px;border-radius:6px;border:1px solid rgb(var(--loom-border));background:rgb(var(--loom-bg));color:rgb(var(--loom-text));font-size:12px;margin-bottom:8px}' +
    '.gal-count{font-size:11px;color:rgb(var(--loom-muted));margin-right:auto}' +
    '</style>' +
    '<div class="gal-root">' +
    '<div class="gal-toolbar">' +
    '<button type="button" class="gal-btn gal-primary" data-act="addCg">＋ 添加CG</button>' +
    '</div>' +
    '<div class="gal-list" data-role="list"></div>' +
    '<div class="gal-foot">' +
    '<label class="gal-cols" title="画廊界面中每行显示的 CG 数量；总行数自动计算">每行CG数' +
    '<input type="number" class="gal-num" data-role="cols" min="1" max="8" step="1" /></label>' +
    '</div>' +
    '<div class="gal-hint">修改自动保存到 game/gallery.rpy · 已在导航菜单自动添加「画廊」入口</div>' +
    '</div>'

  function renderList(container) {
    const state = load()
    const hasProject = !!loom.project.getPath()
    let html = ''
    if (!hasProject) {
      html += '<div class="gal-empty">请先打开一个项目，再管理画廊 CG。</div>'
    } else if (state.cgs.length === 0) {
      html += '<div class="gal-empty">还没有 CG。<br/>点击「＋ 添加CG」创建，再为每张 CG 添加差分图片。</div>'
    } else {
      state.cgs.forEach((cg, ci) => {
        const open = expanded.has(cg.id)
        const first = cg.diffs[0]
        html += '<div class="gal-cg" data-id="' + esc(cg.id) + '">'
        html += '<div class="gal-cg-head" data-act="toggle">'
        html +=
          '<img class="gal-thumb" data-path="' +
          esc(first ? first.path : '') +
          '" alt="" />'
        html += '<span class="gal-cg-name" data-role="name">' + esc(cg.name) + '</span>'
        html += '<span class="gal-badge">' + cg.diffs.length + '</span>'
        html += '<span class="gal-ops">'
        html += '<button type="button" class="gal-op" data-act="renameCg" title="重命名">✎</button>'
        html +=
          '<button type="button" class="gal-op" data-act="upCg" title="上移" ' +
          (ci === 0 ? 'disabled style="opacity:.35"' : '') +
          '>↑</button>'
        html +=
          '<button type="button" class="gal-op" data-act="downCg" title="下移" ' +
          (ci === state.cgs.length - 1 ? 'disabled style="opacity:.35"' : '') +
          '>↓</button>'
        html +=
          '<button type="button" class="gal-op danger" data-act="rmCg" title="删除">✕</button>'
        html += '</span>'
        html += '</div>'
        if (open) {
          html += '<div class="gal-diffs">'
          cg.diffs.forEach((d, di) => {
            html += '<div class="gal-diff" data-id="' + esc(d.id) + '">'
            html += '<img class="gal-thumb" data-path="' + esc(d.path) + '" alt="" />'
            html += '<span class="gal-diff-name" data-role="diffname" title="' + esc(d.path) + '">' + esc(d.imgName) + '</span>'
            if (definedImages && definedImages.has(d.imgName)) {
              html += '<span class="gal-flag" title="项目脚本中已有 image 语句定义该画面，保存时不再重复生成">已定义</span>'
            }
            html += '<span class="gal-ops">'
            html += '<button type="button" class="gal-op" data-act="renameDiff" title="画面名">✎</button>'
            html +=
              '<button type="button" class="gal-op" data-act="upDiff" title="上移" ' +
              (di === 0 ? 'disabled style="opacity:.35"' : '') +
              '>↑</button>'
            html +=
              '<button type="button" class="gal-op" data-act="downDiff" title="下移" ' +
              (di === cg.diffs.length - 1 ? 'disabled style="opacity:.35"' : '') +
              '>↓</button>'
            html += '<button type="button" class="gal-op danger" data-act="rmDiff" title="移除">✕</button>'
            html += '</span>'
            html += '</div>'
          })
          html += '<button type="button" class="gal-add" data-act="addDiff">＋ 差分</button>'
          html += '</div>'
        }
        html += '</div>'
      })
    }
    container.innerHTML = html
    container.querySelectorAll('img[data-path]').forEach(loadThumb)
  }

  function mount(root) {
    rootEl = root
    listEl = root.querySelector('[data-role="list"]')
    const colsEl = root.querySelector('[data-role="cols"]')
    const state = load()
    colsEl.value = String(state.columns)

    // 顶部按钮
    root.querySelector('[data-act="addCg"]').addEventListener('click', () => {
      if (!loom.project.getPath()) {
        loom.toast('请先打开项目', 'info')
        return
      }
      const s = load()
      const cg = { id: uid(), name: 'CG ' + (s.cgs.length + 1), diffs: [] }
      s.cgs.push(cg)
      save(s)
      expanded.add(cg.id)
      renderList(listEl)
    })

    // 底部配置
    colsEl.addEventListener('change', () => {
      const v = parseInt(colsEl.value, 10)
      const s = load()
      s.columns = isNaN(v) ? 3 : Math.max(1, Math.min(8, v))
      colsEl.value = String(s.columns)
      save(s)
    })

    // 列表事件（事件委托）
    listEl.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]')
      const cgCard = e.target.closest('.gal-cg')
      const diffRow = e.target.closest('.gal-diff')
      const s = load()
      const cgId = cgCard ? cgCard.getAttribute('data-id') : null
      const cg = s.cgs.find((c) => c.id === cgId)
      if (!cg) return

      const act = btn ? btn.getAttribute('data-act') : null
      if (act) {
        e.stopPropagation()
        if (act === 'toggle') {
          // 点击卡片头：展开 / 收起差分列表
          if (expanded.has(cgId)) expanded.delete(cgId)
          else expanded.add(cgId)
          renderList(listEl)
          return
        }
        if (act === 'renameCg') {
          startInlineEdit(cgCard.querySelector('[data-role="name"]'), (val) => {
            const v = san(val) || cg.name
            cg.name = v
            save(s)
            renderList(listEl)
          })
          return
        }
        if (act === 'upCg') {
          const i = s.cgs.indexOf(cg)
          if (i > 0) {
            s.cgs.splice(i, 1)
            s.cgs.splice(i - 1, 0, cg)
            save(s)
            renderList(listEl)
          }
          return
        }
        if (act === 'downCg') {
          const i = s.cgs.indexOf(cg)
          if (i < s.cgs.length - 1) {
            s.cgs.splice(i, 1)
            s.cgs.splice(i + 1, 0, cg)
            save(s)
            renderList(listEl)
          }
          return
        }
        if (act === 'rmCg') {
          confirmModal('删除 CG「' + cg.name + '」？').then((ok) => {
            if (!ok) return
            const st = load()
            const idx = st.cgs.findIndex((c) => c.id === cgId)
            if (idx >= 0) st.cgs.splice(idx, 1)
            expanded.delete(cgId)
            save(st)
            renderList(listEl)
          })
          return
        }
        if (act === 'addDiff') {
          pickImageModal().then((picked) => {
            if (!picked) return
            const st = load()
            const c = st.cgs.find((x) => x.id === cgId)
            if (!c) return
            c.diffs.push({ id: uid(), path: picked.path, imgName: basename(picked.path) })
            save(st)
            renderList(listEl)
          })
          return
        }
        // 差分操作
        const diffId = diffRow ? diffRow.getAttribute('data-id') : null
        const diff = cg.diffs.find((d) => d.id === diffId)
        if (!diff) return
        if (act === 'renameDiff') {
          startInlineEdit(diffRow.querySelector('[data-role="diffname"]'), (val) => {
            const v = san(val) || diff.imgName
            diff.imgName = v
            save(s)
            renderList(listEl)
          })
          return
        }
        if (act === 'upDiff') {
          const i = cg.diffs.indexOf(diff)
          if (i > 0) {
            cg.diffs.splice(i, 1)
            cg.diffs.splice(i - 1, 0, diff)
            save(s)
            renderList(listEl)
          }
          return
        }
        if (act === 'downDiff') {
          const i = cg.diffs.indexOf(diff)
          if (i < cg.diffs.length - 1) {
            cg.diffs.splice(i, 1)
            cg.diffs.splice(i + 1, 0, diff)
            save(s)
            renderList(listEl)
          }
          return
        }
        if (act === 'rmDiff') {
          confirmModal('移除差分「' + diff.imgName + '」？').then((ok) => {
            if (!ok) return
            const st = load()
            const c = st.cgs.find((x) => x.id === cgId)
            if (!c) return
            const di = c.diffs.findIndex((d) => d.id === diffId)
            if (di >= 0) c.diffs.splice(di, 1)
            save(st)
            renderList(listEl)
          })
          return
        }
        return
      }
      // 无按钮 → 点击卡片头切换展开（输入框编辑中不触发）
      const tag = e.target && e.target.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (cgCard && e.target.closest('.gal-cg-head')) {
        if (expanded.has(cgId)) expanded.delete(cgId)
        else expanded.add(cgId)
        renderList(listEl)
      }
    })

    renderList(listEl)
    // 挂载后：先同步真实代码（gallery.rpy），再检测已定义图片刷新「已定义」标记，
    // 然后确保导航中有「画廊」入口（否则游戏中没有进画廊的按钮）
    syncFromCode()
      .then(() => refreshDefined())
      .then(ensureNavEntryForProject)
  }

  // 就地重命名（替换名称元素为输入框，回车/失焦提交）
  function startInlineEdit(span, commit) {
    if (!span) return
    const old = span.textContent
    const input = document.createElement('input')
    input.type = 'text'
    input.className = 'gal-name-input'
    input.value = old
    span.replaceWith(input)
    input.focus()
    input.select()
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      commit(ok ? input.value : old)
    }
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true)
      else if (e.key === 'Escape') finish(false)
    })
    input.addEventListener('blur', () => finish(true))
  }

  // ---------- 注册 ----------
  loom.panel.register(
    'gallery.main',
    '画廊',
    { render: () => ({ html: STATIC_HTML, mount }) },
    { sidebar: true }
  )

  // 项目打开 / 切换后，自动同步画廊配置并确保导航中有「画廊」入口。
  // 注意：必须在插件注册顶层绑定（不能放在 mount 里），
  // 否则用户没打开过画廊面板时钩子不生效，入口永远不会注入。
  loom.hooks.on('app:projectOpened', () => {
    syncFromCode()
      .then(() => refreshDefined())
      .then(ensureNavEntryForProject)
  })
  // 在代码编辑器中直接修改并保存 gallery.rpy 时，实时同步面板
  loom.hooks.on('app:saved', (payload) => {
    const file = payload && payload.file
    if (file && /(^|[\\/])gallery\.rpy$/i.test(String(file))) {
      syncFromCode().then(() => refreshDefined())
    }
  })

  // 调试/测试钩子
  if (typeof window !== 'undefined') {
    window.__galleryPlugin = { generateCode, normalize, basename, san, load, save, schedulePersist, scanDefinedImages, refreshDefined, parseGalleryCode, syncFromCode, ensureNavEntry, ensureNavEntryForProject }
  }
})()
