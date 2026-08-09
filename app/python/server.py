"""Pupurin° Loom — Python 后端 (FastAPI)

提供：
  GET  /api/health        健康检查
  GET  /api/script        读取示例 .rpy 源码
  POST /api/parse         解析传入源码，返回 label + edge 结构
  WS   /ws/logs           推送模拟运行日志（验证实时通道）

由 Electron 主进程 spawn 拉起，端口通过命令行参数传入。
"""
import asyncio
import json
import os
import sys
from pathlib import Path
from typing import List, Optional

from fastapi import FastAPI, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 兼容 `python server.py` 与被 import 两种启动方式
sys.path.insert(0, str(Path(__file__).resolve().parent))
from parser import parse_rpy, parse_project  # noqa: E402

BASE_DIR = Path(__file__).resolve().parent
SAMPLE = BASE_DIR / "sample_game" / "script.rpy"
# 单文件读取上限 5MB，防止打爆后端
MAX_SCRIPT_BYTES = 5 * 1024 * 1024

app = FastAPI(title="Pupurin Loom Backend", version="0.0.1")
# CORS 收敛：仅允许渲染层 origin（dev: localhost / prod: file://）
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "file://",
        "null",
    ],
    allow_methods=["*"],
    allow_headers=["*"],
)


class ParseRequest(BaseModel):
    source: Optional[str] = None


class ProjectParseRequest(BaseModel):
    path: str


class LogHub:
    """维护 WebSocket 客户端列表，支持广播。"""

    def __init__(self) -> None:
        self.clients: List[WebSocket] = []

    async def connect(self, ws: WebSocket) -> None:
        await ws.accept()
        self.clients.append(ws)
        await ws.send_text(json.dumps({"type": "system", "msg": "connected"}))

    def disconnect(self, ws: WebSocket) -> None:
        if ws in self.clients:
            self.clients.remove(ws)

    async def broadcast(self, payload: dict) -> None:
        if not self.clients:
            return
        text = json.dumps(payload, ensure_ascii=False)
        dead: list[WebSocket] = []
        for ws in self.clients:
            try:
                await ws.send_text(text)
            except Exception:
                dead.append(ws)
        for d in dead:
            self.disconnect(d)


hub = LogHub()


@app.get("/api/health")
def health() -> dict:
    return {"status": "ok", "pid": os.getpid(), "sample": str(SAMPLE)}


def _resolve_script_path(project_root: str) -> Path:
    """把项目根目录解析为 game/script.rpy，做安全校验。
    安全策略：只允许读 <root>/game/script.rpy，不能指定任意文件名。"""
    root = Path(project_root).expanduser().resolve()
    script = root / "game" / "script.rpy"
    # 必须在实际 root 之下（防符号链接逃逸）
    try:
        script.relative_to(root)
    except ValueError:
        raise HTTPException(status_code=400, detail="invalid project path")
    # 拒绝符号链接
    if script.is_symlink():
        raise HTTPException(status_code=400, detail="symlink not allowed")
    if not script.is_file():
        raise HTTPException(status_code=404, detail="script.rpy not found")
    # 大小上限
    if script.stat().st_size > MAX_SCRIPT_BYTES:
        raise HTTPException(status_code=413, detail="script too large")
    return script


@app.get("/api/script")
def get_script(path: str = Query(..., description="项目根目录绝对路径")) -> dict:
    """读取 <path>/game/script.rpy。path 缺失返回 422（Query 必填）。"""
    script = _resolve_script_path(path)
    return {"source": script.read_text(encoding="utf-8"), "path": str(script)}


@app.get("/api/sample")
def get_sample() -> dict:
    """DEMO 模板：未进入项目时的示例脚本预览。与项目数据流隔离。"""
    return {"source": SAMPLE.read_text(encoding="utf-8"), "path": str(SAMPLE)}


@app.post("/api/parse")
def parse_source(req: ParseRequest) -> dict:
    text = req.source if req.source is not None else SAMPLE.read_text(encoding="utf-8")
    return parse_rpy(text)


@app.post("/api/parse-project")
def parse_project_endpoint(req: ProjectParseRequest) -> dict:
    """聚合解析项目 game/ 下所有 .rpy 文件（label 带 file、跨文件 edges、悬空跳转、条件变量引用）。"""
    root = Path(req.path).expanduser().resolve()
    game_dir = root / "game"
    if not game_dir.is_dir():
        raise HTTPException(status_code=404, detail="game/ 目录不存在")
    return parse_project(str(root))


@app.get("/api/stats")
def get_project_stats(path: str = Query(..., description="项目根目录绝对路径")) -> dict:
    """统计项目中所有 .rpy 文件的字数、行数、label 数量等。"""
    root = Path(project_root := path).expanduser().resolve()
    game_dir = root / "game"
    if not game_dir.is_dir():
        raise HTTPException(status_code=404, detail="game/ 目录不存在")

    # 收集所有 .rpy 文件
    rpy_files = list(game_dir.rglob("*.rpy"))
    if not rpy_files:
        return {
            "files": 0,
            "total_lines": 0,
            "total_chars": 0,
            "dialogue_chars": 0,
            "labels": 0,
            "menus": 0,
        }

    total_lines = 0
    total_chars = 0
    dialogue_chars = 0
    label_count = 0
    menu_count = 0
    file_stats = []

    for rpy in rpy_files:
        try:
            text = rpy.read_text(encoding="utf-8")
            lines = text.split("\n")
            line_count = len(lines)
            char_count = len(text)

            # 解析统计
            result = parse_rpy(text)
            labels = result.get("labels", [])
            edges = result.get("edges", [])
            dlg_chars = result.get("dialogue_chars", 0)
            menus = sum(len(l.get("menu_options", [])) for l in labels if isinstance(l, dict))

            total_lines += line_count
            total_chars += char_count
            dialogue_chars += dlg_chars
            label_count += len(labels)
            menu_count += menus

            file_stats.append({
                "path": str(rpy.relative_to(game_dir)),
                "lines": line_count,
                "chars": char_count,
                "dialogue_chars": dlg_chars,
                "labels": len(labels),
            })
        except Exception:
            continue

    return {
        "files": len(rpy_files),
        "total_lines": total_lines,
        "total_chars": total_chars,
        "dialogue_chars": dialogue_chars,
        "labels": label_count,
        "menus": menu_count,
        "file_stats": file_stats,
    }


@app.websocket("/ws/logs")
async def ws_logs(ws: WebSocket) -> None:
    await hub.connect(ws)
    counter = 0
    try:
        while True:
            await asyncio.sleep(1.5)
            counter += 1
            # 模拟 Ren'Py 运行时日志
            await hub.broadcast({
                "type": "log",
                "level": "info",
                "msg": f"renpy tick #{counter} — label={_pick_label(counter)}",
                "t": counter,
            })
    except WebSocketDisconnect:
        hub.disconnect(ws)
    except Exception:
        hub.disconnect(ws)


def _pick_label(n: int) -> str:
    cycle = ["start", "garden", "sleep", "end"]
    return cycle[(n - 1) % len(cycle)]


if __name__ == "__main__":
    import uvicorn
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    print(f"[pupurin-loom] backend on http://127.0.0.1:{port}", flush=True)
    uvicorn.run(app, host="127.0.0.1", port=port, log_level="info")
