"""
Pydantic 모델 정의 - Wrapper 아키텍처용 스키마
LLM 응답 검증 및 데이터 구조 정의
"""
from typing import Optional, Literal
from pydantic import BaseModel, Field, field_validator
from enum import Enum


# ============================================================================
# 공통 Enum 정의
# ============================================================================

class ObjectType(str, Enum):
    """세일즈맵 오브젝트 타입"""
    PEOPLE = "people"
    COMPANY = "company"
    DEAL = "deal"
    LEAD = "lead"


class FieldType(str, Enum):
    """세일즈맵 필드 타입"""
    TEXT = "text"
    TEXTAREA = "textarea"
    NUMBER = "number"
    EMAIL = "email"
    PHONE = "phone"
    URL = "url"
    DATE = "date"
    DATETIME = "datetime"
    SELECT = "select"
    MULTISELECT = "multiselect"
    BOOLEAN = "boolean"
    USER = "user"
    USERS = "users"
    FILE = "file"


class SkipReason(str, Enum):
    """컬럼 제외 사유"""
    EMPTY = "빈 값만 있음"
    ID_INTERNAL = "내부 식별자"
    DUPLICATE = "다른 열과 중복"
    SYSTEM_GENERATED = "시스템 생성 값"
    META_INFO = "불필요한 메타정보"  # 이관 후 의미없는 정보
    LOW_QUALITY = "데이터 품질 낮음"  # 빈 값이 80% 이상
    AUTO_SKIPPED = "자동 제외"  # LLM이 분류하지 않아 자동 제외


# ============================================================================
# Triage (A단계) - 컬럼 분류
# ============================================================================

class ColumnStats(BaseModel):
    """컬럼 통계 정보"""
    column_name: str = Field(..., description="컬럼 이름")
    total_rows: int = Field(..., ge=0, description="전체 행 수")
    non_empty_count: int = Field(..., ge=0, description="값이 있는 행 수")
    empty_count: int = Field(..., ge=0, description="빈 값 행 수")
    unique_count: int = Field(..., ge=0, description="고유 값 수")
    sample_values: list[str] = Field(default_factory=list, max_length=5, description="샘플 값 (최대 5개)")


class ColumnKeep(BaseModel):
    """유지할 컬럼 정보"""
    column_name: str = Field(..., description="원본 컬럼 이름")
    target_object: ObjectType = Field(..., description="매핑할 오브젝트 타입")
    suggested_field_label: str = Field(..., description="제안 필드 라벨 (예: '고객 - 이름')")
    suggested_field_type: FieldType = Field(default=FieldType.TEXT, description="제안 필드 타입")
    is_required: bool = Field(default=False, description="필수 필드 여부")
    reason: str = Field(..., min_length=1, description="유지 사유")

    @field_validator('suggested_field_label')
    @classmethod
    def validate_field_label_format(cls, v: str) -> str:
        """필드 라벨 형식 검증: '오브젝트 - 필드명'"""
        if ' - ' not in v:
            raise ValueError(f"필드 라벨은 '오브젝트 - 필드명' 형식이어야 합니다: {v}")
        return v


class ColumnSkip(BaseModel):
    """제외할 컬럼 정보"""
    column_name: str = Field(..., description="컬럼 이름")
    reason: SkipReason = Field(..., description="제외 사유")
    detail: Optional[str] = Field(None, description="상세 설명")


class TriageResult(BaseModel):
    """Triage 단계 결과"""
    columns_to_keep: list[ColumnKeep] = Field(..., min_length=1, description="유지할 컬럼 목록")
    columns_to_skip: list[ColumnSkip] = Field(default_factory=list, description="제외할 컬럼 목록")
    recommended_objects: list[ObjectType] = Field(..., min_length=1, description="추천 오브젝트 타입")
    thinking: Optional[str] = Field(None, description="AI 추론 과정")

    @field_validator('columns_to_keep', 'columns_to_skip')
    @classmethod
    def validate_no_duplicates(cls, v: list) -> list:
        """중복 컬럼 검증"""
        names = [item.column_name for item in v]
        if len(names) != len(set(names)):
            duplicates = [n for n in names if names.count(n) > 1]
            raise ValueError(f"중복된 컬럼이 있습니다: {set(duplicates)}")
        return v


# ============================================================================
# Mapping (B단계) - 필드 매핑
# ============================================================================

class FieldMapping(BaseModel):
    """개별 필드 매핑"""
    source_column: str = Field(..., description="원본 컬럼 이름")
    target_object: ObjectType = Field(..., description="대상 오브젝트")
    target_field_id: Optional[str] = Field(None, description="기존 필드 ID (새 필드면 None)")
    target_field_label: str = Field(..., description="필드 라벨")
    field_type: FieldType = Field(default=FieldType.TEXT, description="필드 타입")
    is_new_field: bool = Field(default=False, description="새로 생성할 필드 여부")
    is_required: bool = Field(default=False, description="필수 필드 여부")
    is_unique: bool = Field(default=False, description="유니크 필드 여부")
    confidence: float = Field(default=1.0, ge=0, le=1, description="매핑 신뢰도")

    @field_validator('target_field_label')
    @classmethod
    def validate_field_label_format(cls, v: str) -> str:
        """필드 라벨 형식 검증"""
        if ' - ' not in v:
            raise ValueError(f"필드 라벨은 '오브젝트 - 필드명' 형식이어야 합니다: {v}")
        return v


class MappingResult(BaseModel):
    """Mapping 단계 결과"""
    mappings: list[FieldMapping] = Field(..., min_length=1, description="필드 매핑 목록")
    unmapped_columns: list[str] = Field(default_factory=list, description="매핑되지 않은 컬럼")
    warnings: list[str] = Field(default_factory=list, description="경고 메시지")
    thinking: Optional[str] = Field(None, description="AI 추론 과정")


# ============================================================================
# Validation - 검증 결과
# ============================================================================

class ValidationSeverity(str, Enum):
    """검증 오류 심각도"""
    ERROR = "error"
    WARNING = "warning"
    INFO = "info"


class ValidationErrorItem(BaseModel):
    """개별 검증 오류"""
    field: str = Field(..., description="오류 발생 필드")
    message: str = Field(..., description="오류 메시지")
    severity: ValidationSeverity = Field(default=ValidationSeverity.ERROR, description="심각도")
    suggestion: Optional[str] = Field(None, description="수정 제안")


class AutoFixItem(BaseModel):
    """자동 수정 항목"""
    field: str = Field(..., description="수정 필드")
    original_value: str = Field(..., description="원래 값")
    fixed_value: str = Field(..., description="수정된 값")
    fix_type: str = Field(..., description="수정 유형")


class ValidationResult(BaseModel):
    """검증 결과"""
    is_valid: bool = Field(..., description="검증 통과 여부")
    errors: list[ValidationErrorItem] = Field(default_factory=list, description="오류 목록")
    warnings: list[ValidationErrorItem] = Field(default_factory=list, description="경고 목록")
    auto_fixes: list[AutoFixItem] = Field(default_factory=list, description="자동 수정 목록")
    stats: dict = Field(default_factory=dict, description="검증 통계")


# ============================================================================
# Repair Loop - 수정 요청
# ============================================================================

class RepairRequest(BaseModel):
    """수정 요청"""
    original_response: dict = Field(..., description="원본 LLM 응답")
    validation_errors: list[ValidationErrorItem] = Field(..., description="검증 오류 목록")
    repair_instruction: str = Field(..., description="수정 지시사항")
    attempt: int = Field(default=1, ge=1, le=3, description="시도 횟수")


# ============================================================================
# Export - 내보내기
# ============================================================================

class ExportFormat(str, Enum):
    """내보내기 형식"""
    EXCEL = "xlsx"
    CSV = "csv"


class ExportRequest(BaseModel):
    """내보내기 요청"""
    data: list[dict] = Field(..., min_length=1, description="내보낼 데이터")
    mappings: list[FieldMapping] = Field(..., description="필드 매핑")
    object_types: list[ObjectType] = Field(..., min_length=1, description="오브젝트 타입")
    format: ExportFormat = Field(default=ExportFormat.EXCEL, description="내보내기 형식")
    include_summary: bool = Field(default=True, description="요약 시트 포함 여부")


class ExportResponse(BaseModel):
    """내보내기 응답"""
    success: bool = Field(..., description="성공 여부")
    filename: str = Field(..., description="파일 이름")
    file_path: Optional[str] = Field(None, description="파일 경로")
    download_url: Optional[str] = Field(None, description="다운로드 URL")
    stats: dict = Field(default_factory=dict, description="내보내기 통계")
    errors: list[str] = Field(default_factory=list, description="오류 목록")


# ============================================================================
# API 요청/응답 모델
# ============================================================================

class TriageRequest(BaseModel):
    """Triage API 요청"""
    columns: list[str] = Field(..., min_length=1, description="컬럼 목록")
    sample_data: list[dict] = Field(..., min_length=1, max_length=10, description="샘플 데이터")
    column_stats: Optional[list[ColumnStats]] = Field(None, description="컬럼 통계")
    business_context: Optional[str] = Field(None, description="비즈니스 컨텍스트")


class TriageResponse(BaseModel):
    """Triage API 응답"""
    success: bool = Field(..., description="성공 여부")
    result: Optional[TriageResult] = Field(None, description="Triage 결과")
    validation: Optional[ValidationResult] = Field(None, description="검증 결과")
    repair_attempts: int = Field(default=0, description="수정 시도 횟수")
    error: Optional[str] = Field(None, description="오류 메시지")


class MappingRequest(BaseModel):
    """Mapping API 요청"""
    columns_to_keep: list[ColumnKeep] = Field(..., description="유지할 컬럼")
    object_types: list[ObjectType] = Field(..., description="선택된 오브젝트")
    available_fields: dict[str, list[dict]] = Field(..., description="오브젝트별 사용 가능한 필드")
    sample_data: list[dict] = Field(..., description="샘플 데이터")


class MappingResponse(BaseModel):
    """Mapping API 응답"""
    success: bool = Field(..., description="성공 여부")
    result: Optional[MappingResult] = Field(None, description="Mapping 결과")
    validation: Optional[ValidationResult] = Field(None, description="검증 결과")
    repair_attempts: int = Field(default=0, description="수정 시도 횟수")
    error: Optional[str] = Field(None, description="오류 메시지")
