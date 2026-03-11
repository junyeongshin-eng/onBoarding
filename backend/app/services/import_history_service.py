"""
Import History Service
Supabase 기반 import 세션 기록 관리
"""
import asyncio
import os
import uuid
from datetime import datetime, timezone
from typing import Any, Optional

from supabase import create_client

_url = os.getenv("SUPABASE_URL", "")
_key = os.getenv("SUPABASE_KEY", "")

# 로그 버퍼: 배치로 모아서 한번에 INSERT
_log_buffer: list[dict[str, Any]] = []
_log_lock = asyncio.Lock()
_BATCH_SIZE = 20


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


def _flush_log_buffer_sync(buffer: list[dict[str, Any]]) -> None:
    """버퍼에 모인 로그를 한번에 INSERT."""
    if not buffer:
        return
    sb = _get_client()
    sb.table("import_results").insert(buffer).execute()


async def flush_log_buffer() -> None:
    """현재 버퍼를 비동기로 플러시."""
    async with _log_lock:
        if not _log_buffer:
            return
        to_flush = list(_log_buffer)
        _log_buffer.clear()
    await asyncio.to_thread(_flush_log_buffer_sync, to_flush)


async def log_row_result_async(
    session_id: str,
    row_index: int,
    object_type: str,
    request_body: dict[str, Any],
    response_body: dict[str, Any],
    success: bool,
    error_message: Optional[str] = None,
    action: str = "create",
) -> None:
    """로그를 버퍼에 추가하고, 배치 크기에 도달하면 플러시."""
    entry = {
        "session_id": session_id,
        "row_index": row_index,
        "object_type": object_type,
        "request": request_body,
        "response": response_body,
        "success": success,
        "error": error_message,
        "action": action,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    async with _log_lock:
        _log_buffer.append(entry)
        should_flush = len(_log_buffer) >= _BATCH_SIZE

    if should_flush:
        await flush_log_buffer()


def log_row_result(
    session_id: str,
    row_index: int,
    object_type: str,
    request_body: dict[str, Any],
    response_body: dict[str, Any],
    success: bool,
    error_message: Optional[str] = None,
    action: str = "create",
) -> None:
    """동기 호환용 (기존 proxy 엔드포인트에서 사용)."""
    sb = _get_client()
    sb.table("import_results").insert({
        "session_id": session_id,
        "row_index": row_index,
        "object_type": object_type,
        "request": request_body,
        "response": response_body,
        "success": success,
        "error": error_message,
        "action": action,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }).execute()


def end_session(session_id: str) -> Optional[dict]:
    sb = _get_client()

    # 결과 집계
    results = sb.table("import_results") \
        .select("success, object_type, row_index, action") \
        .eq("session_id", session_id) \
        .execute().data

    total = len(results)

    # (row_index, object_type) 그룹별로 최종 상태 결정
    from collections import defaultdict
    row_groups: dict[tuple, list] = defaultdict(list)
    for r in results:
        key = (r["row_index"], r["object_type"])
        row_groups[key].append(r)

    created_count = 0
    updated_count = 0
    failed_count = 0

    by_type: dict[str, dict] = {}
    for (_, obj_type), entries in row_groups.items():
        if obj_type not in by_type:
            by_type[obj_type] = {"created": 0, "updated": 0, "failed": 0}

        has_update_success = any(
            e.get("action") == "update" and e["success"] for e in entries
        )
        has_create_success = any(
            e.get("action", "create") in (None, "create") and e["success"] for e in entries
        )

        if has_update_success:
            updated_count += 1
            by_type[obj_type]["updated"] += 1
        elif has_create_success:
            created_count += 1
            by_type[obj_type]["created"] += 1
        else:
            failed_count += 1
            by_type[obj_type]["failed"] += 1

    summary = {
        "total_requests": total,
        "success": created_count,
        "created": created_count,
        "updated": updated_count,
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
