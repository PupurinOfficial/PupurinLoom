// 管理 script.rpy 中的 image 定义
// 格式：
// image <charVar> <sprite>:
//     "<path>"

const IMAGE_DEF_RE = /^(\s*)image\s+(\w+)\s+(\w+)\s*:\s*\n\s*"([^"]+)"\s*$/gm

export interface ImageDef {
  charVar: string
  sprite: string
  path: string
  fullMatch: string
  indent: string
}

// 从 script.rpy 内容中提取所有 image 定义
export function parseImageDefs(source: string): ImageDef[] {
  const defs: ImageDef[] = []
  let match: RegExpExecArray | null
  IMAGE_DEF_RE.lastIndex = 0
  while ((match = IMAGE_DEF_RE.exec(source)) !== null) {
    defs.push({
      charVar: match[2],
      sprite: match[3],
      path: match[4],
      fullMatch: match[0],
      indent: match[1],
    })
  }
  return defs
}

// 添加 image 定义到 script.rpy 末尾
export function addImageDef(source: string, charVar: string, sprite: string, path: string): string {
  // 检查是否已存在
  const existing = parseImageDefs(source)
  if (existing.find((d) => d.charVar === charVar && d.sprite === sprite)) {
    return source
  }
  const def = `image ${charVar} ${sprite}:\n    "${path}"\n`
  // 追加到末尾
  const trimmed = source.endsWith('\n') ? source : source + '\n'
  return trimmed + '\n' + def
}

// 从 script.rpy 中移除 image 定义
export function removeImageDef(source: string, charVar: string, sprite: string): string {
  return source.replace(IMAGE_DEF_RE, (full, _indent, cv, sp) => {
    if (cv === charVar && sp === sprite) return ''
    return full
  })
}

// 更新 image 定义的 path
export function updateImageDefPath(source: string, charVar: string, sprite: string, newPath: string): string {
  return source.replace(IMAGE_DEF_RE, (full, indent, cv, sp, _path) => {
    if (cv === charVar && sp === sprite) {
      return `${indent}image ${cv} ${sp}:\n${indent}    "${newPath}"`
    }
    return full
  })
}
