"""
Import History Service
JSON 파일 기반 import 세션 기록 관리
"""
import json
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Optional
import threading

DATA_DIR = Path(__file__).parent.parent / "data"
HISTORY_FILE = DATA_DIR / "import_history.json"

_lock = threading.Lock()


def _read_db() -> list[dict]:
    if not HISTORY_FILE.exists():
        return []
    try:
        return json.loads(HISTORY_FILE.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, FileNotFoundError):
        return []


def _write_db(sessions: list[dict]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.write_text(
        json.dumps(sessions, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def create_session(filename: str, total_rows: int, object_types: list[str]) -> str:
    session_id = uuid.uuid4().hex[:12]
    session = {
        "id": session_id,
        "filename": filename,
        "total_rows": total_rows,
        "object_types": object_types,
        "status": "in_progress",
        "started_at": datetime.now(timezone.utc).isoformat(),
        "ended_at": None,
        "results": [],
        "summary": None,
    }
    with _lock:
        sessions = _read_db()
        sessions.insert(0, session)
        _write_db(sessions)
    return session_id


def log_row_result(
    session_id: str,
    row_index: int,
    object_type: str,
    request_body: dict[str, Any],
    response_body: dict[str, Any],
    success: bool,
    error_message: Optional[str] = None,
) -> None:
    entry = {
        "row_index": row_index,
        "object_type": object_type,
        "request": request_body,
        "response": response_body,
        "success": success,
        "error": error_message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    with _lock:
        sessions = _read_db()
        for s in sessions:
            if s["id"] == session_id:
                s["results"].append(entry)
                break
        _write_db(sessions)


def end_session(session_id: str) -> Optional[dict]:
    with _lock:
        sessions = _read_db()
        for s in sessions:
            if s["id"] == session_id:
                s["status"] = "completed"
                s["ended_at"] = datetime.now(timezone.utc).isoformat()
                # summary 계산
                results = s["results"]
                total = len(results)
                success_count = sum(1 for r in results if r["success"])
                failed_count = total - success_count
                # object_type별 집계
                by_type: dict[str, dict] = {}
                for r in results:
                    ot = r["object_type"]
                    if ot not in by_type:
                        by_type[ot] = {"success": 0, "failed": 0}
                    if r["success"]:
                        by_type[ot]["success"] += 1
                    else:
                        by_type[ot]["failed"] += 1

                s["summary"] = {
                    "total_requests": total,
                    "success": success_count,
                    "failed": failed_count,
                    "by_type": by_type,
                }
                _write_db(sessions)
                return s["summary"]
    return None


def get_session_list() -> list[dict]:
    sessions = _read_db()
    # results 제외, 최신순
    return [
        {
            "id": s["id"],
            "filename": s["filename"],
            "total_rows": s["total_rows"],
            "object_types": s["object_types"],
            "status": s["status"],
            "started_at": s["started_at"],
            "ended_at": s["ended_at"],
            "summary": s.get("summary"),
        }
        for s in sessions
    ]


def get_session_detail(session_id: str) -> Optional[dict]:
    sessions = _read_db()
    for s in sessions:
        if s["id"] == session_id:
            return s
    return None
