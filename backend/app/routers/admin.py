"""
Admin API Router
관리자 페이지용 API (비밀번호 인증)
"""
from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from typing import Optional

from app.services.import_history_service import get_session_list, get_session_detail

router = APIRouter(prefix="/admin", tags=["admin"])

ADMIN_PASSWORD = "AIcrm2026!"


class LoginRequest(BaseModel):
    password: str


class LoginResponse(BaseModel):
    success: bool
    message: Optional[str] = None


def _verify_password(password: str) -> None:
    if password != ADMIN_PASSWORD:
        raise HTTPException(status_code=401, detail="비밀번호가 올바르지 않습니다")


@router.post("/login", response_model=LoginResponse)
async def admin_login(request: LoginRequest) -> LoginResponse:
    if request.password == ADMIN_PASSWORD:
        return LoginResponse(success=True)
    return LoginResponse(success=False, message="비밀번호가 올바르지 않습니다")


@router.get("/sessions")
async def list_sessions(x_admin_password: str = Header(..., alias="X-Admin-Password")):
    _verify_password(x_admin_password)
    return {"sessions": get_session_list()}


@router.get("/sessions/{session_id}")
async def session_detail(
    session_id: str,
    x_admin_password: str = Header(..., alias="X-Admin-Password"),
):
    _verify_password(x_admin_password)
    detail = get_session_detail(session_id)
    if not detail:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없습니다")
    return detail
