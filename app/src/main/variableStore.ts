// Pupurin° Loom — 变量数据存储（主进程）
// 持久化到 项目根/game/variables.json
import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { app } from 'electron'

export type VariableType = 'int' | 'float' | 'str' | 'bool'

export interface Variable {
  id: string
  name: string // 显示名：好感度
  varName: string // Ren'Py 变量名：affection
  type: VariableType
  defaultValue: string // 默认值（字符串形式）
  description: string // 简介
}

function getVarFile(projectRoot: string): string {
  return join(resolve(projectRoot), 'game', 'variables.json')
}

// 回退路径：当项目目录不可写时，将 variables.json 存到 userData/variables/<hash>.json
function getFallbackVarFile(projectRoot: string): string {
  const hash = createHash('sha256').update(resolve(projectRoot)).digest('hex').slice(0, 16)
  return join(app.getPath('userData'), 'variables', `${hash}.json`)
}

export async function loadVariables(projectRoot: string): Promise<Variable[]> {
  // 先尝试项目目录，再尝试 userData 回退
  for (const file of [getVarFile(projectRoot), getFallbackVarFile(projectRoot)]) {
    try {
      const raw = await fs.readFile(file, 'utf-8')
      const data = JSON.parse(raw)
      if (Array.isArray(data.variables)) return data.variables
    } catch {
      /* try next */
    }
  }
  return []
}

// 原子写：优先项目目录，EPERM 时回退到 userData
export async function saveVariables(projectRoot: string, variables: Variable[]): Promise<void> {
  const tryWrite = async (file: string): Promise<void> => {
    const tmp = file + '.tmp'
    await fs.writeFile(tmp, JSON.stringify({ variables }, null, 2), 'utf-8')
    await fs.rename(tmp, file)
  }
  try {
    await tryWrite(getVarFile(projectRoot))
  } catch (e) {
    const fallback = getFallbackVarFile(projectRoot)
    await fs.mkdir(join(fallback, '..'), { recursive: true })
    await tryWrite(fallback)
    console.warn('[variableStore] 项目目录不可写，回退到 userData:', fallback)
  }
}

export function newVariable(name: string): Variable {
  return {
    id: randomBytes(8).toString('hex'),
    name: name.trim() || '新变量',
    varName: '',
    type: 'int',
    defaultValue: '0',
    description: '',
  }
}

// Ren'Py 系统文件（含模板/UI/配置），不含故事内容，聚合扫描 default 时跳过
function isSystemRpy(fileName: string): boolean {
  if (fileName.startsWith('00')) return true
  if (fileName.startsWith('_')) return true
  return ['options.rpy', 'screens.rpy', 'gui.rpy'].includes(fileName)
}

// 从 game/ 下所有 .rpy 文件中解析 default 语句（聚合扫描，支持多文件章节）
export async function parseVariablesFromScript(projectRoot: string): Promise<Variable[]> {
  const gameDir = join(resolve(projectRoot), 'game')

  const rpyFiles: string[] = []

  // 递归收集 game/ 下的所有 .rpy 文件（跳过 Ren'Py 系统文件）
  const walk = async (dir: string): Promise<void> => {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.name.endsWith('.rpy') && !isSystemRpy(entry.name)) {
        rpyFiles.push(full)
      }
    }
  }
  await walk(gameDir)

  const variables: Variable[] = []
  const seenVarNames = new Set<string>()

  // 匹配 default varName = value 或 default varName = "value"
  const DEFAULT_RE = /^default\s+(\w+)\s*=\s*(.+?)\s*(?:#.*)?$/gm

  for (const file of rpyFiles) {
    let content: string
    try {
      content = await fs.readFile(file, 'utf-8')
    } catch {
      continue
    }

    let m: RegExpExecArray | null
    while ((m = DEFAULT_RE.exec(content)) !== null) {
      const varName = m[1]
      const valueStr = m[2].trim()

      if (seenVarNames.has(varName)) continue
      seenVarNames.add(varName)

      // 推断类型
      let type: VariableType = 'int'
      let defaultValue = valueStr

      if (valueStr === 'True' || valueStr === 'False') {
        type = 'bool'
        defaultValue = valueStr === 'True' ? 'true' : 'false'
      } else if (valueStr.startsWith('"') && valueStr.endsWith('"')) {
        type = 'str'
        defaultValue = valueStr.slice(1, -1)
      } else if (valueStr.includes('.')) {
        type = 'float'
      } else if (/^-?\d+$/.test(valueStr)) {
        type = 'int'
      }

      variables.push({
        id: randomBytes(8).toString('hex'),
        name: varName,
        varName,
        type,
        defaultValue,
        description: '',
      })
    }
  }

  console.log(`[variableStore] 从 ${rpyFiles.length} 个 .rpy 文件解析到 ${variables.length} 个变量`)
  return variables
}

// 将变量保存到 script.rpy（在顶部添加 default 语句）
export async function saveVariablesToScript(
  projectRoot: string,
  variables: Variable[]
): Promise<void> {
  const gameDir = join(resolve(projectRoot), 'game')
  const scriptPath = join(gameDir, 'script.rpy')

  // 读取现有内容
  let content: string
  try {
    content = await fs.readFile(scriptPath, 'utf-8')
  } catch {
    // 如果文件不存在，创建空文件
    content = ''
  }

  // 移除旧的 default 语句
  const lines = content.split('\n')
  const filteredLines = lines.filter((line) => !/^\s*default\s+\w+\s*=/.test(line))

  // 构建新的 default 语句
  const defaultLines: string[] = []
  for (const v of variables) {
    let value: string
    switch (v.type) {
      case 'bool':
        value = v.defaultValue === 'true' ? 'True' : 'False'
        break
      case 'str':
        value = `"${v.defaultValue}"`
        break
      default:
        value = v.defaultValue
    }
    defaultLines.push(`default ${v.varName} = ${value}`)
  }

  // 在顶部添加 default 语句（保留原有空行）
  let newContent = ''
  if (defaultLines.length > 0) {
    newContent = defaultLines.join('\n') + '\n'
  }

  // 找到第一个非空行、非注释行的位置
  let insertIndex = 0
  for (let i = 0; i < filteredLines.length; i++) {
    const line = filteredLines[i].trim()
    if (line && !line.startsWith('#')) {
      insertIndex = i
      break
    }
  }

  // 插入 default 语句
  newContent += filteredLines.slice(insertIndex).join('\n')

  // 原子写
  const tmp = scriptPath + '.tmp'
  await fs.writeFile(tmp, newContent, 'utf-8')
  await fs.rename(tmp, scriptPath)

  console.log(`[variableStore] 已保存 ${variables.length} 个变量到 script.rpy`)
}