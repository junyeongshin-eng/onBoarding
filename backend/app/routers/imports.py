from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, Literal
from urllib.parse import quote
import pandas as pd
import io

router = APIRouter()

# Mapping from internal object types to Salesmap import format
SALESMAP_OBJECT_NAMES = {
    "company": "Organization",
    "contact": "People",
    "lead": "Lead",
    "deal": "Deal",
}

# Mapping from internal field IDs to Salesmap field names
SALESMAP_FIELD_NAMES = {
    "company": {
        "name": "이름",
        "employee_count": "직원 수",
        "address": "주소",
        "phone": "전화번호",
        "website": "웹 주소",
        "owner": "담당자",
    },
    "contact": {
        "name": "이름",
        "email": "이메일",
        "phone": "전화번호",
        "position": "포지션",
        "company": "회사",
        "owner": "담당자",
        "customer_group": "고객 그룹",
        "journey_stage": "고객 여정 단계",
    },
    "lead": {
        "name": "이름",
        "status": "상태",
        "amount": "금액",
        "close_date": "마감일",
        "expected_date": "수주 예정일",
        "owner": "담당자",
        "pipeline": "파이프라인",
        "pipeline_stage": "파이프라인 단계",
        "lead_group": "리드 그룹",
        "contact": "연결된 고객",
        "company": "연결된 회사",
    },
    "deal": {
        "name": "이름",
        "status": "상태",
        "amount": "금액",
        "close_date": "마감일",
        "expected_date": "수주 예정일",
        "owner": "담당자",
        "pipeline": "파이프라인",
        "pipeline_stage": "파이프라인 단계",
        "contact": "연결된 고객",
        "company": "연결된 회사",
        "subscription_start": "구독 시작일",
        "subscription_end": "구독 종료일",
        "monthly_amount": "월 구독 금액",
    },
}


class FieldMapping(BaseModel):
    source_column: str
    target_field: str  # format: "objectType.fieldId"


class CustomField(BaseModel):
    id: str
    label: str
    type: str
    required: bool = False
    objectType: str
    objectName: str
    isCustom: bool = True


class ImportRequest(BaseModel):
    filename: str
    object_types: list[str]  # Multiple object types
    data: list[dict]
    field_mappings: list[FieldMapping]
    custom_fields: list[CustomField] = []  # User-created custom fields


class ValidationError(BaseModel):
    row: int
    field: str
    message: str
    severity: str  # "error" or "warning"


class ValidationResult(BaseModel):
    success: bool
    total_rows: int
    valid_rows: int
    error_count: int
    warning_count: int
    errors: list[ValidationError]
    valid_row_indices: list[int]  # Indices of rows that passed validation


class ImportResponse(BaseModel):
    success: bool
    imported_count: int
    errors: list[str]


@router.post("/import")
async def import_data(request: ImportRequest):
    """
    Generate an Excel file in Salesmap import format.
    Returns the file as a downloadable attachment.
    """
    try:
        # Validate object types
        valid_types = {"company", "contact", "lead", "deal"}
        for obj_type in request.object_types:
            if obj_type not in valid_types:
                raise HTTPException(status_code=400, detail=f"잘못된 오브젝트 타입: {obj_type}")

        # Group mappings by object type
        mappings_by_object: dict[str, list[FieldMapping]] = {}
        for mapping in request.field_mappings:
            parts = mapping.target_field.split(".")
            if len(parts) == 2:
                obj_type, field_id = parts
                if obj_type not in mappings_by_object:
                    mappings_by_object[obj_type] = []
                mappings_by_object[obj_type].append(mapping)

        # Build column headers and data in Salesmap format
        # Column format: "{ObjectType} - {FieldName}"
        salesmap_columns = []
        column_mappings = []  # (source_column, salesmap_column)

        for obj_type in request.object_types:
            obj_mappings = mappings_by_object.get(obj_type, [])
            salesmap_obj_name = SALESMAP_OBJECT_NAMES.get(obj_type, obj_type)

            for mapping in obj_mappings:
                field_id = mapping.target_field.split(".")[1]

                # Check if it's a custom field
                custom_field = next(
                    (f for f in request.custom_fields if f.objectType == obj_type and f.id == field_id),
                    None
                )

                if custom_field:
                    field_label = custom_field.label
                else:
                    field_label = SALESMAP_FIELD_NAMES.get(obj_type, {}).get(field_id, field_id)

                salesmap_column = f"{salesmap_obj_name} - {field_label}"
                salesmap_columns.append(salesmap_column)
                column_mappings.append((mapping.source_column, salesmap_column))

        # Validate that we have columns to export
        if not salesmap_columns:
            raise HTTPException(
                status_code=400,
                detail="매핑된 필드가 없습니다. 최소 하나의 필드를 매핑해주세요."
            )

        # Transform data to Salesmap format
        transformed_data = []
        for row in request.data:
            new_row = {}
            for source_col, salesmap_col in column_mappings:
                if source_col in row:
                    value = row[source_col]
                    # Handle None values
                    new_row[salesmap_col] = value if value is not None else ""
            if new_row:  # Only add non-empty rows
                transformed_data.append(new_row)

        # Validate that we have data to export
        if not transformed_data:
            raise HTTPException(
                status_code=400,
                detail="변환할 데이터가 없습니다. 데이터와 매핑을 확인해주세요."
            )

        # Create DataFrame with Salesmap column order
        df = pd.DataFrame(transformed_data)

        # Ensure all columns exist and are in correct order
        for col in salesmap_columns:
            if col not in df.columns:
                df[col] = ""
        df = df[salesmap_columns]

        # Generate Excel file
        output = io.BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, index=False, sheet_name='Import Data')
        output.seek(0)

        # Return as downloadable file
        # Use URL encoding for non-ASCII filenames (RFC 5987)
        base_filename = request.filename.rsplit('.', 1)[0]
        filename = f"salesmap_import_{base_filename}.xlsx"
        encoded_filename = quote(filename)

        return StreamingResponse(
            output,
            media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{encoded_filename}"
            }
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 생성 실패: {str(e)}")


@router.post("/import/preview", response_model=ImportResponse)
async def preview_import(request: ImportRequest):
    """
    Preview the import without generating a file.
    Returns count and validation info.
    """
    valid_types = {"company", "contact", "lead", "deal"}
    errors = []

    for obj_type in request.object_types:
        if obj_type not in valid_types:
            errors.append(f"잘못된 오브젝트 타입: {obj_type}")

    # Count mappings per object
    mappings_by_object: dict[str, int] = {}
    for mapping in request.field_mappings:
        parts = mapping.target_field.split(".")
        if len(parts) == 2:
            obj_type = parts[0]
            mappings_by_object[obj_type] = mappings_by_object.get(obj_type, 0) + 1

    # Validate required fields
    required_fields = {
        "contact": "name",
        "company": "name",
        "lead": "name",
        "deal": "name",
    }

    for obj_type in request.object_types:
        required = required_fields.get(obj_type)
        if required:
            has_required = any(
                m.target_field == f"{obj_type}.{required}"
                for m in request.field_mappings
            )
            if not has_required:
                obj_name = {"company": "회사", "contact": "고객", "lead": "리드", "deal": "딜"}.get(obj_type, obj_type)
                errors.append(f"{obj_name}의 필수 필드 '이름'이 매핑되지 않았습니다")

    return ImportResponse(
        success=len(errors) == 0,
        imported_count=len(request.data),
        errors=errors
    )


import re
from datetime import datetime

def validate_date(value: str) -> bool:
    """Validate date format YYYY-MM-DD"""
    if not value:
        return True
    patterns = [
        r'^\d{4}-\d{2}-\d{2}$',
        r'^\d{4}/\d{2}/\d{2}$',
        r'^\d{4}\.\d{2}\.\d{2}$',
    ]
    return any(re.match(p, str(value)) for p in patterns)


def validate_datetime(value: str) -> bool:
    """Validate datetime format YYYY-MM-DD HH:mm"""
    if not value:
        return True
    patterns = [
        r'^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$',
        r'^\d{4}/\d{2}/\d{2} \d{2}:\d{2}$',
        r'^\d{4}\.\d{2}\.\d{2} \d{2}:\d{2}$',
    ]
    return any(re.match(p, str(value)) for p in patterns)


def validate_email(value: str) -> bool:
    """Validate email format"""
    if not value:
        return True
    return bool(re.match(r'^[^@]+@[^@]+\.[^@]+$', str(value)))


def validate_number(value) -> bool:
    """Validate number format"""
    if value is None or value == '':
        return True
    try:
        float(str(value).replace(',', ''))
        return True
    except:
        return False


def validate_boolean(value: str) -> bool:
    """Validate boolean format"""
    if not value:
        return True
    return str(value).upper() in ['TRUE', 'FALSE', '1', '0', 'YES', 'NO']


@router.post("/import/validate", response_model=ValidationResult)
async def validate_import(request: ImportRequest):
    """
    Validate import data row by row.
    Returns detailed validation results with errors and warnings.
    """
    validation_errors: list[ValidationError] = []
    valid_row_indices: list[int] = []

    # Build mapping lookup: source_column -> (object_type, field_id, field_info)
    field_lookup: dict[str, tuple] = {}
    for mapping in request.field_mappings:
        parts = mapping.target_field.split(".")
        if len(parts) == 2:
            obj_type, field_id = parts
            # Find field info from OBJECT_FIELDS
            field_info = None
            if obj_type in OBJECT_FIELDS:
                for f in OBJECT_FIELDS[obj_type]["fields"]:
                    if f["id"] == field_id:
                        field_info = f
                        break
            # Check custom fields
            if not field_info:
                for cf in request.custom_fields:
                    if cf.objectType == obj_type and cf.id == field_id:
                        field_info = {"id": cf.id, "label": cf.label, "type": cf.type, "required": False}
                        break
            field_lookup[mapping.source_column] = (obj_type, field_id, field_info)

    # Track unique values for duplicate detection
    unique_values: dict[str, set] = {}

    # Validate each row
    for row_idx, row in enumerate(request.data, start=1):
        row_has_error = False

        # Check each mapped field
        for source_col, (obj_type, field_id, field_info) in field_lookup.items():
            value = row.get(source_col)
            field_label = field_info["label"] if field_info else field_id

            if not field_info:
                continue

            field_type = field_info.get("type", "text")
            is_required = field_info.get("required", False)
            is_unique = field_info.get("unique", False)

            # Required field validation
            if is_required and (value is None or str(value).strip() == ''):
                validation_errors.append(ValidationError(
                    row=row_idx,
                    field=field_label,
                    message=f"'{field_label}' 필드는 필수입니다",
                    severity="error"
                ))
                row_has_error = True
                continue

            # Skip further validation if value is empty
            if value is None or str(value).strip() == '':
                continue

            str_value = str(value).strip()

            # Type-specific validation
            if field_type == "date" and not validate_date(str_value):
                validation_errors.append(ValidationError(
                    row=row_idx,
                    field=field_label,
                    message=f"날짜 형식이 올바르지 않습니다 (YYYY-MM-DD)",
                    severity="error"
                ))
                row_has_error = True

            elif field_type == "datetime" and not validate_datetime(str_value):
                validation_errors.append(ValidationError(
                    row=row_idx,
                    field=field_label,
                    message=f"날짜/시간 형식이 올바르지 않습니다 (YYYY-MM-DD HH:mm)",
                    severity="error"
                ))
                row_has_error = True

            elif field_type == "email" and not validate_email(str_value):
                validation_errors.append(ValidationError(
                    row=row_idx,
                    field=field_label,
                    message=f"이메일 형식이 올바르지 않습니다",
                    severity="error"
                ))
                row_has_error = True

            elif field_type == "number" and not validate_number(str_value):
                validation_errors.append(ValidationError(
                    row=row_idx,
                    field=field_label,
                    message=f"숫자 형식이 올바르지 않습니다",
                    severity="error"
                ))
                row_has_error = True

            elif field_type == "boolean" and not validate_boolean(str_value):
                validation_errors.append(ValidationError(
                    row=row_idx,
                    field=field_label,
                    message=f"TRUE 또는 FALSE만 입력 가능합니다",
                    severity="error"
                ))
                row_has_error = True

            # Unique value validation
            if is_unique and str_value:
                unique_key = f"{obj_type}.{field_id}"
                if unique_key not in unique_values:
                    unique_values[unique_key] = set()

                if str_value.lower() in unique_values[unique_key]:
                    validation_errors.append(ValidationError(
                        row=row_idx,
                        field=field_label,
                        message=f"중복된 값입니다: {str_value}",
                        severity="warning"
                    ))
                else:
                    unique_values[unique_key].add(str_value.lower())

        # Check Lead/Deal connection requirement
        if "lead" in request.object_types or "deal" in request.object_types:
            has_people = any(
                m.target_field.startswith("contact.") for m in request.field_mappings
            )
            has_org = any(
                m.target_field.startswith("company.") for m in request.field_mappings
            )

            if not has_people and not has_org:
                # Check if there's data for people or org in the row
                people_value = None
                org_value = None
                for source_col, (obj_type, field_id, _) in field_lookup.items():
                    if obj_type == "contact":
                        people_value = row.get(source_col)
                    elif obj_type == "company":
                        org_value = row.get(source_col)

                if not people_value and not org_value:
                    if "lead" in request.object_types:
                        validation_errors.append(ValidationError(
                            row=row_idx,
                            field="연결",
                            message="리드는 고객 또는 회사 중 하나는 반드시 입력해야 합니다",
                            severity="error"
                        ))
                        row_has_error = True
                    if "deal" in request.object_types:
                        validation_errors.append(ValidationError(
                            row=row_idx,
                            field="연결",
                            message="딜은 고객 또는 회사 중 하나는 반드시 입력해야 합니다",
                            severity="error"
                        ))
                        row_has_error = True

        if not row_has_error:
            valid_row_indices.append(row_idx - 1)  # Store 0-indexed

    error_count = len([e for e in validation_errors if e.severity == "error"])
    warning_count = len([e for e in validation_errors if e.severity == "warning"])

    return ValidationResult(
        success=error_count == 0,
        total_rows=len(request.data),
        valid_rows=len(valid_row_indices),
        error_count=error_count,
        warning_count=warning_count,
        errors=validation_errors,
        valid_row_indices=valid_row_indices
    )


# Salesmap Object Fields based on documentation
OBJECT_FIELDS = {
    "company": {
        "name": "회사",
        "fields": [
            {"id": "name", "label": "회사명", "type": "text", "required": True, "unique": True},
            {"id": "employee_count", "label": "직원 수", "type": "number", "required": False},
            {"id": "address", "label": "주소", "type": "text", "required": False},
            {"id": "phone", "label": "전화번호", "type": "phone", "required": False},
            {"id": "website", "label": "웹 주소", "type": "url", "required": False},
            {"id": "owner", "label": "담당자", "type": "text", "required": False},
        ]
    },
    "contact": {
        "name": "고객",
        "fields": [
            {"id": "name", "label": "이름", "type": "text", "required": True},
            {"id": "email", "label": "이메일", "type": "email", "required": True, "unique": True},
            {"id": "phone", "label": "전화번호", "type": "phone", "required": False},
            {"id": "position", "label": "포지션", "type": "text", "required": False},
            {"id": "company", "label": "소속 회사", "type": "relation", "required": False},
            {"id": "owner", "label": "담당자", "type": "text", "required": False},
            {"id": "customer_group", "label": "고객 그룹", "type": "select", "required": False},
            {"id": "journey_stage", "label": "고객 여정 단계", "type": "select", "required": False},
        ]
    },
    "lead": {
        "name": "리드",
        "fields": [
            {"id": "name", "label": "리드명", "type": "text", "required": True},
            {"id": "status", "label": "상태", "type": "select", "required": False,
             "options": ["New", "Nurturing", "MQL", "Working", "Archive"]},
            {"id": "amount", "label": "금액", "type": "number", "required": False},
            {"id": "close_date", "label": "마감일", "type": "date", "required": False},
            {"id": "expected_date", "label": "수주 예정일", "type": "date", "required": False},
            {"id": "owner", "label": "담당자", "type": "text", "required": False},
            {"id": "pipeline", "label": "파이프라인", "type": "text", "required": False},
            {"id": "pipeline_stage", "label": "파이프라인 단계", "type": "text", "required": False},
            {"id": "lead_group", "label": "리드 그룹", "type": "select", "required": False},
            {"id": "contact", "label": "연결된 고객", "type": "relation", "required": False},
            {"id": "company", "label": "연결된 회사", "type": "relation", "required": False},
        ]
    },
    "deal": {
        "name": "딜",
        "fields": [
            {"id": "name", "label": "딜명", "type": "text", "required": True},
            {"id": "status", "label": "상태", "type": "select", "required": False,
             "options": ["Convert", "SQL", "Won", "Lost"]},
            {"id": "amount", "label": "금액", "type": "number", "required": False},
            {"id": "close_date", "label": "마감일", "type": "date", "required": False},
            {"id": "expected_date", "label": "수주 예정일", "type": "date", "required": False},
            {"id": "owner", "label": "담당자", "type": "text", "required": False},
            {"id": "pipeline", "label": "파이프라인", "type": "text", "required": False},
            {"id": "pipeline_stage", "label": "파이프라인 단계", "type": "text", "required": False},
            {"id": "contact", "label": "연결된 고객", "type": "relation", "required": False},
            {"id": "company", "label": "연결된 회사", "type": "relation", "required": False},
            # MRR fields for deals
            {"id": "subscription_start", "label": "구독 시작일", "type": "date", "required": False},
            {"id": "subscription_end", "label": "구독 종료일", "type": "date", "required": False},
            {"id": "monthly_amount", "label": "월 구독 금액", "type": "number", "required": False},
        ]
    }
}


# AI-powered endpoints
from app.services.ai_service import auto_map_fields, detect_duplicates, ai_detect_duplicates


class AvailableField(BaseModel):
    key: str  # e.g., "contact.name"
    id: str
    label: str
    object_type: str
    description: Optional[str] = None


class AutoMapRequest(BaseModel):
    source_columns: list[str]
    sample_data: list[dict]
    target_object_types: list[str]
    available_fields: Optional[list[AvailableField]] = None


class AutoMapResponse(BaseModel):
    mappings: dict[str, Optional[str]]
    confidence: dict[str, float]
    error: Optional[str] = None


class DuplicateDetectionRequest(BaseModel):
    data: list[dict]
    field_mappings: list[FieldMapping]
    use_ai: bool = False
    threshold: float = 0.85


class DuplicateRecord(BaseModel):
    row1: int
    row2: int
    similarity: float
    field_similarities: dict[str, float]
    data1: dict[str, str]
    data2: dict[str, str]
    ai_analysis: Optional[dict] = None


class DuplicateDetectionResponse(BaseModel):
    duplicates: list[DuplicateRecord]
    total_checked: int


@router.post("/import/auto-map", response_model=AutoMapResponse)
async def auto_map_endpoint(request: AutoMapRequest):
    """
    Use AI to automatically suggest field mappings based on column names and sample data.
    """
    try:
        # Convert available_fields to dict format for AI service
        available_fields_dict = None
        if request.available_fields:
            available_fields_dict = [
                {
                    "key": f.key,
                    "id": f.id,
                    "label": f.label,
                    "object_type": f.object_type,
                    "description": f.description or f.label
                }
                for f in request.available_fields
            ]

        result = await auto_map_fields(
            source_columns=request.source_columns,
            sample_data=request.sample_data,
            target_object_types=request.target_object_types,
            available_fields=available_fields_dict
        )
        return AutoMapResponse(
            mappings=result.get("mappings", {}),
            confidence=result.get("confidence", {}),
            error=result.get("error")
        )
    except Exception as e:
        return AutoMapResponse(
            mappings={},
            confidence={},
            error=str(e)
        )


@router.post("/import/detect-duplicates", response_model=DuplicateDetectionResponse)
async def detect_duplicates_endpoint(request: DuplicateDetectionRequest):
    """
    Detect potential duplicate records in the data.
    """
    try:
        field_mappings_dict = [
            {"source_column": m.source_column, "target_field": m.target_field}
            for m in request.field_mappings
        ]

        if request.use_ai:
            duplicates = await ai_detect_duplicates(
                data=request.data,
                field_mappings=field_mappings_dict,
                sample_size=100
            )
        else:
            duplicates = await detect_duplicates(
                data=request.data,
                field_mappings=field_mappings_dict,
                threshold=request.threshold
            )

        return DuplicateDetectionResponse(
            duplicates=[DuplicateRecord(**d) for d in duplicates],
            total_checked=len(request.data)
        )
    except Exception as e:
        return DuplicateDetectionResponse(
            duplicates=[],
            total_checked=0
        )


@router.get("/object-types")
def get_object_types():
    """Get available object types for import"""
    return {
        "object_types": [
            {"id": "company", "name": "회사", "description": "회사/조직 데이터"},
            {"id": "contact", "name": "고객", "description": "고객/연락처 데이터"},
            {"id": "lead", "name": "리드", "description": "리드 데이터"},
            {"id": "deal", "name": "딜", "description": "딜/거래 데이터"},
        ]
    }


@router.get("/crm-fields/{object_type}")
def get_crm_fields(object_type: str):
    """Get CRM fields for a specific object type"""
    if object_type not in OBJECT_FIELDS:
        raise HTTPException(status_code=400, detail="잘못된 오브젝트 타입입니다")

    return OBJECT_FIELDS[object_type]


# ============================================
# Salesmap API Integration Endpoints
# ============================================

from app.services.salesmap_service import validate_api_key, fetch_object_fields
from app.services.ai_service import consulting_chat


class ApiKeyValidationRequest(BaseModel):
    api_key: str


class ApiKeyValidationResponse(BaseModel):
    valid: bool
    message: str


class FetchFieldsRequest(BaseModel):
    api_key: str
    object_types: list[str]


class FieldInfo(BaseModel):
    id: str
    label: str
    type: str
    required: bool
    is_system: bool
    is_custom: bool = False


class ObjectFieldsResult(BaseModel):
    object_type: str
    object_name: str
    success: bool
    fields: list[FieldInfo]
    error: Optional[str] = None
    warning: Optional[str] = None


class FetchFieldsResponse(BaseModel):
    success: bool
    results: list[ObjectFieldsResult]


@router.post("/salesmap/validate-key", response_model=ApiKeyValidationResponse)
async def validate_salesmap_key(request: ApiKeyValidationRequest):
    """
    Validate a Salesmap API key.
    """
    print(f"[Route] /salesmap/validate-key 호출됨")
    print(f"[Route] API Key 길이: {len(request.api_key)}")
    result = await validate_api_key(request.api_key)
    print(f"[Route] 결과: {result}")
    return ApiKeyValidationResponse(
        valid=result["valid"],
        message=result["message"]
    )


@router.post("/salesmap/fetch-fields", response_model=FetchFieldsResponse)
async def fetch_salesmap_fields(request: FetchFieldsRequest):
    """
    Fetch available fields from Salesmap for the specified object types.
    """
    print(f"[Route] /salesmap/fetch-fields 호출됨")
    print(f"[Route] Object Types: {request.object_types}")
    results = []

    for obj_type in request.object_types:
        result = await fetch_object_fields(request.api_key, obj_type)

        fields = [
            FieldInfo(
                id=f["id"],
                label=f["label"],
                type=f["type"],
                required=f["required"],
                is_system=f.get("is_system", False),
                is_custom=f.get("is_custom", False)
            )
            for f in result.get("fields", [])
        ]

        results.append(ObjectFieldsResult(
            object_type=obj_type,
            object_name=result.get("object_name", obj_type),
            success=result.get("success", False),
            fields=fields,
            error=result.get("error"),
            warning=result.get("warning")
        ))

    all_success = all(r.success for r in results)
    return FetchFieldsResponse(success=all_success, results=results)


# ============================================
# AI Consulting Chat Endpoints
# ============================================

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class FileContext(BaseModel):
    filename: str
    columns: list[str]
    sample_data: list[dict]
    total_rows: int


class ConsultingChatRequest(BaseModel):
    messages: list[ChatMessage]
    is_summary_request: bool = False
    file_context: Optional[FileContext] = None


class ConsultingChatResponse(BaseModel):
    type: str  # "message", "summary", or "error"
    content: Optional[str] = None
    data: Optional[dict] = None


@router.post("/consulting/chat", response_model=ConsultingChatResponse)
async def consulting_chat_endpoint(request: ConsultingChatRequest):
    """
    AI-powered consulting chat for B2B CRM data import.
    Helps users identify their data management needs.
    """
    try:
        messages_dict = [{"role": m.role, "content": m.content} for m in request.messages]

        # Convert file context to dict if present
        file_context_dict = None
        if request.file_context:
            file_context_dict = {
                "filename": request.file_context.filename,
                "columns": request.file_context.columns,
                "sample_data": request.file_context.sample_data,
                "total_rows": request.file_context.total_rows,
            }

        result = await consulting_chat(
            messages_dict,
            request.is_summary_request,
            file_context_dict
        )

        return ConsultingChatResponse(
            type=result.get("type", "message"),
            content=result.get("content"),
            data=result.get("data")
        )
    except Exception as e:
        print(f"Consulting chat error: {e}")
        return ConsultingChatResponse(
            type="error",
            content=f"AI 응답 오류: {str(e)}"
        )
