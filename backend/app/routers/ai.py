"""
AI Router
Triage, Mapping API 엔드포인트
"""
import os
from typing import Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.models.schemas import (
    TriageRequest, TriageResponse, TriageResult,
    MappingRequest, MappingResponse, MappingResult,
    ColumnKeep, ObjectType, ValidationResult,
)
from app.services.llm import OpenAIProvider, LLMConfig
from app.services.llm.prompts import build_triage_prompt, build_mapping_prompt
from app.services.repair import triage_with_repair, mapping_with_repair
from app.services.file_analyzer import file_analyzer
from app.services.validator import triage_validator, mapping_validator

router = APIRouter(prefix="/ai", tags=["ai"])


def get_llm_provider() -> OpenAIProvider:
    """LLM Provider 생성"""
    api_key = os.getenv("OPENAI_API_KEY")
    if not api_key:
        raise HTTPException(status_code=500, detail="OPENAI_API_KEY not configured")

    config = LLMConfig(
        model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
        temperature=0.3,
        max_tokens=4000,
        json_mode=True,
    )
    return OpenAIProvider(api_key=api_key, config=config)


@router.post("/triage", response_model=TriageResponse)
async def triage_columns(request: TriageRequest) -> TriageResponse:
    """
    컬럼 분류 (Triage)

    - 업로드된 파일의 컬럼을 분석
    - 유지할 컬럼과 제외할 컬럼 분류
    - 추천 오브젝트 타입 제안
    """
    try:
        llm = get_llm_provider()

        # 컬럼 통계 계산 (제공되지 않은 경우)
        column_stats = request.column_stats
        if not column_stats:
            analysis = file_analyzer.analyze(request.sample_data)
            column_stats = analysis.column_stats

        # 프롬프트 생성
        system_prompt, user_prompt = build_triage_prompt(
            columns=request.columns,
            sample_data=request.sample_data,
            column_stats=[s.model_dump() for s in column_stats] if column_stats else None,
            business_context=request.business_context,
        )

        # Triage 실행 (Repair Loop 포함)
        result = await triage_with_repair(
            llm=llm,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            all_columns=request.columns,
        )

        if result.success and result.result:
            return TriageResponse(
                success=True,
                result=result.result,
                validation=result.validation,
                repair_attempts=result.attempts,
            )
        else:
            return TriageResponse(
                success=False,
                validation=result.validation,
                repair_attempts=result.attempts,
                error="Triage 분류 실패. 검증 오류를 확인하세요.",
            )

    except HTTPException:
        raise
    except Exception as e:
        return TriageResponse(
            success=False,
            error=str(e),
        )


@router.post("/map", response_model=MappingResponse)
async def map_fields(request: MappingRequest) -> MappingResponse:
    """
    필드 매핑 (Mapping)

    - Triage 결과의 유지 컬럼을 세일즈맵 필드에 매핑
    - 기존 필드 또는 새 커스텀 필드 제안
    """
    try:
        llm = get_llm_provider()

        # ColumnKeep 객체를 dict로 변환
        columns_to_keep_dicts = [c.model_dump() for c in request.columns_to_keep]

        # 프롬프트 생성
        system_prompt, user_prompt = build_mapping_prompt(
            columns_to_keep=columns_to_keep_dicts,
            object_types=[ot.value if isinstance(ot, ObjectType) else ot for ot in request.object_types],
            available_fields=request.available_fields,
            sample_data=request.sample_data,
        )

        # Mapping 실행 (Repair Loop 포함)
        result = await mapping_with_repair(
            llm=llm,
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            columns_to_keep=request.columns_to_keep,
            object_types=[ot.value if isinstance(ot, ObjectType) else ot for ot in request.object_types],
            available_fields=request.available_fields,
        )

        if result.success and result.result:
            return MappingResponse(
                success=True,
                result=result.result,
                validation=result.validation,
                repair_attempts=result.attempts,
            )
        else:
            return MappingResponse(
                success=False,
                validation=result.validation,
                repair_attempts=result.attempts,
                error="필드 매핑 실패. 검증 오류를 확인하세요.",
            )

    except HTTPException:
        raise
    except Exception as e:
        return MappingResponse(
            success=False,
            error=str(e),
        )


class AnalyzeRequest(BaseModel):
    """파일 분석 요청"""
    data: list[dict]
    sample_count: int = 5


class AnalyzeResponse(BaseModel):
    """파일 분석 응답"""
    success: bool
    columns: list[str]
    total_rows: int
    column_stats: list[dict]
    sample_data: list[dict]
    skip_candidates: list[dict]
    error: Optional[str] = None


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_file(request: AnalyzeRequest) -> AnalyzeResponse:
    """
    파일 분석

    - 컬럼 통계 계산
    - 데이터 타입 추론
    - 제외 후보 컬럼 식별
    """
    try:
        analysis = file_analyzer.analyze(request.data, request.sample_count)

        # 제외 후보 식별
        skip_candidates = []
        for stats in analysis.column_stats:
            is_skip, reason = file_analyzer.is_skip_candidate(stats)
            if is_skip:
                skip_candidates.append({
                    "column_name": stats.column_name,
                    "reason": reason,
                })

        return AnalyzeResponse(
            success=True,
            columns=analysis.columns,
            total_rows=analysis.total_rows,
            column_stats=[s.model_dump() for s in analysis.column_stats],
            sample_data=analysis.sample_data,
            skip_candidates=skip_candidates,
        )

    except Exception as e:
        return AnalyzeResponse(
            success=False,
            columns=[],
            total_rows=0,
            column_stats=[],
            sample_data=[],
            skip_candidates=[],
            error=str(e),
        )
