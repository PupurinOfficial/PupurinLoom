// 从 Ren'Py 条件表达式中提取用户变量名（过滤 Python/Ren'Py 保留字）

const RESERVED_WORDS = new Set([
  'and', 'or', 'not', 'in', 'is', 'if', 'elif', 'else', 'for', 'while',
  'def', 'class', 'return', 'pass', 'break', 'continue', 'import', 'from',
  'True', 'False', 'None', 'renpy', 'config', 'persistent', 'store',
  'bool', 'int', 'float', 'str', 'len', 'range', 'abs', 'min', 'max',
  'sum', 'input', 'print', 'lambda', 'global', 'nonlocal', 'with', 'as',
  'try', 'except', 'finally', 'raise', 'assert', 'del', 'yield', 'await',
  'async', 'type', 'list', 'dict', 'set', 'tuple', 'self', 'expression',
])

const VAR_NAME_RE = /\b[A-Za-z_]\w*\b/g

/** 提取条件表达式中的变量名（去重、保持顺序） */
export function extractVarNames(condition: string): string[] {
  const seen = new Set<string>()
  const result: string[] = []
  for (const m of condition.matchAll(VAR_NAME_RE)) {
    const name = m[0]
    if (RESERVED_WORDS.has(name) || seen.has(name)) continue
    seen.add(name)
    result.push(name)
  }
  return result
}
