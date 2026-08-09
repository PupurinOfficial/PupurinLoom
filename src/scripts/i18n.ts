// 官网语言：IP 属地识别 → 时区兜底 → 浏览器语言兜底；右上角可手动切换（localStorage 记忆）
// 为避免英文用户先看到中文闪现，先按「时区/浏览器语言」立即渲染，IP 属地结果返回后再校正。
import { messages, type Lang } from '../i18n'

const STORAGE_KEY = 'pupurin-lang'
// 大中华区 IP 属地视为中文
const ZH_COUNTRIES = ['CN', 'HK', 'TW', 'MO']
// 中文时区兜底
const ZH_ZONES = ['Asia/Shanghai', 'Asia/Urumqi', 'Asia/Hong_Kong', 'Asia/Macau', 'Asia/Taipei']

function fallbackLang(): Lang {
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  if (ZH_ZONES.includes(tz)) return 'zh'
  return (navigator.language || '').toLowerCase().startsWith('zh') ? 'zh' : 'en'
}

async function ipLang(): Promise<Lang | null> {
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3500)
    const res = await fetch('https://ipapi.co/json/', { signal: ctrl.signal })
    clearTimeout(timer)
    if (res.ok) {
      const data = (await res.json()) as { country_code?: string }
      const code = data.country_code
      if (typeof code === 'string' && code) {
        return ZH_COUNTRIES.includes(code) ? 'zh' : 'en'
      }
    }
  } catch {
    /* 网络不可用则维持当前语言 */
  }
  return null
}

function apply(lang: Lang): void {
  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en'
  const dict = messages[lang]
  document.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    const key = el.dataset.i18n
    if (!key) return
    const text = dict[key]
    if (text !== undefined) el.textContent = text
  })
  document.querySelectorAll<HTMLElement>('[data-lang-opt]').forEach((btn) => {
    const active = btn.dataset.langOpt === lang
    btn.classList.toggle('active', active)
    btn.setAttribute('aria-pressed', String(active))
  })
}

function initLangSwitcher(): void {
  const wrap = document.querySelector('[data-lang-wrap]')
  const btn = document.querySelector<HTMLElement>('[data-lang-btn]')
  const menu = document.querySelector<HTMLElement>('[data-lang-menu]')
  if (!wrap || !btn || !menu) return

  btn.addEventListener('click', (e) => {
    e.stopPropagation()
    const open = menu.hasAttribute('hidden')
    menu.toggleAttribute('hidden', !open)
    btn.setAttribute('aria-expanded', String(open))
  })

  menu.querySelectorAll<HTMLElement>('[data-lang-opt]').forEach((opt) => {
    opt.addEventListener('click', () => {
      const next = opt.dataset.langOpt as Lang
      localStorage.setItem(STORAGE_KEY, next)
      apply(next)
      menu.setAttribute('hidden', '')
      btn.setAttribute('aria-expanded', 'false')
    })
  })

  // 点击外部关闭
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target as Node)) {
      menu.setAttribute('hidden', '')
      btn.setAttribute('aria-expanded', 'false')
    }
  })
}

async function init(): Promise<void> {
  const saved = localStorage.getItem(STORAGE_KEY)
  let lang: Lang = saved === 'zh' || saved === 'en' ? saved : fallbackLang()
  apply(lang) // 立即渲染，不等 IP 接口
  initLangSwitcher()
  if (saved === 'zh' || saved === 'en') return
  const fromIp = await ipLang()
  if (fromIp && fromIp !== lang) apply(fromIp)
}

init()
