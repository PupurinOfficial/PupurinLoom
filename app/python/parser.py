"""Pupurin° Loom — 轻量 Ren'Py 脚本解析器 (DEMO)

识别可视化流图所需结构：label / jump / call / menu / menu 选项。
统计对话字数（宽口径：纯引号行 + 角色对话行）。
不依赖 Ren'Py SDK，纯文本解析。
"""
from __future__ import annotations

import re
from dataclasses import dataclass, asdict, field
from pathlib import Path
from typing import Any, Dict, List, Optional, Set

LABEL_RE = re.compile(r'^\s*label\s+([A-Za-z_]\w*)\s*(?:\((.*?)\))?\s*:\s*(#.*)?$')
JUMP_RE = re.compile(r'^\s*jump\s+([A-Za-z_]\w*)\s*(?:#.*)?$')
CALL_RE = re.compile(r'^\s*call\s+([A-Za-z_]\w*)\s*(?:#.*)?$')
MENU_RE = re.compile(r'^(\s*)menu\s*([A-Za-z_]\w*)?\s*:\s*(#.*)?$')
# menu 选项: "文本": jump target  或  "文本":
MENU_OPTION_RE = re.compile(r'^\s*["\'](.+?)["\']\s*:\s*(?:jump\s+([A-Za-z_]\w*))?(?:#.*)?$')
# 纯引号对话/旁白行: "..."  或 '...'
STRING_RE = re.compile(r'^\s*["\'](.+?)["\']\s*(?:#.*)?$')
# 角色对话行: e "..."  /  character "你好"
CHAR_DIALOGUE_RE = re.compile(r'^\s*[A-Za-z_]\w*\s+["\'](.+?)["\']\s*(?:#.*)?$')


@dataclass
class MenuOption:
    text: str
    target: Optional[str]  # jump 目标，无则为纯分支
    line: int


@dataclass
class Label:
    id: str
    name: str
    line: int
    end_line: int
    source: str
    doc: str = ""
    menu_options: List[MenuOption] = field(default_factory=list)


@dataclass
class Edge:
    source: Optional[str]
    target: str
    type: str  # jump | call | menu
    line: int
    option_text: Optional[str] = None  # menu 边的选项文本


def _leading_spaces(line: str) -> int:
    return len(line) - len(line.lstrip(' '))


def _find_label_for_line(line_idx: int, label_starts: List[tuple]) -> Optional[str]:
    """往上找最近的一个 label 起点。"""
    current: Optional[str] = None
    for start_idx, name in label_starts:
        if start_idx <= line_idx:
            current = name
        else:
            break
    return current


def parse_rpy(text: str) -> Dict[str, Any]:
    lines = text.splitlines()
    label_starts: List[tuple] = []

    # 第一遍：定位所有 label 起点
    for i, line in enumerate(lines):
        m = LABEL_RE.match(line)
        if m:
            label_starts.append((i, m.group(1)))

    label_index: Dict[str, Label] = {}
    labels: List[Label] = []
    for idx, (start, name) in enumerate(label_starts):
        end = label_starts[idx + 1][0] - 1 if idx + 1 < len(label_starts) else len(lines) - 1
        source = "\n".join(lines[start:end + 1])
        doc = ""
        for j in range(start + 1, end + 1):
            sm = STRING_RE.match(lines[j])
            if sm:
                doc = sm.group(1)
                break
        lab = Label(
            id=name, name=name,
            line=start + 1, end_line=end + 1,
            source=source, doc=doc,
        )
        label_index[name] = lab
        labels.append(lab)

    # 第二遍：扫描 jump/call/menu选项，归属到所在 label
    # 用缩进栈跟踪 menu 上下文（DEMO 不支持嵌套 menu）
    # pending_option: "文本": 单独一行时记录，等待下一行缩进 jump 关联
    edges: List[Edge] = []
    current_label: Optional[str] = None
    menu_stack: List[tuple] = []  # (menu_indent, label_of_menu)
    pending_option: Optional[tuple] = None  # (text, line, menu_label)

    for i, line in enumerate(lines):
        # 更新 current_label
        if _find_label_for_line(i, label_starts) is not None:
            current_label = _find_label_for_line(i, label_starts)

        # 检查 menu 块是否结束（缩进回到 menu 行之上）
        while menu_stack:
            menu_indent, _ = menu_stack[-1]
            stripped = line.strip()
            if stripped and _leading_spaces(line) <= menu_indent:
                menu_stack.pop()
                pending_option = None
            else:
                break

        # menu 起点
        mm = MENU_RE.match(line)
        if mm:
            menu_indent = len(mm.group(1))
            menu_stack.append((menu_indent, current_label))
            pending_option = None
            continue

        # menu 上下文内
        if menu_stack:
            _, menu_label = menu_stack[-1]
            # menu 选项行（"文本": 或 "文本": jump target）
            mo = MENU_OPTION_RE.match(line)
            if mo:
                opt_text = mo.group(1)
                opt_target = mo.group(2)
                if opt_target:
                    # 同行 jump
                    if menu_label and menu_label in label_index:
                        label_index[menu_label].menu_options.append(
                            MenuOption(text=opt_text, target=opt_target, line=i + 1)
                        )
                    edges.append(Edge(
                        source=menu_label, target=opt_target,
                        type="menu", line=i + 1, option_text=opt_text,
                    ))
                    pending_option = None
                else:
                    # "文本": 单独一行，等待下一行 jump
                    pending_option = (opt_text, i + 1, menu_label)
                continue
            # 有 pending_option 时，jump/call 关联到该选项
            if pending_option:
                opt_text, opt_line, opt_menu_label = pending_option
                mj2 = JUMP_RE.match(line)
                if mj2:
                    target = mj2.group(1)
                    if opt_menu_label and opt_menu_label in label_index:
                        label_index[opt_menu_label].menu_options.append(
                            MenuOption(text=opt_text, target=target, line=opt_line)
                        )
                    edges.append(Edge(
                        source=opt_menu_label, target=target,
                        type="menu", line=opt_line, option_text=opt_text,
                    ))
                    pending_option = None
                    continue
                mc2 = CALL_RE.match(line)
                if mc2:
                    target = mc2.group(1)
                    if opt_menu_label and opt_menu_label in label_index:
                        label_index[opt_menu_label].menu_options.append(
                            MenuOption(text=opt_text, target=target, line=opt_line)
                        )
                    edges.append(Edge(
                        source=opt_menu_label, target=target,
                        type="menu", line=opt_line, option_text=opt_text,
                    ))
                    pending_option = None
                    continue
                # 非跳转语句，结束 pending（纯分支选项）
                pending_option = None
            continue  # menu 上下文内的非选项非跳转行，跳过

        # 普通 jump
        mj = JUMP_RE.match(line)
        if mj:
            edges.append(Edge(
                source=current_label, target=mj.group(1),
                type="jump", line=i + 1,
            ))
            continue
        # 普通 call
        mc = CALL_RE.match(line)
        if mc:
            edges.append(Edge(
                source=current_label, target=mc.group(1),
                type="call", line=i + 1,
            ))

    # 对话字数（宽口径：纯引号行 + 角色对话行，去引号）
    dialogue_chars = 0
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith('#'):
            continue
        # 角色对话优先（e "..." 形式）
        cd = CHAR_DIALOGUE_RE.match(line)
        if cd:
            dialogue_chars += len(cd.group(1))
            continue
        sm = STRING_RE.match(line)
        if sm:
            dialogue_chars += len(sm.group(1))

    label_names = {l.name for l in labels}
    return {
        "labels": [asdict(l) for l in labels],
        "edges": [asdict(e) for e in edges],
        "label_names": sorted(label_names),
        "line_count": len(lines),
        "full_source": text,
        "dialogue_chars": dialogue_chars,
    }


# ---- 项目级聚合解析 ----

# if/elif 语句行（条件位于冒号前）
IF_RE = re.compile(r'^\s*(if|elif)\s+(.+?)\s*(?::.*)?$')
# 条件表达式中的标识符
VAR_NAME_RE = re.compile(r'[A-Za-z_]\w*')
# Python / Ren'Py 保留字与内建常量，不作为用户变量统计
RESERVED_WORDS: Set[str] = {
    "and", "or", "not", "in", "is", "if", "elif", "else", "for", "while",
    "def", "class", "return", "pass", "break", "continue", "import", "from",
    "True", "False", "None", "renpy", "config", "persistent", "store",
    "bool", "int", "float", "str", "len", "range", "abs", "min", "max",
    "sum", "input", "print", "lambda", "global", "nonlocal", "with", "as",
    "try", "except", "finally", "raise", "assert", "del", "yield", "await",
    "async", "type", "list", "dict", "set", "tuple", "self", "expression",
}


@dataclass
class VariableUsage:
    """条件语句中引用的变量位置。"""
    var: str
    file: str
    line: int
    condition: str


def _extract_vars(condition: str) -> List[str]:
    """提取条件表达式中出现的用户变量名（去重，保持顺序，过滤保留字）。"""
    seen: Set[str] = set()
    result: List[str] = []
    for m in VAR_NAME_RE.finditer(condition):
        name = m.group(0)
        if name in RESERVED_WORDS or name in seen:
            continue
        seen.add(name)
        result.append(name)
    return result


def _is_hidden(rel: Path) -> bool:
    """路径任一段以 '.' 开头视为隐藏目录/文件，跳过。"""
    return any(part.startswith('.') for part in rel.parts)


def parse_project(project_root: str) -> Dict[str, Any]:
    """聚合解析项目 game/ 目录下所有 .rpy 文件。

    返回结构（在单文件 parse_rpy 基础上扩展）：
      labels:      所有文件的 label，每个带 file 字段（相对 game/）
      edges:       所有文件的跳转边，带 file 字段 + resolved（目标是否存在于聚合集合）
      label_names: 全局 label 名（Ren'Py 要求全局唯一）
      files:       参与解析的 .rpy 文件列表
      dialogue_chars: 全项目对话字数
      variable_usages: 所有 if/elif 条件中引用的变量位置
    """
    root = Path(project_root).expanduser().resolve()
    game_dir = root / "game"
    if not game_dir.is_dir():
        return {
            "labels": [], "edges": [], "label_names": [], "files": [],
            "dialogue_chars": 0, "variable_usages": [],
        }

    rpy_files = [
        p for p in sorted(game_dir.rglob("*.rpy"))
        if p.is_file() and not p.is_symlink() and not _is_hidden(p.relative_to(game_dir))
    ]

    labels: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []
    variable_usages: List[VariableUsage] = []
    label_names: Set[str] = set()
    files: List[str] = []
    dialogue_chars = 0

    for rpy in rpy_files:
        rel = rpy.relative_to(game_dir).as_posix()
        try:
            text = rpy.read_text(encoding="utf-8")
        except Exception:
            continue

        files.append(rel)
        parsed = parse_rpy(text)

        # 排除 translate 等内部 label（如 label _），避免污染场景导航
        story_labels = [lb for lb in parsed["labels"] if not lb["name"].startswith('_')]
        for lb in story_labels:
            lb["file"] = rel
            labels.append(lb)
            label_names.add(lb["name"])

        for ed in parsed["edges"]:
            ed["file"] = rel
            edges.append(ed)

        dialogue_chars += parsed.get("dialogue_chars", 0)

        # 统计 if/elif 条件中的变量引用（仅故事文件：含至少一个真实 label）
        if story_labels:
            for i, line in enumerate(text.splitlines()):
                m = IF_RE.match(line)
                if not m:
                    continue
                condition = m.group(2).strip()
                for var in _extract_vars(condition):
                    variable_usages.append(
                        VariableUsage(var=var, file=rel, line=i + 1, condition=condition)
                    )

    # 标记悬空跳转：目标 label 不在全局集合中
    for ed in edges:
        ed["resolved"] = ed["target"] in label_names

    return {
        "labels": labels,
        "edges": edges,
        "label_names": sorted(label_names),
        "files": files,
        "dialogue_chars": dialogue_chars,
        "variable_usages": [asdict(v) for v in variable_usages],
    }


if __name__ == "__main__":
    import sys
    import json
    src = sys.stdin.read() if not sys.argv[1:] else open(sys.argv[1], encoding="utf-8").read()
    print(json.dumps(parse_rpy(src), ensure_ascii=False, indent=2))
