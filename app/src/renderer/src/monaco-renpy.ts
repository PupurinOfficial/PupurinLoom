// Pupurin° Loom — Ren'Py Monaco 语言注册（幂等）
// 必须在 Editor 的 beforeMount 里调用，确保语言/主题在实例化前就绪
import type { loader } from '@monaco-editor/react'

let registered = false

export function registerRenpy(monaco: typeof import('monaco-editor')): void {
  if (registered) return
  try {
    // 1. 注册语言
    monaco.languages.register({ id: 'renpy' })

  // 2. Monarch tokenizer — 规则顺序：注释 > 三引号 > 对话行 > 旁白 > 字符串 > 关键字 > 标识符
  monaco.languages.setMonarchTokensProvider('renpy', {
    defaultToken: '',
    tokenPostfix: '.renpy',
    keywords: [
      'label', 'jump', 'call', 'menu', 'scene', 'show', 'hide', 'with',
      'play', 'stop', 'queue', 'sound', 'music', 'voice', 'pause',
      'return', 'if', 'elif', 'else', 'while', 'for', 'in', 'pass',
      'image', 'define', 'default', 'transform', 'screen', 'init',
      'python', 'extend', 'window', 'narrator', 'centered', 'layer', 'at'
    ],
    operators: [],
    symbols: /[=><!~?:&|+\-*/^%]+/,
    tokenizer: {
      root: [
        // 注释
        [/#.*$/, 'comment'],
        // 三引号多行字符串（Ren'Py 长文本 / init python 里的 docstring，允许缩进）
        [/^\s*"""/, { token: 'string', next: '@string_tri' }],
        // 角色对话：Name "..." / Name '...'（单行完整匹配，不进入子状态，杜绝跨行残留）
        [/^\s*[A-Za-z_]\w*\s+"[^"]*"/, 'keyword.dialogue'],
        [/^\s*[A-Za-z_]\w*\s+'[^']*'/, 'keyword.dialogue'],
        // 旁白 / 纯引号对话行："..."
        [/^\s*"[^"]*"/, 'string.dialogue'],
        [/^\s*'[^']*'/, 'string.dialogue'],
        // 行尾孤立的开引号（未闭合只影响本行，不留状态）
        [/["']$/, 'string.quote'],
        // 行内字符串（文件路径、属性值、函数参数等）
        [/"/, { token: 'string.quote', next: '@string_dq' }],
        [/'/, { token: 'string.quote', next: '@string_sq' }],
        // 关键字 / 标识符
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@default': 'identifier'
            }
          }
        ],
        // Ren'Py 内联 python 语句符
        [/\$/, 'keyword'],
        // 数字
        [/\d+/, 'number'],
        // 缩进（行首空白，不着色但消费掉）
        [/^[\t ]+/, ''],
        // 符号
        [/[:{}()\[\],.]/, 'delimiter'],
        [/@symbols/, 'operator']
      ],
      // 三引号多行字符串（允许跨行）
      string_tri: [
        [/[^"]+/, 'string'],
        [/"""/, { token: 'string', next: '@pop' }],
        [/""/, 'string'],
        [/"/, 'string']
      ],
      // 双引号字符串：未闭合时行尾强制回 root（@eos 守卫，避免状态残留到下一行）
      string_dq: [
        [
          /[^"]+/,
          {
            cases: {
              '@eos': { token: 'string', next: '@pop' },
              '@default': 'string'
            }
          }
        ],
        [/"/, { token: 'string.quote', next: '@pop' }],
        [/\\./, 'string.escape']
      ],
      // 单引号字符串
      string_sq: [
        [
          /[^']+/,
          {
            cases: {
              '@eos': { token: 'string', next: '@pop' },
              '@default': 'string'
            }
          }
        ],
        [/'/, { token: 'string.quote', next: '@pop' }],
        [/\\./, 'string.escape']
      ]
    }
  })

  // 3. 语言配置（括号匹配、注释切换等）
  monaco.languages.setLanguageConfiguration('renpy', {
    comments: { lineComment: '#' },
    brackets: [
      ['{', '}'],
      ['(', ')'],
      ['[', ']']
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '(', close: ')' },
      { open: '[', close: ']' },
      { open: '"', close: '"' },
      { open: "'", close: "'" }
    ]
  })

  // 4. 定义 loom-dark 主题（基于 vs-dark，用项目配色）
  monaco.editor.defineTheme('loom-dark', {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '6b6358', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'FFE4A6' },
      { token: 'keyword.dialogue', foreground: '9ad6a0' },
      { token: 'string', foreground: 'c8a87a' },
      { token: 'string.dialogue', foreground: '9ad6a0' },
      { token: 'string.quote', foreground: '8a7a4a' },
      { token: 'number', foreground: 'd4a8e8' },
      { token: 'identifier', foreground: 'f0ead6' },
      { token: 'delimiter', foreground: '9a948a' },
      { token: 'operator', foreground: 'b59a52' }
    ],
    colors: {
      'editor.background': '#1f1d1a',
      'editor.foreground': '#f0ead6',
      'editorLineNumber.foreground': '#5a534a',
      'editorLineNumber.activeForeground': '#FFE4A6',
      'editor.selectionBackground': '#3a352e',
      'editor.lineHighlightBackground': '#2a2722',
      'editorCursor.foreground': '#FFE4A6',
      'editorIndentGuide.background': '#33302a',
      'editorIndentGuide.activeBackground': '#44403a'
    }
  })

  // 浅色模式主题（基于 vs）
  monaco.editor.defineTheme('loom-light', {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: 'a08a5a', fontStyle: 'italic' },
      { token: 'keyword', foreground: 'b07d2e' },
      { token: 'keyword.dialogue', foreground: '3f8f52' },
      { token: 'string', foreground: 'a0602e' },
      { token: 'string.dialogue', foreground: '3f8f52' },
      { token: 'string.quote', foreground: 'a08a5a' },
      { token: 'number', foreground: '7a4fc4' },
      { token: 'identifier', foreground: '2b2926' },
      { token: 'delimiter', foreground: '7d766b' },
      { token: 'operator', foreground: '8a6a2e' }
    ],
    colors: {
      'editor.background': '#ffffff',
      'editor.foreground': '#2b2926',
      'editorLineNumber.foreground': '#b9b2a5',
      'editorLineNumber.activeForeground': '#b07d2e',
      'editor.selectionBackground': '#e8e2d2',
      'editor.lineHighlightBackground': '#f5f2ea',
      'editorCursor.foreground': '#b07d2e',
      'editorIndentGuide.background': '#efece4',
      'editorIndentGuide.activeBackground': '#d8d3c8'
    }
  })

  registered = true
  } catch (e) {
    // 注册失败时复位标志，避免永久失去高亮；错误会显示在 devtools 控制台
    registered = false
    console.error('[monaco-renpy] 语言注册失败：', e)
    throw e
  }
}

// 供 @monaco-editor/react 的 beforeMount 使用
export function beforeMount(monaco: typeof import('monaco-editor')): void {
  registerRenpy(monaco)
}

export type { loader }
