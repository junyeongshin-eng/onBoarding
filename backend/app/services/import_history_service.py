"""
Import History Service
Supabase 기반 import 세션 기록 관리
"""
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from supabase import create_client

_url = os.getenv("SUPABASE_URL", "")
_key = os.getenv("SUPABASE_KEY", "")


def _get_client():
    return create_client(_url, _key)


def create_session(filename: str, total_rows: int, object_types: list[str]) -> str:
    session_id = uuid.uuid4().hex[:12]
    sb = _get_client()
    sb.table("import_sessions").insert({
        "id": session_id,
        "filename": filename,
        "total_rows": total_rows,
        "object_types": object_types,
        "status": "in_progress",
        "started_at": datetime.now(timezone.utc).isoformat(),
    }).execute()
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
    sb = _get_client()
    sb.table("import_results").insert({
        "session_id": session_id,
        "row_index": row_index,
        "object_type": object_type,
        "request": request_body,
        "response": response_body,
        "success": success,
        "error": error_message,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }).execute()


def end_session(session_id: str) -> Optional[dict]:
    sb = _get_client()

    # 결과 집계
    results = sb.table("import_results") \
        .select("success, object_type") \
        .eq("session_id", session_id) \
        .execute().data

    total = len(results)
    success_count = sum(1 for r in results if r["success"])
    failed_count = total - success_count

    by_type: dict[str, dict] = {}
    for r in results:
        ot = r["object_type"]
        if ot not in by_type:
            by_type[ot] = {"success": 0, "failed": 0}
        if r["success"]:
            by_type[ot]["success"] += 1
        else:
            by_type[ot]["failed"] += 1

    summary = {
        "total_requests": total,
        "success": success_count,
        "failed": failed_count,
        "by_type": by_type,
    }

    sb.table("import_sessions").update({
        "status": "completed",
        "ended_at": datetime.now(timezone.utc).isoformat(),
        "summary": summary,
    }).eq("id", session_id).execute()

    return summary


def get_session_list() -> list[dict]:
    sb = _get_client()
    result = sb.table("import_sessions") \
        .select("id, filename, total_rows, object_types, status, started_at, ended_at, summary") \
        .order("started_at", desc=True) \
        .execute()
    return result.data


def get_session_detail(session_id: str) -> Optional[dict]:
    sb = _get_client()

    session = sb.table("import_sessions") \
        .select("*") \
        .eq("id", session_id) \
        .single() \
        .execute().data

    if not session:
        return None

    results = sb.table("import_results") \
        .select("*") \
        .eq("session_id", session_id) \
        .order("row_index") \
        .order("timestamp") \
        .execute().data

    session["results"] = results
    return session
