"""
Export Router
데이터 내보내기 API 엔드포인트
"""
import os
from typing import Optional
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.models.schemas import (
    FieldMapping, ExportFormat, ExportRequest, ExportResponse, ObjectType
)
from app.services.exporter import exporter

router = APIRouter(prefix="/export", tags=["export"])


class ExportRequestBody(BaseModel):
    """내보내기 요청 바디"""
    data: list[dict]
    mappings: list[dict]  # FieldMapping dict
    object_types: list[str]
    format: str = "xlsx"
    include_summary: bool = True


@router.post("", response_model=ExportResponse)
async def export_data(request: ExportRequestBody) -> ExportResponse:
    """
    데이터 내보내기

    - 매핑된 데이터를 Excel 또는 CSV로 내보내기
    - 오브젝트별 시트 생성 (Excel)
    - 요약 시트 포함 옵션
    """
    try:
        # FieldMapping 객체로 변환
        mappings = []
        for m in request.mappings:
            # target_object를 ObjectType으로 변환
            target_obj = m.get('target_object')
            if isinstance(target_obj, str):
                try:
                    target_obj = ObjectType(target_obj)
                except ValueError:
                    pass

            mappings.append(FieldMapping(
                source_column=m.get('source_column', ''),
                target_object=target_obj,
                target_field_id=m.get('target_field_id'),
                target_field_label=m.get('target_field_label', ''),
                field_type=m.get('field_type', 'text'),
                is_new_field=m.get('is_new_field', False),
                is_required=m.get('is_required', False),
                is_unique=m.get('is_unique', False),
                confidence=m.get('confidence', 1.0),
            ))

        # 형식 변환
        export_format = ExportFormat.EXCEL
        if request.format.lower() in ['csv', 'text/csv']:
            export_format = ExportFormat.CSV

        # 내보내기 실행
        result = exporter.export(
            data=request.data,
            mappings=mappings,
            object_types=request.object_types,
            format=export_format,
            include_summary=request.include_summary,
        )

        if result.success:
            return ExportResponse(
                success=True,
                filename=result.filename,
                file_path=result.file_path,
                download_url=f"/api/export/download/{result.filename}",
                stats=result.stats,
                errors=result.errors,
            )
        else:
            return ExportResponse(
                success=False,
                filename="",
                stats=result.stats,
                errors=result.errors,
            )

    except Exception as e:
        return ExportResponse(
            success=False,
            filename="",
            errors=[str(e)],
        )


@router.get("/download/{filename}")
async def download_file(filename: str):
    """
    파일 다운로드

    - 내보낸 파일 다운로드
    """
    # 보안: 파일명에 경로 조작 문자가 없는지 확인
    if '..' in filename or '/' in filename or '\\' in filename:
        raise HTTPException(status_code=400, detail="Invalid filename")

    file_path = os.path.join(exporter.exports_dir, filename)

    if not os.path.exists(file_path):
        raise HTTPException(status_code=404, detail="File not found")

    # Content-Type 결정
    if filename.endswith('.xlsx'):
        media_type = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    elif filename.endswith('.csv'):
        media_type = "text/csv"
    else:
        media_type = "application/octet-stream"

    return FileResponse(
        path=file_path,
        filename=filename,
        media_type=media_type,
    )


@router.get("/list")
async def list_exports():
    """
    내보낸 파일 목록

    - 생성된 내보내기 파일 목록 조회
    """
    try:
        files = []
        for filename in os.listdir(exporter.exports_dir):
            if filename.endswith(('.xlsx', '.csv')):
                file_path = os.path.join(exporter.exports_dir, filename)
                stat = os.stat(file_path)
                files.append({
                    "filename": filename,
                    "size": stat.st_size,
                    "created": stat.st_ctime,
                    "download_url": f"/api/export/download/{filename}",
                })

        # 최신순 정렬
        files.sort(key=lambda x: x['created'], reverse=True)

        return {"success": True, "files": files}

    except Exception as e:
        return {"success": False, "files": [], "error": str(e)}
