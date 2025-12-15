from fastapi import APIRouter, UploadFile, File, HTTPException
from app.services.file_parser import parse_file

router = APIRouter()


@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    allowed_extensions = [".csv", ".xlsx", ".xls"]
    file_ext = "." + file.filename.split(".")[-1].lower()

    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed: {', '.join(allowed_extensions)}"
        )

    try:
        contents = await file.read()
        result = parse_file(contents, file_ext)

        return {
            "filename": file.filename,
            "columns": result["columns"],
            "preview": result["preview"],
            "total_rows": result["total_rows"],
            "data": result["data"]
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"파일 파싱 실패: {str(e)}")
