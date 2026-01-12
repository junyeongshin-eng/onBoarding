"""
Validator 서비스
LLM 응답의 Pydantic 검증 및 비즈니스 규칙 검증
"""
from typing import Optional
from pydantic import ValidationError

from app.models.schemas import (
    TriageResult, MappingResult, ColumnKeep, ColumnSkip,
    FieldMapping, ValidationResult, ValidationErrorItem, ValidationSeverity,
    ObjectType
)
from app.models.salesmap import (
    REQUIRED_FIELDS, UNIQUE_FIELDS, CONNECTION_REQUIREMENTS,
    MIN_KEEP_RATIO, MAX_SKIP_COLUMNS, get_object_name
)


class ValidationError2(Exception):
    """검증 오류 예외"""
    def __init__(self, errors: list[ValidationErrorItem]):
        self.errors = errors
        super().__init__(f"{len(errors)} validation errors")


class TriageValidator:
    """Triage 결과 검증기"""

    def validate(
        self,
        data: dict,
        all_columns: list[str],
    ) -> tuple[Optional[TriageResult], ValidationResult]:
        """
        Triage 결과 검증

        Args:
            data: LLM 응답 JSON
            all_columns: 원본 파일의 전체 컬럼 목록

        Returns:
            (TriageResult or None, ValidationResult)
        """
        errors: list[ValidationErrorItem] = []
        warnings: list[ValidationErrorItem] = []

        # 1. Pydantic 스키마 검증
        try:
            result = TriageResult(**data)
        except ValidationError as e:
            for err in e.errors():
                errors.append(ValidationErrorItem(
                    field=".".join(str(p) for p in err["loc"]),
                    message=err["msg"],
                    severity=ValidationSeverity.ERROR,
                ))
            return None, ValidationResult(
                is_valid=False,
                errors=errors,
                warnings=warnings,
                stats={"pydantic_errors": len(errors)},
            )

        # 2. 배타적 분류 검증 (keep과 skip에 중복 없어야 함)
        keep_names = {c.column_name for c in result.columns_to_keep}
        skip_names = {c.column_name for c in result.columns_to_skip}
        duplicates = keep_names & skip_names
        if duplicates:
            errors.append(ValidationErrorItem(
                field="columns",
                message=f"컬럼이 keep과 skip 양쪽에 있습니다: {duplicates}",
                severity=ValidationSeverity.ERROR,
                suggestion="각 컬럼은 keep 또는 skip 중 하나에만 있어야 합니다",
            ))

        # 3. 전체 컬럼 누락 검증
        all_classified = keep_names | skip_names
        missing = set(all_columns) - all_classified
        if missing:
            errors.append(ValidationErrorItem(
                field="columns",
                message=f"분류되지 않은 컬럼: {missing}",
                severity=ValidationSeverity.ERROR,
                suggestion="모든 컬럼은 keep 또는 skip으로 분류되어야 합니다",
            ))

        extra = all_classified - set(all_columns)
        if extra:
            errors.append(ValidationErrorItem(
                field="columns",
                message=f"원본에 없는 컬럼: {extra}",
                severity=ValidationSeverity.ERROR,
            ))

        # 4. 유지 비율 검증 (90% 이상)
        total = len(all_columns)
        keep_count = len(result.columns_to_keep)
        keep_ratio = keep_count / total if total > 0 else 0

        if keep_ratio < MIN_KEEP_RATIO:
            warnings.append(ValidationErrorItem(
                field="columns_to_keep",
                message=f"유지 비율이 {keep_ratio:.1%}로 권장 {MIN_KEEP_RATIO:.0%} 미만입니다",
                severity=ValidationSeverity.WARNING,
                suggestion=f"{total}개 컬럼 중 {int(total * MIN_KEEP_RATIO)}개 이상 유지를 권장합니다",
            ))

        # 5. 제외 컬럼 수 검증
        if len(result.columns_to_skip) > MAX_SKIP_COLUMNS:
            warnings.append(ValidationErrorItem(
                field="columns_to_skip",
                message=f"제외 컬럼이 {len(result.columns_to_skip)}개로 권장 {MAX_SKIP_COLUMNS}개 초과",
                severity=ValidationSeverity.WARNING,
            ))

        # 6. 필드 라벨 형식 검증
        for col in result.columns_to_keep:
            if ' - ' not in col.suggested_field_label:
                errors.append(ValidationErrorItem(
                    field=f"columns_to_keep.{col.column_name}.suggested_field_label",
                    message=f"'{col.suggested_field_label}' 형식 오류: '오브젝트 - 필드명' 형식 필요",
                    severity=ValidationSeverity.ERROR,
                    suggestion=f"'{get_object_name(col.target_object)} - 필드명' 형식으로 수정",
                ))

        # 7. 추천 오브젝트 검증
        if not result.recommended_objects:
            errors.append(ValidationErrorItem(
                field="recommended_objects",
                message="추천 오브젝트가 비어있습니다",
                severity=ValidationSeverity.ERROR,
            ))

        # 8. 연결 요건 검증
        recommended = set(result.recommended_objects)
        has_deal_or_lead = ObjectType.DEAL in recommended or ObjectType.LEAD in recommended
        has_people_or_company = ObjectType.PEOPLE in recommended or ObjectType.COMPANY in recommended

        if has_deal_or_lead and not has_people_or_company:
            warnings.append(ValidationErrorItem(
                field="recommended_objects",
                message="딜/리드가 있지만 연결할 고객/회사가 없습니다",
                severity=ValidationSeverity.WARNING,
                suggestion="딜/리드는 고객 또는 회사와 연결되어야 합니다",
            ))

        is_valid = len(errors) == 0
        return (result if is_valid else None), ValidationResult(
            is_valid=is_valid,
            errors=errors,
            warnings=warnings,
            stats={
                "total_columns": total,
                "keep_count": keep_count,
                "skip_count": len(result.columns_to_skip),
                "keep_ratio": keep_ratio,
            },
        )


class MappingValidator:
    """Mapping 결과 검증기"""

    def validate(
        self,
        data: dict,
        columns_to_keep: list[ColumnKeep],
        object_types: list[str],
        available_fields: dict[str, list[dict]],
    ) -> tuple[Optional[MappingResult], ValidationResult]:
        """
        Mapping 결과 검증

        Args:
            data: LLM 응답 JSON
            columns_to_keep: Triage에서 유지하기로 한 컬럼
            object_types: 선택된 오브젝트 타입
            available_fields: 오브젝트별 사용 가능한 필드

        Returns:
            (MappingResult or None, ValidationResult)
        """
        errors: list[ValidationErrorItem] = []
        warnings: list[ValidationErrorItem] = []

        # 1. Pydantic 검증
        try:
            result = MappingResult(**data)
        except ValidationError as e:
            for err in e.errors():
                errors.append(ValidationErrorItem(
                    field=".".join(str(p) for p in err["loc"]),
                    message=err["msg"],
                    severity=ValidationSeverity.ERROR,
                ))
            return None, ValidationResult(
                is_valid=False,
                errors=errors,
                warnings=warnings,
            )

        # 2. 모든 유지 컬럼이 매핑되었는지 검증
        keep_column_names = {c.column_name for c in columns_to_keep}
        mapped_columns = {m.source_column for m in result.mappings}
        unmapped = keep_column_names - mapped_columns

        if unmapped:
            errors.append(ValidationErrorItem(
                field="mappings",
                message=f"매핑되지 않은 컬럼: {unmapped}",
                severity=ValidationSeverity.ERROR,
            ))

        # 3. 오브젝트 타입 검증
        valid_objects = set(object_types)
        for mapping in result.mappings:
            if mapping.target_object not in valid_objects:
                errors.append(ValidationErrorItem(
                    field=f"mappings.{mapping.source_column}.target_object",
                    message=f"잘못된 오브젝트 타입: {mapping.target_object}",
                    severity=ValidationSeverity.ERROR,
                    suggestion=f"사용 가능: {valid_objects}",
                ))

        # 4. 필드 라벨 형식 검증
        for mapping in result.mappings:
            if ' - ' not in mapping.target_field_label:
                errors.append(ValidationErrorItem(
                    field=f"mappings.{mapping.source_column}.target_field_label",
                    message=f"'{mapping.target_field_label}' 형식 오류",
                    severity=ValidationSeverity.ERROR,
                    suggestion="'오브젝트 - 필드명' 형식으로 수정",
                ))

        # 5. 기존 필드 ID 검증 (새 필드가 아닌 경우)
        for mapping in result.mappings:
            if not mapping.is_new_field and mapping.target_field_id:
                obj_fields = available_fields.get(mapping.target_object, [])
                field_ids = {f['id'] for f in obj_fields}
                if mapping.target_field_id not in field_ids:
                    warnings.append(ValidationErrorItem(
                        field=f"mappings.{mapping.source_column}.target_field_id",
                        message=f"존재하지 않는 필드 ID: {mapping.target_field_id}",
                        severity=ValidationSeverity.WARNING,
                        suggestion="새 필드로 생성하거나 올바른 ID 사용",
                    ))

        # 6. 필수 필드 매핑 검증
        for obj_type in object_types:
            required = REQUIRED_FIELDS.get(obj_type, [])
            mapped_to_obj = [m for m in result.mappings if m.target_object == obj_type]
            mapped_field_ids = {m.target_field_id for m in mapped_to_obj if m.target_field_id}

            for req_field in required:
                if req_field not in mapped_field_ids:
                    # 라벨로도 확인
                    obj_name = get_object_name(obj_type)
                    required_label_found = any(
                        req_field in m.target_field_label.lower()
                        for m in mapped_to_obj
                    )
                    if not required_label_found:
                        warnings.append(ValidationErrorItem(
                            field=f"mappings.{obj_type}",
                            message=f"{obj_name}의 필수 필드 '{req_field}'가 매핑되지 않음",
                            severity=ValidationSeverity.WARNING,
                        ))

        # 7. 중복 매핑 검증
        mapping_targets = []
        for m in result.mappings:
            target = (m.target_object, m.target_field_id or m.target_field_label)
            mapping_targets.append(target)

        seen = set()
        duplicates = []
        for t in mapping_targets:
            if t in seen:
                duplicates.append(t)
            seen.add(t)

        if duplicates:
            warnings.append(ValidationErrorItem(
                field="mappings",
                message=f"중복 매핑된 필드: {duplicates}",
                severity=ValidationSeverity.WARNING,
            ))

        is_valid = len(errors) == 0
        return (result if is_valid else None), ValidationResult(
            is_valid=is_valid,
            errors=errors,
            warnings=warnings,
            stats={
                "total_mappings": len(result.mappings),
                "new_fields": sum(1 for m in result.mappings if m.is_new_field),
                "unmapped_count": len(unmapped),
            },
        )


# 싱글톤 인스턴스
triage_validator = TriageValidator()
mapping_validator = MappingValidator()
