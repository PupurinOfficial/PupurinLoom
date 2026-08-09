// Pupurin° Loom — 角色数据存储（主进程）
// 持久化到 项目根/game/characters.json（写入失败时回退到 userData）
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { app } from 'electron'

// ---- Ren'Py 脚本解析 ----

// 匹配 define X = Character("name", ... who_color="#color" ...)
// 支持单行和多行定义
const DEFINE_CHAR_RE = /define\s+(\w+)\s*=\s*Character\s*\(([\s\S]*?)\)/g

// 匹配 image X sprite: \n    "path"
const IMAGE_DEF_RE = /^(\s*)image\s+(\w+)\s+(\w+)\s*:\s*\n\s*"([^"]+)"\s*$/gm

interface ParsedCharDef {
  varName: string
  name: string
  color: string | null
}

interface ParsedImageDef {
  charVar: string
  sprite: string
  path: string
}

// 从 Character(...) 参数字符串中提取名称和颜色
function parseCharArgs(args: string): { name: string; color: string | null } {
  // 提取第一个字符串参数作为名称："沐纱" 或 '沐纱'
  const nameMatch = args.match(/["']([^"']+)["']/)
  const name = nameMatch ? nameMatch[1] : ''

  // 提取 who_color="#color" 或 who_color='#color'
  const colorMatch = args.match(/who_color\s*=\s*["']([^"']+)["']/)
  const color = colorMatch ? colorMatch[1] : null

  return { name, color }
}

// 解析所有 .rpy 文件，提取角色定义和图片定义
async function parseRenpyFiles(gameDir: string): Promise<{ chars: ParsedCharDef[]; images: ParsedImageDef[] }> {
  // 收集所有 .rpy 文件
  let rpyFiles: string[] = []
  try {
    const entries = await fs.readdir(gameDir)
    rpyFiles = entries.filter((f) => f.endsWith('.rpy')).map((f) => join(gameDir, f))
  } catch {
    return { chars: [], images: [] }
  }

  const chars: ParsedCharDef[] = []
  const images: ParsedImageDef[] = []
  const seenCharVars = new Set<string>()

  for (const rpyFile of rpyFiles) {
    let content: string
    try {
      content = await fs.readFile(rpyFile, 'utf-8')
    } catch {
      continue
    }

    // 解析 define X = Character(...)
    let m: RegExpExecArray | null
    DEFINE_CHAR_RE.lastIndex = 0
    while ((m = DEFINE_CHAR_RE.exec(content)) !== null) {
      const varName = m[1]
      const argsStr = m[2]
      // 跳过 Character(None) （旁白）
      if (argsStr.trim().startsWith('None')) continue
      if (seenCharVars.has(varName)) continue
      seenCharVars.add(varName)
      const { name, color } = parseCharArgs(argsStr)
      if (name) {
        chars.push({ varName, name, color })
      }
    }

    // 解析 image X sprite: "path"
    IMAGE_DEF_RE.lastIndex = 0
    while ((m = IMAGE_DEF_RE.exec(content)) !== null) {
      images.push({
        charVar: m[2],
        sprite: m[3],
        path: m[4].replace(/\\/g, '/'),
      })
    }
  }

  return { chars, images }
}

export interface Sprite {
  id: string
  name: string // 差分名：happy / angry / ...
  path: string // 图片相对路径（相对 game/），如 images/eileen_happy.png
}

export type AvatarType = 'initial' | 'sprite' | 'custom'

export interface AvatarConfig {
  type: AvatarType
  spriteId?: string // type=sprite 时关联的差分 ID
  customPath?: string // type=custom 时的图片路径（相对 game/）
}

export interface Character {
  id: string
  name: string // 显示名：艾琳
  varName: string // Ren'Py 变量名：e
  color: string // 名字颜色 hex：#FFE4A6
  description: string // 简介（将作为注释）
  sprites: Sprite[]
  avatar?: AvatarConfig
}

function getCharFile(projectRoot: string): string {
  return join(resolve(projectRoot), 'game', 'characters.json')
}

// 回退路径：当项目目录不可写时（如 ad-hoc 签名应用访问 home 目录），
// 将 characters.json 存到 userData/characters/<hash>.json
function getFallbackCharFile(projectRoot: string): string {
  const hash = createHash('sha256').update(resolve(projectRoot)).digest('hex').slice(0, 16)
  return join(app.getPath('userData'), 'characters', `${hash}.json`)
}

export async function loadCharacters(projectRoot: string): Promise<Character[]> {
  // 先尝试项目目录，再尝试 userData 回退
  for (const file of [getCharFile(projectRoot), getFallbackCharFile(projectRoot)]) {
    try {
      const raw = await fs.readFile(file, 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data.characters)) return data.characters
    } catch {
      /* try next */
    }
  }
  return []
}

// 原子写：优先项目目录，EPERM 时回退到 userData
export async function saveCharacters(projectRoot: string, characters: Character[]): Promise<void> {
  const tryWrite = async (file: string): Promise<void> => {
    const tmp = file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify({ characters }, null, 2), 'utf-8')
    await fs.rename(tmp, file)
  }
  try {
    await tryWrite(getCharFile(projectRoot))
  } catch (e) {
    const fallback = getFallbackCharFile(projectRoot)
    await fs.mkdir(join(fallback, '..'), { recursive: true })
    await tryWrite(fallback)
    console.warn('[characterStore] 项目目录不可写，回退到 userData:', fallback)
  }
}

export function newCharacter(name: string): Character {
  return {
    id: randomBytes(8).toString('hex'),
    name: name.trim() || '新角色',
    varName: '',
    color: '#FFE4A6',
    description: '',
    sprites: [],
    avatar: { type: 'initial' },
  }
}

export function newSprite(name: string): Sprite {
  return {
    id: randomBytes(8).toString('hex'),
    name: name.trim() || '新差分',
    path: '',
  }
}

// 从 script.rpy（及所有 .rpy 文件）解析角色和差分，保存到 characters.json
// 如果已有 characters.json，会合并（保留已有角色，追加新解析的）
export async function parseCharactersFromScript(projectRoot: string): Promise<Character[]> {
  const gameDir = join(resolve(projectRoot), 'game')
  const { chars, images } = await parseRenpyFiles(gameDir)

  // 加载已有角色（如果 characters.json 存在）
  const existing = await loadCharacters(projectRoot)
  const existingVars = new Set(existing.map((c) => c.varName.toLowerCase()))

  // 按 varName 小写匹配差分
  const imagesByVar = new Map<string, ParsedImageDef[]>()
  for (const img of images) {
    const key = img.charVar.toLowerCase()
    if (!imagesByVar.has(key)) imagesByVar.set(key, [])
    imagesByVar.get(key)!.push(img)
  }

  // 为每个解析到的角色创建 Character（跳过已存在的）
  const newChars: Character[] = []
  for (const c of chars) {
    if (existingVars.has(c.varName.toLowerCase())) continue

    const matchedImages = imagesByVar.get(c.varName.toLowerCase()) ?? []
    const sprites: Sprite[] = matchedImages.map((img) => ({
      id: randomBytes(8).toString('hex'),
      name: img.sprite,
      path: img.path,
    }))

    newChars.push({
      id: randomBytes(8).toString('hex'),
      name: c.name,
      varName: c.varName,
      color: c.color ?? '#FFE4A6',
      description: '',
      sprites,
      avatar: sprites.length > 0
        ? { type: 'sprite', spriteId: sprites[0].id }
        : { type: 'initial' },
    })
  }

  // 合并并保存
  const all = [...existing, ...newChars]
  if (newChars.length > 0) {
    await saveCharacters(projectRoot, all)
  }
  console.log(`[characterStore] 解析完成：已有 ${existing.length} 角色，新增 ${newChars.length} 角色`)
  return all
}
