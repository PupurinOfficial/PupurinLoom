// 铃光时刻 —— 内置插件（模式一：AI 标记剧情高光时刻）
// 用用户配置的 AI（OpenAI 兼容协议）在剧情中挑出最有宣传潜力的「铃光时刻」，
// 保存为按项目隔离的标记列表，供后续生成宣传片使用。
//
// 演示/依赖的 loom API：
//   loom.project.getPath / listFiles / openAt / parseProject
//   loom.fs.read / write
//   loom.http.post(url, body, headers, { timeoutMs, maxBytes })
//   loom.store.get / set、loom.toast、loom.panel、loom.commands、loom.hooks
;(function () {
  'use strict'

  var EXPORT_FILE = 'pupurin_moments.json'
  var MARKS_KEY_PREFIX = 'marks:'
  var CONFIG_KEY = 'config'
  var MAX_LOGS = 60

  // ---------- 默认提示词 ----------
  var DEFAULT_JUDGE_PROMPT = [
    '你是一位资深的视觉小说 / Galgame 宣传策划。请从给定的剧情片段中，挑出最有「铃光时刻」潜力的高光片段——即最适合做宣传素材、最能打动玩家或引发传播的瞬间。',
    '',
    '判断标准（按重要性排序）：',
    '1. 情绪张力：情感爆发、告白、离别、牺牲、觉醒、绝境反转、名台词；',
    '2. 意外性：出乎意料但合乎逻辑的转折；',
    '3. 角色魅力：能体现角色性格高光、反差或成长的瞬间；',
    '4. 传播力：单看一句台词或一张画面就能打动人，适合做宣传截图或短视频。',
    '',
    '要求：',
    '- 宁缺毋滥：没有达标的高光就返回空数组；',
    '- 每段剧情最多挑 3 个，优先挑真正最亮的那一个；',
    '- 只依据给定的片段判断，不要脑补未出现的情节。'
  ].join('\n')

  var DEFAULT_OUTPUT_PROMPT = [
    '请只输出 JSON，不要任何解释、不要 Markdown 代码块。格式：',
    '{"moments":[{"label":"所在场景的 label 名","quote":"原文中连续的一句或几句台词/旁白（20~60 字，必须与原文逐字一致，不要改写、不要加角色名前缀）","title":"给这一刻起的标题（8 字以内）","promo":"可直接用于宣传的短文案（20 字以内，有传播力、不剧透结局）","reason":"为什么这是高光时刻（30 字以内）","score":8,"tags":["催泪"]}]}',
    '',
    '注意：',
    '- quote 必须能在给定原文中逐字找到（可去掉引号与缩进），它是定位依据；',
    '- score 为 1~10 的整数，代表高光强度；',
    '- tags 用 1~3 个中文短标签，如 催泪 / 热血 / 反转 / 告白 / 离别 / 悬念。'
  ].join('\n')

  var DEFAULTS = {
    baseUrl: 'https://api.deepseek.com/v1',
    apiKey: '',
    model: 'deepseek-chat',
    temperature: 0.3,
    timeoutMs: 120000,
    maxOutputChars: 200000,
    batchChars: 6000,
    forceJson: false,
    judgePrompt: DEFAULT_JUDGE_PROMPT,
    outputPrompt: DEFAULT_OUTPUT_PROMPT
  }

  // ---------- 模块状态 ----------
  var state = {
    tab: 'run',
    files: null, // [{ path, name, study:是否故事文件, chars }]（path 为 game/ 相对路径）
    fileSel: {}, // path -> 是否参与标记
    contents: {}, // path -> 原文
    labels: null, // [{ file, name, line, endLine, text }]
    scanStale: false,
    selLabel: null, // 织机当前选中的故事 { file, name, line, endLine }
    curFile: '', // 织机当前打开的文件（game/ 相对路径）
    marks: [],
    includedOnly: false,
    sort: 'order',
    run: null
  }
  var overlay = null
  var cssInjected = false

  // ---------- 配置 ----------
  function num(v, fallback, min, max) {
    var n = typeof v === 'number' ? v : parseFloat(v)
    if (!isFinite(n)) return fallback
    return Math.min(max, Math.max(min, n))
  }

  function cfg() {
    var raw = loom.store.get(CONFIG_KEY)
    var c = raw && typeof raw === 'object' ? raw : {}
    return {
      baseUrl: typeof c.baseUrl === 'string' && c.baseUrl ? c.baseUrl : DEFAULTS.baseUrl,
      apiKey: typeof c.apiKey === 'string' ? c.apiKey : DEFAULTS.apiKey,
      model: typeof c.model === 'string' && c.model ? c.model : DEFAULTS.model,
      temperature: num(c.temperature, DEFAULTS.temperature, 0, 2),
      timeoutMs: num(c.timeoutMs, DEFAULTS.timeoutMs, 5000, 600000),
      maxOutputChars: num(c.maxOutputChars, DEFAULTS.maxOutputChars, 1000, 2000000),
      batchChars: num(c.batchChars, DEFAULTS.batchChars, 1000, 30000),
      forceJson: c.forceJson === true,
      judgePrompt: typeof c.judgePrompt === 'string' && c.judgePrompt.trim() ? c.judgePrompt : DEFAULTS.judgePrompt,
      outputPrompt:
        typeof c.outputPrompt === 'string' && c.outputPrompt.trim() ? c.outputPrompt : DEFAULTS.outputPrompt
    }
  }

  function saveCfg(c) {
    loom.store.set(CONFIG_KEY, c)
  }

  // ---------- 标记数据（按项目路径隔离）----------
  function marksKey() {
    return MARKS_KEY_PREFIX + (loom.project.getPath() || '')
  }

  function loadMarks() {
    var d = loom.store.get(marksKey())
    var list = d && Array.isArray(d.marks) ? d.marks : []
    var out = list.filter(function (m) {
      return m && typeof m === 'object' && m.quote
    })
    relocateMarks(out)
    return out
  }

  // 剧本会被继续编辑：按 quote 重新在剧本中定位行号
  // 返回 { total, updated, failed }；manual 模式（用户点「重新定位」）会额外把未匹配的标为「未精确定位」
  function relocateMarks(list, opts) {
    var o = opts || {}
    var files = {}
    list.forEach(function (m) {
      if (m.file && m.quote) files[m.file] = true
    })
    var names = Object.keys(files)
    var updated = 0
    var failed = 0
    if (!names.length) return Promise.resolve({ total: list.length, updated: 0, failed: 0 })
    return Promise.all(
      names.map(function (f) {
        return loom.fs
          .read('game/' + f)
          .then(function (content) {
            var batch = { segs: buildSegments(splitLabels(content), 1e9) }
            list.forEach(function (m) {
              if (m.file !== f || !m.quote) return
              var hit = segmentFor(batch, m.label, m.quote)
              if (!hit || !hit.loc.matched) {
                failed++
                if (o.manual && m.matched !== false) {
                  m.matched = false
                  updated++
                }
                return
              }
              if (m.line !== hit.loc.line || !m.matched) updated++
              m.line = hit.loc.line
              m.matched = true
            })
          })
          .catch(function () {
            // 文件读不到（被删/改名）：整份标记都算未匹配
            list.forEach(function (m) {
              if (m.file === f && m.quote) failed++
            })
          })
      })
    ).then(function () {
      if (o.manual || updated) {
        persistMarks()
        if (overlay && state.tab === 'marks') renderBody()
      }
      return { total: list.length, updated: updated, failed: failed }
    })
  }

  function persistMarks() {
    loom.store.set(marksKey(), { version: 1, updatedAt: Date.now(), marks: state.marks })
  }

  function includedCount() {
    return state.marks.filter(function (m) {
      return m.include !== false
    }).length
  }

  // ---------- 文本工具 ----------
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
  }

  // 归一化：去掉 Ren'Py 文本标签 / 插值 / 引号 / 空白 / 常见标点，便于逐字比对
  function normalizeForMatch(s) {
    return String(s == null ? '' : s)
      .replace(/\{[^}]*\}/g, '')
      .replace(/\[[^\]]*\]/g, '')
      .replace(/["'“”‘’「」『』]/g, '')
      .replace(/[\s\u3000]+/g, '')
      .replace(/[，。！？、；：,.!?;:…—～~\-·]/g, '')
      .toLowerCase()
  }

  // 从模型回复中提取 JSON（容错 Markdown 代码块 / 前后缀说明）
  function extractJson(text) {
    var t = String(text == null ? '' : text).trim()
    if (!t) return null
    var fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(t)
    if (fenced && fenced[1].trim()) t = fenced[1].trim()
    try {
      var direct = JSON.parse(t)
      return Array.isArray(direct) ? { moments: direct } : direct
    } catch (e) {
      /* 继续尝试截取 */
    }
    var objStart = t.indexOf('{')
    var objEnd = t.lastIndexOf('}')
    if (objStart >= 0 && objEnd > objStart) {
      try {
        var obj = JSON.parse(t.slice(objStart, objEnd + 1))
        return Array.isArray(obj) ? { moments: obj } : obj
      } catch (e2) {
        /* 继续尝试数组 */
      }
    }
    var arrStart = t.indexOf('[')
    var arrEnd = t.lastIndexOf(']')
    if (arrStart >= 0 && arrEnd > arrStart) {
      try {
        var arr = JSON.parse(t.slice(arrStart, arrEnd + 1))
        return Array.isArray(arr) ? { moments: arr } : null
      } catch (e3) {
        /* 无法解析 */
      }
    }
    return null
  }

  // 兼容 OpenAI / Anthropic / Gemini 三类响应体的正文提取
  function extractAssistantText(json) {
    if (!json || typeof json !== 'object') return ''
    var joinParts = function (arr) {
      return (arr || [])
        .map(function (p) {
          if (typeof p === 'string') return p
          return p && typeof p.text === 'string' ? p.text : ''
        })
        .join('')
    }
    if (Array.isArray(json.choices) && json.choices[0]) {
      var ch = json.choices[0]
      var c = ch.message ? ch.message.content : ch.text
      if (typeof c === 'string') return c
      if (Array.isArray(c)) return joinParts(c)
    }
    if (json.content !== undefined) {
      if (typeof json.content === 'string') return json.content
      if (Array.isArray(json.content)) return joinParts(json.content)
    }
    if (Array.isArray(json.candidates) && json.candidates[0]) {
      var cand = json.candidates[0]
      if (cand.content && Array.isArray(cand.content.parts)) return joinParts(cand.content.parts)
    }
    if (typeof json.output_text === 'string') return json.output_text
    return ''
  }

  // 对话补全地址归一化：接受 baseUrl（…/v1）或完整 endpoint
  function chatUrl(base) {
    var b = String(base || '')
      .trim()
      .replace(/\/+$/, '')
    if (!b) return ''
    if (/\/chat\/completions$/i.test(b)) return b
    if (/\/completions$/i.test(b)) return b.replace(/\/completions$/i, '/chat/completions')
    return b + '/chat/completions'
  }

  // ---------- 剧本清洗与分块 ----------
  // 代码行前缀（这类行对判断高光无价值，且会稀释提示词）
  var DROP_LINE_RE = /^\s*(#|\$|init\b|define\b|default\b|image\b|transform\b|style\b|screen\b|translate\b|python\b|layeredimage\b|at\b|with\b|show\s+screen|hide\s+screen|voice\b|stop\b|queue\b|window\b)/

  // 清洗后的行，同时保留每行在文件中的绝对行号（清洗会丢行，行号不能按剩余行数累加）
  function cleanLines(text, startLine) {
    var out = []
    var lines = String(text || '').split(/\r?\n/)
    for (var i = 0; i < lines.length; i++) {
      var ln = lines[i]
      if (!ln.trim()) continue
      if (DROP_LINE_RE.test(ln)) continue
      out.push({ text: ln.replace(/\s+$/, ''), line: startLine + i })
    }
    return out
  }

  // 仅用于统计字数的纯文本
  function cleanScript(text) {
    return cleanLines(text, 1)
      .map(function (l) {
        return l.text
      })
      .join('\n')
  }

  // 按 label 切分单个 .rpy（返回行号区间，用于把模型给出的 quote 映射回代码行）
  function splitLabels(content) {
    var lines = String(content || '').split(/\r?\n/)
    var out = []
    var cur = null
    for (var i = 0; i < lines.length; i++) {
      var m = /^\s*label\s+([A-Za-z_][\w.]*)\s*(?:\([^)]*\))?\s*:/.exec(lines[i])
      if (m) {
        if (cur) {
          cur.endLine = i
          out.push(cur)
        }
        cur = { name: m[1], line: i + 1, endLine: lines.length, lines: [] }
      }
      if (cur) cur.lines.push(lines[i])
    }
    if (cur) out.push(cur)
    return out.map(function (l) {
      return { name: l.name, line: l.line, endLine: l.endLine, text: l.lines.join('\n') }
    })
  }

  // 生成片段列表（片段内每行带文件绝对行号；超长 label 按行拆分为多段，行号连续）
  function buildSegments(labels, budget) {
    var segs = []
    for (var i = 0; i < labels.length; i++) {
      var lb = labels[i]
      var entries = cleanLines(lb.text, lb.line)
      if (!entries.length) continue
      var buf = []
      var bufLen = 0
      for (var j = 0; j < entries.length; j++) {
        var e = entries[j]
        var len = e.text.length + 1
        if (bufLen + len > budget && buf.length > 0) {
          segs.push(makeSegment(lb, buf))
          buf = []
          bufLen = 0
        }
        buf.push(e)
        bufLen += len
      }
      if (buf.length) segs.push(makeSegment(lb, buf))
    }
    return segs
  }

  function makeSegment(lb, entries) {
    return {
      file: lb.file,
      label: lb.name,
      startLine: entries[0].line,
      endLine: entries[entries.length - 1].line,
      entries: entries,
      text: entries
        .map(function (e) {
          return e.text
        })
        .join('\n')
    }
  }

  // 把片段合并为请求批次（控制单批字符数，避免单次请求过长）
  function buildBatches(segments, budget) {
    var batches = []
    var cur = { text: '', segs: [] }
    for (var i = 0; i < segments.length; i++) {
      var s = segments[i]
      var head = '### [' + s.file + '] 场景 label: ' + s.label + '（自此第 ' + s.startLine + ' 行）\n'
      var block = head + s.text + '\n'
      if (cur.text && cur.text.length + block.length > budget) {
        batches.push(cur)
        cur = { text: '', segs: [] }
      }
      cur.text += block
      cur.segs.push(s)
    }
    if (cur.text) batches.push(cur)
    return batches
  }

  // 一行里「玩家可见文本」（引号内的台词/旁白）。模型常把相邻多行台词合并成一句引文，
  // 用可见文本流匹配可以忽略行间的角色名前缀与引号，避免定位失败退回到段落起始行。
  function visibleText(line) {
    var out = []
    var re = /"([^"]*)"/g
    var m
    while ((m = re.exec(String(line || '')))) out.push(m[1])
    return out.join('')
  }

  // 在归一化文本流中定位 quote，返回命中的行下标（-1 表示未命中）
  function findInStream(starts, acc, nq) {
    var idx = acc.indexOf(nq)
    if (idx < 0) {
      // 兜底：只匹配前半段（模型可能漏抄了末尾几个字）
      var head = nq.slice(0, Math.max(6, Math.floor(nq.length / 2)))
      idx = acc.indexOf(head)
    }
    if (idx < 0) return -1
    // 命中点所在的那一行，就是该 quote 的起始行
    var hit = 0
    for (var k = 0; k < starts.length; k++) {
      if (starts[k] <= idx) hit = k
      else break
    }
    return hit
  }

  // quote → 绝对行号（找不到时退回片段起始行）
  function locateQuote(segment, quote) {
    var nq = normalizeForMatch(quote)
    if (!nq || nq.length < 2) return { line: segment.startLine, matched: false }
    var entries = segment.entries && segment.entries.length ? segment.entries : null
    if (!entries) {
      // 兜底：没有行号表时按文本行估算（仅测试桩会走到这里）
      entries = String(segment.text || '')
        .split('\n')
        .map(function (t, i) {
          return { text: t, line: segment.startLine + i }
        })
    }
    var visStarts = []
    var visAcc = ''
    var rawStarts = []
    var rawAcc = ''
    for (var i = 0; i < entries.length; i++) {
      visStarts.push(visAcc.length)
      visAcc += normalizeForMatch(visibleText(entries[i].text))
      rawStarts.push(rawAcc.length)
      rawAcc += normalizeForMatch(entries[i].text)
    }
    // 先按可见文本匹配（容忍多行合并引用），失败再退回原始行匹配
    var hit = findInStream(visStarts, visAcc, nq)
    if (hit < 0) hit = findInStream(rawStarts, rawAcc, nq)
    if (hit < 0) return { line: segment.startLine, matched: false }
    return { line: entries[hit].line, matched: true }
  }

  // 片段内找 label 元信息（batch 内可能有多个 label）
  function segmentFor(batch, labelName, quote) {
    // 优先取同名 label 且能定位到 quote 的片段
    var fallback = null
    for (var i = 0; i < batch.segs.length; i++) {
      var s = batch.segs[i]
      if (labelName && s.label !== labelName) continue
      var loc = locateQuote(s, quote)
      if (loc.matched) return { seg: s, loc: loc, exact: true }
      if (!fallback) fallback = { seg: s, loc: loc, exact: false }
    }
    if (fallback) return fallback
    // label 名对不上：全局按 quote 定位
    for (var j = 0; j < batch.segs.length; j++) {
      var s2 = batch.segs[j]
      var loc2 = locateQuote(s2, quote)
      if (loc2.matched) return { seg: s2, loc: loc2, exact: true }
    }
    return null
  }

  // ---------- AI 调用 ----------
  function httpError(r) {
    var body = String(r && r.text ? r.text : '').slice(0, 300)
    if (r && r.status === 401) return 'HTTP 401：API Key 无效或未授权。' + body
    if (r && r.status === 403) return 'HTTP 403：无权限访问该模型。' + body
    if (r && r.status === 404) return 'HTTP 404：接口地址或模型名有误（请检查 baseUrl 与模型）。' + body
    if (r && r.status === 429) return 'HTTP 429：请求过于频繁或额度不足。' + body
    return 'HTTP ' + (r ? r.status : '?') + '：' + body
  }

  function callAI(messages, maxTokens) {
    var c = cfg()
    if (!c.apiKey) throw new Error('请先在「设置」中填写 API Key')
    var url = chatUrl(c.baseUrl)
    if (!url) throw new Error('请先在「设置」中填写 API 地址')
    var body = {
      model: c.model,
      messages: messages,
      temperature: c.temperature
    }
    if (maxTokens) body.max_tokens = maxTokens
    if (c.forceJson) body.response_format = { type: 'json_object' }
    var headers = {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + c.apiKey
    }
    return loom.http
      .post(url, body, headers, { timeoutMs: c.timeoutMs, maxBytes: c.maxOutputChars })
      .then(function (r) {
        if (!r || !r.ok) throw new Error(httpError(r))
        var json
        try {
          json = JSON.parse(r.text)
        } catch (e) {
          throw new Error('响应不是合法 JSON：' + String(r.text || '').slice(0, 200))
        }
        if (json && json.error) {
          throw new Error('接口返回错误：' + String(json.error.message || json.error.code || json.error))
        }
        return extractAssistantText(json)
      })
  }

  function testConnection() {
    return callAI(
      [
        { role: 'system', content: '你是连通性测试助手。' },
        { role: 'user', content: '只回复两个字：可用' }
      ],
      16
    )
  }

  // ---------- 标记流程 ----------
  function logLine(s) {
    if (!state.run) return
    state.run.logs.push(s)
    if (state.run.logs.length > MAX_LOGS) state.run.logs = state.run.logs.slice(-MAX_LOGS)
    renderLogs()
  }

  function scanProject() {
    // fs:list 只列一层，需要自己递归（子目录剧本也要一起标记）
    var found = []
    function walk(dir) {
      return loom.project.listFiles(dir).then(function (items) {
        var jobs = []
        ;(items || []).forEach(function (it) {
          if (it.isDir) {
            jobs.push(walk(it.path))
          } else if (/\.rpy$/i.test(it.name)) {
            found.push({
              path: it.path,
              name: it.name,
              story: it.isStoryFile === true,
              codeFile: isCodeFile(it.path)
            })
          }
        })
        return Promise.all(jobs)
      })
    }
    return walk('')
      .then(function () {
        var files = found.sort(function (a, b) {
          return a.path.localeCompare(b.path)
        })
        return Promise.all(
          files.map(function (f) {
            return loom.fs.read('game/' + f.path).then(function (content) {
              f.chars = content ? content.replace(/\s/g, '').length : 0
              state.contents[f.path] = content || ''
            })
          })
        ).then(function () {
          return files
        })
      })
      .then(function (files) {
        state.files = files
        state.fileSel = {}
        files.forEach(function (f) {
          state.fileSel[f.path] = f.story && !f.codeFile
        })
        // 解析 label（本地正则，行号即文件真实行号）
        var labels = []
        files.forEach(function (f) {
          var parts = splitLabels(state.contents[f.path] || '')
          parts.forEach(function (p) {
            labels.push({ file: f.path, name: p.name, line: p.line, endLine: p.endLine, text: p.text })
          })
        })
        state.labels = labels
        state.scanStale = false
        return { files: files.length, labels: labels.length }
      })
  }

  function isCodeFile(path) {
    if (/^tl\//i.test(path)) return true
    var base = String(path).split('/').pop().toLowerCase()
    return /^(screens|gui|options|gallery|nvl|common|00console|00library)\.rpy$/.test(base)
  }

  function selectedFiles() {
    var out = []
    ;(state.files || []).forEach(function (f) {
      if (state.fileSel[f.path]) out.push(f)
    })
    return out
  }

  function selectedLabels() {
    var sel = {}
    selectedFiles().forEach(function (f) {
      sel[f.path] = true
    })
    return (state.labels || []).filter(function (l) {
      return sel[l.file]
    })
  }

  function plan() {
    var c = cfg()
    var labels = selectedLabels()
    var segs = buildSegments(labels, c.batchChars)
    var batches = buildBatches(segs, c.batchChars)
    var chars = 0
    labels.forEach(function (l) {
      chars += cleanScript(l.text).length
    })
    return { labels: labels, segments: segs, batches: batches, chars: chars }
  }

  function mergeMoment(batch, m) {
    var quote = String(m && m.quote ? m.quote : '').trim()
    if (quote.length < 4) return null
    var hit = segmentFor(batch, String(m.label || '').trim(), quote)
    var seg = hit ? hit.seg : null
    var line = hit ? hit.loc.line : 0
    var file = seg ? seg.file : batch.segs[0].file
    var label = seg ? seg.label : String(m.label || '')
    var mk = {
      id: 'm' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
      file: file,
      line: line,
      label: label,
      quote: quote,
      matched: !!(hit && hit.exact),
      title: String(m.title || '').trim() || quote.slice(0, 8),
      promo: String(m.promo || '').trim(),
      reason: String(m.reason || '').trim(),
      score: num(m.score, 6, 1, 10),
      tags: Array.isArray(m.tags)
        ? m.tags
            .map(function (t) {
              return String(t).trim()
            })
            .filter(Boolean)
            .slice(0, 3)
        : [],
      include: true,
      createdAt: Date.now()
    }
    return mk
  }

  function mergeIntoMarks(list) {
    var added = 0
    var updated = 0
    list.forEach(function (mk) {
      var dup = null
      for (var i = 0; i < state.marks.length; i++) {
        var old = state.marks[i]
        if (old.file === mk.file && old.line === mk.line) {
          dup = old
          break
        }
      }
      if (!dup) {
        state.marks.push(mk)
        added++
        return
      }
      // 同位置：保留高分与更完整的信息，入选状态沿用旧值
      if (mk.score > dup.score) {
        dup.score = mk.score
        dup.title = mk.title || dup.title
        dup.promo = mk.promo || dup.promo
        dup.reason = mk.reason || dup.reason
        dup.tags = mk.tags.length ? mk.tags : dup.tags
      }
      updated++
    })
    return { added: added, updated: updated }
  }

  function startRun() {
    if (state.run && state.run.running) return
    if (!loom.project.getPath()) {
      loom.toast('请先打开一个项目', 'error')
      return
    }
    var c = cfg()
    if (!c.apiKey) {
      loom.toast('请先在「设置」中填写 API Key', 'error')
      state.tab = 'cfg'
      renderBody()
      return
    }
    if (!state.labels) {
      loom.toast('请先点击「扫描项目」', 'error')
      return
    }
    var p = plan()
    if (!p.batches.length) {
      loom.toast('所选文件中没有可分析的剧情（请检查文件勾选）', 'error')
      return
    }
    state.run = {
      running: true,
      cancel: false,
      total: p.batches.length,
      done: 0,
      found: 0,
      msg: '准备中…',
      error: '',
      logs: []
    }
    logLine('已选 ' + selectedFiles().length + ' 个文件 · ' + p.chars + ' 字 · 共 ' + p.batches.length + ' 批')
    renderBody()
    var chain = Promise.resolve()
    p.batches.forEach(function (batch, i) {
      chain = chain.then(function () {
        if (!state.run || state.run.cancel) return
        state.run.msg = '第 ' + (i + 1) + '/' + p.batches.length + ' 批：' + batch.segs[0].file + ' · ' + batch.segs[0].label
        updateProgressDom()
        var messages = [
          { role: 'system', content: c.judgePrompt },
          {
            role: 'user',
            content: c.outputPrompt + '\n\n===== 待分析的剧情片段 =====\n' + batch.text
          }
        ]
        return callAI(messages).then(function (text) {
          var obj = extractJson(text)
          var arr = obj && (obj.moments || obj.highlights || obj.data)
          var list = Array.isArray(arr) ? arr : []
          var ms = []
          list.forEach(function (m) {
            var mk = mergeMoment(batch, m)
            if (mk) ms.push(mk)
          })
          var r = mergeIntoMarks(ms)
          state.run.done = i + 1
          state.run.found = state.marks.length
          persistMarks()
          logLine(
            '[' +
              (i + 1) +
              '/' +
              p.batches.length +
              '] ' +
              batch.segs[0].file +
              ' → 新增 ' +
              r.added +
              ' 个' +
              (r.updated ? '（合并 ' + r.updated + ' 个）' : '')
          )
          updateProgressDom()
          refreshPanels()
        })
      })
    })
    chain
      .then(function () {
        if (!state.run) return
        var cancelled = state.run.cancel
        state.run.running = false
        state.run.cancel = false
        state.run.msg = cancelled
          ? '已中断：本次新标记 ' + state.marks.length + ' 个'
          : '完成：共 ' + state.marks.length + ' 个铃光时刻'
        logLine(state.run.msg)
        updateProgressDom()
        renderBody()
        loom.toast(state.run.msg, 'success')
        refreshPanels()
      })
      .catch(function (e) {
        if (!state.run) return
        state.run.running = false
        state.run.error = String(e && e.message ? e.message : e)
        state.run.msg = '出错：' + state.run.error
        logLine(state.run.msg)
        updateProgressDom()
        renderBody()
        loom.toast('标记失败：' + state.run.error, 'error')
      })
  }

  // ---------- 界面 ----------
  function injectCss() {
    if (cssInjected) return
    cssInjected = true
    var style = document.createElement('style')
    style.textContent = [
      // 功能栏面板（撑满侧边栏高度：列表占满剩余空间并内部滚动）
      '.sz-panel-body{display:flex;flex-direction:column;flex:1 1 auto;min-height:0}',
      '.sz-panel{display:flex;flex-direction:column;gap:8px;flex:1 1 auto;min-height:0}',
      '.sz-stat{font-size:11px;color:rgb(var(--loom-muted));line-height:1.7;background:rgb(var(--loom-bg));border:1px solid rgb(var(--loom-border));border-radius:6px;padding:6px 8px}',
      '.sz-stat b{color:rgb(var(--loom-accent));font-weight:600}',
      '.sz-hint{font-size:10px;color:rgb(var(--loom-muted));line-height:1.5}',
      // 侧边栏：当前文件的铃光时刻列表（占满剩余高度、内部滚动）
      '.sz-panel>*{flex-shrink:0}',
      '.sz-panel-head{display:flex;align-items:baseline;justify-content:space-between;gap:6px;font-size:11px}',
      '.sz-panel-name{font-weight:600;color:rgb(var(--loom-accent));word-break:break-all}',
      '.sz-panel-list{display:flex;flex-direction:column;gap:6px;flex:1 1 auto;min-height:0;overflow:auto}',
      '.sz-panel-item{display:flex;flex-wrap:wrap;align-items:center;gap:4px 6px;text-align:left;width:100%;border:1px solid rgb(var(--loom-border));background:rgb(var(--loom-bg));color:rgb(var(--loom-text));border-radius:6px;padding:5px 7px;cursor:pointer;font-family:inherit;font-size:11px}',
      '.sz-panel-item:hover{border-color:rgb(var(--loom-accent))}',
      '.sz-panel-item.sz-off{opacity:.55}',
      '.sz-panel-title{font-weight:600;flex:1 1 auto}',
      '.sz-panel-line{font-size:10px;color:rgb(var(--loom-muted));font-family:ui-monospace,Menlo,monospace}',
      '.sz-panel-quote{flex:1 1 100%;font-size:10px;color:rgb(var(--loom-muted));line-height:1.4;overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}',
      // 按钮
      '.sz-btn{border:1px solid rgb(var(--loom-border));background:rgb(var(--loom-panel2));color:rgb(var(--loom-text));border-radius:6px;padding:5px 10px;font-size:11px;cursor:pointer;font-family:inherit}',
      '.sz-btn:hover{border-color:rgb(var(--loom-accent));color:rgb(var(--loom-accent))}',
      '.sz-btn.sz-primary{background:rgb(var(--loom-accent));border-color:rgb(var(--loom-accent));color:rgb(var(--loom-bg));font-weight:600}',
      '.sz-btn.sz-primary:hover{opacity:.9;color:rgb(var(--loom-bg))}',
      '.sz-btn:disabled{opacity:.5;cursor:not-allowed}',
      '.sz-btn.sz-danger:hover{border-color:rgb(var(--loom-err));color:rgb(var(--loom-err))}',
      // 工作台
      '.sz-modal{position:fixed;inset:0;z-index:1200;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:28px}',
      '.sz-shell{background:rgb(var(--loom-panel));border:1px solid rgb(var(--loom-border));border-radius:12px;width:min(1080px,96vw);height:min(760px,92vh);display:flex;flex-direction:column;overflow:hidden;box-shadow:0 16px 48px rgba(0,0,0,.4)}',
      '.sz-head{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid rgb(var(--loom-border));background:rgb(var(--loom-panel2));flex-shrink:0}',
      '.sz-title{font-size:13px;font-weight:600}',
      '.sz-star{color:rgb(var(--loom-accent))}',
      '.sz-tabs{display:flex;gap:4px;margin-left:8px}',
      '.sz-tab{border:1px solid transparent;background:transparent;color:rgb(var(--loom-muted));border-radius:6px;padding:4px 10px;font-size:12px;cursor:pointer;font-family:inherit}',
      '.sz-tab:hover{color:rgb(var(--loom-text))}',
      '.sz-tab.sz-on{background:rgb(var(--loom-accent)/0.12);border-color:rgb(var(--loom-accent)/0.4);color:rgb(var(--loom-accent));font-weight:600}',
      '.sz-x{margin-left:auto;border:0;background:transparent;color:rgb(var(--loom-muted));cursor:pointer;font-size:14px;padding:2px 6px;border-radius:4px}',
      '.sz-x:hover{color:rgb(var(--loom-text));background:rgb(var(--loom-panel))}',
      '.sz-body{flex:1;min-height:0;overflow-y:auto;padding:14px}',
      '.sz-section{margin-bottom:14px}',
      '.sz-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px}',
      '.sz-ell{max-width:132px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex:none}',
      '.sz-fold{margin:0 0 4px;border-top:1px solid rgb(var(--loom-border))}',
      '.sz-fold>summary{display:flex;align-items:center;gap:8px;padding:7px 2px;cursor:pointer;list-style:none;font-size:12px;font-weight:600}',
      '.sz-fold>summary::-webkit-details-marker{display:none}',
      '.sz-fold>summary::before{content:"\\25B8";font-size:9px;color:rgb(var(--loom-muted))}',
      '.sz-fold[open]>summary::before{content:"\\25BE"}',
      '.sz-fold-body{padding:2px 0 8px 12px}',
      '.sz-fold.sz-inner{border-top:0;margin:0 0 6px}',
      '.sz-fold.sz-inner>summary{padding:4px 2px;font-size:11px;font-weight:400;color:rgb(var(--loom-muted))}',
      '.sz-fold.sz-inner .sz-fold-body{padding-left:0}',
      '.sz-muted{font-size:11px;color:rgb(var(--loom-muted))}',
      '.sz-files{border:1px solid rgb(var(--loom-border));border-radius:8px;max-height:190px;overflow-y:auto;background:rgb(var(--loom-bg))}',
      '.sz-file{display:flex;align-items:center;gap:8px;padding:5px 8px;font-size:11px;border-bottom:1px solid rgb(var(--loom-border)/0.5)}',
      '.sz-file:last-child{border-bottom:0}',
      '.sz-file input{accent-color:rgb(var(--loom-accent))}',
      '.sz-file-name{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,Menlo,monospace}',
      '.sz-file-tag{font-size:10px;padding:1px 6px;border-radius:8px;border:1px solid rgb(var(--loom-border));color:rgb(var(--loom-muted));white-space:nowrap}',
      '.sz-file-tag.sz-story{border-color:rgb(var(--loom-accent)/0.45);color:rgb(var(--loom-accent));background:rgb(var(--loom-accent)/0.1)}',
      '.sz-bar-wrap{height:6px;background:rgb(var(--loom-bg));border:1px solid rgb(var(--loom-border));border-radius:4px;overflow:hidden;margin:8px 0}',
      '.sz-bar{height:100%;width:0;background:rgb(var(--loom-accent));transition:width .2s}',
      '.sz-logs{border:1px solid rgb(var(--loom-border));border-radius:8px;background:rgb(var(--loom-bg));padding:8px;font-size:11px;font-family:ui-monospace,Menlo,monospace;color:rgb(var(--loom-muted));max-height:180px;overflow-y:auto;white-space:pre-wrap;line-height:1.6}',
      '.sz-err{color:rgb(var(--loom-err))}',
      // 结果列表
      '.sz-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:10px;padding-bottom:10px;border-bottom:1px solid rgb(var(--loom-border))}',
      '.sz-tools label{display:flex;align-items:center;gap:4px;font-size:11px;color:rgb(var(--loom-muted));cursor:pointer}',
      '.sz-mark{border:1px solid rgb(var(--loom-border));border-radius:8px;background:rgb(var(--loom-bg));padding:8px 10px;margin-bottom:8px}',
      '.sz-mark.sz-off{opacity:.55}',
      '.sz-mark-head{display:flex;align-items:center;gap:8px}',
      '.sz-mark-head input[type=checkbox]{accent-color:rgb(var(--loom-accent))}',
      '.sz-score{font-size:11px;font-weight:700;color:rgb(var(--loom-accent));background:rgb(var(--loom-accent)/0.12);border-radius:6px;padding:1px 6px;font-family:ui-monospace,Menlo,monospace}',
      '.sz-in{border:1px solid transparent;background:transparent;color:rgb(var(--loom-text));font-family:inherit;font-size:12px;border-radius:4px;padding:2px 4px;min-width:0}',
      '.sz-in:hover{border-color:rgb(var(--loom-border))}',
      '.sz-in:focus{border-color:rgb(var(--loom-accent));background:rgb(var(--loom-panel));outline:none}',
      '.sz-in.sz-title{font-weight:600;flex:1}',
      '.sz-in.sz-promo{flex:1;color:rgb(var(--loom-accent))}',
      '.sz-in.sz-pin{border-color:rgb(var(--loom-border));background:rgb(var(--loom-bg));padding:4px 6px}',
      '.sz-in.sz-num{width:56px;text-align:center;padding:4px 2px}',
      '.sz-link{border:0;background:transparent;color:rgb(var(--loom-muted));font-family:ui-monospace,Menlo,monospace;font-size:10px;cursor:pointer;text-decoration:underline;text-decoration-style:dotted;padding:0 2px}',
      '.sz-link:hover{color:rgb(var(--loom-accent))}',
      '.sz-quote{font-size:12px;color:rgb(var(--loom-text));line-height:1.7;margin:6px 0;padding-left:8px;border-left:2px solid rgb(var(--loom-accent)/0.5)}',
      '.sz-promo-row{display:flex;align-items:center;gap:6px;margin-bottom:4px}',
      '.sz-label{font-size:10px;color:rgb(var(--loom-muted));flex-shrink:0}',
      '.sz-meta{display:flex;align-items:center;gap:8px;font-size:10px;color:rgb(var(--loom-muted));flex-wrap:wrap}',
      '.sz-tag{border:1px solid rgb(var(--loom-border));border-radius:8px;padding:0 5px}',
      '.sz-empty{font-size:12px;color:rgb(var(--loom-muted));text-align:center;padding:36px 0;line-height:1.8}',
      '.sz-op{border:0;background:transparent;color:rgb(var(--loom-muted));cursor:pointer;font-size:12px;padding:0 4px;border-radius:4px}',
      '.sz-op:hover{color:rgb(var(--loom-text));background:rgb(var(--loom-panel2))}',
      '.sz-op.sz-danger:hover{color:rgb(var(--loom-err))}',
      // 设置
      '.sz-field{display:flex;align-items:center;gap:8px;margin-bottom:8px}',
      '.sz-field.sz-stack{align-items:flex-start;flex-direction:column;gap:4px}',
      '.sz-field label{font-size:11px;color:rgb(var(--loom-muted));width:110px;flex-shrink:0;text-align:right}',
      '.sz-field.sz-stack label{width:auto;text-align:left}',
      '.sz-input,.sz-area{background:rgb(var(--loom-bg));border:1px solid rgb(var(--loom-border));border-radius:6px;color:rgb(var(--loom-text));font-family:inherit;font-size:12px;padding:5px 8px;flex:1;min-width:0;box-sizing:border-box}',
      '.sz-input:focus,.sz-area:focus{outline:none;border-color:rgb(var(--loom-accent))}',
      '.sz-area{width:100%;min-height:110px;resize:vertical;line-height:1.6}',
      '.sz-num{flex:none;width:110px}',
      '.sz-note{font-size:10px;color:rgb(var(--loom-muted));line-height:1.6;margin:2px 0 10px}',
      '.sz-sub{font-size:12px;font-weight:600;margin:14px 0 8px;padding-top:10px;border-top:1px solid rgb(var(--loom-border))}'
    ].join('\n')
    document.head.appendChild(style)
  }

  function panelStatHtml() {
    var c = cfg()
    var ready = c.apiKey && c.model ? '已配置' : '未配置'
    var count = state.marks.length
    return (
      '<div class="sz-stat">' +
      'AI：<b>' +
      esc(ready) +
      '</b>　模型 ' +
      esc(c.model || '—') +
      '<br/>已标记铃光时刻：<b>' +
      count +
      '</b> 个（入选 ' +
      includedCount() +
      ' 个）' +
      (loom.project.getPath() ? '' : '<br/><span class="sz-err">未打开项目</span>') +
      '</div>'
    )
  }

  // 面板跟随的文件：优先「选中故事」所在文件，其次织机当前打开的文件
  function panelFile() {
    var f = state.selLabel && state.selLabel.file ? state.selLabel.file : state.curFile
    return String(f || '').replace(/^game\//, '')
  }

  // 当前文件里的全部铃光时刻（同一个文件里可能有多个 label，一并列出）
  function momentsOfSelected() {
    var file = panelFile()
    if (!file) return []
    return state.marks
      .filter(function (m) {
        return m.file === file
      })
      .sort(function (a, b) {
        return (a.line || 0) - (b.line || 0)
      })
  }

  function panelBodyHtml() {
    var html = '<div class="sz-panel">'
    html += '<div class="sz-stat-slot">' + panelStatHtml() + '</div>'
    html += '<button type="button" class="sz-btn sz-primary" data-act="open">打开工作台</button>'
    var file = panelFile()
    if (!file) {
      html += '<div class="sz-hint">在织机里打开或选中一个剧本文件，这里会列出这个文件中的铃光时刻。</div>'
      return html + '</div>'
    }
    var hits = momentsOfSelected()
    var short = file.split('/').pop()
    html +=
      '<div class="sz-panel-head">' +
      '<span class="sz-panel-name" title="' +
      esc(file) +
      '">' +
      esc(short) +
      '</span>' +
      '<span class="sz-muted">' +
      hits.length +
      ' 个铃光时刻</span>' +
      '</div>'
    if (!hits.length) {
      html +=
        '<div class="sz-hint">这个文件还没有铃光时刻。可在工作台「标记」页扫描后运行 AI。</div>'
      return html + '</div>'
    }
    html += '<div class="sz-panel-list">'
    hits.forEach(function (m) {
      html +=
        '<button type="button" class="sz-panel-item' +
        (m.include === false ? ' sz-off' : '') +
        '" data-act="panel-jump" data-id="' +
        esc(m.id) +
        '" title="跳转到这一行">' +
        '<span class="sz-score">' +
        esc(m.score) +
        '</span>' +
        '<span class="sz-panel-title">' +
        esc(m.title || '') +
        '</span>' +
        '<span class="sz-panel-line">' +
        esc(m.label || '') +
        ' · ' +
        esc(m.line || '?') +
        (m.matched === false ? ' 未精确定位' : '') +
        '</span>' +
        '<span class="sz-panel-quote">' +
        esc(m.quote) +
        '</span>' +
        '</button>'
    })
    html += '</div>'
    return html + '</div>'
  }

  function refreshPanels() {
    var nodes = document.querySelectorAll('[data-role="sz-panel-body"]')
    for (var i = 0; i < nodes.length; i++) nodes[i].innerHTML = panelBodyHtml()
  }

  // ---- 功能栏面板 ----
  var PANEL_HTML =
    '<div data-role="sz-panel-body" class="sz-panel-body">' + panelBodyHtml() + '</div>'

  function onPanelClick(e) {
    var t = e.target && e.target.closest ? e.target.closest('[data-act]') : null
    if (!t) return
    var act = t.getAttribute('data-act')
    if (act === 'open') {
      openWorkspace()
    } else if (act === 'panel-jump') {
      var id = t.getAttribute('data-id')
      for (var i = 0; i < state.marks.length; i++) {
        if (state.marks[i].id === id) {
          loom.project.openAt(state.marks[i].file, state.marks[i].line || 1)
          return
        }
      }
    }
  }

  function mountPanel(el) {
    injectCss()
    if (typeof loom.project.getSelectedLabel === 'function') {
      state.selLabel = loom.project.getSelectedLabel()
    }
    if (typeof loom.project.currentFile === 'function') {
      state.curFile = loom.project.currentFile() || ''
    }
    if (!el.__szPanelBound) {
      el.__szPanelBound = true
      el.addEventListener('click', onPanelClick)
    }
    // 面板挂载时同步一次标记（插件可能在项目打开事件之后才加载；运行中不覆盖内存结果）
    if (!(state.run && state.run.running)) state.marks = loadMarks()
    refreshPanels()
  }

  // ---- 工作台 ----
  function openWorkspace() {
    if (overlay) return
    injectCss()
    if (!(state.run && state.run.running)) state.marks = loadMarks()
    overlay = document.createElement('div')
    overlay.className = 'sz-modal'
    overlay.innerHTML =
      '<div class="sz-shell">' +
      '<div class="sz-head">' +
      '<span class="sz-title"><span class="sz-star">✦</span> 铃光时刻</span>' +
      '<div class="sz-tabs" data-role="tabs"></div>' +
      '<button type="button" class="sz-x" data-act="close" title="关闭">✕</button>' +
      '</div>' +
      '<div class="sz-body" data-role="body"></div>' +
      '</div>'
    overlay.addEventListener('click', onWorkspaceClick)
    overlay.addEventListener('change', onWorkspaceChange)
    overlay.addEventListener('input', onWorkspaceInput)
    overlay.addEventListener('keydown', onWorkspaceKeydown)
    document.body.appendChild(overlay)
    if (!state.files && loom.project.getPath()) {
      scanProject()
        .then(function () {
          renderBody()
        })
        .catch(function () {
          renderBody()
        })
    }
    renderTabs()
    renderBody()
  }

  function closeWorkspace() {
    if (!overlay) return
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay)
    overlay = null
  }

  function renderTabs() {
    if (!overlay) return
    var box = overlay.querySelector('[data-role="tabs"]')
    if (!box) return
    var tabs = [
      { id: 'run', label: '标记' },
      { id: 'list', label: '结果 ' + state.marks.length },
      { id: 'promo', label: '宣传片' },
      { id: 'cfg', label: '设置' }
    ]
    box.innerHTML = tabs
      .map(function (t) {
        return (
          '<button type="button" class="sz-tab' +
          (state.tab === t.id ? ' sz-on' : '') +
          '" data-tab="' +
          t.id +
          '">' +
          esc(t.label) +
          '</button>'
        )
      })
      .join('')
  }

  function renderBody() {
    renderTabs()
    if (!overlay) return
    flushCfgSave()
    var body = overlay.querySelector('[data-role="body"]')
    if (!body) return
    if (!loom.project.getPath()) {
      body.innerHTML = '<div class="sz-empty">请先打开一个项目，再使用「铃光时刻」。</div>'
      return
    }
    if (state.tab === 'list') body.innerHTML = listTabHtml()
    else if (state.tab === 'promo') {
      body.innerHTML = promoTabHtml()
      // 首次进入宣传片页时拉一次字体列表（下拉里可选项目自带字体）
      if (!promoUi.fontList) {
        fontList().then(function (fonts) {
          promoUi.fontList = fonts
          if (overlay && state.tab === 'promo') renderBody()
        })
      }
      if (promoUi.autoPreview && (includedMarks().length || String(pcfg().title || '').trim())) schedulePreview()
    } else if (state.tab === 'cfg') body.innerHTML = cfgTabHtml()
    else body.innerHTML = runTabHtml()
    updateProgressDom()
    pUpdateDom()
  }

  // ---- 标记页 ----
  function estText() {
    var p = plan()
    return (
      '已选 ' +
      selectedFiles().length +
      ' 个文件 · ' +
      p.chars +
      ' 字 · 共 ' +
      p.labels.length +
      ' 个场景 · 预计 ' +
      p.batches.length +
      ' 次请求'
    )
  }

  function runTabHtml() {
    var files = state.files
    var html = ''
    html += '<div class="sz-row">'
    html += '<button type="button" class="sz-btn" data-act="scan">' + (files ? '重新扫描项目' : '扫描项目') + '</button>'
    html += '<span class="sz-muted">' + (files ? '共 ' + files.length + ' 个 .rpy 文件' : '扫描后会列出可标记的剧本文件') + '</span>'
    if (state.scanStale) html += '<span class="sz-muted sz-err">剧本已变更，建议重新扫描</span>'
    html += '</div>'

    if (files) {
      html += '<div class="sz-row"><span class="sz-muted">选择参与标记的剧本（默认勾选故事文件）</span>'
      html += '<button type="button" class="sz-btn" data-act="sel-all">全选</button>'
      html += '<button type="button" class="sz-btn" data-act="sel-none">全不选</button>'
      html += '<button type="button" class="sz-btn" data-act="sel-story">仅故事文件</button></div>'
      html += '<div class="sz-files">'
      if (!files.length) html += '<div class="sz-file"><span class="sz-muted">项目内没有 .rpy 文件</span></div>'
      files.forEach(function (f) {
        html +=
          '<label class="sz-file">' +
          '<input type="checkbox" data-act="file" data-path="' +
          esc(f.path) +
          '"' +
          (state.fileSel[f.path] ? ' checked' : '') +
          '/>' +
          '<span class="sz-file-name" title="' +
          esc(f.path) +
          '">game/' +
          esc(f.path) +
          '</span>' +
          '<span class="sz-file-tag' +
          (f.story ? ' sz-story' : '') +
          '">' +
          (f.story ? '故事' : '代码') +
          '</span>' +
          '<span class="sz-file-tag">' +
          (f.chars || 0) +
          ' 字</span>' +
          '</label>'
      })
      html += '</div>'
    }

    html += '<div class="sz-row" style="margin-top:12px">'
    var running = state.run && state.run.running
    html +=
      '<button type="button" class="sz-btn sz-primary" data-act="run"' +
      (running || !files ? ' disabled' : '') +
      '>开始标记</button>'
    if (running) html += '<button type="button" class="sz-btn sz-danger" data-act="cancel">中断</button>'
    html += '<span class="sz-muted" data-role="est">' + (files ? esc(estText()) : '') + '</span>'
    html += '</div>'

    html +=
      '<div class="sz-bar-wrap"><div class="sz-bar" data-role="bar" style="width:' +
      progressPct() +
      '%"></div></div>'
    html += '<div class="sz-muted" data-role="runmsg">' + esc(state.run ? state.run.msg : '尚未开始') + '</div>'
    html += '<div class="sz-logs" data-role="logs">' + (state.run && state.run.logs.length ? esc(state.run.logs.join('\n')) : '日志会显示在这里') + '</div>'
    html += '<div class="sz-note">提示：AI 结果与费用由你填写的 API 承担。单批字符数越小越省 token，但请求次数更多。</div>'
    return html
  }

  function progressPct() {
    if (!state.run || !state.run.total) return 0
    return Math.round((state.run.done / state.run.total) * 100)
  }

  function updateProgressDom() {
    if (!overlay) return
    var bar = overlay.querySelector('[data-role="bar"]')
    if (bar) bar.style.width = progressPct() + '%'
    var msg = overlay.querySelector('[data-role="runmsg"]')
    if (msg && state.run) {
      var text = state.run.msg
      if (state.run.running) text += '（' + state.run.done + '/' + state.run.total + '）'
      if (state.run.error) msg.innerHTML = '<span class="sz-err">' + esc(text) + '</span>'
      else msg.textContent = text
    }
    var est = overlay.querySelector('[data-role="est"]')
    if (est && state.files && !(state.run && state.run.running)) est.textContent = estText()
  }

  function renderLogs() {
    if (!overlay || state.tab !== 'run') return
    var box = overlay.querySelector('[data-role="logs"]')
    if (box) {
      box.textContent = state.run && state.run.logs.length ? state.run.logs.join('\n') : '日志会显示在这里'
      box.scrollTop = box.scrollHeight
    }
  }

  // ---- 结果页 ----
  function sortedMarks() {
    var list = state.marks.slice()
    if (state.sort === 'score') {
      list.sort(function (a, b) {
        return b.score - a.score
      })
    } else {
      list.sort(function (a, b) {
        if (a.file !== b.file) return String(a.file).localeCompare(String(b.file))
        return (a.line || 0) - (b.line || 0)
      })
    }
    return list
  }

  function markCardHtml(m, idx) {
    var tags = (m.tags || [])
      .map(function (t) {
        return '<span class="sz-tag">' + esc(t) + '</span>'
      })
      .join('')
    return (
      '<div class="sz-mark' +
      (m.include === false ? ' sz-off' : '') +
      '">' +
      '<div class="sz-mark-head">' +
      '<input type="checkbox" data-act="inc" data-idx="' +
      idx +
      '"' +
      (m.include === false ? '' : ' checked') +
      ' title="加入宣传片素材"' +
      '/>' +
      '<span class="sz-score">' +
      esc(m.score) +
      '</span>' +
      '<input class="sz-in sz-title" data-field="title" data-idx="' +
      idx +
      '" value="' +
      esc(m.title) +
      '"/>' +
      '<button type="button" class="sz-link" data-act="jump" data-idx="' +
      idx +
      '" title="跳转到脚本">' +
      esc(m.file + ':' + (m.line || '?')) +
      (m.matched === false ? ' (未精确定位)' : '') +
      '</button>' +
      '<button type="button" class="sz-op sz-danger" data-act="del" data-idx="' +
      idx +
      '" title="删除">✕</button>' +
      '</div>' +
      '<div class="sz-quote">「' +
      esc(m.quote) +
      '」</div>' +
      '<div class="sz-promo-row">' +
      '<span class="sz-label">宣传语</span>' +
      '<input class="sz-in sz-promo" data-field="promo" data-idx="' +
      idx +
      '" value="' +
      esc(m.promo || '') +
      '" placeholder="点这里改为你自己的宣传文案"/>' +
      '<button type="button" class="sz-op" data-act="copy" data-idx="' +
      idx +
      '" title="复制宣传语">复制</button>' +
      '</div>' +
      '<div class="sz-meta">' +
      '<span>label: ' +
      esc(m.label || '—') +
      '</span>' +
      (m.reason ? '<span>' + esc(m.reason) + '</span>' : '') +
      tags +
      '</div>' +
      '</div>'
    )
  }

  function listTabHtml() {
    var list = sortedMarks().filter(function (m) {
      return !state.includedOnly || m.include !== false
    })
    var html = ''
    html += '<div class="sz-tools">'
    html +=
      '<label><input type="checkbox" data-act="only-inc"' +
      (state.includedOnly ? ' checked' : '') +
      '/> 仅入选宣传片</label>'
    html += '<span class="sz-muted">共 ' + state.marks.length + ' 个 · 入选 ' + includedCount() + ' 个</span>'
    html +=
      '<button type="button" class="sz-btn" data-act="sort">排序：' +
      (state.sort === 'score' ? '评分优先' : '剧情顺序') +
      '</button>'
    html += '<button type="button" class="sz-btn" data-act="export">导出 JSON</button>'
    html += '<button type="button" class="sz-btn" data-act="import">导入 JSON</button>'
    html +=
      '<button type="button" class="sz-btn" data-act="locate" title="按引文重新在剧本中定位行号（删改剧情后用）">重新定位</button>'
    html += '<button type="button" class="sz-btn sz-danger" data-act="clear">清空</button>'
    html += '</div>'
    if (!list.length) {
      html +=
        '<div class="sz-empty">还没有标记。<br/>切到「标记」页扫描项目并开始，AI 找出的高光时刻会显示在这里。</div>'
      return html
    }
    list.forEach(function (m) {
      html += markCardHtml(m, state.marks.indexOf(m))
    })
    return html
  }

  // ---- 设置页 ----
  function cfgTabHtml() {
    var c = cfg()
    var html = ''
    html += '<div class="sz-sub" style="margin-top:0;padding-top:0;border-top:0">AI 接口（OpenAI 兼容协议）</div>'
    html += field('接口地址', '<input class="sz-input" data-cfg="baseUrl" value="' + esc(c.baseUrl) + '" placeholder="https://api.deepseek.com/v1"/>')
    html += field('API Key', '<input class="sz-input" data-cfg="apiKey" value="' + esc(c.apiKey) + '" placeholder="sk-..."/>')
    html += field('模型名', '<input class="sz-input" data-cfg="model" value="' + esc(c.model) + '" placeholder="deepseek-chat"/>')
    html +=
      field(
        '温度',
        '<input class="sz-input sz-num" type="number" step="0.1" min="0" max="2" data-cfg="temperature" value="' +
          esc(c.temperature) +
          '"/>'
      ) +
      field(
        '超时(秒)',
        '<input class="sz-input sz-num" type="number" min="5" max="600" data-cfg="timeoutSec" value="' +
          Math.round(c.timeoutMs / 1000) +
          '"/>'
      )
    html +=
      field(
        '单批字符数',
        '<input class="sz-input sz-num" type="number" min="1000" max="30000" step="500" data-cfg="batchChars" value="' +
          c.batchChars +
          '"/>'
      ) +
      field(
        '响应上限',
        '<input class="sz-input sz-num" type="number" min="1000" max="2000000" step="1000" data-cfg="maxOutputChars" value="' +
          c.maxOutputChars +
          '"/>'
      )
    html +=
      '<div class="sz-row">' +
      '<label style="font-size:11px;color:rgb(var(--loom-muted));display:flex;gap:6px;align-items:center">' +
      '<input type="checkbox" data-cfg="forceJson"' +
      (c.forceJson ? ' checked' : '') +
      '/> 强制 JSON 输出（部分服务不支持，报错时请关闭）</label>' +
      '</div>'
    html +=
      '<div class="sz-row">' +
      '<button type="button" class="sz-btn sz-primary" data-act="test">测试连接</button>' +
      '<button type="button" class="sz-btn" data-act="cfg-reset">恢复默认配置</button>' +
      '<span class="sz-muted" data-role="testmsg"></span>' +
      '</div>'
    html +=
      '<div class="sz-note">BaseURL 填到版本号即可（如 https://api.deepseek.com/v1）；本插件会拼接 /chat/completions。也可直接填完整接口地址。密钥保存在本机插件数据目录，不上传任何服务器。</div>'

    html += '<div class="sz-sub">判定提示词（你认为什么算「铃光时刻」）</div>'
    html += '<textarea class="sz-area" data-cfg="judgePrompt">' + esc(c.judgePrompt) + '</textarea>'
    html += '<div class="sz-sub">输出要求提示词（要 AI 按什么格式、什么宣传口径输出）</div>'
    html += '<textarea class="sz-area" data-cfg="outputPrompt">' + esc(c.outputPrompt) + '</textarea>'
    html +=
      '<div class="sz-row"><button type="button" class="sz-btn" data-act="prompt-reset">恢复默认提示词</button>' +
      '<span class="sz-muted">修改会即时保存</span></div>'
    return html
  }

  function field(label, inputHtml) {
    return '<div class="sz-field"><label>' + esc(label) + '</label>' + inputHtml + '</div>'
  }

  // ---- 轻量确认框（Electron 渲染层禁用 window.confirm / prompt）----
  function confirmBox(msg) {
    return new Promise(function (resolve) {
      var box = document.createElement('div')
      box.className = 'sz-modal'
      box.style.zIndex = '1300'
      box.innerHTML =
        '<div class="sz-shell" style="width:min(420px,90vw);height:auto">' +
        '<div class="sz-head"><span class="sz-title">确认</span></div>' +
        '<div class="sz-body" style="font-size:12px;line-height:1.8">' +
        esc(msg) +
        '</div>' +
        '<div class="sz-head" style="border-top:1px solid rgb(var(--loom-border));border-bottom:0;justify-content:flex-end">' +
        '<button type="button" class="sz-btn" data-ok="0">取消</button>' +
        '<button type="button" class="sz-btn sz-danger" data-ok="1">确定</button>' +
        '</div>' +
        '</div>'
      box.addEventListener('click', function (e) {
        var t = e.target
        if (t === box) {
          done(false)
          return
        }
        var ok = t && t.getAttribute && t.getAttribute('data-ok')
        if (ok != null) done(ok === '1')
      })
      function done(v) {
        if (box.parentNode) box.parentNode.removeChild(box)
        resolve(v)
      }
      document.body.appendChild(box)
    })
  }

  // ---- 事件处理 ----
  function onWorkspaceClick(e) {
    var t = e.target
    if (t === overlay) {
      closeWorkspace()
      return
    }
    // 任何点击先落盘尚未提交的文本输入，避免按钮读到旧配置 / 被后续重置覆盖
    flushCfgSave()
    flushPField()
    flushStyleInput()
    flushMarkText()
    var tabBtn = t.closest ? t.closest('[data-tab]') : null
    if (tabBtn) {
      state.tab = tabBtn.getAttribute('data-tab')
      renderBody()
      return
    }
    // 折叠分组的标题：只记住开合状态，其余交给 <details> 自己处理
    var foldEl = t.closest ? t.closest('[data-fold]') : null
    if (foldEl && !(t.closest && t.closest('[data-act]'))) {
      promoUi.open[foldEl.getAttribute('data-fold')] = !foldEl.parentNode.open
      return
    }
    var el = t.closest ? t.closest('[data-act]') : null
    if (!el) return
    var act = el.getAttribute('data-act')
    var idx = parseInt(el.getAttribute('data-idx'), 10)
    if (act === 'close') {
      closeWorkspace()
    } else if (act === 'scan') {
      doScan()
    } else if (act === 'sel-all' || act === 'sel-none' || act === 'sel-story') {
      ;(state.files || []).forEach(function (f) {
        state.fileSel[f.path] = act === 'sel-all' ? true : act === 'sel-none' ? false : f.story && !f.codeFile
      })
      renderBody()
    } else if (act === 'run') {
      startRun()
    } else if (act === 'cancel') {
      if (state.run) {
        state.run.cancel = true
        state.run.msg = '正在中断（等待当前批返回）…'
        logLine('收到中断请求')
        updateProgressDom()
      }
    } else if (act === 'jump') {
      var mk = state.marks[idx]
      if (mk) {
        closeWorkspace()
        loom.project.openAt(mk.file, mk.line || 1)
      }
    } else if (act === 'del') {
      var m2 = state.marks[idx]
      if (!m2) return
      state.marks.splice(idx, 1)
      persistMarks()
      refreshPanels()
      renderBody()
    } else if (act === 'copy') {
      var m3 = state.marks[idx]
      if (m3 && navigator.clipboard) {
        navigator.clipboard.writeText(m3.promo || m3.quote || '').then(
          function () {
            loom.toast('已复制宣传语', 'success')
          },
          function () {
            loom.toast('复制失败', 'error')
          }
        )
      }
    } else if (act === 'sort') {
      state.sort = state.sort === 'score' ? 'order' : 'score'
      renderBody()
    } else if (act === 'export') {
      exportMarks()
    } else if (act === 'import') {
      importMarks()
    } else if (act === 'locate') {
      relocateNow()
    } else if (act === 'clear') {
      confirmBox('确定清空当前项目的全部铃光时刻标记？（不会删除项目文件）').then(function (ok) {
        if (!ok) return
        state.marks = []
        persistMarks()
        refreshPanels()
        renderBody()
        loom.toast('已清空标记', 'info')
      })
    } else if (act === 'test') {
      var msg = overlay.querySelector('[data-role="testmsg"]')
      if (msg) msg.textContent = '测试中…'
      testConnection().then(
        function (text) {
          if (msg) msg.textContent = '连接成功：' + String(text || '').slice(0, 40)
          loom.toast('AI 接口连接成功', 'success')
        },
        function (err) {
          if (msg) msg.innerHTML = '<span class="sz-err">' + esc(String(err && err.message ? err.message : err)) + '</span>'
          loom.toast('连接失败：' + String(err && err.message ? err.message : err), 'error')
        }
      )
    } else if (act === 'cfg-reset') {
      var key = cfg().apiKey
      var next = {}
      for (var k in DEFAULTS) if (Object.prototype.hasOwnProperty.call(DEFAULTS, k)) next[k] = DEFAULTS[k]
      next.apiKey = key
      saveCfg(next)
      renderBody()
      loom.toast('已恢复默认配置（保留 API Key）', 'info')
    } else if (act === 'prompt-reset') {
      var c2 = cfg()
      c2.judgePrompt = DEFAULT_JUDGE_PROMPT
      c2.outputPrompt = DEFAULT_OUTPUT_PROMPT
      saveCfg(c2)
      renderBody()
      loom.toast('已恢复默认提示词', 'info')
    } else if (act === 'promo-gen') {
      generatePromo()
    } else if (act === 'promo-capture') {
      captureOnly()
    } else if (act === 'promo-preview') {
      renderPreview()
    } else if (act === 'promo-scope') {
      promoUi.scope = el.getAttribute('data-scope') || 'mark'
      renderBody()
      schedulePreview()
    } else if (act === 'promo-preset') {
      var preset = findPreset(el.getAttribute('data-preset'))
      if (preset) {
        writeScopeStyle(pcfg(), preset.style)
        renderBody()
        loom.toast('已套用花字：' + preset.label, 'success')
      }
    } else if (act === 'promo-style-reset') {
      resetScopeStyle()
    } else if (act === 'ai-copy') {
      aiWriteCopy()
    } else if (act === 'ai-send') {
      aiChatSend()
    } else if (act === 'ai-apply') {
      aiApplyPatch(idx)
    } else if (act === 'ai-clear') {
      promoUi.chat = []
      promoUi.aiMsg = ''
      renderBody()
    } else if (act === 'promo-cancel') {
      promo.cancel = true
      pSet('正在中断…', promo.pct)
      pLog('收到中断请求')
      if (promo.taskId) loom.task.cancel(promo.taskId)
    } else if (act === 'promo-open') {
      loom.shell.openPath(PROMO_DIR).then(
        function (err) {
          if (err) loom.toast('打开失败：' + err, 'error')
        },
        function (e) {
          loom.toast('打开失败：' + errText(e), 'error')
        }
      )
    }
  }

  function onWorkspaceChange(e) {
    var t = e.target
    if (!t || !t.getAttribute) return
    var act = t.getAttribute('data-act')
    if (act === 'file') {
      var path = t.getAttribute('data-path')
      state.fileSel[path] = !!t.checked
      updateProgressDom()
      return
    }
    if (act === 'only-inc') {
      state.includedOnly = !!t.checked
      renderBody()
      return
    }
    var fieldName = t.getAttribute('data-field')
    if (fieldName) {
      var idx = parseInt(t.getAttribute('data-idx'), 10)
      var mk = state.marks[idx]
      if (mk) {
        mk[fieldName] = t.value
        persistMarks()
        refreshPanels()
      }
      return
    }
    // 样式作用域切换
    if (t.getAttribute('data-scope-sel')) {
      promoUi.scope = t.value
      renderBody()
      schedulePreview()
      return
    }
    // 改样式是否自动刷新预览
    if (t.getAttribute('data-preview-auto')) {
      promoUi.autoPreview = !!t.checked
      if (promoUi.autoPreview) schedulePreview()
      return
    }
    // 单个样式字段（失焦 / 勾选 / 下拉）
    var sf = t.getAttribute('data-sfield')
    if (sf) {
      flushStyleInput()
      var sfd = styleField(sf)
      if (sfd) applyStyleInput(sf, readSField(t, sfd))
      return
    }
    // 逐条宣传语
    var mt = t.getAttribute('data-mtext')
    if (mt != null) {
      flushMarkText()
      writeMarkText(parseInt(mt, 10), t.value)
      return
    }
    var key = t.getAttribute('data-cfg')
    if (!key) {
      // 宣传片配置：失焦即落盘
      var pf = t.getAttribute('data-pfield')
      if (pf) {
        pendingPField = null
        applyPField(pf, t.value)
      }
      return
    }
    flushCfgSave()
    applyCfgValue(key, t.type === 'checkbox' ? !!t.checked : t.value)
  }

  var cfgSaveTimer = null
  var pendingCfg = null
  function onWorkspaceInput(e) {
    var t = e.target
    if (!t || !t.getAttribute) return
    // 样式数值/颜色：拖色板或连续输入时不要每一下都落盘 + 起 ffmpeg
    var sf = t.getAttribute('data-sfield')
    if (sf) {
      var sfd = styleField(sf)
      if (sfd) {
        pendingSField = { key: sf, value: readSField(t, sfd) }
        if (sFieldTimer) clearTimeout(sFieldTimer)
        sFieldTimer = setTimeout(flushStyleInput, 500)
      }
      return
    }
    var mt = t.getAttribute('data-mtext')
    if (mt != null) {
      pendingMarkText = { idx: parseInt(mt, 10), value: t.value }
      if (mTextTimer) clearTimeout(mTextTimer)
      mTextTimer = setTimeout(flushMarkText, 500)
      return
    }
    // AI 对话输入：只记住内容（重新渲染后不丢），回车才发送
    if (t.getAttribute('data-role') === 'ai-input') {
      promoUi.chatInput = t.value
      return
    }
    var pf = t.getAttribute('data-pfield')
    if (pf) {
      pendingPField = { key: pf, value: t.value }
      if (pCfgTimer) clearTimeout(pCfgTimer)
      pCfgTimer = setTimeout(function () {
        flushPField()
      }, 400)
      return
    }
    var key = t.getAttribute('data-cfg')
    if (!key) return
    // 文本/数字输入：延迟落盘，避免每次按键都写文件（提示词尤其长）
    pendingCfg = { key: key, value: t.value }
    if (cfgSaveTimer) clearTimeout(cfgSaveTimer)
    cfgSaveTimer = setTimeout(function () {
      flushCfgSave()
    }, 400)
  }

  // AI 对话输入框：回车发送
  function onWorkspaceKeydown(e) {
    if (e.key !== 'Enter') return
    var t = e.target
    if (!t || !t.getAttribute || t.getAttribute('data-role') !== 'ai-input') return
    e.preventDefault()
    aiChatSend()
  }

  // ---- 宣传片配置（与上面 AI 配置同样的「延迟落盘」策略）----
  var pCfgTimer = null
  var pendingPField = null

  function flushPField() {
    if (pCfgTimer) {
      clearTimeout(pCfgTimer)
      pCfgTimer = null
    }
    if (!pendingPField) return
    var p = pendingPField
    pendingPField = null
    applyPField(p.key, p.value)
  }

  // 样式字段 / 逐条文案的「延迟落盘」（拖色板、连续打字时不反复起 ffmpeg 预览）
  var sFieldTimer = null
  var pendingSField = null
  var mTextTimer = null
  var pendingMarkText = null

  function flushStyleInput() {
    if (sFieldTimer) {
      clearTimeout(sFieldTimer)
      sFieldTimer = null
    }
    if (!pendingSField) return
    var p = pendingSField
    pendingSField = null
    applyStyleInput(p.key, p.value)
  }

  function flushMarkText() {
    if (mTextTimer) {
      clearTimeout(mTextTimer)
      mTextTimer = null
    }
    if (!pendingMarkText) return
    var p = pendingMarkText
    pendingMarkText = null
    writeMarkText(p.idx, p.value)
  }

  function applyPField(key, value) {
    var c = pcfg()
    if (key === 'duration') c.duration = num(value, c.duration, 1, 15)
    else if (key === 'transition') c.transition = num(value, c.transition, 0, 3)
    else if (key === 'fps') c.fps = Math.round(num(value, c.fps, 12, 60))
    else if (key === 'crf') c.crf = Math.round(num(value, c.crf, 0, 40))
    else if (key === 'font') c.font = String(value || '').trim()
    else c[key] = String(value)
    savePcfg(c)
    // 会改变画面的设置顺手刷新预览
    if (key === 'title' || key === 'endText' || key === 'font') schedulePreview()
  }

  // 立即应用尚未落盘的输入（点「测试连接」「开始标记」前调用，避免读到旧值）
  function flushCfgSave() {
    if (cfgSaveTimer) {
      clearTimeout(cfgSaveTimer)
      cfgSaveTimer = null
    }
    if (!pendingCfg) return
    var p = pendingCfg
    pendingCfg = null
    applyCfgValue(p.key, p.value)
  }

  function applyCfgValue(key, value) {
    var c = cfg()
    if (key === 'forceJson') c.forceJson = !!value
    else if (key === 'temperature') c.temperature = num(value, c.temperature, 0, 2)
    else if (key === 'timeoutSec') c.timeoutMs = num(value, c.timeoutMs / 1000, 5, 600) * 1000
    else if (key === 'batchChars') c.batchChars = num(value, c.batchChars, 1000, 30000)
    else if (key === 'maxOutputChars') c.maxOutputChars = num(value, c.maxOutputChars, 1000, 2000000)
    else c[key] = String(value)
    saveCfg(c)
    if (key === 'batchChars') refreshPanels()
  }

  function doScan() {
    loom.toast('正在扫描项目…', 'info')
    scanProject()
      .then(function (r) {
        renderBody()
        loom.toast('已扫描 ' + r.files + ' 个文件 · ' + r.labels + ' 个场景', 'success')
      })
      .catch(function (e) {
        loom.toast('扫描失败：' + String(e && e.message ? e.message : e), 'error')
      })
  }

  // ---- 导入 / 导出 ----
  function exportMarks() {
    if (!state.marks.length) {
      loom.toast('没有可导出的标记', 'error')
      return
    }
    var payload = {
      format: 'pupurin-loom-moments',
      version: 1,
      project: loom.project.getPath(),
      exportedAt: new Date().toISOString(),
      marks: sortedMarks()
    }
    loom.fs.write(EXPORT_FILE, JSON.stringify(payload, null, 2)).then(
      function () {
        loom.toast('已导出到项目根目录 ' + EXPORT_FILE, 'success')
      },
      function (e) {
        loom.toast('导出失败：' + String(e && e.message ? e.message : e), 'error')
      }
    )
  }

  function importMarks() {
    loom.fs.read(EXPORT_FILE).then(function (text) {
      if (!text) {
        loom.toast('未找到 ' + EXPORT_FILE + '（请把导出的文件放到项目根目录）', 'error')
        return
      }
      var data = null
      try {
        data = JSON.parse(text)
      } catch (e) {
        loom.toast('文件不是合法 JSON', 'error')
        return
      }
      var list = Array.isArray(data) ? data : data && Array.isArray(data.marks) ? data.marks : []
      var clean = list.filter(function (m) {
        return m && typeof m === 'object' && m.quote
      })
      if (!clean.length) {
        loom.toast('文件内没有有效的标记', 'error')
        return
      }
      var r = mergeIntoMarks(
        clean.map(function (m) {
          return Object.assign({}, m, {
            id: m.id || 'i' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36),
            include: m.include !== false,
            score: num(m.score, 6, 1, 10),
            tags: Array.isArray(m.tags) ? m.tags : []
          })
        })
      )
      persistMarks()
      refreshPanels()
      renderBody()
      loom.toast('已导入：新增 ' + r.added + ' 个，合并 ' + r.updated + ' 个', 'success')
    })
  }

  // 用户删改剧情后：按引文把全部标记重新定位到当前剧本
  function relocateNow() {
    if (!state.marks.length) {
      loom.toast('还没有标记可重新定位', 'info')
      return
    }
    loom.toast('正在重新定位…', 'info')
    relocateMarks(state.marks, { manual: true }).then(
      function (r) {
        refreshPanels()
        loom.toast(
          '重新定位完成：更新 ' + r.updated + ' 条' + (r.failed ? '，未匹配 ' + r.failed + ' 条（已标为未精确定位）' : ''),
          r.failed ? 'info' : 'success'
        )
      },
      function (e) {
        loom.toast('重新定位失败：' + String(e && e.message ? e.message : e), 'error')
      }
    )
  }

  // ==================== 功能二：宣传片 ====================
  // 把「铃光时刻」变成宣传片：在游戏里逐点 --warp 截图（游戏截图），再用 ffmpeg 叠加宣传文字合成 mp4。
  //
  // 采集：注入 game/zz_pupurin_capture.rpy（惰性脚本：仅当 builds/promo/.capture.json 存在时生效）
  //       → renpy <项目> --warp game/<file>:<line> → 脚本秒拍后自退 → 还原（删除注入文件与配置）
  //       一个高光一次 warp（不自动推进剧情）：拍一个点只需几秒，游戏窗口随即关闭
  // 合成：ffmpeg -filter_complex 生成 片头 + 各高光（截图 + 宣传文案）+ 转场 + 片尾 + BGM
  //       （不用 -filter_complex_script：该选项在 ffmpeg 8+ 已被移除，内联图各版本通用）
  //
  // 依赖宿主能力：loom.task.spawn / loom.ffmpeg.ensure / loom.shell.openPath / loom.fs.remove

  var PROMO_KEY = 'promo'
  var PROMO_DIR = 'builds/promo'
  var FRAMES_DIR = PROMO_DIR + '/frames'
  var TEXT_DIR = PROMO_DIR + '/text'
  var PREVIEW_DIR = PROMO_DIR + '/preview'
  var CAPTURE_CFG = PROMO_DIR + '/.capture.json'
  var CAPTURE_RESULT = FRAMES_DIR + '/_capture_result.json'
  var CAPTURE_RPY = 'game/zz_pupurin_capture.rpy'
  var CAPTURE_RPYC = 'game/zz_pupurin_capture.rpyc'

  var OUT_W = 1920
  var OUT_H = 1080
  var INTRO_SEC = 2.5
  var OUTRO_SEC = 2.5
  // 单次采集的最长 tick 数（periodic_callback 计次）。正常情况 3 个 tick 就拍完，
  // 这里只是「warp 没落到目标行」时的兜底。
  var CAPTURE_TIMEOUT_TICKS = 600
  // 单次采集的最长秒数：采集脚本里的看门狗线程到点直接硬退出，
  // 保证游戏窗口一定会关闭（哪怕 Ren'Py 主线程卡住）。
  var CAPTURE_WALL_TIMEOUT_SEC = 45

  var PROMO_DEFAULTS = {
    title: '',
    endText: '敬请期待',
    duration: 3,
    transition: 0.6,
    bgm: '',
    fps: 30,
    crf: 20,
    font: '' // 选中的字体（game/ 相对路径）；空 = 自动用项目里第一个可用字体
  }

  // ---- 文字样式：字段表（表单渲染 / 落盘归一化 / AI 提示词都读它，避免三处各写一遍）----
  // dflt 可以是常量，也可以按作用域给不同默认（intro 片头 / mark 高光 / outro 片尾）
  var STYLE_ROLES = ['intro', 'mark', 'outro']
  var ROLE_LABEL = { intro: '片头', mark: '高光', outro: '片尾' }
  var STYLE_FIELDS = [
    { key: 'size', label: '字号', kind: 'int', min: 12, max: 220, dflt: { intro: 76, mark: 46, outro: 56 } },
    { key: 'color', label: '颜色', kind: 'color', dflt: '#FFFFFF' },
    { key: 'x', label: '水平', kind: 'enum', values: ['left', 'center', 'right'], valueLabels: ['靠左', '居中', '靠右'], dflt: 'center' },
    { key: 'y', label: '垂直', kind: 'enum', values: ['top', 'middle', 'bottom'], valueLabels: ['靠上', '居中', '靠下'], dflt: { intro: 'middle', mark: 'bottom', outro: 'middle' } },
    { key: 'dx', label: '水平偏移', kind: 'int', min: -1200, max: 1200, dflt: 0 },
    { key: 'dy', label: '垂直偏移', kind: 'int', min: -1200, max: 1200, dflt: 0 },
    { key: 'perLine', label: '每行字数', kind: 'int', min: 4, max: 60, dflt: { intro: 12, mark: 18, outro: 12 } },
    { key: 'lineSpacing', label: '行距', kind: 'int', min: 0, max: 90, dflt: 14 },
    { key: 'borderW', label: '描边宽度', kind: 'int', min: 0, max: 30, dflt: 0 },
    { key: 'borderColor', label: '描边颜色', kind: 'color', dflt: '#000000' },
    { key: 'shadowX', label: '阴影偏移 X', kind: 'int', min: -40, max: 40, dflt: 0 },
    { key: 'shadowY', label: '阴影偏移 Y', kind: 'int', min: -40, max: 40, dflt: 0 },
    { key: 'shadowColor', label: '阴影颜色', kind: 'color', dflt: '#000000' },
    { key: 'shadowAlpha', label: '阴影不透明度', kind: 'num', min: 0, max: 1, dflt: 0.7 },
    { key: 'box', label: '背景挡板', kind: 'bool', dflt: false },
    { key: 'boxColor', label: '挡板颜色', kind: 'color', dflt: '#000000' },
    { key: 'boxAlpha', label: '挡板不透明度', kind: 'num', min: 0, max: 1, dflt: 0.55 },
    { key: 'boxBorderW', label: '挡板留白', kind: 'int', min: 0, max: 140, dflt: 30 }
  ]

  // 表单排版：把字段按行分组（只影响控件怎么摆，不影响取值）
  // 常用参数常驻显示；其余收进「更多参数」，免得页面太长
  var STYLE_ROWS_COMMON = [
    ['size', 'color'],
    ['x', 'y'],
    ['perLine']
  ]
  var STYLE_ROWS_ADV = [
    ['dx', 'dy'],
    ['lineSpacing'],
    ['borderW', 'borderColor'],
    ['shadowX', 'shadowY', 'shadowColor', 'shadowAlpha'],
    ['box', 'boxColor', 'boxAlpha', 'boxBorderW']
  ]

  // 「花字」皮肤：一组字段的取值，套用后可继续手改
  var STYLE_PRESETS = [
    { id: 'plain', label: '纯白极简', style: { color: '#FFFFFF', borderW: 0, shadowX: 0, shadowY: 0, box: false, lineSpacing: 14 } },
    {
      id: 'stroke',
      label: '描边加粗',
      style: { color: '#FFFFFF', borderW: 5, borderColor: '#000000', shadowX: 0, shadowY: 0, box: false }
    },
    {
      id: 'shadow',
      label: '阴影浮起',
      style: { color: '#FFFFFF', borderW: 0, shadowX: 4, shadowY: 4, shadowColor: '#000000', shadowAlpha: 0.65, box: false }
    },
    {
      id: 'bar',
      label: '黑底字幕条',
      style: { color: '#FFFFFF', borderW: 0, shadowX: 0, shadowY: 0, box: true, boxColor: '#000000', boxAlpha: 0.6, boxBorderW: 34, lineSpacing: 16 }
    },
    {
      id: 'gold',
      label: '金色标题',
      style: { color: '#F2D07A', borderW: 4, borderColor: '#3A2A08', shadowX: 0, shadowY: 5, shadowColor: '#000000', shadowAlpha: 0.7, box: false, lineSpacing: 18 }
    },
    {
      id: 'neon',
      label: '霓虹发光',
      style: { color: '#B8F5FF', borderW: 10, borderColor: '#1E90FF', shadowX: 0, shadowY: 0, shadowAlpha: 0, box: false, lineSpacing: 16 }
    }
  ]

  function styleDflt(role, field) {
    var d = field.dflt
    if (d && typeof d === 'object') return d[role] != null ? d[role] : d.mark
    return d
  }

  function normStyleValue(field, v, role) {
    if (field.kind === 'bool') return v === true
    if (field.kind === 'int') return Math.round(num(v, styleDflt(role, field), field.min, field.max))
    if (field.kind === 'num') return num(v, styleDflt(role, field), field.min, field.max)
    if (field.kind === 'color') return isHex(v) ? String(v).toUpperCase() : styleDflt(role, field)
    if (field.kind === 'enum') return field.values.indexOf(v) >= 0 ? v : styleDflt(role, field)
    return typeof v === 'string' ? v : styleDflt(role, field)
  }

  function isHex(v) {
    return typeof v === 'string' && /^#[0-9a-fA-F]{6}$/.test(v.trim())
  }

  // 任意来源（配置 / 单个高光覆盖 / AI 返回）→ 一份完整合法的样式
  function normStyle(role, raw) {
    var src = raw && typeof raw === 'object' ? raw : {}
    var out = {}
    STYLE_FIELDS.forEach(function (f) {
      out[f.key] = normStyleValue(f, src[f.key], role)
    })
    return out
  }

  function styleDefaultsFor(role) {
    return normStyle(role, null)
  }

  // 该段最终使用的样式：作用域默认样式 + 单个高光的部分覆盖
  function roleStyle(pc, kind, mark) {
    var base = pc && pc[kind] ? pc[kind] : null
    var ov = mark && mark && mark.promoStyle ? mark.promoStyle : null
    var merged = {}
    STYLE_FIELDS.forEach(function (f) {
      merged[f.key] = base && base[f.key] !== undefined ? base[f.key] : styleDflt(kind, f)
      if (ov && ov[f.key] !== undefined) merged[f.key] = ov[f.key]
    })
    return normStyle(kind, merged)
  }

  // #RRGGBB → ffmpeg 颜色字面量（0xRRGGBB，可选带 @alpha）
  function ffColor(v, alpha) {
    var hex = isHex(v) ? v.trim().slice(1).toUpperCase() : 'FFFFFF'
    var a = typeof alpha === 'number' ? alpha : 1
    return '0x' + hex + (a >= 1 ? '' : '@' + Math.max(0, Math.min(1, a)).toFixed(2))
  }

  // 文字位置 → drawtext 的 x/y 表达式（9 宫格基准 + 像素偏移）
  var POS_MARGIN_X = 60
  var POS_MARGIN_TOP = 90
  var POS_MARGIN_BOTTOM = 150
  function posExpr(st) {
    var x =
      st.x === 'left' ? String(POS_MARGIN_X)
        : st.x === 'right' ? '(w-text_w-' + POS_MARGIN_X + ')'
          : '(w-text_w)/2'
    var y =
      st.y === 'top' ? String(POS_MARGIN_TOP)
        : st.y === 'bottom' ? '(h-text_h-' + POS_MARGIN_BOTTOM + ')'
          : '(h-text_h)/2'
    if (st.dx) x += (st.dx > 0 ? '+' : '') + st.dx
    if (st.dy) y += (st.dy > 0 ? '+' : '') + st.dy
    return { x: x, y: y }
  }

  // 样式 → drawtext 参数（不含 fontfile / textfile，调用方各自拼）
  function styleToDrawtext(st) {
    var pos = posExpr(st)
    var out =
      ':fontsize=' + st.size +
      ':fontcolor=' + ffColor(st.color) +
      ':line_spacing=' + st.lineSpacing +
      ':x=' + pos.x + ':y=' + pos.y
    if (st.borderW > 0) out += ':borderw=' + st.borderW + ':bordercolor=' + ffColor(st.borderColor)
    if (st.shadowX || st.shadowY) {
      out +=
        ':shadowx=' + st.shadowX + ':shadowy=' + st.shadowY +
        ':shadowcolor=' + ffColor(st.shadowColor, st.shadowAlpha)
    }
    if (st.box) out += ':box=1:boxcolor=' + ffColor(st.boxColor, st.boxAlpha) + ':boxborderw=' + st.boxBorderW
    return out
  }

  var promoUi = {
    scope: 'mark', // 当前编辑的样式作用域：'intro' | 'mark' | 'outro' | 'mark:<i>'(第 i 个入选高光)
    autoPreview: true,
    previewRole: '', // 预览底图对应的角色，用于切底图
    previewSrc: '',
    previewMsg: '',
    previewBusy: false,
    chat: [], // [{ role:'user'|'ai', text, raw, patch, scope, applied }]
    chatInput: '',
    aiBusy: false,
    aiMsg: '',
    fontList: null,
    // 各折叠块是否展开（重新渲染后要保持）
    open: { preview: true, text: true, style: false, adv: false, ai: false, gen: true, genAdv: false }
  }
  var previewTimer = null

  // 作用域解析：{ role, kind, mark, markIdx }
  function scopeInfo(pc) {
    var s = String(promoUi.scope || 'mark')
    var m = /^mark:(\d+)$/.exec(s)
    if (m) {
      var i = parseInt(m[1], 10)
      var list = includedMarks()
      if (list[i]) return { role: s, kind: 'mark', mark: list[i], markIdx: i }
      return { role: 'mark', kind: 'mark', mark: null, markIdx: -1 }
    }
    if (s === 'intro' || s === 'outro') return { role: s, kind: s, mark: null, markIdx: -1 }
    return { role: 'mark', kind: 'mark', mark: null, markIdx: -1 }
  }

  // 当前作用域生效的样式（单个高光作用域时即「该高光的完整样式」）
  function scopeStyle(pc) {
    var si = scopeInfo(pc)
    return roleStyle(pc, si.kind, si.role.indexOf('mark:') === 0 ? si.mark : null)
  }

  function writeScopeStyle(pc, patch) {
    var si = scopeInfo(pc)
    if (si.role.indexOf('mark:') === 0 && si.mark) {
      var ov = {}
      for (var k in si.mark.promoStyle || {}) if (Object.prototype.hasOwnProperty.call(si.mark.promoStyle, k)) ov[k] = si.mark.promoStyle[k]
      for (var k2 in patch) if (Object.prototype.hasOwnProperty.call(patch, k2)) ov[k2] = patch[k2]
      si.mark.promoStyle = ov
      persistMarks()
    } else {
      var cur = {}
      STYLE_FIELDS.forEach(function (f) {
        cur[f.key] = pc[si.kind][f.key]
      })
      for (var k3 in patch) if (Object.prototype.hasOwnProperty.call(patch, k3)) cur[k3] = patch[k3]
      pc[si.kind] = normStyle(si.kind, cur)
      savePcfg(pc)
    }
    schedulePreview()
  }

  function findPreset(id) {
    for (var i = 0; i < STYLE_PRESETS.length; i++) if (STYLE_PRESETS[i].id === id) return STYLE_PRESETS[i]
    return null
  }

  // 「恢复默认」：单个高光 = 删掉覆盖、回到全局样式；否则回到该作用域的出厂默认
  function resetScopeStyle() {
    var pc = pcfg()
    var si = scopeInfo(pc)
    if (si.role.indexOf('mark:') === 0 && si.mark) {
      delete si.mark.promoStyle
      persistMarks()
    } else {
      pc[si.kind] = styleDefaultsFor(si.kind)
      savePcfg(pc)
    }
    renderBody()
    schedulePreview()
  }

  // 表单控件 → 该字段的规范值（数字转换 / 大写颜色）
  function readSField(t, f) {
    var v = t.value
    if (f.kind === 'bool') return !!t.checked
    if (f.kind === 'int') return parseInt(v, 10)
    if (f.kind === 'num') return parseFloat(v)
    if (f.kind === 'color') return String(v).toUpperCase()
    return v
  }

  // 写入当前作用域的样式（单个字段改动）
  function applyStyleInput(key, value) {
    var f = styleField(key)
    if (!f) return
    var patch = {}
    patch[key] = value
    writeScopeStyle(pcfg(), patch)
  }

  // 逐条文案：data-mtext 用的是「入选列表」的下标（与采集顺序一致）
  function writeMarkText(i, value) {
    var m = includedMarks()[i]
    if (!m) return
    m.promoText = String(value)
    persistMarks()
    schedulePreview()
  }

  // ---- AI：写 / 润色文案 ----
  function styleFieldDoc() {
    return STYLE_FIELDS.map(function (f) {
      var range =
        f.kind === 'int' || f.kind === 'num'
          ? ' [' + f.min + '~' + f.max + ']'
          : f.kind === 'color'
            ? '（#RRGGBB）'
            : f.kind === 'enum'
              ? '（' + f.values.join('/') + '）'
              : f.kind === 'bool'
                ? '（true/false）'
                : ''
      return f.key + ' ' + f.label + range
    }).join('\n')
  }

  var STYLE_SYSTEM_PROMPT = [
    '你是「铃光时刻」宣传片的文字样式调参助手。用户用自然语言描述想要的文字外观，你把它翻译成样式参数改动。',
    '',
    '可调参数（键 含义 取值范围）：',
    styleFieldDoc(),
    '',
    '只输出 JSON，不要 Markdown 代码块：',
    '{"reply":"一句话说明改了什么（给用户看）","patch":{"要改的键":值}}',
    '只改用户提到的键，其余不要输出；不需要改参数时 patch 输出 {}。'
  ].join('\n')

  function aiWriteCopy() {
    var list = includedMarks()
    if (!list.length) {
      loom.toast('还没有入选的高光时刻（到「结果」页勾选）', 'error')
      return
    }
    if (promoUi.aiBusy) return
    promoUi.aiBusy = true
    promoUi.aiMsg = 'AI 正在写文案…'
    renderBody()
    var lines = list.map(function (m, i) {
      return (
        i + 1 + '. 标题：' + (m.title || '（无）') +
        '｜原句：' + String(m.quote || '').slice(0, 60) +
        '｜入选理由：' + String(m.reason || '').slice(0, 40) +
        '｜现有宣传语：' + String(m.promoText != null ? m.promoText : m.promo || '').slice(0, 30)
      )
    })
    var sys = [
      '你是视觉小说宣传文案写手。为每条「铃光时刻」写一句可直接叠加到画面上的宣传短句。',
      '要求：',
      '- 每条不超过 20 个字，一句话，有画面感或情绪冲击力，不剧透结局；',
      '- 不要引号、不要句号结尾、不要角色名前缀；',
      '- 有「现有宣传语」的优先润色它，不要完全换一个意思；',
      '- 同一部作品的宣传语风格要统一，像同一个人写的。',
      '',
      '只输出 JSON，不要 Markdown：{"items":[{"i":1,"promo":"……"}]}'
    ].join('\n')
    callAI([{ role: 'system', content: sys }, { role: 'user', content: lines.join('\n') }], 1200)
      .then(function (text) {
        var j = extractJson(text)
        var items = j && Array.isArray(j.items) ? j.items : null
        if (!items || !items.length) throw new Error('AI 没有返回可用文案：' + String(text || '').slice(0, 120))
        var n = 0
        items.forEach(function (it) {
          var i = Math.round(num(it && it.i, 0, 0, 1000000)) - 1
          var m = list[i]
          var p = it && it.promo != null ? String(it.promo).trim() : ''
          if (!m || !p) return
          m.promoText = p
          n++
        })
        if (!n) throw new Error('AI 返回的文案对不上任何高光（编号或内容为空）')
        persistMarks()
        promoUi.aiMsg = '已写入 ' + n + ' 条文案'
        loom.toast('AI 已写 ' + n + ' 条宣传语', 'success')
      })
      .catch(function (e) {
        promoUi.aiMsg = 'AI 写文案失败：' + errText(e)
        loom.toast('AI 写文案失败：' + errText(e), 'error')
      })
      .then(function () {
        promoUi.aiBusy = false
        if (overlay && state.tab === 'promo') renderBody()
        schedulePreview()
      })
  }

  // ---- AI：对话式调样式（返回 patch，用户点「套用此改动」才生效）----
  function aiChatSend() {
    if (promoUi.aiBusy) return
    var inp = overlay ? overlay.querySelector('[data-role="ai-input"]') : null
    var text = String((inp ? inp.value : promoUi.chatInput) || '').trim()
    if (!text) return
    if (inp) inp.value = ''
    var pc = pcfg()
    var si = scopeInfo(pc)
    var st = scopeStyle(pc)
    var pl = previewPlan(pc)
    promoUi.chat.push({ role: 'user', text: text })
    promoUi.aiBusy = true
    renderBody()

    var ctx = [
      '当前作用域：' + (si.role.indexOf('mark:') === 0 ? '高光 #' + (si.markIdx + 1) : ROLE_LABEL[si.kind]),
      '该段文字：' + String(pl.text || '').slice(0, 60),
      '当前样式：' + JSON.stringify(st)
    ].join('\n')
    var msgs = [{ role: 'system', content: STYLE_SYSTEM_PROMPT }]
    promoUi.chat.forEach(function (c, i) {
      var last = i === promoUi.chat.length - 1
      if (c.role === 'user') msgs.push({ role: 'user', content: last ? c.text + '\n\n【当前上下文】\n' + ctx : c.text })
      else msgs.push({ role: 'assistant', content: c.raw || c.text })
    })

    callAI(msgs, 900)
      .then(function (out) {
        var j = extractJson(out)
        if (!j) throw new Error('AI 没有返回 JSON：' + String(out || '').slice(0, 120))
        var reply = String(j.reply || '').trim() || '（AI 未说明改动）'
        var src = j.patch && typeof j.patch === 'object' ? j.patch : {}
        var patch = {}
        STYLE_FIELDS.forEach(function (f) {
          if (src[f.key] === undefined) return
          patch[f.key] = normStyleValue(f, src[f.key], si.kind)
        })
        promoUi.chat.push({
          role: 'ai',
          text: reply,
          raw: out,
          patch: Object.keys(patch).length ? patch : null,
          scope: si.role,
          applied: false
        })
      })
      .catch(function (e) {
        promoUi.chat.push({ role: 'ai', text: '出错了：' + errText(e), patch: null })
      })
      .then(function () {
        promoUi.aiBusy = false
        if (overlay && state.tab === 'promo') renderBody()
      })
  }

  function aiApplyPatch(idx) {
    var c = promoUi.chat[idx]
    if (!c || !c.patch) return
    if (c.scope) promoUi.scope = c.scope
    writeScopeStyle(pcfg(), c.patch)
    c.applied = true
    renderBody()
    loom.toast('已套用 AI 的样式改动', 'success')
  }

  var promo = {
    running: false,
    cancel: false,
    step: '尚未生成',
    pct: 0,
    logs: [],
    error: '',
    taskId: '',
    captured: null, // { 'm1': true, ... } 上一次采集到的帧（供界面显示「已采集 x/N」）
    out: null // { video, captured, total, secs }
  }

  function pcfg() {
    var raw = loom.store.get(PROMO_KEY)
    var c = raw && typeof raw === 'object' ? raw : {}
    var out = {
      title: typeof c.title === 'string' ? c.title : PROMO_DEFAULTS.title,
      endText: typeof c.endText === 'string' ? c.endText : PROMO_DEFAULTS.endText,
      duration: num(c.duration, PROMO_DEFAULTS.duration, 1, 15),
      transition: num(c.transition, PROMO_DEFAULTS.transition, 0, 3),
      bgm: typeof c.bgm === 'string' ? c.bgm.trim() : '',
      fps: Math.round(num(c.fps, PROMO_DEFAULTS.fps, 12, 60)),
      crf: Math.round(num(c.crf, PROMO_DEFAULTS.crf, 0, 40)),
      font: typeof c.font === 'string' ? c.font.trim() : ''
    }
    STYLE_ROLES.forEach(function (role) {
      out[role] = normStyle(role, c[role])
    })
    return out
  }

  function savePcfg(c) {
    loom.store.set(PROMO_KEY, c)
  }

  function errText(e) {
    return String(e && e.message ? e.message : e)
  }

  function pUpdateDom() {
    if (!overlay || state.tab !== 'promo') return
    var bar = overlay.querySelector('[data-role="p-bar"]')
    if (bar) bar.style.width = Math.round(promo.pct * 100) + '%'
    var msg = overlay.querySelector('[data-role="p-msg"]')
    if (msg) msg.innerHTML = promo.error ? '<span class="sz-err">' + esc(promo.step) + '</span>' : esc(promo.step)
    var box = overlay.querySelector('[data-role="p-logs"]')
    if (box) {
      box.textContent = promo.logs.length ? promo.logs.join('\n') : '日志会显示在这里'
      box.scrollTop = box.scrollHeight
    }
  }

  function pLog(msg) {
    promo.logs.push(String(msg))
    if (promo.logs.length > MAX_LOGS) promo.logs.shift()
    pUpdateDom()
  }

  function pSet(step, pct) {
    if (step != null) promo.step = String(step)
    if (typeof pct === 'number') promo.pct = Math.max(0, Math.min(1, pct))
    pUpdateDom()
  }

  // ---- 采集脚本（常量，注入到 game/ 后由 --warp 触发）----
  function captureScriptText() {
    return [
      '# ⚠️ Pupurin° Loom｜铃光时刻 宣传片采集脚本（自动注入，采集结束自动删除）',
      '#',
      '# 安全设计：',
      '#   1. 只有在 builds/promo/.capture.json 存在时才生效（正常游戏运行时该文件不存在，',
      '#      因此本脚本哪怕残留 .rpyc 也完全惰性、不产生任何行为）；',
      '#   2. 一次只拍一个目标（--warp 直达该行），不自动推进剧情；',
      '#   3. 拍到或超时都会自退，另有看门狗线程按时硬退出，避免游戏窗口一直开着。',
      '',
      'init -100 python:',
      '    import os as _pl_os',
      '    import json as _pl_json',
      '    import threading as _pl_thread',
      '',
      '    def _pl_norm(p):',
      '        return _pl_os.path.normpath(str(p).replace("\\\\", "/"))',
      '',
      '    def _pl_read_cfg():',
      '        p = _pl_os.path.join(config.basedir, "builds", "promo", ".capture.json")',
      '        try:',
      '            with open(p, "r") as f:',
      '                return _pl_json.load(f)',
      '        except Exception:',
      '            return None',
      '',
      '    _pl_cfg = _pl_read_cfg()',
      '',
      '    if _pl_cfg:',
      '        # warp 需要开发者模式；只在采集期生效',
      '        config.developer = True',
      '',
      '        _pl_out = _pl_cfg.get("out") or _pl_os.path.join(config.basedir, "builds", "promo", "frames")',
      '        if not _pl_os.path.isabs(_pl_out):',
      '            _pl_out = _pl_os.path.join(config.basedir, _pl_out)',
      '',
      '        _pl_targets = {}',
      '        for _t in (_pl_cfg.get("targets") or []):',
      '            try:',
      '                _pl_targets[(_pl_norm(_t.get("file")), int(_t.get("line")))] = str(_t.get("id"))',
      '            except Exception:',
      '                pass',
      '',
      '        _pl_timeout_ticks = int(_pl_cfg.get("timeoutTicks") or 600)',
      '        _pl_settle_ticks = int(_pl_cfg.get("settleTicks") or 3)',
      '        _pl_wall_timeout = float(_pl_cfg.get("wallTimeoutSec") or 45)',
      '',
      '        # 输出分辨率：窗口物理尺寸受屏幕钳制且因机而异，用 screenshot_crop 让',
      '        # renpy.screenshot() 先把整窗缩放为 (screen_width, screen_height) 再裁剪，',
      '        # 得到与窗口大小无关的确定尺寸（游戏逻辑分辨率）。',
      '        _pl_width = min(int(_pl_cfg.get("width") or config.screen_width), config.screen_width)',
      '        _pl_height = min(int(_pl_cfg.get("height") or config.screen_height), config.screen_height)',
      '        config.screenshot_crop = (0, 0, _pl_width, _pl_height)',
      '',
      '        _pl_state = {"ticks": 0, "shot": {}, "settle": {}, "log": [], "last": None, "held": 0, "done": False}',
      '',
      '        def _pl_busy():',
      '            """是否仍有文字在逐字显示（warp 命中行引擎已关闭逐字，这里仅作兜底）"""',
      '            try:',
      '                import renpy.text.text as _rt',
      '                return any(getattr(t, "slow", False) for t in _rt.slow_text)',
      '            except Exception:',
      '                return False',
      '',
      '        def _pl_ensure_dir():',
      '            if not _pl_os.path.isdir(_pl_out):',
      '                try:',
      '                    _pl_os.makedirs(_pl_out)',
      '                except Exception:',
      '                    pass',
      '',
      '        def _pl_write(path, text):',
      '            try:',
      '                _pl_ensure_dir()',
      '                with open(_pl_os.path.join(_pl_out, path), "w") as f:',
      '                    f.write(text)',
      '            except Exception:',
      '                pass',
      '',
      '        def _pl_log(msg):',
      '            _pl_state["log"].append(msg)',
      '            _pl_write("_capture_log.txt", "\\n".join(_pl_state["log"]) + "\\n")',
      '',
      '        def _pl_write_result(ticks, reason):',
      '            _pl_write("_capture_result.json", _pl_json.dumps({',
      '                "width": _pl_width,',
      '                "height": _pl_height,',
      '                "shots": {k: bool(v) for k, v in _pl_state["shot"].items()},',
      '                "ticks": ticks,',
      '                "total": len(_pl_targets),',
      '                "reason": reason,',
      '            }, ensure_ascii=False))',
      '',
      '        def _pl_finish(ticks, reason):',
      '            if _pl_state["done"]:',
      '                return',
      '            _pl_state["done"] = True',
      '            _pl_log("done shots=%d/%d ticks=%s reason=%s" % (',
      '                len(_pl_state["shot"]), len(_pl_targets), ticks, reason))',
      '            _pl_write_result(ticks, reason)',
      '            # renpy.quit() 是「抛 QuitException 让主循环退出」，必须让它继续向上冒泡（不要 catch）',
      '            renpy.quit()',
      '',
      '        def _pl_watchdog():',
      '            """兜底：到点必定让进程退出（哪怕主线程卡住、或 renpy.quit() 没生效）"""',
      '            import time as _pl_time',
      '            _pl_time.sleep(_pl_wall_timeout)',
      '            if _pl_state["done"]:',
      '                _pl_log("watchdog: still alive %ss after finish, hard exit" % _pl_wall_timeout)',
      '            else:',
      '                _pl_state["done"] = True',
      '                _pl_log("watchdog: nothing shot in %ss, hard exit" % _pl_wall_timeout)',
      '                _pl_write_result(_pl_state["ticks"], "watchdog")',
      '            _pl_os._exit(0)',
      '',
      '        _pl_wd = _pl_thread.Thread(target=_pl_watchdog)',
      '        _pl_wd.daemon = True',
      '        _pl_wd.start()',
      '',
      '        def _pl_tick():',
      '            st = _pl_state',
      '            if st["done"]:',
      '                return',
      '            st["ticks"] += 1',
      '',
      '            try:',
      '                _f, _l = renpy.get_filename_line()',
      '            except Exception:',
      '                _f, _l = "", 0',
      '            key = (_pl_norm(_f or ""), int(_l or 0))',
      '',
      '            if key == st["last"]:',
      '                st["held"] += 1',
      '            else:',
      '                st["last"] = key',
      '                st["held"] = 1',
      '',
      '            mid = _pl_targets.get(key)',
      '            pending = bool(mid) and mid not in st["shot"]',
      '',
      '            if pending and not _pl_busy():',
      '                st["settle"][mid] = st["settle"].get(mid, 0) + 1',
      '                if st["settle"][mid] >= _pl_settle_ticks:',
      '                    st["shot"][mid] = True',
      '                    _pl_ensure_dir()',
      '                    try:',
      '                        ok = renpy.screenshot(_pl_os.path.join(_pl_out, "%s.png" % mid))',
      '                    except Exception as _e:',
      '                        ok = False',
      '                        _pl_log("screenshot err=%r" % (_e,))',
      '                    _pl_log("shot id=%s file=%s line=%s ok=%s size=%sx%s ticks=%s" % (',
      '                        mid, _f, _l, ok, _pl_width, _pl_height, st["ticks"]))',
      '',
      '            # 单目标：拍到就收工；warp 没落到目标行时靠 tick 上限兜底（都不再推进剧情）',
      '            if len(st["shot"]) >= len(_pl_targets):',
      '                _pl_finish(st["ticks"], "shot")',
      '            elif st["ticks"] >= _pl_timeout_ticks:',
      '                _pl_finish(st["ticks"], "timeout")',
      '',
      '        config.periodic_callback = _pl_tick',
      ''
    ].join('\n')
  }

  // ---- 小工具 ----
  function projectName() {
    var p = String(loom.project.getPath() || '').replace(/\\/g, '/')
    var parts = p.split('/').filter(function (s) { return !!s })
    return parts.length ? parts[parts.length - 1] : '宣传片'
  }

  // 标记里的 file 是 game/ 相对路径；采集脚本的 target 需要「相对项目根」的路径
  function captureFilePath(file) {
    var f = String(file || '').replace(/\\/g, '/').replace(/^\/+/, '')
    return f.indexOf('game/') === 0 ? f : 'game/' + f
  }

  // 入选的高光（顺序即采集顺序：m1、m2…）
  function includedMarks() {
    return state.marks.filter(function (m) {
      return m && m.include !== false && m.file && m.line
    })
  }

  // 该高光在片子里用的文案：手动覆盖 > AI 宣传语 > 标题
  function markText(m) {
    if (!m) return ''
    var t = m.promoText != null ? m.promoText : m.promo
    return String(t == null || t === '' ? m.title || '' : t).trim()
  }

  // 每个入选标记各自一组：一次 --warp 只拍一个点。
  // （同一 label 里的多个目标若并成一次运行，就只能逐句自动推进剧情去找后面的目标，
  //   既慢，又会让游戏窗口长时间开着演剧情——所以宁可多启动几次 Ren'Py。）
  function promoGroups() {
    return includedMarks().map(function (m) {
      return [m]
    })
  }

  function promoMarkCount() {
    return promoGroups().reduce(function (n, g) {
      return n + g.length
    }, 0)
  }

  // ffmpeg filtergraph 里引用路径：统一用正斜杠并整体加单引号
  function ffPath(p) {
    return "'" + String(p).replace(/\\/g, '/').replace(/'/g, "'\\''") + "'"
  }

  // 按每行 per 个字折行（drawtext 不会自动换行）
  var LINE_HEAD_STOPS = '，。！？、；：）】》」』”’…—～'
  function wrapText(s, per) {
    var out = []
    String(s == null ? '' : s)
      .split('\n')
      .forEach(function (para) {
        var chars = Array.from(para)
        if (!chars.length) {
          out.push('')
          return
        }
        var lines = []
        var step = Math.max(1, Math.floor(per) || 1)
        var i = 0
        while (i < chars.length) {
          var end = Math.min(chars.length, i + step)
          // 西文单词不拦腰截断：切点落在单词中间时回退到最近的空格
          if (end < chars.length && /[A-Za-z0-9]/.test(chars[end - 1]) && /[A-Za-z0-9]/.test(chars[end])) {
            for (var j = end - 2; j > i; j--) {
              if (chars[j] === ' ') {
                end = j + 1
                break
              }
            }
          }
          lines.push(chars.slice(i, end).join(''))
          i = end
        }
        // 折行后去掉行首空白，再避免标点出现在行首（把它并回上一行）
        for (var k = 0; k < lines.length; k++) {
          lines[k] = lines[k].replace(/^[ \t\u3000]+/, '')
          while (k > 0 && lines[k] && LINE_HEAD_STOPS.indexOf(lines[k][0]) >= 0) {
            lines[k - 1] += lines[k][0]
            lines[k] = lines[k].slice(1)
          }
          lines[k] = lines[k].replace(/[ \t\u3000]+$/, '')
        }
        out = out.concat(lines)
      })
    return out.join('\n')
  }

  // 字体可能在 game/ 顶层，也可能在 fonts/ 等子目录里（字体文件不存在时 list 会失败，按空处理）
  var FONT_DIRS = ['game', 'game/fonts', 'game/font', 'game/gui/font']
  function fontList() {
    return Promise.all(
      FONT_DIRS.map(function (d) {
        return loom.fs.list(d).then(
          function (items) {
            return items || []
          },
          function () {
            return []
          }
        )
      })
    ).then(function (lists) {
      var fonts = []
      lists.forEach(function (items) {
        items.forEach(function (it) {
          if (!it.isDir && /\.(ttf|otf|ttc)$/i.test(it.name)) fonts.push({ name: it.name, path: it.path })
        })
      })
      return fonts
    })
  }

  // preferred 是配置里记住的字体（game/ 相对路径）；失效时回落到第一个可用字体
  function pickFont(preferred) {
    return fontList().then(function (fonts) {
      if (!fonts.length) return ''
      if (preferred) {
        for (var i = 0; i < fonts.length; i++) {
          if (fonts[i].path === preferred || fonts[i].name === preferred) return fonts[i].path
        }
      }
      var prefer = ['SourceHanSansLite.ttf', 'DejaVuSans.ttf', 'NotoSansCJK-Regular.ttc', 'msyh.ttc']
      for (var j = 0; j < prefer.length; j++) {
        for (var k = 0; k < fonts.length; k++) {
          if (fonts[k].name === prefer[j]) return fonts[k].path
        }
      }
      return fonts[0].path
    })
  }

  // ---- 采集 ----
  async function removeQuietly(path) {
    try {
      await loom.fs.remove(path)
    } catch (e) {
      /* 文件不存在或已删 */
    }
  }

  // 从 Ren'Py 输出里取「首条错误」，用于把「0 帧」翻译成人话。
  // 语法错误形如：File "game/x.rpy", line 34: expected statement.
  // 运行异常形如：File "game/x.rpy", line 12, in <module>
  function firstRenpyError(text) {
    var lines = String(text || '').split('\n')
    for (var i = 0; i < lines.length; i++) {
      var m = lines[i].match(/File "([^"]+)",\s*line\s*(\d+)(?::\s*(.+?)\s*$|,\s*in\s+(.+?)\s*$)?/)
      if (!m) continue
      var loc = m[1] + ':' + m[2]
      var why = m[3] || (m[4] ? '在 ' + m[4] + ' 中出错' : '')
      return why ? loc + '：' + why : loc
    }
    return ''
  }

  async function captureGroupOnce(items) {
    var targets = items.map(function (it) {
      return { id: it.id, file: it.file, line: it.line }
    })
    await removeQuietly(CAPTURE_RESULT)
    await loom.fs.write(
      CAPTURE_CFG,
      JSON.stringify(
        {
          out: FRAMES_DIR,
          targets: targets,
          timeoutTicks: CAPTURE_TIMEOUT_TICKS,
          settleTicks: 3,
          wallTimeoutSec: CAPTURE_WALL_TIMEOUT_SEC
        },
        null,
        2
      )
    )
    var spec = items[0].file + ':' + items[0].line
    pLog('启动 Ren\'Py 采集：--warp ' + spec)
    var t = loom.task.spawn({
      tool: 'renpy',
      args: [loom.project.getPath(), '--warp', spec],
      timeoutMs: 4 * 60 * 1000
    })
    promo.taskId = t.id
    var buf = ''
    var off = t.onOutput(function (chunk) {
      buf += chunk
      // 头尾各留 4000 字符：错误通常在开头，收尾信息在末尾
      if (buf.length > 8000) buf = buf.slice(0, 4000) + '\n…\n' + buf.slice(-4000)
    })
    var r = await t.done
    off()
    promo.taskId = ''
    r.firstError = firstRenpyError(buf)
    if (r.firstError) pLog('renpy 报错：' + r.firstError)
    else if (buf.trim()) pLog('renpy: ' + buf.trim().split('\n').slice(-4).join(' | '))
    return r
  }

  async function readCaptureResult() {
    var raw = await loom.fs.read(CAPTURE_RESULT)
    if (!raw) return null
    try {
      return JSON.parse(raw)
    } catch (e) {
      return null
    }
  }

  // ---- 合成 ----
  function buildStoryboard(usable, pc) {
    var segs = []
    var title = String(pc.title || projectName()).trim()
    if (title) segs.push({ kind: 'intro', text: title, secs: INTRO_SEC, style: roleStyle(pc, 'intro', null) })
    usable.forEach(function (it) {
      segs.push({
        kind: 'mark',
        item: it,
        text: markText(it.mark),
        secs: pc.duration,
        style: roleStyle(pc, 'mark', it.mark)
      })
    })
    var endText = String(pc.endText || '').trim()
    if (endText) segs.push({ kind: 'outro', text: endText, secs: OUTRO_SEC, style: roleStyle(pc, 'outro', null) })
    return segs
  }

  async function buildFilterGraph(segs, pc, font, outVideo) {
    var fps = pc.fps
    var minSec = Math.min.apply(
      null,
      segs.map(function (s) {
        return s.secs
      })
    )
    // 转场不能长到吃掉整段
    var T = Math.max(0, Math.min(pc.transition, Math.max(0, minSec - 0.4)))
    var lines = []
    var inputs = [] // [{ item, secs }]

    for (var i = 0; i < segs.length; i++) {
      var s = segs[i]
      var g = 'g' + i
      if (s.kind === 'mark') {
        inputs.push({ item: s.item, secs: s.secs })
        lines.push(
          '[' + (inputs.length - 1) + ':v]scale=' + OUT_W + ':' + OUT_H +
            ':force_original_aspect_ratio=decrease,pad=' + OUT_W + ':' + OUT_H +
            ':(ow-iw)/2:(oh-ih)/2:black,setsar=1,fps=' + fps +
            ',format=yuv420p,setpts=PTS-STARTPTS[' + g + ']'
        )
      } else {
        lines.push(
          'color=c=0x0E0E14:s=' + OUT_W + 'x' + OUT_H + ':r=' + fps + ':d=' + s.secs.toFixed(3) +
            ',format=yuv420p,setsar=1[' + g + ']'
        )
      }

      var d = 'd' + i
      if (s.text) {
        lines.push(
          '[' + g + ']drawtext=fontfile=' + ffPath(font) +
            ':textfile=' + ffPath(TEXT_DIR + '/' + i + '.txt') +
            styleToDrawtext(s.style) + '[' + d + ']'
        )
      } else {
        lines.push('[' + g + ']null[' + d + ']')
      }
    }

    var prev = 'd0'
    var acc = segs[0].secs
    for (var k = 1; k < segs.length; k++) {
      var out = 'x' + k
      if (T > 0.05) {
        lines.push(
          '[' + prev + '][d' + k + ']xfade=transition=fade:duration=' + T.toFixed(3) +
            ':offset=' + (acc - T).toFixed(3) + '[' + out + ']'
        )
        acc = acc - T + segs[k].secs
      } else {
        lines.push('[' + prev + '][d' + k + ']concat=n=2:v=1:a=0[' + out + ']')
        acc = acc + segs[k].secs
      }
      prev = out
    }
    var total = acc
    lines.push('[' + prev + ']null[vout]')

    // 音频（可选 BGM）
    var hasAudio = !!pc.bgm
    if (hasAudio) {
      lines.push(
        '[' + inputs.length + ':a]atrim=0:' + total.toFixed(3) + ',asetpts=PTS-STARTPTS' +
          ',afade=t=in:st=0:d=0.8,afade=t=out:st=' + Math.max(0, total - 1.2).toFixed(3) +
          ':d=1.2,volume=0.85[aout]'
      )
    }

    var graph = lines.join(';\n') + '\n'

    var args = ['-y', '-hide_banner', '-nostdin']
    inputs.forEach(function (it) {
      args = args.concat([
        '-loop', '1',
        '-framerate', String(fps),
        '-t', it.secs.toFixed(3),
        '-i', FRAMES_DIR + '/' + it.item.id + '.png'
      ])
    })
    if (hasAudio) args = args.concat(['-stream_loop', '-1', '-i', pc.bgm])
    args = args.concat(['-filter_complex', graph, '-map', '[vout]'])
    if (hasAudio) args = args.concat(['-map', '[aout]'])
    args = args.concat([
      '-c:v', 'libx264', '-preset', 'medium', '-crf', String(pc.crf),
      '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-r', String(fps),
      '-loglevel', 'warning', '-progress', 'pipe:1', '-nostats'
    ])
    if (hasAudio) args = args.concat(['-c:a', 'aac', '-b:a', '192k'])
    args = args.concat(['-t', total.toFixed(3), outVideo])
    return { args: args, total: total, transition: T }
  }

  function promoFileName() {
    var d = new Date()
    var pad = function (n) {
      return (n < 10 ? '0' : '') + n
    }
    return (
      PROMO_DIR + '/promo-' +
      d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + '-' +
      pad(d.getHours()) + pad(d.getMinutes()) + pad(d.getSeconds()) + '.mp4'
    )
  }

  async function composeVideo(usable, pc, font, outVideo) {
    var segs = buildStoryboard(usable, pc)
    // 宣传文案写入独立文本文件，用 drawtext 的 textfile 读取，避免 filtergraph 里的转义地狱
    for (var i = 0; i < segs.length; i++) {
      if (!segs[i].text) continue
      await loom.fs.write(TEXT_DIR + '/' + i + '.txt', wrapText(segs[i].text, segs[i].style.perLine) + '\n')
    }
    var built = await buildFilterGraph(segs, pc, font, outVideo)
    var total = built.total
    pLog('分镜：' + segs.length + ' 段 · 时长 ' + total.toFixed(1) + 's · 转场 ' + built.transition.toFixed(1) + 's')

    var t = loom.task.spawn({ tool: 'ffmpeg', args: built.args, timeoutMs: 20 * 60 * 1000 })
    promo.taskId = t.id
    var tail = ''
    var lastPct = -1
    var off = t.onOutput(function (chunk, stream) {
      if (stream !== 'stdout') {
        tail = (tail + chunk).slice(-2000)
        return
      }
      // -progress pipe:1：out_time_us=<微秒>
      chunk.split('\n').forEach(function (line) {
        var m = /^(?:out_time_us|out_time_ms)=(\d+)/.exec(line.trim())
        if (!m || total <= 0) return
        var ratio = Math.min(1, parseInt(m[1], 10) / 1e6 / total)
        var pct = Math.round(ratio * 100)
        if (pct === lastPct) return
        lastPct = pct
        pSet('合成中… ' + pct + '%', 0.62 + 0.36 * ratio)
      })
    })
    var r = await t.done
    off()
    promo.taskId = ''
    if (r.canceled) throw new Error('已取消')
    if (!r.ok) {
      throw new Error(
        'ffmpeg 合成失败（exit=' + String(r.code) + '）' +
          (tail.trim() ? '：' + tail.trim().split('\n').slice(-3).join(' ') : '')
      )
    }
    return total
  }

  async function restoreCapture(prevRpy) {
    try {
      if (typeof prevRpy === 'string') await loom.fs.write(CAPTURE_RPY, prevRpy)
      else await removeQuietly(CAPTURE_RPY)
      // 编译产物一并删除，避免残留脚本继续生效
      await removeQuietly(CAPTURE_RPYC)
      await removeQuietly(CAPTURE_CFG)
    } catch (e) {
      pLog('清理失败（可手动删除 ' + CAPTURE_RPY + ' 与 ' + CAPTURE_CFG + '）：' + errText(e))
    }
  }

  // 把入选标记排成采集计划（id 即帧文件名 m1、m2…）
  function promoPlan() {
    var plan = []
    var groupPlans = promoGroups().map(function (g) {
      return g.map(function (m) {
        var it = {
          id: 'm' + (plan.length + 1),
          file: captureFilePath(m.file),
          line: m.line || 1,
          mark: m
        }
        plan.push(it)
        return it
      })
    })
    return { plan: plan, groupPlans: groupPlans }
  }

  // 注入采集脚本 → 逐个目标截图 → 还原。返回 { captured, firstErr }
  async function captureFrames(plan, groupPlans) {
    var prevRpy = await loom.fs.read(CAPTURE_RPY).catch(function () {
      return null
    })
    try {
      try {
        await loom.fs.write(CAPTURE_RPY, captureScriptText())
      } catch (e) {
        throw new Error('无法写入采集脚本（项目目录不可写？）：' + errText(e))
      }
      pLog('已注入 ' + CAPTURE_RPY + '（' + plan.length + ' 个目标 · 逐个 warp 采集）')

      var captured = {}
      var firstErr = ''
      for (var gi = 0; gi < groupPlans.length; gi++) {
        if (promo.cancel) throw new Error('已取消')
        var items = groupPlans[gi]
        pSet(
          '采集 ' + (gi + 1) + '/' + groupPlans.length + '（' + items[0].mark.file + ':' + items[0].line + '）…',
          0.55 * (gi / groupPlans.length)
        )
        var r = await captureGroupOnce(items)
        if (r.firstError && !firstErr) firstErr = r.firstError
        if (promo.cancel || r.canceled) throw new Error('已取消')
        var res = await readCaptureResult()
        var got = 0
        if (res && res.shots) {
          Object.keys(res.shots).forEach(function (k) {
            if (res.shots[k]) captured[k] = true
          })
          got = items.filter(function (it) {
            return res.shots[it.id]
          }).length
        }
        pLog(
          '采集 ' + (gi + 1) + '/' + groupPlans.length + '：' + got + '/' + items.length + ' 帧（exit=' +
            String(r.code) + (r.timedOut ? ' · 超时' : '') + (r.ok ? '' : ' · ' + String(r.error || '异常')) +
            (got < items.length && res && res.reason ? ' · ' + String(res.reason) : '') + '）'
        )
      }
      return { captured: captured, firstErr: firstErr }
    } finally {
      await restoreCapture(prevRpy)
    }
  }

  // 「只采集截图」：先把画面抓下来，这样样式预览才有真实底图，也便于换帧/重拍
  async function captureOnly() {
    if (promo.running) return
    if (!loom.project.getPath()) {
      loom.toast('请先打开一个项目', 'error')
      return
    }
    var built = promoPlan()
    if (!built.plan.length) {
      loom.toast('还没有入选的高光时刻（到「结果」页勾选）', 'error')
      return
    }
    promo.running = true
    promo.cancel = false
    promo.error = ''
    promo.logs = []
    promo.pct = 0
    pSet('准备中…', 0)
    try {
      var cap = await captureFrames(built.plan, built.groupPlans)
      promo.captured = cap.captured
      var n = Object.keys(cap.captured).length
      pLog('采集完成：' + n + '/' + built.plan.length + ' 帧（可在下方切换作用域预览效果）')
      pSet('已采集 ' + n + '/' + built.plan.length + ' 帧', 1)
      loom.toast('已采集 ' + n + '/' + built.plan.length + ' 帧画面', n ? 'success' : 'error')
      schedulePreview()
    } catch (e) {
      if (promo.cancel) {
        promo.step = '已取消'
        pLog('已取消')
      } else {
        promo.error = errText(e)
        promo.step = '采集失败：' + promo.error
        promo.pct = 0
        pLog('失败：' + promo.error)
        loom.toast('采集失败：' + promo.error, 'error')
      }
    } finally {
      promo.running = false
      promo.cancel = false
      promo.taskId = ''
      renderBody()
      pUpdateDom()
    }
  }

  async function generatePromo() {
    if (promo.running) return
    if (!loom.project.getPath()) {
      loom.toast('请先打开一个项目', 'error')
      return
    }
    var groups = promoGroups()
    if (!groups.length) {
      loom.toast('还没有入选的高光时刻（到「结果」页勾选）', 'error')
      return
    }

    promo.running = true
    promo.cancel = false
    promo.error = ''
    promo.logs = []
    promo.out = null
    promo.pct = 0
    pSet('准备中…', 0)

    var pc = pcfg()
    var built = promoPlan()
    var plan = built.plan
    var groupPlans = built.groupPlans

    try {
      // 1) 采集（注入采集脚本 → 逐个 --warp 截图 → 还原）
      var cap = await captureFrames(plan, groupPlans)
      var captured = cap.captured
      var firstErr = cap.firstErr
      promo.captured = captured

      var usable = plan.filter(function (it) {
        return captured[it.id]
      })
      var missing = plan.filter(function (it) {
        return !captured[it.id]
      })
      if (missing.length) {
        pLog(
          '未采集到 ' + missing.length + ' 帧：' +
            missing
              .map(function (it) {
                return it.mark.file + ':' + it.line
              })
              .join('、')
        )
      }
      if (!usable.length) {
        // 有 Ren'Py 报错时直接给出首条错误，比「没有采集到任何画面」有用得多
        if (firstErr) {
          throw new Error('游戏编译/运行失败：' + firstErr + '（请修复后重试，或先用「从这里开始玩」确认游戏能正常运行）')
        }
        throw new Error('没有采集到任何画面（请确认游戏能正常运行，或先用「从这里开始玩」验证）')
      }

      // 2) ffmpeg
      pSet('准备 ffmpeg…', 0.58)
      var ff = await loom.ffmpeg.ensure(function (m) {
        pLog(m)
      })
      if (!ff.available) throw new Error('ffmpeg 不可用（自动下载失败），请手动安装 ffmpeg 后重试')
      pLog('ffmpeg：' + ff.path + '（' + (ff.source === 'system' ? '系统已安装' : '已自动下载') + '）')

      var font = await pickFont(pc.font)
      if (!font) throw new Error('项目 game/ 目录下没有可用字体（.ttf/.otf/.ttc），无法叠加宣传文字')

      var outVideo = promoFileName()
      pSet('合成中… 0%', 0.62)
      var secs = await composeVideo(usable, pc, font, outVideo)

      promo.out = { video: outVideo, captured: usable.length, total: plan.length, secs: secs }
      promo.pct = 1
      pLog('已生成 ' + outVideo + '（' + usable.length + '/' + plan.length + ' 个高光 · ' + secs.toFixed(1) + 's）')
      pSet('完成', 1)
      loom.toast('宣传片已生成：' + outVideo, 'success')
    } catch (e) {
      if (promo.cancel) {
        promo.step = '已取消'
        pLog('已取消')
      } else {
        promo.error = errText(e)
        promo.step = '生成失败：' + promo.error
        promo.pct = 0
        pLog('失败：' + promo.error)
        loom.toast('生成失败：' + promo.error, 'error')
      }
    } finally {
      promo.running = false
      promo.cancel = false
      promo.taskId = ''
      renderBody()
      pUpdateDom()
    }
  }

  // ---- 静帧预览（与成片用同一套 drawtext 参数，所见即所得）----
  // 底图优先用该高光已采集的游戏截图；片头/片尾与未采集时用纯色底。
  function previewPlan(pc) {
    var si = scopeInfo(pc)
    if (si.kind === 'intro') {
      return {
        kind: 'intro',
        text: String(pc.title || projectName()).trim() || '（片头标题为空）',
        style: roleStyle(pc, 'intro', null),
        frameId: ''
      }
    }
    if (si.kind === 'outro') {
      return {
        kind: 'outro',
        text: String(pc.endText || '').trim() || '（片尾文案为空）',
        style: roleStyle(pc, 'outro', null),
        frameId: ''
      }
    }
    var list = includedMarks()
    var idx = si.markIdx >= 0 ? si.markIdx : 0
    var m = list[idx]
    if (!m) {
      return { kind: 'mark', text: '（还没有入选的高光时刻）', style: roleStyle(pc, 'mark', null), frameId: '', empty: true }
    }
    return {
      kind: 'mark',
      text: markText(m) || '（该高光还没有文案）',
      style: roleStyle(pc, 'mark', m),
      frameId: 'm' + (idx + 1),
      mark: m
    }
  }

  function framesOnDisk() {
    return loom.fs
      .list(FRAMES_DIR)
      .then(
        function (items) {
          return (items || [])
            .filter(function (it) {
              return !it.isDir && /\.png$/i.test(it.name)
            })
            .map(function (it) {
              return it.name.replace(/\.png$/i, '')
            })
        },
        function () {
          return []
        }
      )
  }

  async function renderPreview() {
    if (!overlay || state.tab !== 'promo' || promo.running) return
    if (promoUi.previewBusy) return
    var pc = pcfg()
    var pl = previewPlan(pc)
    promoUi.previewBusy = true
    promoUi.previewMsg = '渲染预览中…'
    previewDom()
    try {
      var ff = await loom.ffmpeg.ensure()
      if (!ff.available) throw new Error('ffmpeg 不可用（自动下载失败），请手动安装 ffmpeg')
      var onDisk = await framesOnDisk()
      var bgId = ''
      if (pl.frameId && onDisk.indexOf(pl.frameId) >= 0) bgId = pl.frameId
      else if (pl.kind === 'mark' && onDisk.length) bgId = onDisk[0]
      var font = await pickFont(pc.font)
      if (!font) throw new Error('项目 game/ 目录下没有可用字体')

      // 文本文件写在预览目录里：fs.write 会顺带把 PREVIEW_DIR 建出来（ffmpeg 不会建目录）
      await loom.fs.write(PREVIEW_DIR + '/preview.txt', wrapText(pl.text, pl.style.perLine) + '\n')
      var out = PREVIEW_DIR + '/preview.png'
      await removeQuietly(out)

      var head = ['-y', '-hide_banner', '-nostdin']
      var graph = []
      if (bgId) {
        head = head.concat(['-loop', '1', '-framerate', String(pc.fps), '-t', '0.2', '-i', FRAMES_DIR + '/' + bgId + '.png'])
        graph.push(
          '[0:v]scale=' + OUT_W + ':' + OUT_H + ':force_original_aspect_ratio=decrease,pad=' + OUT_W + ':' + OUT_H +
            ':(ow-iw)/2:(oh-ih)/2:black,setsar=1,format=yuv420p[g0]'
        )
      } else {
        graph.push('color=c=0x0E0E14:s=' + OUT_W + 'x' + OUT_H + ':r=' + pc.fps + ':d=0.2,setsar=1,format=yuv420p[g0]')
      }
      graph.push(
        '[g0]drawtext=fontfile=' + ffPath(font) + ':textfile=' + ffPath(PREVIEW_DIR + '/preview.txt') +
          styleToDrawtext(pl.style) + '[vout]'
      )
      var args = head.concat([
        '-filter_complex', graph.join(';\n'),
        '-map', '[vout]', '-frames:v', '1', '-update', '1', '-loglevel', 'warning', out
      ])
      var t = loom.task.spawn({ tool: 'ffmpeg', args: args, timeoutMs: 2 * 60 * 1000 })
      var err = ''
      var off = t.onOutput(function (chunk, stream) {
        if (stream !== 'stdout') err = (err + chunk).slice(-1200)
      })
      var r = await t.done
      off()
      if (!r.ok) {
        throw new Error('渲染失败' + (err.trim() ? '：' + err.trim().split('\n').slice(-2).join(' ') : ''))
      }
      // 面板只能经 game/ 读图，这里用 ../ 回到项目根（预览图就落在 builds/promo/preview/）
      var dataUrl = await loom.project.readImage('../' + out)
      if (!dataUrl) throw new Error('预览图读取失败')
      promoUi.previewSrc = dataUrl
      promoUi.previewMsg = (bgId ? '底图 ' + bgId + '.png' : '纯色底') + ' · ' +
        ROLE_LABEL[pl.kind] + (pl.mark ? '「' + String(pl.mark.title || '').slice(0, 12) + '」' : '') +
        ' · ' + pl.style.size + 'px'
    } catch (e) {
      promoUi.previewMsg = '预览失败：' + errText(e)
    } finally {
      promoUi.previewBusy = false
      previewDom()
    }
  }

  function previewDom() {
    if (!overlay || state.tab !== 'promo') return
    var img = overlay.querySelector('[data-role="p-preview"]')
    if (img) {
      if (promoUi.previewSrc) {
        img.src = promoUi.previewSrc
        img.style.display = 'block'
      } else {
        img.removeAttribute('src')
        img.style.display = 'none'
      }
    }
    // 状态显示在折叠标题上（收起时也能看到）
    var note = overlay.querySelector('[data-fnote="preview"]')
    if (note) {
      note.textContent = promoUi.previewBusy ? '渲染预览中…' : promoUi.previewMsg
      note.className = promoUi.previewMsg.indexOf('失败') === 0 ? 'sz-err' : 'sz-muted'
      note.style.fontWeight = '400'
    }
  }

  // 样式改动后自动刷新预览（防抖，避免连续拖数值时反复起 ffmpeg）
  function schedulePreview() {
    if (previewTimer) {
      clearTimeout(previewTimer)
      previewTimer = null
    }
    if (!promoUi.autoPreview) return
    previewTimer = setTimeout(function () {
      previewTimer = null
      renderPreview()
    }, 700)
  }

  // ---------- 宣传片页 ----------
  // 折叠分组（<details>）：key 对应 promoUi.open[key]，展开状态在重渲染后保持
  function foldOpen(key) {
    return promoUi.open[key] === false ? '' : ' open'
  }

  function foldHead(key, title, note) {
    return (
      '<summary data-fold="' + key + '"><span>' + esc(title) + '</span>' +
      '<span class="sz-muted" data-fnote="' + key + '" style="font-weight:400">' + esc(note || '') + '</span>' +
      '</summary>'
    )
  }

  function fold(key, title, note, bodyHtml, inner) {
    return (
      '<details class="sz-fold' + (inner ? ' sz-inner' : '') + '"' + foldOpen(key) + '>' +
      foldHead(key, title, note) +
      '<div class="sz-fold-body">' + bodyHtml + '</div></details>'
    )
  }

  function styleRowsHtml(rows, st) {
    return rows
      .map(function (rowKeys) {
        return (
          '<div class="sz-row">' +
          rowKeys
            .map(function (k) {
              var f = styleField(k)
              return f ? styleCtrlHtml(f, st) : ''
            })
            .join('') +
          '</div>'
        )
      })
      .join('')
  }

  function styleField(key) {
    for (var i = 0; i < STYLE_FIELDS.length; i++) if (STYLE_FIELDS[i].key === key) return STYLE_FIELDS[i]
    return null
  }

  // 一个样式控件的 HTML（type 取决于字段 kind）
  function styleCtrlHtml(f, st) {
    var attrs = 'data-sfield="' + f.key + '"'
    if (f.kind === 'bool') {
      return '<label class="sz-label" style="display:inline-flex;align-items:center;gap:4px">' +
        '<input type="checkbox" ' + attrs + (st[f.key] ? ' checked' : '') + '/>' + esc(f.label) + '</label>'
    }
    if (f.kind === 'color') {
      return '<span class="sz-label">' + esc(f.label) + '</span>' +
        '<input class="sz-in sz-pin" type="color" ' + attrs + ' value="' + esc(st[f.key]) +
        '" style="width:46px;height:24px;padding:0" title="' + esc(st[f.key]) + '"/>'
    }
    if (f.kind === 'enum') {
      var opts = f.values.map(function (v, i) {
        return '<option value="' + v + '"' + (st[f.key] === v ? ' selected' : '') + '>' +
          esc(f.valueLabels ? f.valueLabels[i] : v) + '</option>'
      }).join('')
      return '<span class="sz-label">' + esc(f.label) + '</span><select class="sz-in sz-pin" ' + attrs + '>' + opts + '</select>'
    }
    return '<span class="sz-label">' + esc(f.label) + '</span>' +
      '<input class="sz-in sz-pin sz-num" ' + attrs + ' value="' + esc(st[f.key]) +
      '" title="' + f.min + ' ~ ' + f.max + '"/>'
  }

  function promoTabHtml() {
    var pc = pcfg()
    var list = includedMarks()
    var marks = list.length
    var si = scopeInfo(pc)
    var st = scopeStyle(pc)
    var html = []

    var capN = promo.captured ? Object.keys(promo.captured).length : 0
    html.push(
      '<div class="sz-row"><span class="sz-muted">入选 ' + marks + ' 个高光 · ' +
        (promo.captured ? '已采集 ' + capN + '/' + marks + ' 帧' : '尚未采集画面（先「只采集截图」才能用真实画面预览）') +
        ' · 输出到 ' + PROMO_DIR + '</span></div>'
    )

    // ---- 文案 ----
    var textBody = [
      '<div class="sz-row"><span class="sz-label">片头</span>' +
        '<input class="sz-in sz-pin" data-pfield="title" value="' + esc(pc.title) +
        '" placeholder="留空则用项目名" style="flex:1;min-width:180px"/>' +
        '<span class="sz-label">片尾</span>' +
        '<input class="sz-in sz-pin" data-pfield="endText" value="' + esc(pc.endText) +
        '" placeholder="留空则不加片尾" style="flex:1;min-width:180px"/></div>',
      '<div class="sz-row"><button type="button" class="sz-btn" data-act="ai-copy"' +
        (promoUi.aiBusy || !marks ? ' disabled' : '') + '>AI 写 / 润色文案</button>' +
        '<span class="sz-muted">' + esc(promoUi.aiMsg || '按入选高光批量生成宣传语，可再逐条手改') + '</span></div>',
      marks
        ? list
            .map(function (m, i) {
              return (
                '<div class="sz-row"><span class="sz-muted" style="min-width:20px">#' + (i + 1) + '</span>' +
                '<input class="sz-in sz-pin" data-mtext="' + i + '" value="' +
                esc(m.promoText != null ? m.promoText : m.promo || '') +
                '" placeholder="' + esc(m.title || m.quote || '（AI 宣传语）') + '" style="flex:1;min-width:120px"/>' +
                '<button type="button" class="sz-btn" data-act="promo-scope" data-scope="mark:' + i + '">样式' +
                (m.promoStyle ? ' ✓' : '') + '</button>' +
                '<span class="sz-muted sz-ell" title="' + esc(m.file + ':' + (m.line || 1)) + '">' +
                esc(String(m.file).split('/').pop()) + ':' + (m.line || 1) +
                (promo.captured && promo.captured['m' + (i + 1)] ? ' · 已采集' : '') +
                '</span></div>'
              )
            })
            .join('')
        : '<div class="sz-row"><span class="sz-muted">还没有入选的高光时刻（到「结果」页勾选）</span></div>'
    ].join('')
    html.push(fold('text', '文案', marks ? marks + ' 条宣传语' : '暂无高光', textBody))

    // ---- 样式 ----
    var scopeOpts = [
      { v: 'intro', t: '片头' },
      { v: 'mark', t: '高光（默认样式）' },
      { v: 'outro', t: '片尾' }
    ].concat(
      list.map(function (m, i) {
        return { v: 'mark:' + i, t: '高光 #' + (i + 1) + (m.promoStyle ? '（已自定义）' : '') }
      })
    )
    var fonts = promoUi.fontList || []
    var styleBody = [
      '<div class="sz-row"><span class="sz-label">作用域</span>' +
        '<select class="sz-in sz-pin" data-scope-sel="1">' +
        scopeOpts.map(function (o) {
          return '<option value="' + o.v + '"' + (promoUi.scope === o.v ? ' selected' : '') + '>' + esc(o.t) + '</option>'
        }).join('') +
        '</select>' +
        '<span class="sz-muted">' +
        (si.role.indexOf('mark:') === 0
          ? '只改这一个高光，不影响其他'
          : '所有' + ROLE_LABEL[si.kind] + '共用') +
        '</span></div>',
      '<div class="sz-row"><span class="sz-label">花字</span>' +
        STYLE_PRESETS.map(function (p) {
          return '<button type="button" class="sz-btn" data-act="promo-preset" data-preset="' + p.id + '">' + esc(p.label) + '</button>'
        }).join('') +
        '</div>',
      '<div class="sz-row"><span class="sz-label">字体</span>' +
        '<select class="sz-in sz-pin" data-pfield="font" style="min-width:180px">' +
        '<option value=""' + (pc.font ? '' : ' selected') + '>自动（项目里第一个可用字体）</option>' +
        fonts.map(function (f) {
          return '<option value="' + esc(f.path) + '"' + (pc.font === f.path ? ' selected' : '') + '>' + esc(f.name) + '</option>'
        }).join('') +
        '</select>' +
        (fonts.length ? '' : '<span class="sz-muted">未发现字体文件</span>') +
        '</div>',
      styleRowsHtml(STYLE_ROWS_COMMON, st),
      fold('adv', '更多参数', '偏移 / 行距 / 描边 / 阴影 / 挡板', styleRowsHtml(STYLE_ROWS_ADV, st), true),
      '<div class="sz-row">' +
        '<button type="button" class="sz-btn" data-act="promo-style-reset">' +
        (si.role.indexOf('mark:') === 0 ? '恢复跟随全局' : '恢复默认') + '</button>' +
        '<span class="sz-muted">' + esc(ROLE_LABEL[si.kind]) + ' · ' + st.size + 'px · ' + esc(st.color) +
        ' · ' + esc(posLabel(st)) + (st.box ? ' · 有挡板' : '') + '</span></div>'
    ].join('')
    html.push(
      fold('style', '文字样式', ROLE_LABEL[si.kind] + ' · ' + st.size + 'px · ' + posLabel(st), styleBody)
    )

    // ---- 预览 ----
    html.push(
      fold(
        'preview',
        '效果预览',
        promoUi.previewMsg,
        '<div class="sz-row"><img data-role="p-preview" alt="预览" style="display:' +
          (promoUi.previewSrc ? 'block' : 'none') +
          ';width:100%;max-width:420px;border-radius:6px;border:1px solid rgb(var(--loom-border))"' +
          (promoUi.previewSrc ? ' src="' + promoUi.previewSrc + '"' : '') + '/></div>' +
          '<div class="sz-row"><button type="button" class="sz-btn" data-act="promo-preview">刷新预览</button>' +
          '<button type="button" class="sz-btn" data-act="promo-capture"' +
          (promo.running || !marks ? ' disabled' : '') + '>只采集截图</button>' +
          '<label class="sz-label" style="display:inline-flex;align-items:center;gap:4px">' +
          '<input type="checkbox" data-preview-auto="1"' + (promoUi.autoPreview ? ' checked' : '') +
          '/>改样式自动刷新</label></div>'
      )
    )

    // ---- AI 调样式 ----
    var aiBody = []
    aiBody.push(
      '<div class="sz-row"><span class="sz-muted">用自然语言描述想要的文字外观（当前作用域：' +
        esc(si.role.indexOf('mark:') === 0 ? '高光 #' + (si.markIdx + 1) : ROLE_LABEL[si.kind]) +
        '），AI 给出一组改动，确认后才会套用。</span></div>'
    )
    promoUi.chat.forEach(function (c, i) {
      if (c.role === 'user') {
        aiBody.push('<div class="sz-row"><span class="sz-muted">你：' + esc(c.text) + '</span></div>')
      } else {
        aiBody.push(
          '<div class="sz-row"><span class="sz-muted">AI：' + esc(c.text) +
            (c.patch ? '（将改：' + esc(Object.keys(c.patch).join('、')) + '）' : '') + '</span>' +
            (c.patch
              ? '<button type="button" class="sz-btn" data-act="ai-apply" data-idx="' + i + '"' +
                (c.applied ? ' disabled' : '') + '>' + (c.applied ? '已套用' : '套用此改动') + '</button>'
              : '') +
            '</div>'
        )
      }
    })
    if (promoUi.aiBusy) aiBody.push('<div class="sz-row"><span class="sz-muted">AI 思考中…</span></div>')
    aiBody.push(
      '<div class="sz-row">' +
        '<input class="sz-in sz-pin" data-role="ai-input" value="' + esc(promoUi.chatInput) +
        '" placeholder="例如：高光文字大一点、改成金色、挪到上方" style="flex:1;min-width:180px"/>' +
        '<button type="button" class="sz-btn" data-act="ai-send"' + (promoUi.aiBusy ? ' disabled' : '') + '>发送</button>' +
        '<button type="button" class="sz-btn" data-act="ai-clear">清空对话</button></div>'
    )
    html.push(fold('ai', 'AI 调样式', promoUi.chat.length ? promoUi.chat.length + ' 条对话' : '对话式改样式', aiBody.join('')))

    // ---- 生成 ----
    var genBody = [
      '<div class="sz-row">' +
        '<span class="sz-label">每个高光</span><input class="sz-in sz-pin sz-num" data-pfield="duration" value="' + esc(pc.duration) + '"/><span class="sz-muted">秒</span>' +
        '<span class="sz-label">转场</span><input class="sz-in sz-pin sz-num" data-pfield="transition" value="' + esc(pc.transition) + '"/><span class="sz-muted">秒</span>' +
        '</div>',
      '<div class="sz-row">' +
        '<button type="button" class="sz-btn sz-primary" data-act="promo-gen"' +
        (promo.running || !marks ? ' disabled' : '') + '>生成宣传片</button>' +
        (promo.running ? '<button type="button" class="sz-btn sz-danger" data-act="promo-cancel">中断</button>' : '') +
        '<span class="sz-muted" data-role="p-msg">' + esc(promo.step) + '</span></div>',
      '<div class="sz-bar-wrap"><div class="sz-bar" data-role="p-bar" style="width:' + Math.round(promo.pct * 100) + '%"></div></div>',
      '<div class="sz-logs" data-role="p-logs">' +
        esc(promo.logs.length ? promo.logs.join('\n') : '日志会显示在这里') + '</div>',
      promo.out
        ? '<div class="sz-row"><span class="sz-muted">' + esc(promo.out.video) + '（' + promo.out.captured + '/' +
          promo.out.total + ' 个高光入片 · ' + Number(promo.out.secs).toFixed(1) + 's）</span>' +
          '<button type="button" class="sz-btn" data-act="promo-open">打开所在文件夹</button></div>'
        : '',
      fold(
        'genAdv',
        '更多导出设置',
        '帧率 ' + pc.fps + ' · 画质 ' + pc.crf + (pc.bgm ? ' · 有 BGM' : ''),
        '<div class="sz-row"><span class="sz-label">帧率</span><input class="sz-in sz-pin sz-num" data-pfield="fps" value="' +
          esc(pc.fps) + '"/>' +
          '<span class="sz-label">画质</span><input class="sz-in sz-pin sz-num" data-pfield="crf" value="' + esc(pc.crf) +
          '"/><span class="sz-muted">0 最好 / 30 最小</span></div>' +
          '<div class="sz-row"><span class="sz-label">背景音乐</span>' +
          '<input class="sz-in sz-pin" data-pfield="bgm" value="' + esc(pc.bgm) +
          '" placeholder="项目内路径，如 game/audio/bgm.mp3（留空则无音乐）" style="flex:1;min-width:200px"/></div>',
        true
      )
    ].join('')
    html.push(
      fold(
        'gen',
        '生成',
        marks ? marks + ' 个高光 · 约 ' + Math.round(marks * (pc.duration + pc.transition) + 2) + ' 秒' : '还没有入选的高光',
        genBody
      )
    )
    html.push(
      '<div class="sz-note">提示：采集/生成期间会启动游戏并自动截图（游戏窗口会短暂出现，请勿操作）。' +
        '首次使用可能需要下载 ffmpeg。</div>'
    )
    return html.join('')
  }

  // 位置的中文描述（样式行末尾展示）
  function posLabel(st) {
    var X = { left: '左', center: '中', right: '右' }
    var Y = { top: '上', middle: '中', bottom: '下' }
    var s = X[st.x] + Y[st.y]
    if (st.dx || st.dy) s += '（偏移 ' + st.dx + ',' + st.dy + '）'
    return s
  }

  // ---------- 项目切换 ----------
  function resetForProject() {
    var p = loom.project.getPath()
    state.files = null
    state.fileSel = {}
    state.contents = {}
    state.labels = null
    state.scanStale = false
    state.run = null
    state.tab = 'run'
    state.marks = p ? loadMarks() : []
    state.selLabel = typeof loom.project.getSelectedLabel === 'function' ? loom.project.getSelectedLabel() : null
    state.curFile = typeof loom.project.currentFile === 'function' ? loom.project.currentFile() || '' : ''
    // 宣传片产物 / 预览 / AI 对话都属于上一个项目；运行中不打断（任务按项目路径已绑定）
    if (!promo.running) {
      promo.out = null
      promo.logs = []
      promo.error = ''
      promo.pct = 0
      promo.step = '尚未生成'
    }
    promo.captured = null
    promoUi.scope = 'mark'
    promoUi.previewSrc = ''
    promoUi.previewMsg = ''
    promoUi.chat = []
    promoUi.chatInput = ''
    promoUi.aiMsg = ''
    promoUi.fontList = null
    promoUi.open = { preview: true, text: true, style: false, adv: false, ai: false, gen: true, genAdv: false }
    if (overlay) renderBody()
    refreshPanels()
  }

  // ---------- 注册 ----------
  loom.panel.register(
    'moments.main',
    '铃光时刻',
    {
      render: function () {
        return { html: PANEL_HTML, mount: mountPanel }
      }
    },
    { sidebar: true }
  )

  loom.commands.register('moments.open', '铃光时刻：打开工作台', function () {
    openWorkspace()
  })

  // 切换/打开项目：重置扫描与标记（标记按项目路径隔离存储）
  loom.hooks.on('app:projectOpened', function () {
    resetForProject()
  })

  // 织机里选中了别的故事：侧边栏改为显示该故事所在文件的铃光时刻
  loom.hooks.on('editor:labelSelected', function (sel) {
    state.selLabel = sel && sel.name ? sel : null
    refreshPanels()
  })

  // 织机切换打开的文件：侧边栏跟随该文件（选中故事与当前文件不一致时以当前文件为准）
  loom.hooks.on('app:fileOpened', function (payload) {
    var f = payload && payload.file
    if (!f) return
    var rel = String(f).replace(/^game\//, '')
    if (state.selLabel && String(state.selLabel.file || '').replace(/^game\//, '') !== rel) state.selLabel = null
    state.curFile = rel
    refreshPanels()
  })

  // 剧本被保存：只有当「本次扫描过的故事文件」内容真的变了才提示重新扫描
  // （保存 screens.rpy 等代码文件、或内容未变时不打扰）
  loom.hooks.on('app:saved', function (payload) {
    var file = payload && payload.file
    if (!file || !/\.rpy$/i.test(String(file))) return
    var rel = String(file).replace(/^game\//, '')
    if (state.contents[rel] === undefined || isCodeFile(rel)) return
    loom.fs.read('game/' + rel).then(function (text) {
      if ((text || '') === state.contents[rel]) return
      state.contents[rel] = text || ''
      state.scanStale = true
      if (overlay && state.tab === 'run') renderBody()
    })
  })

  // 调试/测试钩子（冒烟测试直接调用纯函数）
  if (typeof window !== 'undefined') {
    window.__momentsPlugin = {
      DEFAULTS: DEFAULTS,
      DEFAULT_JUDGE_PROMPT: DEFAULT_JUDGE_PROMPT,
      DEFAULT_OUTPUT_PROMPT: DEFAULT_OUTPUT_PROMPT,
      state: state,
      esc: esc,
      num: num,
      normalizeForMatch: normalizeForMatch,
      extractJson: extractJson,
      extractAssistantText: extractAssistantText,
      chatUrl: chatUrl,
      cleanScript: cleanScript,
      splitLabels: splitLabels,
      buildSegments: buildSegments,
      buildBatches: buildBatches,
      locateQuote: locateQuote,
      segmentFor: segmentFor,
      mergeMoment: mergeMoment,
      mergeIntoMarks: mergeIntoMarks,
      isCodeFile: isCodeFile,
      loadMarks: loadMarks,
      persistMarks: persistMarks,
      relocateMarks: relocateMarks,
      momentsOfSelected: momentsOfSelected,
      panelBodyHtml: panelBodyHtml,
      plan: plan,
      scanProject: scanProject,
      startRun: startRun,
      promo: promo,
      PROMO_DEFAULTS: PROMO_DEFAULTS,
      pcfg: pcfg,
      promoGroups: promoGroups,
      captureScriptText: captureScriptText,
      buildStoryboard: buildStoryboard,
      wrapText: wrapText,
      generatePromo: generatePromo,
      // 样式系统（纯函数，便于单测）
      STYLE_FIELDS: STYLE_FIELDS,
      STYLE_ROWS_COMMON: STYLE_ROWS_COMMON,
      STYLE_ROWS_ADV: STYLE_ROWS_ADV,
      STYLE_PRESETS: STYLE_PRESETS,
      normStyle: normStyle,
      styleDefaultsFor: styleDefaultsFor,
      roleStyle: roleStyle,
      styleToDrawtext: styleToDrawtext,
      posExpr: posExpr,
      ffColor: ffColor,
      scopeInfo: scopeInfo,
      includedMarks: includedMarks,
      markText: markText,
      previewPlan: previewPlan,
      promoTabHtml: promoTabHtml,
      styleCtrlHtml: styleCtrlHtml,
      promoUi: promoUi
    }
  }
})()
