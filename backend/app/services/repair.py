"""
Repair Loop 서비스
LLM 응답 검증 실패 시 자동 수정 요청
"""
import json
import logging
from typing import TypeVar, Callable, Optional, Any
from dataclasses import dataclass

from app.models.schemas import (
    TriageResult, MappingResult, ValidationResult, ValidationErrorItem
)
from app.services.llm.base import LLMProvider, LLMResponse
from app.services.validator import triage_validator, mapping_validator

logger = logging.getLogger(__name__)

T = TypeVar('T', TriageResult, MappingResult)

MAX_REPAIR_ATTEMPTS = 2


@dataclass
class RepairLoopResult:
    """Repair Loop 결과"""
    success: bool
    result: Optional[Any]  # TriageResult or MappingResult
    validation: ValidationResult
    attempts: int
    repair_history: list[dict]


async def run_with_repair_loop(
    llm: LLMProvider,
    system_prompt: str,
    user_prompt: str,
    validator_func: Callable,
    validator_args: dict,
    max_attempts: int = MAX_REPAIR_ATTEMPTS,
) -> RepairLoopResult:
    """
    LLM 호출 + 검증 + 수정 루프 실행

    Args:
        llm: LLM Provider
        system_prompt: 시스템 프롬프트
        user_prompt: 사용자 프롬프트
        validator_func: 검증 함수 (결과, **args) -> (parsed_result, ValidationResult)
        validator_args: 검증 함수에 전달할 추가 인자
        max_attempts: 최대 수정 시도 횟수

    Returns:
        RepairLoopResult
    """
    repair_history = []
    attempts = 0

    # 최초 LLM 호출
    response = await llm.complete(system_prompt, user_prompt)

    if not response.success:
        return RepairLoopResult(
            success=False,
            result=None,
            validation=ValidationResult(
                is_valid=False,
                errors=[ValidationErrorItem(
                    field="llm",
                    message=f"LLM 호출 실패: {response.error}",
                )],
            ),
            attempts=1,
            repair_history=[{"attempt": 1, "error": response.error}],
        )

    current_response = response.content
    parsed_json = response.parsed_json

    while attempts < max_attempts:
        attempts += 1

        if not parsed_json:
            # JSON 파싱 실패
            validation = ValidationResult(
                is_valid=False,
                errors=[ValidationErrorItem(
                    field="response",
                    message="JSON 파싱 실패",
                )],
            )
            parsed_result = None
        else:
            # 검증 실행
            parsed_result, validation = validator_func(parsed_json, **validator_args)

        repair_history.append({
            "attempt": attempts,
            "response_preview": current_response[:200] if current_response else "",
            "is_valid": validation.is_valid,
            "error_count": len(validation.errors),
        })

        if validation.is_valid and parsed_result:
            # 검증 성공
            return RepairLoopResult(
                success=True,
                result=parsed_result,
                validation=validation,
                attempts=attempts,
                repair_history=repair_history,
            )

        if attempts >= max_attempts:
            # 최대 시도 횟수 초과
            break

        # 수정 요청
        logger.info(f"Repair attempt {attempts + 1}: {len(validation.errors)} errors")

        error_messages = [
            f"- {e.field}: {e.message}" + (f" (제안: {e.suggestion})" if e.suggestion else "")
            for e in validation.errors
        ]

        repair_response = await llm.complete_with_repair(
            system_prompt=system_prompt,
            user_prompt=user_prompt,
            validation_errors=error_messages,
            original_response=current_response,
        )

        if not repair_response.success:
            repair_history.append({
                "attempt": attempts + 1,
                "error": f"Repair 호출 실패: {repair_response.error}",
            })
            break

        current_response = repair_response.content
        parsed_json = repair_response.parsed_json

    # 모든 시도 실패
    return RepairLoopResult(
        success=False,
        result=None,
        validation=validation,
        attempts=attempts,
        repair_history=repair_history,
    )


async def triage_with_repair(
    llm: LLMProvider,
    system_prompt: str,
    user_prompt: str,
    all_columns: list[str],
) -> RepairLoopResult:
    """
    Triage 실행 + Repair Loop

    Args:
        llm: LLM Provider
        system_prompt: 시스템 프롬프트
        user_prompt: 사용자 프롬프트
        all_columns: 전체 컬럼 목록

    Returns:
        RepairLoopResult with TriageResult
    """
    return await run_with_repair_loop(
        llm=llm,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        validator_func=triage_validator.validate,
        validator_args={"all_columns": all_columns},
    )


async def mapping_with_repair(
    llm: LLMProvider,
    system_prompt: str,
    user_prompt: str,
    columns_to_keep: list,
    object_types: list[str],
    available_fields: dict[str, list[dict]],
) -> RepairLoopResult:
    """
    Mapping 실행 + Repair Loop

    Args:
        llm: LLM Provider
        system_prompt: 시스템 프롬프트
        user_prompt: 사용자 프롬프트
        columns_to_keep: 유지할 컬럼 목록
        object_types: 선택된 오브젝트 타입
        available_fields: 사용 가능한 필드

    Returns:
        RepairLoopResult with MappingResult
    """
    return await run_with_repair_loop(
        llm=llm,
        system_prompt=system_prompt,
        user_prompt=user_prompt,
        validator_func=mapping_validator.validate,
        validator_args={
            "columns_to_keep": columns_to_keep,
            "object_types": object_types,
            "available_fields": available_fields,
        },
    )
