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
