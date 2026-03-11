"""
Salesmap API Router
세일즈맵 API 프록시 및 연동 기능
"""
import httpx
from typing import Optional, Any
from fastapi import APIRouter, HTTPException, Header
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from app.services.salesmap_service import (
    fetch_object_fields,
    fetch_all_products,
    OBJECT_NAMES_KR,
)
from app.services.ai_service import get_openai_client
from app.services.import_history_service import (
    create_session,
    log_row_result,
    end_session,
)
from app.services.bulk_import_service import bulk_import_stream
import json

router = APIRouter(prefix="/salesmap", tags=["salesmap"])

SALESMAP_API_BASE = "https://salesmap.kr/api"


class ApiKeyValidationRequest(BaseModel):
    api_key: str


class ApiKeyValidationResponse(BaseModel):
    valid: bool
    message: Optional[str] = None


class FetchFieldsRequest(BaseModel):
    api_key: str
    object_types: list[str]


class ObjectFieldsResult(BaseModel):
    object_type: str
    object_name: str
    success: bool
    fields: list[dict] = []
    error: Optional[str] = None
    warning: Optional[str] = None


class FetchFieldsResponse(BaseModel):
    success: bool
    results: list[ObjectFieldsResult] = []
    error: Optional[str] = None


class ProxyRequest(BaseModel):
    """프록시 요청"""
    data: dict[str, Any]


class ProxyResponse(BaseModel):
    """프록시 응답"""
    success: bool
    data: Optional[dict[str, Any]] = None
    message: Optional[str] = None
    reason: Optional[str] = None


@router.post("/validate-key", response_model=ApiKeyValidationResponse)
async def validate_api_key(request: ApiKeyValidationRequest) -> ApiKeyValidationResponse:
    """
    세일즈맵 API 키 검증
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{SALESMAP_API_BASE}/v2/me",
                headers={
                    "Authorization": f"Bearer {request.api_key}",
                },
                timeout=10.0,
            )

            if response.status_code == 200:
                return ApiKeyValidationResponse(valid=True)
            elif response.status_code == 401:
                return ApiKeyValidationResponse(valid=False, message="API 키가 유효하지 않습니다")
            else:
                return ApiKeyValidationResponse(valid=False, message=f"검증 실패: {response.status_code}")

    except httpx.TimeoutException:
        return ApiKeyValidationResponse(valid=False, message="API 서버 응답 시간 초과")
    except Exception as e:
        return ApiKeyValidationResponse(valid=False, message=str(e))


@router.post("/fetch-fields", response_model=FetchFieldsResponse)
async def fetch_fields(request: FetchFieldsRequest) -> FetchFieldsResponse:
    """
    세일즈맵 필드 조회 (salesmap_service 사용)
    """
    try:
        results = []

        for obj_type in request.object_types:
            print(f"[fetch-fields] Fetching fields for: {obj_type}")

            result = await fetch_object_fields(request.api_key, obj_type)

            print(f"[fetch-fields] {obj_type} result: success={result.get('success')}, fields={len(result.get('fields', []))}")

            object_name = OBJECT_NAMES_KR.get(obj_type, obj_type)

            results.append(ObjectFieldsResult(
                object_type=obj_type,  # 원래 요청한 object_type 유지
                object_name=object_name,
                success=result.get("success", False),
                fields=result.get("fields", []),
                error=result.get("error"),
                warning=result.get("warning"),
            ))

        print(f"[fetch-fields] Final results: {[r.object_type for r in results]}")
        return FetchFieldsResponse(success=True, results=results)

    except Exception as e:
        print(f"[fetch-fields] Exception: {e}")
        return FetchFieldsResponse(success=False, error=str(e))


class StartSessionRequest(BaseModel):
    filename: str
    total_rows: int
    object_types: list[str]


class StartSessionResponse(BaseModel):
    session_id: str


class EndSessionResponse(BaseModel):
    success: bool
    summary: Optional[dict] = None


@router.post("/session/start", response_model=StartSessionResponse)
async def start_import_session(request: StartSessionRequest) -> StartSessionResponse:
    session_id = create_session(request.filename, request.total_rows, request.object_types)
    return StartSessionResponse(session_id=session_id)


@router.post("/session/{session_id}/end", response_model=EndSessionResponse)
async def end_import_session(session_id: str) -> EndSessionResponse:
    summary = end_session(session_id)
    return EndSessionResponse(success=True, summary=summary)


class BulkImportRequest(BaseModel):
    api_key: str
    upsert_enabled: bool = True
    session_id: Optional[str] = None
    active_objects: list[str]
    product_cache: list[dict] = []
    quote_connection: str = "deal"
    rows: list[dict[str, Any]]
    filename: str = ""
    total_rows: int = 0


@router.post("/bulk-import")
async def bulk_import(request: BulkImportRequest):
    # Create session if not provided
    session_id = request.session_id
    if not session_id and request.filename:
        try:
            session_id = create_session(
                request.filename,
                request.total_rows or len(request.rows),
                request.active_objects,
            )
        except Exception as e:
            print(f"[BulkImport] Session creation failed (non-fatal): {e}")

    async def event_stream():
        async for chunk in bulk_import_stream(
            api_key=request.api_key,
            upsert_enabled=request.upsert_enabled,
            session_id=session_id,
            active_objects=request.active_objects,
            product_cache_initial=request.product_cache,
            quote_connection=request.quote_connection,
            rows=request.rows,
        ):
            yield chunk

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/proxy/v2/people")
async def proxy_create_people(
    request: ProxyRequest,
    x_salesmap_api_key: str = Header(..., alias="X-Salesmap-Api-Key"),
    x_import_session_id: Optional[str] = Header(None, alias="X-Import-Session-Id"),
    x_import_row_index: Optional[str] = Header(None, alias="X-Import-Row-Index"),
) -> ProxyResponse:
    return await _proxy_request(
        endpoint="/v2/people",
        method="POST",
        api_key=x_salesmap_api_key,
        data=request.data,
        session_id=x_import_session_id,
        row_index=int(x_import_row_index) if x_import_row_index else None,
        object_type="people",
    )


@router.post("/proxy/v2/organization")
async def proxy_create_organization(
    request: ProxyRequest,
    x_salesmap_api_key: str = Header(..., alias="X-Salesmap-Api-Key"),
    x_import_session_id: Optional[str] = Header(None, alias="X-Import-Session-Id"),
    x_import_row_index: Optional[str] = Header(None, alias="X-Import-Row-Index"),
) -> ProxyResponse:
    return await _proxy_request(
        endpoint="/v2/organization",
        method="POST",
        api_key=x_salesmap_api_key,
        data=request.data,
        session_id=x_import_session_id,
        row_index=int(x_import_row_index) if x_import_row_index else None,
        object_type="organization",
    )


@router.post("/proxy/v2/deal")
async def proxy_create_deal(
    request: ProxyRequest,
    x_salesmap_api_key: str = Header(..., alias="X-Salesmap-Api-Key"),
    x_import_session_id: Optional[str] = Header(None, alias="X-Import-Session-Id"),
    x_import_row_index: Optional[str] = Header(None, alias="X-Import-Row-Index"),
) -> ProxyResponse:
    return await _proxy_request(
        endpoint="/v2/deal",
        method="POST",
        api_key=x_salesmap_api_key,
        data=request.data,
        session_id=x_import_session_id,
        row_index=int(x_import_row_index) if x_import_row_index else None,
        object_type="deal",
    )


@router.post("/proxy/v2/lead")
async def proxy_create_lead(
    request: ProxyRequest,
    x_salesmap_api_key: str = Header(..., alias="X-Salesmap-Api-Key"),
    x_import_session_id: Optional[str] = Header(None, alias="X-Import-Session-Id"),
    x_import_row_index: Optional[str] = Header(None, alias="X-Import-Row-Index"),
) -> ProxyResponse:
    return await _proxy_request(
        endpoint="/v2/lead",
        method="POST",
        api_key=x_salesmap_api_key,
        data=request.data,
        session_id=x_import_session_id,
        row_index=int(x_import_row_index) if x_import_row_index else None,
        object_type="lead",
    )


# --- 업데이트 프록시 엔드포인트 (중복 시 upsert용) ---

@router.post("/proxy/v2/people/{record_id}")
async def proxy_update_people(
    record_id: str,
    request: ProxyRequest,
    x_salesmap_api_key: str = Header(..., alias="X-Salesmap-Api-Key"),
    x_import_session_id: Optional[str] = Header(None, alias="X-Import-Session-Id"),
    x_import_row_index: Optional[str] = Header(None, alias="X-Import-Row-Index"),
) -> ProxyResponse:
    return await _proxy_request(
        endpoint=f"/v2/people/{record_id}",
        method="POST",
        api_key=x_salesmap_api_key,
        data=request.data,
        session_id=x_import_session_id,
        row_index=int(x_import_row_index) if x_import_row_index else None,
        object_type="people",
        action="update",
    )


@router.post("/proxy/v2/organization/{record_id}")
async def proxy_update_organization(
    record_id: str,
    request: ProxyRequest,
    x_salesmap_api_key: str = Header(..., alias="X-Salesmap-Api-Key"),
    x_import_session_id: Optional[str] = Header(None, alias="X-Import-Session-Id"),
    x_import_row_index: Optional[str] = Header(None, alias="X-Import-Row-Index"),
) -> ProxyResponse:
    return await _proxy_request(
        endpoint=f"/v2/organization/{record_id}",
        method="POST",
        api_key=x_salesmap_api_key,
        data=request.data,
        session_id=x_import_session_id,
        row_index=int(x_import_row_index) if x_import_row_index else None,
        object_type="organization",
        action="update",
    )


@router.post("/proxy/v2/deal/{record_id}")
async def proxy_update_deal(
    record_id: str,
    request: ProxyRequest,
    x_salesmap_api_key: str = Header(..., alias="X-Salesmap-Api-Key"),
    x_import_session_id: Optional[str] = Header(None, alias="X-Import-Session-Id"),
    x_import_row_index: Optional[str] = Header(None, alias="X-Import-Row-Index"),
) -> ProxyResponse:
    return await _proxy_request(
        endpoint=f"/v2/deal/{record_id}",
        method="POST",
        api_key=x_salesmap_api_key,
        data=request.data,
        session_id=x_import_session_id,
        row_index=int(x_import_row_index) if x_import_row_index else None,
        object_type="deal",
        action="update",
    )


@router.post("/proxy/v2/lead/{record_id}")
async def proxy_update_lead(
    record_id: str,
    request: ProxyRequest,
    x_salesmap_api_key: str = Header(..., alias="X-Salesmap-Api-Key"),
    x_import_session_id: Optional[str] = Header(None, alias="X-Import-Session-Id"),
    x_import_row_index: Optional[str] = Header(None, alias="X-Import-Row-Index"),
) -> ProxyResponse:
    return await _proxy_request(
        endpoint=f"/v2/lead/{record_id}",
        method="POST",
        api_key=x_salesmap_api_key,
        data=request.data,
        session_id=x_import_session_id,
        row_index=int(x_import_row_index) if x_import_row_index else None,
        object_type="lead",
        action="update",
    )


@router.post("/proxy/v2/product")
async def proxy_create_product(
    request: ProxyRequest,
    x_salesmap_api_key: str = Header(..., alias="X-Salesmap-Api-Key"),
    x_import_session_id: Optional[str] = Header(None, alias="X-Import-Session-Id"),
    x_import_row_index: Optional[str] = Header(None, alias="X-Import-Row-Index"),
) -> ProxyResponse:
    return await _proxy_request(
        endpoint="/v2/product",
        method="POST",
        api_key=x_salesmap_api_key,
        data=request.data,
        session_id=x_import_session_id,
        row_index=int(x_import_row_index) if x_import_row_index else None,
        object_type="product",
    )


@router.post("/proxy/v2/quote")
async def proxy_create_quote(
    request: ProxyRequest,
    x_salesmap_api_key: str = Header(..., alias="X-Salesmap-Api-Key"),
    x_import_session_id: Optional[str] = Header(None, alias="X-Import-Session-Id"),
    x_import_row_index: Optional[str] = Header(None, alias="X-Import-Row-Index"),
) -> ProxyResponse:
    return await _proxy_request(
        endpoint="/v2/quote",
        method="POST",
        api_key=x_salesmap_api_key,
        data=request.data,
        session_id=x_import_session_id,
        row_index=int(x_import_row_index) if x_import_row_index else None,
        object_type="quote",
    )


# 전체 상품 조회 API
@router.post("/products")
async def get_products(request: ApiKeyValidationRequest) -> dict:
    """
    세일즈맵 전체 상품 목록 조회 (커서 페이지네이션)
    """
    result = await fetch_all_products(request.api_key)
    return result


async def _proxy_request(
    endpoint: str,
    method: str,
    api_key: str,
    data: dict[str, Any],
    session_id: Optional[str] = None,
    row_index: Optional[int] = None,
    object_type: Optional[str] = None,
    action: str = "create",
) -> ProxyResponse:
    """
    세일즈맵 API로 요청 프록시 (+ 세션 로깅)
    """
    try:

        async with httpx.AsyncClient() as client:
            response = await client.request(
                method=method,
                url=f"{SALESMAP_API_BASE}{endpoint}",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=data,
                timeout=30.0,
            )


            result = response.json()

            # reason이 리스트일 수 있음 → 문자열로 변환
            raw_reason = result.get("reason")
            reason_str = ", ".join(raw_reason) if isinstance(raw_reason, list) else raw_reason

            if response.status_code in (200, 201):
                proxy_resp = ProxyResponse(
                    success=result.get("success", True),
                    data=result.get("data"),
                    message=result.get("message"),
                    reason=reason_str,
                )
            else:
                proxy_resp = ProxyResponse(
                    success=False,
                    data=result.get("data"),
                    message=result.get("message", f"API 오류: {response.status_code}"),
                    reason=reason_str,
                )

            # 세션 로깅
            if session_id and row_index is not None and object_type:
                try:
                    log_row_result(
                        session_id=session_id,
                        row_index=row_index,
                        object_type=object_type,
                        request_body=data,
                        response_body=result,
                        success=proxy_resp.success,
                        error_message=proxy_resp.reason or proxy_resp.message if not proxy_resp.success else None,
                        action=action,
                    )
                except Exception as log_err:
                    print(f"[Salesmap Proxy] Logging error (non-fatal): {log_err}")

            return proxy_resp

    except httpx.TimeoutException:
        if session_id and row_index is not None and object_type:
            try:
                log_row_result(session_id, row_index, object_type, data, {}, False, "API 서버 응답 시간 초과", action=action)
            except Exception:
                pass
        return ProxyResponse(success=False, message="API 서버 응답 시간 초과")
    except Exception as e:
        if session_id and row_index is not None and object_type:
            try:
                log_row_result(session_id, row_index, object_type, data, {}, False, str(e), action=action)
            except Exception:
                pass
        return ProxyResponse(success=False, message=str(e))


class FetchPipelinesRequest(BaseModel):
    api_key: str
    object_type: str  # "deal" or "lead"


# 파이프라인 조회 API
@router.post("/pipelines")
async def get_pipelines(request: FetchPipelinesRequest) -> dict:
    """
    세일즈맵 파이프라인 목록 조회
    GET /v2/deal/pipeline 또는 GET /v2/lead/pipeline
    """
    try:
        endpoint = f"/v2/{request.object_type}/pipeline"

        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{SALESMAP_API_BASE}{endpoint}",
                headers={
                    "Authorization": f"Bearer {request.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=10.0,
            )

            print(f"[pipelines] {endpoint} -> {response.status_code}")

            if response.status_code == 200:
                result = response.json()
                pipeline_list = result.get("data", {}).get("pipelineList", [])
                return {
                    "success": True,
                    "pipelineList": pipeline_list,
                }
            else:
                return {
                    "success": False,
                    "message": f"조회 실패: {response.status_code}",
                }

    except Exception as e:
        print(f"[pipelines] Exception: {e}")
        return {"success": False, "message": str(e)}


# 사용자 목록 조회 API
@router.post("/users")
async def get_users(request: ApiKeyValidationRequest) -> dict:
    """
    세일즈맵 사용자 목록 조회
    GET /v2/user
    """
    try:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                f"{SALESMAP_API_BASE}/v2/user",
                headers={
                    "Authorization": f"Bearer {request.api_key}",
                    "Content-Type": "application/json",
                },
                timeout=10.0,
            )

            print(f"[users] /v2/user -> {response.status_code}")

            if response.status_code == 200:
                result = response.json()
                user_list = result.get("data", {}).get("userList", [])
                return {
                    "success": True,
                    "userList": user_list,
                }
            else:
                return {
                    "success": False,
                    "message": f"조회 실패: {response.status_code}",
                }

    except Exception as e:
        print(f"[users] Exception: {e}")
        return {"success": False, "message": str(e)}


# AI 자동 매핑 요청/응답 모델
class AutoMappingRequest(BaseModel):
    columns: list[str]
    sample_data: list[dict]
    available_fields: dict[str, list[dict]]  # object_type -> fields
    enabled_objects: list[str]


class FieldMapping(BaseModel):
    column: str
    object_type: Optional[str] = None
    field_key: Optional[str] = None
    field_name: Optional[str] = None
    confidence: float = 0.0
    reason: Optional[str] = None


class AutoMappingResponse(BaseModel):
    success: bool
    mappings: list[FieldMapping] = []
    error: Optional[str] = None


@router.post("/auto-mapping", response_model=AutoMappingResponse)
async def auto_mapping(request: AutoMappingRequest) -> AutoMappingResponse:
    """
    AI를 사용하여 파일 컬럼을 세일즈맵 필드에 자동 매핑
    """
    try:
        # 모든 사용 가능한 필드를 그룹화된 형태로 정리
        all_fields_list = []
        for obj_type in request.enabled_objects:
            obj_name = OBJECT_NAMES_KR.get(obj_type, obj_type)
            fields = request.available_fields.get(obj_type, [])
            for field in fields:
                all_fields_list.append({
                    "key": f"{obj_type}.{field.get('id', field.get('key', ''))}",
                    "label": f"[{obj_name}] {field.get('label', field.get('name', ''))}",
                    "object_type": obj_type,
                    "field_key": field.get('id', field.get('key', '')),
                    "field_name": field.get('label', field.get('name', '')),
                    "required": field.get('required', False),
                })

        # 샘플 데이터 문자열 생성
        sample_str = ""
        for col in request.columns[:20]:
            values = [str(row.get(col, ""))[:50] for row in request.sample_data[:3] if row.get(col)]
            if values:
                sample_str += f"- {col}: {', '.join(values)}\n"
            else:
                sample_str += f"- {col}: (빈 값)\n"

        prompt = f"""당신은 CRM 데이터 매핑 전문가입니다. 업로드된 파일의 컬럼을 세일즈맵 CRM 필드에 자동 매핑해주세요.

## 소스 컬럼 및 샘플 데이터
{sample_str}

## 타겟 CRM 필드 (사용 가능한 필드 목록)
{json.dumps(all_fields_list, ensure_ascii=False, indent=2)}

## 매핑 규칙
1. 컬럼명과 샘플 데이터를 분석하여 가장 적합한 필드를 찾으세요
2. 매핑 신뢰도를 0.0~1.0 사이로 평가하세요:
   - 0.9+ : 거의 확실한 매칭 (이름↔이름, email↔이메일 등)
   - 0.7-0.9 : 높은 확률의 매칭
   - 0.5-0.7 : 가능한 매칭
   - 0.5 미만 : 불확실한 매칭 (null로 반환)
3. 확신이 없으면 null로 반환하세요 (잘못된 매핑보다 낫습니다)
4. 하나의 컬럼은 하나의 필드에만 매핑하세요

## 응답 형식 (JSON)
{{
  "mappings": [
    {{
      "column": "컬럼명",
      "target": "object_type.field_key 또는 null",
      "confidence": 0.0-1.0,
      "reason": "매핑 근거 (한 줄)"
    }}
  ]
}}

모든 소스 컬럼에 대해 매핑 결과를 반환하세요. JSON만 응답하세요."""

        openai_client = get_openai_client()
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a CRM data mapping expert. Return only JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            response_format={"type": "json_object"},
            max_tokens=4000
        )

        content = response.choices[0].message.content
        result = json.loads(content)

        # 필드 정보 룩업 맵 생성
        field_lookup = {f["key"]: f for f in all_fields_list}

        # 응답 변환
        mappings = []
        for m in result.get("mappings", []):
            target = m.get("target")
            confidence = m.get("confidence", 0.0)

            if target and target in field_lookup and confidence >= 0.5:
                field_info = field_lookup[target]
                mappings.append(FieldMapping(
                    column=m["column"],
                    object_type=field_info["object_type"],
                    field_key=field_info["field_key"],
                    field_name=field_info["field_name"],
                    confidence=confidence,
                    reason=m.get("reason", "")
                ))
            else:
                mappings.append(FieldMapping(
                    column=m["column"],
                    object_type=None,
                    field_key=None,
                    field_name=None,
                    confidence=confidence,
                    reason=m.get("reason", "매핑되지 않음")
                ))

        return AutoMappingResponse(success=True, mappings=mappings)

    except Exception as e:
        print(f"Auto-mapping error: {e}")
        return AutoMappingResponse(success=False, error=str(e))
