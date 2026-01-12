"""
세일즈맵 상수 및 필드 정의
오브젝트별 시스템 필드, 필수 조건, 유효성 규칙
"""
from typing import Optional
from dataclasses import dataclass, field


# ============================================================================
# 오브젝트 메타데이터
# ============================================================================

OBJECT_NAMES = {
    "people": "고객",
    "company": "회사",
    "deal": "딜",
    "lead": "리드",
}

OBJECT_DESCRIPTIONS = {
    "people": "개인 고객 정보 (연락처, 소속 등)",
    "company": "회사/조직 정보",
    "deal": "영업 기회 - 계약 협상 단계의 잠재 거래",
    "lead": "리드 - 마케팅 단계의 잠재 고객",
}


# ============================================================================
# 오브젝트별 필수 조건
# ============================================================================

# 필수 필드 (반드시 값이 있어야 함)
REQUIRED_FIELDS = {
    "people": ["name"],  # 이름 필수
    "company": ["name"],  # 회사명 필수
    "deal": ["name", "pipeline"],  # 딜 이름, 파이프라인 필수
    "lead": ["name"],  # 리드 이름 필수
}

# 유니크 필드 (중복 불가)
UNIQUE_FIELDS = {
    "people": ["email"],  # 이메일은 고유해야 함
    "company": [],
    "deal": [],
    "lead": ["email"],  # 리드 이메일도 고유
}

# 연결 필수 조건
CONNECTION_REQUIREMENTS = {
    "deal": ["people", "company"],  # 딜은 고객 또는 회사와 연결 필요
    "lead": ["people", "company"],  # 리드도 고객 또는 회사와 연결 필요
}


# ============================================================================
# 시스템 필드 정의
# ============================================================================

@dataclass
class SystemField:
    """시스템 필드 정보"""
    id: str
    label: str
    field_type: str
    required: bool = False
    unique: bool = False
    editable: bool = True
    description: str = ""


# 고객(People) 시스템 필드
PEOPLE_SYSTEM_FIELDS = [
    SystemField("name", "이름", "text", required=True, description="고객 이름"),
    SystemField("email", "이메일", "email", unique=True, description="이메일 주소"),
    SystemField("phone", "전화번호", "phone", description="전화번호"),
    SystemField("mobile", "휴대폰", "phone", description="휴대폰 번호"),
    SystemField("position", "직함", "text", description="직책/직함"),
    SystemField("department", "부서", "text", description="소속 부서"),
    SystemField("company", "회사", "text", description="소속 회사명"),
    SystemField("address", "주소", "text", description="주소"),
    SystemField("memo", "메모", "textarea", description="메모"),
    SystemField("owner", "담당자", "user", editable=True, description="담당 영업사원"),
    SystemField("tags", "태그", "multiselect", description="태그"),
    SystemField("created_at", "생성일", "datetime", editable=False, description="생성 일시"),
    SystemField("updated_at", "수정일", "datetime", editable=False, description="수정 일시"),
]

# 회사(Company) 시스템 필드
COMPANY_SYSTEM_FIELDS = [
    SystemField("name", "회사명", "text", required=True, description="회사 이름"),
    SystemField("domain", "도메인", "url", description="회사 웹사이트"),
    SystemField("industry", "산업", "select", description="업종"),
    SystemField("employee_count", "직원수", "number", description="직원 수"),
    SystemField("address", "주소", "text", description="회사 주소"),
    SystemField("phone", "대표전화", "phone", description="대표 전화번호"),
    SystemField("memo", "메모", "textarea", description="메모"),
    SystemField("owner", "담당자", "user", editable=True, description="담당 영업사원"),
    SystemField("tags", "태그", "multiselect", description="태그"),
    SystemField("created_at", "생성일", "datetime", editable=False, description="생성 일시"),
    SystemField("updated_at", "수정일", "datetime", editable=False, description="수정 일시"),
]

# 딜(Deal) 시스템 필드
DEAL_SYSTEM_FIELDS = [
    SystemField("name", "딜 이름", "text", required=True, description="딜/거래 이름"),
    SystemField("pipeline", "파이프라인", "select", required=True, description="영업 파이프라인"),
    SystemField("stage", "단계", "select", description="영업 단계"),
    SystemField("amount", "금액", "number", description="예상 거래 금액"),
    SystemField("currency", "통화", "select", description="통화 단위"),
    SystemField("probability", "확률", "number", description="성사 확률 (%)"),
    SystemField("expected_close_date", "예상 마감일", "date", description="예상 계약 일자"),
    SystemField("actual_close_date", "실제 마감일", "date", description="실제 계약 일자"),
    SystemField("status", "상태", "select", description="딜 상태 (진행/성공/실패)"),
    SystemField("source", "유입경로", "select", description="고객 유입 경로"),
    SystemField("memo", "메모", "textarea", description="메모"),
    SystemField("owner", "담당자", "user", editable=True, description="담당 영업사원"),
    SystemField("tags", "태그", "multiselect", description="태그"),
    SystemField("created_at", "생성일", "datetime", editable=False, description="생성 일시"),
    SystemField("updated_at", "수정일", "datetime", editable=False, description="수정 일시"),
]

# 리드(Lead) 시스템 필드
LEAD_SYSTEM_FIELDS = [
    SystemField("name", "리드 이름", "text", required=True, description="리드 이름"),
    SystemField("email", "이메일", "email", unique=True, description="이메일 주소"),
    SystemField("phone", "전화번호", "phone", description="전화번호"),
    SystemField("company", "회사", "text", description="소속 회사"),
    SystemField("position", "직함", "text", description="직책"),
    SystemField("source", "유입경로", "select", description="리드 획득 경로"),
    SystemField("status", "상태", "select", description="리드 상태"),
    SystemField("score", "점수", "number", description="리드 스코어"),
    SystemField("memo", "메모", "textarea", description="메모"),
    SystemField("owner", "담당자", "user", editable=True, description="담당자"),
    SystemField("tags", "태그", "multiselect", description="태그"),
    SystemField("created_at", "생성일", "datetime", editable=False, description="생성 일시"),
    SystemField("updated_at", "수정일", "datetime", editable=False, description="수정 일시"),
]

# 오브젝트별 시스템 필드 매핑
SYSTEM_FIELDS = {
    "people": PEOPLE_SYSTEM_FIELDS,
    "company": COMPANY_SYSTEM_FIELDS,
    "deal": DEAL_SYSTEM_FIELDS,
    "lead": LEAD_SYSTEM_FIELDS,
}


# ============================================================================
# 필드 타입별 검증 규칙
# ============================================================================

FIELD_TYPE_PATTERNS = {
    "email": r'^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$',
    "phone": r'^[\d\-\+\(\)\s]+$',
    "url": r'^https?://[^\s]+$',
    "number": r'^-?\d+\.?\d*$',
    "date": r'^\d{4}-\d{2}-\d{2}$',
    "datetime": r'^\d{4}-\d{2}-\d{2}[T\s]\d{2}:\d{2}',
}

FIELD_TYPE_NORMALIZERS = {
    "phone": lambda x: ''.join(c for c in str(x) if c.isdigit() or c in '+-'),
    "email": lambda x: str(x).lower().strip(),
    "url": lambda x: str(x).strip() if str(x).startswith(('http://', 'https://')) else f'https://{str(x).strip()}',
    "number": lambda x: float(str(x).replace(',', '').replace(' ', '')),
    "date": lambda x: str(x)[:10] if len(str(x)) >= 10 else str(x),
}


# ============================================================================
# 컬럼 분류 규칙
# ============================================================================

# 제외할 컬럼 패턴 (정규식)
SKIP_COLUMN_PATTERNS = [
    r'^id$',
    r'^_id$',
    r'.*_id$',
    r'^seq$',
    r'^no$',
    r'^index$',
    r'^row_?num',
    r'^created_?at$',
    r'^updated_?at$',
    r'^deleted_?at$',
    r'^modified_?at$',
]

# 빈 값으로 간주할 값들
EMPTY_VALUES = ['', None, 'null', 'NULL', 'None', 'N/A', 'n/a', '-', '--']

# 최소 유지 비율 (90%)
MIN_KEEP_RATIO = 0.9

# 최대 제외 컬럼 수
MAX_SKIP_COLUMNS = 3


# ============================================================================
# 헬퍼 함수
# ============================================================================

def get_system_fields(object_type: str) -> list[SystemField]:
    """오브젝트의 시스템 필드 목록 반환"""
    return SYSTEM_FIELDS.get(object_type, [])


def get_required_fields(object_type: str) -> list[str]:
    """오브젝트의 필수 필드 ID 목록 반환"""
    return REQUIRED_FIELDS.get(object_type, [])


def get_unique_fields(object_type: str) -> list[str]:
    """오브젝트의 유니크 필드 ID 목록 반환"""
    return UNIQUE_FIELDS.get(object_type, [])


def get_object_name(object_type: str) -> str:
    """오브젝트 타입의 한글 이름 반환"""
    return OBJECT_NAMES.get(object_type, object_type)


def get_connection_requirements(object_type: str) -> list[str]:
    """오브젝트의 연결 필수 조건 반환"""
    return CONNECTION_REQUIREMENTS.get(object_type, [])


def is_value_empty(value) -> bool:
    """값이 빈 값인지 확인"""
    if value is None:
        return True
    str_value = str(value).strip()
    return str_value in EMPTY_VALUES or len(str_value) == 0


def format_field_label(object_type: str, field_name: str) -> str:
    """필드 라벨을 '오브젝트 - 필드명' 형식으로 포맷"""
    obj_name = get_object_name(object_type)
    return f"{obj_name} - {field_name}"


def parse_field_label(label: str) -> tuple[Optional[str], str]:
    """
    '오브젝트 - 필드명' 형식의 라벨을 파싱
    Returns: (object_name, field_name) 또는 (None, label)
    """
    if ' - ' in label:
        parts = label.split(' - ', 1)
        return parts[0], parts[1]
    return None, label


def find_system_field(object_type: str, field_id_or_label: str) -> Optional[SystemField]:
    """시스템 필드 찾기 (ID 또는 라벨로)"""
    fields = get_system_fields(object_type)
    for f in fields:
        if f.id == field_id_or_label or f.label == field_id_or_label:
            return f
    return None
