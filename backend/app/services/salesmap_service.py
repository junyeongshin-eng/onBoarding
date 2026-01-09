import httpx

# Base URL: https://salesmap.kr/api
SALESMAP_BASE_URL = "https://salesmap.kr/api/v2"

# Mapping from internal object types to Salesmap API endpoints
SALESMAP_ENDPOINTS = {
    "people": "people",
    "deal": "deal",
    "lead": "lead",
    "company": "organization",
}

# Korean names for objects
OBJECT_NAMES_KR = {
    "people": "고객",
    "deal": "딜",
    "lead": "리드",
    "company": "회사",
}


async def validate_api_key(api_key: str) -> dict:
    """
    Validate Salesmap API key by making a test request.
    Returns validation result with user/workspace info if valid.
    """
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            # Try to fetch people list to validate the key
            url = f"{SALESMAP_BASE_URL}/people"
            print(f"[validate_api_key] 요청 URL: {url}")
            print(f"[validate_api_key] API Key: {api_key[:10]}...{api_key[-4:]}" if len(api_key) > 14 else f"[validate_api_key] API Key: {api_key}")

            response = await client.get(
                url,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                }
            )

            print(f"[validate_api_key] 응답 상태: {response.status_code}")
            print(f"[validate_api_key] 응답 내용: {response.text[:500]}" if len(response.text) > 500 else f"[validate_api_key] 응답 내용: {response.text}")

            if response.status_code == 200:
                return {
                    "valid": True,
                    "message": "API 키가 유효합니다",
                }
            elif response.status_code == 401:
                return {
                    "valid": False,
                    "message": "유효하지 않은 API 키입니다",
                }
            else:
                return {
                    "valid": False,
                    "message": f"API 연결 오류: {response.status_code}",
                }
    except httpx.TimeoutException:
        return {
            "valid": False,
            "message": "API 서버 연결 시간 초과",
        }
    except Exception as e:
        return {
            "valid": False,
            "message": f"연결 오류: {str(e)}",
        }


async def fetch_object_fields(api_key: str, object_type: str) -> dict:
    """
    Fetch available fields for an object type by calling the list API
    and extracting field names from the response.

    Args:
        api_key: Salesmap API key
        object_type: One of 'people', 'deal', 'lead', 'company'

    Returns:
        Dictionary with fields list and metadata
    """
    endpoint = SALESMAP_ENDPOINTS.get(object_type)
    if not endpoint:
        return {
            "success": False,
            "error": f"알 수 없는 오브젝트 타입: {object_type}",
            "fields": []
        }

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            url = f"{SALESMAP_BASE_URL}/{endpoint}"
            print(f"[fetch_object_fields] 요청 URL: {url}")
            print(f"[fetch_object_fields] Object Type: {object_type}")

            response = await client.get(
                url,
                headers={
                    "Content-Type": "application/json",
                    "Authorization": f"Bearer {api_key}"
                }
            )

            print(f"[fetch_object_fields] 응답 상태: {response.status_code}")
            print(f"[fetch_object_fields] 응답 내용: {response.text[:1000]}" if len(response.text) > 1000 else f"[fetch_object_fields] 응답 내용: {response.text}")

            if response.status_code == 401:
                return {
                    "success": False,
                    "error": "API 키가 유효하지 않습니다",
                    "fields": []
                }

            if response.status_code != 200:
                return {
                    "success": False,
                    "error": f"API 오류: {response.status_code}",
                    "fields": []
                }

            data = response.json()

            # API 응답 구조: {"success": true, "data": {"peopleList": [...], "dealList": [...], ...}}
            # endpoint에 따라 다른 키 사용
            list_key_map = {
                "people": "peopleList",
                "deal": "dealList",
                "lead": "leadList",
                "organization": "organizationList",
            }
            list_key = list_key_map.get(endpoint, f"{endpoint}List")

            inner_data = data.get("data", {})
            records = inner_data.get(list_key, [])

            print(f"[fetch_object_fields] List Key: {list_key}, Records 수: {len(records)}")

            if not records:
                # No records found, return basic fields
                return {
                    "success": True,
                    "warning": "데이터가 없어 기본 필드만 표시됩니다",
                    "fields": get_default_fields(object_type),
                    "record_count": 0
                }

            # Extract all unique field names from records
            all_fields = set()
            for record in records:
                if isinstance(record, dict):
                    all_fields.update(record.keys())

            # Convert to list of field objects with metadata
            fields = []
            for field_name in sorted(all_fields):
                # Skip internal/system fields
                if field_name.startswith("_"):
                    continue

                is_sys = is_system_field(field_name)
                field_info = {
                    "id": field_name,
                    "label": get_field_label(field_name),
                    "type": infer_field_type(records, field_name),
                    "required": is_required_field(object_type, field_name),
                    "is_system": is_sys,
                    "editable": not is_sys,  # 시스템 필드가 아니면 수정 가능
                }
                fields.append(field_info)

            return {
                "success": True,
                "fields": fields,
                "record_count": len(records),
                "object_name": OBJECT_NAMES_KR.get(object_type, object_type)
            }

    except httpx.TimeoutException:
        return {
            "success": False,
            "error": "API 서버 연결 시간 초과",
            "fields": []
        }
    except Exception as e:
        return {
            "success": False,
            "error": f"필드 조회 오류: {str(e)}",
            "fields": []
        }


def get_field_label(field_name: str) -> str:
    """Convert field name to human-readable Korean label."""
    label_map = {
        # Common fields
        "id": "ID",
        "name": "이름",
        "email": "이메일",
        "phone": "전화번호",
        "position": "포지션",
        "company": "회사",
        "organization": "회사",
        "organization_id": "회사 ID",
        "owner": "담당자",
        "owner_id": "담당자 ID",
        "status": "상태",
        "amount": "금액",
        "close_date": "마감일",
        "expected_date": "수주 예정일",
        "pipeline": "파이프라인",
        "pipeline_id": "파이프라인 ID",
        "pipeline_stage": "파이프라인 단계",
        "pipeline_stage_id": "파이프라인 단계 ID",
        "stage": "단계",
        "created_at": "생성 날짜",
        "updated_at": "수정 날짜",
        "description": "설명",
        "note": "메모",
        "notes": "메모",
        "tags": "태그",
        "source": "소스",
        "contact": "연결된 고객",
        "contact_id": "고객 ID",
        "people": "연결된 고객",
        "people_id": "고객 ID",

        # People (고객) fields
        "profile_image": "프로필 사진",
        "linkedin": "링크드인",
        "unsubscribe_reason": "수신 거부 사유",
        "unsubscribed": "수신 거부 여부",
        "record_id": "RecordId",
        "recordId": "RecordId",
        "customer_group": "고객 그룹",
        "journey_stage": "고객 여정 단계",

        # Deal (딜) fields
        "monthly_amount": "월 구독 금액",
        "fail_reason": "실패 사유",
        "fail_detail_reason": "실패 상세 사유",
        "subscription_end_type": "구독 종료 유형",
        "subscription_start_type": "구독 시작 유형",
        "subscription_start": "구독 시작일",
        "subscription_end": "구독 종료일",
        "follower": "팔로워",
        "followers": "팔로워",
        "main_quote_products": "메인 견적 상품 리스트",

        # Lead (리드) fields
        "lead_type": "유형",
        "hold_reason": "보류 사유",
        "hold_detail_reason": "보류 상세 사유",
        "lead_group": "리드 그룹",

        # Organization (회사) fields
        "address": "주소",
        "website": "웹 주소",
        "employee_count": "직원수",
        "employees": "직원수",
    }
    return label_map.get(field_name, field_name)


def infer_field_type(records: list, field_name: str) -> str:
    """Infer field type from sample values."""
    # Check known field types first based on Salesmap specification
    type_hints = {
        # Text fields
        "name": "text",
        "position": "text",
        "address": "text",
        "linkedin": "text",
        "unsubscribe_reason": "text",
        "fail_detail_reason": "text",
        "hold_detail_reason": "text",
        "record_id": "text",
        "recordId": "text",

        # Email fields
        "email": "email",

        # Phone fields
        "phone": "phone",

        # URL fields
        "website": "url",
        "profile_image": "url",

        # Number fields
        "amount": "number",
        "employee_count": "number",
        "employees": "number",
        "monthly_amount": "number",

        # Date/Datetime fields
        "created_at": "datetime",
        "updated_at": "datetime",
        "close_date": "datetime",
        "expected_date": "datetime",
        "subscription_start": "datetime",
        "subscription_end": "datetime",

        # Boolean fields
        "unsubscribed": "boolean",

        # Select fields (single)
        "source": "select",
        "status": "select",
        "journey_stage": "select",
        "lead_type": "select",
        "hold_reason": "select",
        "subscription_start_type": "select",
        "subscription_end_type": "select",

        # Multiselect fields
        "fail_reason": "multiselect",
        "customer_group": "multiselect",
        "lead_group": "multiselect",
        "main_quote_products": "multiselect",
        "followers": "users",
        "follower": "users",

        # User fields
        "owner": "user",
        "owner_id": "user",

        # Relation fields
        "organization": "relation",
        "organization_id": "relation",
        "contact": "relation",
        "contact_id": "relation",
        "people": "relation",
        "people_id": "relation",
        "pipeline": "pipeline",
        "pipeline_id": "pipeline",
        "pipeline_stage": "pipeline_stage",
        "pipeline_stage_id": "pipeline_stage",
    }

    if field_name in type_hints:
        return type_hints[field_name]

    # Infer from values
    for record in records:
        value = record.get(field_name)
        if value is None:
            continue

        if isinstance(value, bool):
            return "boolean"
        if isinstance(value, (int, float)):
            return "number"
        if isinstance(value, list):
            return "multiselect"
        if isinstance(value, dict):
            return "relation"
        if isinstance(value, str):
            # Check for date patterns
            if len(value) == 10 and value[4] == "-" and value[7] == "-":
                return "date"
            if "@" in value and "." in value:
                return "email"

    return "text"


def is_required_field(object_type: str, field_name: str) -> bool:
    """
    Check if a field is required for the object type.
    Based on Salesmap field specifications.

    Note:
    - 담당자(owner): 미입력 시 업로드한 사람이 기본값으로 설정됨
    - RecordId: 기존 레코드 업데이트 시에만 사용 (신규 생성 시 불필요)
    - 고객 여정 단계, 딜/리드 상태: 필수 아님
    """
    required_fields = {
        # 고객 (People) - 이름만 필수
        "people": ["name", "이름"],
        # 회사 (Organization) - 이름만 필수
        "company": ["name", "이름"],
        # 리드 (Lead) - 이름만 필수
        "lead": ["name", "이름"],
        # 딜 (Deal) - 이름만 필수
        "deal": ["name", "이름"],
    }
    return field_name in required_fields.get(object_type, [])


def is_system_field(field_name: str) -> bool:
    """
    Check if a field is a system/read-only field (Import impossible).
    Based on Salesmap field specifications.
    """
    # Exact match system fields
    system_fields = {
        "id", "created_at", "updated_at", "workspace_id",
        "_id", "__v", "createdAt", "updatedAt",
        # Korean system field names
        "수정 날짜", "생성 날짜", "총 매출", "팀",
        "진행중 딜 개수", "완료 TODO", "실패된 딜 개수", "성사된 딜 개수",
        "미완료 TODO", "리드 개수", "딜 개수", "누적 시퀀스 등록수",
        "전체 TODO", "현재 진행중인 시퀀스 여부",
    }

    if field_name in system_fields:
        return True

    # Pattern-based detection (Import impossible patterns)
    system_patterns = [
        "최근 ",      # "최근 ~" - Recent fields (auto-recorded)
        "다음 TODO",  # "다음 TODO ~" - Next TODO (auto-calculated)
    ]

    system_suffixes = [
        " 개수",      # "~ 개수" - Count fields (auto-calculated)
        " 목록",      # "~ 목록" - List fields (auto-recorded)
    ]

    for pattern in system_patterns:
        if field_name.startswith(pattern):
            return True

    for suffix in system_suffixes:
        if field_name.endswith(suffix):
            return True

    return False


def get_default_fields(object_type: str) -> list:
    """
    Get default importable fields when no data is available.
    Based on Salesmap field specifications.

    Note:
    - 담당자(owner): 미입력 시 업로드한 사람이 기본값으로 설정됨 (required=False)
    - RecordId: 기존 레코드 업데이트 시에만 사용 (required=False)
    - 고객 여정 단계, 딜/리드 상태: 필수 아님 (required=False)
    - 파이프라인/단계: 시스템에서 기본값 제공 (required=False)
    """
    defaults = {
        # 고객 (People) - Import 가능 필드
        "people": [
            {"id": "name", "label": "이름", "type": "text", "required": True, "is_system": False, "editable": True},
            {"id": "email", "label": "이메일", "type": "email", "required": False, "is_system": False, "editable": True},
            {"id": "position", "label": "포지션", "type": "text", "required": False, "is_system": False, "editable": True},
            {"id": "profile_image", "label": "프로필 사진", "type": "url", "required": False, "is_system": False, "editable": True},
            {"id": "linkedin", "label": "링크드인", "type": "text", "required": False, "is_system": False, "editable": True},
            {"id": "unsubscribe_reason", "label": "수신 거부 사유", "type": "text", "required": False, "is_system": False, "editable": True},
            {"id": "recordId", "label": "RecordId", "type": "text", "required": False, "is_system": False, "editable": True},
            {"id": "unsubscribed", "label": "수신 거부 여부", "type": "boolean", "required": False, "is_system": False, "editable": True},
            {"id": "source", "label": "소스", "type": "select", "required": False, "is_system": False, "editable": True},
            {"id": "journey_stage", "label": "고객 여정 단계", "type": "select", "required": False, "is_system": False, "editable": True},
            {"id": "owner", "label": "담당자", "type": "user", "required": False, "is_system": False, "editable": True},
            {"id": "customer_group", "label": "고객 그룹", "type": "multiselect", "required": False, "is_system": False, "editable": True},
        ],
        # 회사 (Organization) - Import 가능 필드
        "company": [
            {"id": "name", "label": "이름", "type": "text", "required": True, "is_system": False, "editable": True},
            {"id": "profile_image", "label": "프로필 사진", "type": "url", "required": False, "is_system": False, "editable": True},
            {"id": "address", "label": "주소", "type": "text", "required": False, "is_system": False, "editable": True},
            {"id": "phone", "label": "전화", "type": "text", "required": False, "is_system": False, "editable": True},
            {"id": "website", "label": "웹 주소", "type": "url", "required": False, "is_system": False, "editable": True},
            {"id": "linkedin", "label": "링크드인", "type": "text", "required": False, "is_system": False, "editable": True},
            {"id": "recordId", "label": "RecordId", "type": "text", "required": False, "is_system": False, "editable": True},
            {"id": "employee_count", "label": "직원수", "type": "number", "required": False, "is_system": False, "editable": True},
            {"id": "owner", "label": "담당자", "type": "user", "required": False, "is_system": False, "editable": True},
        ],
        # 리드 (Lead) - Import 가능 필드
        "lead": [
            {"id": "name", "label": "이름", "type": "text", "required": True, "is_system": False, "editable": True},
            {"id": "hold_detail_reason", "label": "보류 상세 사유", "type": "text", "required": False, "is_system": False, "editable": True},
            {"id": "recordId", "label": "RecordId", "type": "text", "required": False, "is_system": False, "editable": True},
            {"id": "amount", "label": "금액", "type": "number", "required": False, "is_system": False, "editable": True},
            {"id": "lead_type", "label": "유형", "type": "select", "required": False, "is_system": False, "editable": True},
            {"id": "status", "label": "상태", "type": "select", "required": False, "is_system": False, "editable": True},
            {"id": "hold_reason", "label": "보류 사유", "type": "select", "required": False, "is_system": False, "editable": True},
            {"id": "expected_date", "label": "수주 예정일", "type": "datetime", "required": False, "is_system": False, "editable": True},
            {"id": "owner", "label": "담당자", "type": "user", "required": False, "is_system": False, "editable": True},
            {"id": "followers", "label": "팔로워", "type": "users", "required": False, "is_system": False, "editable": True},
            {"id": "pipeline", "label": "파이프라인", "type": "pipeline", "required": False, "is_system": False, "editable": True},
            {"id": "pipeline_stage", "label": "파이프라인 단계", "type": "pipeline_stage", "required": False, "is_system": False, "editable": True},
            {"id": "lead_group", "label": "리드 그룹", "type": "multiselect", "required": False, "is_system": False, "editable": True},
            {"id": "main_quote_products", "label": "메인 견적 상품 리스트", "type": "multiselect", "required": False, "is_system": False, "editable": True},
        ],
        # 딜 (Deal) - Import 가능 필드
        "deal": [
            {"id": "name", "label": "이름", "type": "text", "required": True, "is_system": False, "editable": True},
            {"id": "fail_detail_reason", "label": "실패 상세 사유", "type": "text", "required": False, "is_system": False, "editable": True},
            {"id": "recordId", "label": "RecordId", "type": "text", "required": False, "is_system": False, "editable": True},
            {"id": "amount", "label": "금액", "type": "number", "required": False, "is_system": False, "editable": True},
            {"id": "monthly_amount", "label": "월 구독 금액", "type": "number", "required": False, "is_system": False, "editable": True},
            {"id": "status", "label": "상태", "type": "select", "required": False, "is_system": False, "editable": True},
            {"id": "fail_reason", "label": "실패 사유", "type": "multiselect", "required": False, "is_system": False, "editable": True},
            {"id": "subscription_end_type", "label": "구독 종료 유형", "type": "select", "required": False, "is_system": False, "editable": True},
            {"id": "subscription_start_type", "label": "구독 시작 유형", "type": "select", "required": False, "is_system": False, "editable": True},
            {"id": "expected_date", "label": "수주 예정일", "type": "datetime", "required": False, "is_system": False, "editable": True},
            {"id": "close_date", "label": "마감일", "type": "datetime", "required": False, "is_system": False, "editable": True},
            {"id": "subscription_end", "label": "구독 종료일", "type": "datetime", "required": False, "is_system": False, "editable": True},
            {"id": "subscription_start", "label": "구독 시작일", "type": "datetime", "required": False, "is_system": False, "editable": True},
            {"id": "owner", "label": "담당자", "type": "user", "required": False, "is_system": False, "editable": True},
            {"id": "followers", "label": "팔로워", "type": "users", "required": False, "is_system": False, "editable": True},
            {"id": "pipeline", "label": "파이프라인", "type": "pipeline", "required": True, "is_system": False, "editable": True},
            {"id": "pipeline_stage", "label": "파이프라인 단계", "type": "pipeline_stage", "required": True, "is_system": False, "editable": True},
            {"id": "main_quote_products", "label": "메인 견적 상품 리스트", "type": "multiselect", "required": False, "is_system": False, "editable": True},
        ],
    }
    return defaults.get(object_type, [])
