import os
import json
import re
from openai import OpenAI
from typing import Optional
from difflib import SequenceMatcher
from datetime import datetime

# Initialize OpenAI client
client: Optional[OpenAI] = None


def get_openai_client() -> OpenAI:
    global client
    if client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY environment variable is not set")
        client = OpenAI(api_key=api_key)
    return client


def analyze_column_types(data: list[dict], columns: list[str]) -> dict:
    """
    Analyze columns in the data to detect the most appropriate field type.
    Returns a dict mapping column names to recommended field types and metadata.

    Field types:
    - text: General text
    - number: Numeric values
    - email: Email addresses
    - phone: Phone numbers
    - date: Date values
    - datetime: Date with time
    - url: URLs
    - select: Limited set of values (single selection)
    - multiselect: Multiple values (comma-separated)
    - boolean: True/False values
    """
    result = {}

    for col in columns:
        values = [row.get(col) for row in data if row.get(col) is not None and str(row.get(col)).strip()]

        if not values:
            result[col] = {"type": "text", "reason": "빈 값", "unique_count": 0, "sample_values": []}
            continue

        str_values = [str(v).strip() for v in values]
        unique_values = list(set(str_values))
        unique_count = len(unique_values)
        total_count = len(str_values)
        sample_values = unique_values[:5]

        # Initialize detection flags
        detected_type = "text"
        reason = "기본 텍스트"

        # Check for boolean
        bool_patterns = {'true', 'false', 'yes', 'no', '예', '아니오', 'y', 'n', '1', '0', 'o', 'x'}
        lower_values = [v.lower() for v in str_values]
        if unique_count <= 2 and all(v in bool_patterns for v in lower_values):
            detected_type = "boolean"
            reason = f"True/False 형태의 값 (고유값 {unique_count}개)"

        # Check for email
        elif all(re.match(r'^[\w\.-]+@[\w\.-]+\.\w+$', v) for v in str_values):
            detected_type = "email"
            reason = "이메일 형식"

        # Check for phone number
        elif all(re.match(r'^[\d\-\+\(\)\s]{8,}$', v) for v in str_values):
            detected_type = "phone"
            reason = "전화번호 형식"

        # Check for URL
        elif all(re.match(r'^https?://', v) for v in str_values):
            detected_type = "url"
            reason = "URL 형식"

        # Check for date/datetime
        else:
            date_patterns = [
                r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}$',  # 2024-01-15
                r'^\d{1,2}[-/]\d{1,2}[-/]\d{4}$',  # 15-01-2024
                r'^\d{4}년\s*\d{1,2}월\s*\d{1,2}일$',  # 2024년 1월 15일
            ]
            datetime_patterns = [
                r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}\s+\d{1,2}:\d{2}',  # 2024-01-15 14:30
                r'^\d{4}[-/]\d{1,2}[-/]\d{1,2}T\d{1,2}:\d{2}',  # 2024-01-15T14:30
            ]

            is_datetime = all(any(re.match(p, v) for p in datetime_patterns) for v in str_values)
            is_date = all(any(re.match(p, v) for p in date_patterns) for v in str_values)

            if is_datetime:
                detected_type = "datetime"
                reason = "날짜+시간 형식"
            elif is_date:
                detected_type = "date"
                reason = "날짜 형식"

            # Check for number
            elif all(re.match(r'^-?[\d,]+\.?\d*$', v.replace(',', '')) for v in str_values):
                detected_type = "number"
                reason = "숫자 형식"

            # Check for select/multiselect (limited unique values)
            elif unique_count <= 10 and unique_count < total_count * 0.3:
                # Check if values contain comma (multiselect)
                if any(',' in v for v in str_values):
                    detected_type = "multiselect"
                    reason = f"복수 선택 가능 (고유값 {unique_count}개, 쉼표로 구분된 값 포함)"
                else:
                    detected_type = "select"
                    reason = f"제한된 선택 옵션 (고유값 {unique_count}개 / 전체 {total_count}개)"

            # Check for multiselect (comma-separated values)
            elif any(',' in v for v in str_values):
                split_values = []
                for v in str_values:
                    split_values.extend([x.strip() for x in v.split(',')])
                split_unique = len(set(split_values))
                if split_unique <= 20:
                    detected_type = "multiselect"
                    reason = f"복수 선택 (쉼표 구분, 개별 옵션 {split_unique}개)"

        result[col] = {
            "type": detected_type,
            "reason": reason,
            "unique_count": unique_count,
            "total_count": total_count,
            "sample_values": sample_values
        }

    return result


def parse_thinking_response(content: str) -> dict:
    """
    Parse AI response that contains <thinking> tags.
    Returns dict with 'thinking' and 'result' keys.
    """
    thinking = ""
    result_content = content

    # Extract thinking content
    thinking_match = re.search(r'<thinking>(.*?)</thinking>', content, re.DOTALL)
    if thinking_match:
        thinking = thinking_match.group(1).strip()
        result_content = re.sub(r'<thinking>.*?</thinking>', '', content, flags=re.DOTALL).strip()

    # Try to parse JSON from result
    try:
        # Find JSON in the result content
        json_match = re.search(r'\{[\s\S]*\}', result_content)
        if json_match:
            result = json.loads(json_match.group())
        else:
            result = {}
    except json.JSONDecodeError:
        result = {}

    return {
        "thinking": thinking,
        "result": result
    }


# Field mapping definitions for reference
SALESMAP_FIELDS = {
    "company": {
        "name": "Organization",
        "fields": [
            {"id": "name", "label": "이름", "description": "회사명, 조직명"},
            {"id": "employee_count", "label": "직원 수", "description": "직원 수, 인원"},
            {"id": "address", "label": "주소", "description": "회사 주소, 위치"},
            {"id": "phone", "label": "전화번호", "description": "회사 전화번호, 대표번호"},
            {"id": "website", "label": "웹 주소", "description": "웹사이트, 홈페이지 URL"},
            {"id": "owner", "label": "담당자", "description": "담당 영업사원"},
        ]
    },
    "people": {
        "name": "People",
        "fields": [
            {"id": "name", "label": "이름", "description": "고객명, 연락처 이름, 성명"},
            {"id": "email", "label": "이메일", "description": "이메일 주소"},
            {"id": "phone", "label": "전화번호", "description": "휴대폰, 연락처"},
            {"id": "position", "label": "포지션", "description": "직급, 직책, 역할"},
            {"id": "company", "label": "소속 회사", "description": "회사명, 소속"},
            {"id": "owner", "label": "담당자", "description": "담당 영업사원"},
        ]
    },
    "lead": {
        "name": "Lead",
        "fields": [
            {"id": "name", "label": "이름", "description": "리드명, 제목"},
            {"id": "status", "label": "상태", "description": "리드 상태, 진행상태"},
            {"id": "amount", "label": "금액", "description": "예상 금액, 거래액"},
            {"id": "pipeline", "label": "파이프라인", "description": "영업 파이프라인"},
            {"id": "pipeline_stage", "label": "파이프라인 단계", "description": "현재 단계"},
            {"id": "people_name", "label": "연결된 고객 이름", "description": "고객 이름 (필수: 회사 또는 고객 중 하나)"},
            {"id": "company_name", "label": "연결된 회사 이름", "description": "회사 이름 (필수: 회사 또는 고객 중 하나)"},
            {"id": "owner", "label": "담당자", "description": "담당 영업사원"},
        ]
    },
    "deal": {
        "name": "Deal",
        "fields": [
            {"id": "name", "label": "이름", "description": "딜명, 거래명"},
            {"id": "status", "label": "상태", "description": "딜 상태"},
            {"id": "amount", "label": "금액", "description": "거래 금액"},
            {"id": "pipeline", "label": "파이프라인", "description": "영업 파이프라인"},
            {"id": "pipeline_stage", "label": "파이프라인 단계", "description": "현재 단계"},
            {"id": "people_name", "label": "연결된 고객 이름", "description": "고객 이름 (필수: 회사 또는 고객 중 하나)"},
            {"id": "company_name", "label": "연결된 회사 이름", "description": "회사 이름 (필수: 회사 또는 고객 중 하나)"},
            {"id": "owner", "label": "담당자", "description": "담당 영업사원"},
        ]
    }
}


async def auto_map_fields(
    source_columns: list[str],
    sample_data: list[dict],
    target_object_types: list[str],
    available_fields: list = None
) -> dict:
    """
    Use AI with Chain-of-Thought to automatically map source columns to CRM fields.
    Returns mapping results with AI's reasoning process.
    """
    # Build field options for the prompt
    field_options = []

    if available_fields:
        for field_info in available_fields:
            field_options.append({
                "key": field_info.get("key", ""),
                "label": field_info.get("label", ""),
                "description": field_info.get("description", field_info.get("label", ""))
            })
    else:
        for obj_type in target_object_types:
            if obj_type in SALESMAP_FIELDS:
                obj_info = SALESMAP_FIELDS[obj_type]
                for field in obj_info["fields"]:
                    field_options.append({
                        "key": f"{obj_type}.{field['id']}",
                        "label": f"{obj_info['name']} - {field['label']}",
                        "description": field["description"]
                    })

    # Prepare sample data for context
    sample_str = ""
    for col in source_columns[:15]:
        values = [str(row.get(col, ""))[:50] for row in sample_data[:5] if row.get(col)]
        if values:
            sample_str += f"- {col}: {', '.join(values)}\n"

    prompt = f"""당신은 CRM 데이터 매핑 전문가입니다. 사용자가 업로드한 파일의 컬럼을 Salesmap CRM 필드에 매핑해야 합니다.

## 소스 컬럼 (업로드된 파일)
{', '.join(source_columns)}

## 샘플 데이터
{sample_str}

## 타겟 CRM 필드
{json.dumps(field_options, ensure_ascii=False, indent=2)}

## 분석 과정
각 컬럼을 분석하며 아래 과정을 <thinking> 태그 안에 상세히 작성하세요.

<thinking>
각 소스 컬럼을 하나씩 분석합니다:

[컬럼명]
1. 컬럼명 해석: 이 이름이 무엇을 의미하는가?
2. 샘플 데이터 분석:
   - 데이터 형태: 텍스트/숫자/날짜/이메일/전화번호 등
   - 값의 패턴과 예시가 말해주는 것
3. 후보 타겟 필드 (1순위, 2순위)
4. 최종 선택과 신뢰도 (0.0-1.0)
5. 선택 근거

(모든 컬럼에 대해 반복)

### 매핑 요약
- 높은 신뢰도 매핑: ...
- 낮은 신뢰도 매핑: ...
- 매핑 불가 컬럼: ...
</thinking>

분석을 완료한 후, 아래 JSON 형식으로 결과를 정리하세요:
{{
  "mappings": {{
    "소스컬럼명": "object_type.field_id 또는 null"
  }},
  "confidence": {{
    "소스컬럼명": 0.0-1.0
  }},
  "reasoning": {{
    "소스컬럼명": "매핑 근거 한 줄 요약"
  }}
}}"""

    try:
        openai_client = get_openai_client()
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a CRM data mapping expert. First show your thinking process in <thinking> tags, then provide the JSON result."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=4000
        )

        content = response.choices[0].message.content
        parsed = parse_thinking_response(content)

        result = parsed["result"]
        result["thinking"] = parsed["thinking"]

        return result
    except Exception as e:
        print(f"AI mapping error: {e}")
        return {"mappings": {}, "confidence": {}, "error": str(e)}


def similarity_ratio(a: str, b: str) -> float:
    """Calculate similarity ratio between two strings."""
    if not a or not b:
        return 0.0
    a_lower = str(a).lower().strip()
    b_lower = str(b).lower().strip()
    return SequenceMatcher(None, a_lower, b_lower).ratio()


async def detect_duplicates(
    data: list[dict],
    field_mappings: list[dict],
    threshold: float = 0.85
) -> list[dict]:
    """
    Detect potential duplicate records in the data using string similarity.
    """
    duplicates = []

    # Find key fields for comparison (name, email, company name)
    key_fields = []
    for mapping in field_mappings:
        target = mapping.get("target_field", "")
        source = mapping.get("source_column", "")
        if any(x in target for x in ["name", "email"]):
            key_fields.append({"source": source, "target": target, "weight": 1.0 if "email" in target else 0.8})

    if not key_fields:
        return []

    # Compare each pair of rows
    checked_pairs = set()

    for i, row1 in enumerate(data):
        for j, row2 in enumerate(data):
            if i >= j:
                continue

            pair_key = (min(i, j), max(i, j))
            if pair_key in checked_pairs:
                continue
            checked_pairs.add(pair_key)

            # Calculate weighted similarity
            total_similarity = 0
            total_weight = 0
            field_similarities = {}

            for field_info in key_fields:
                source = field_info["source"]
                weight = field_info["weight"]

                val1 = row1.get(source, "")
                val2 = row2.get(source, "")

                if val1 and val2:
                    sim = similarity_ratio(val1, val2)
                    field_similarities[source] = sim
                    total_similarity += sim * weight
                    total_weight += weight

            if total_weight > 0:
                avg_similarity = total_similarity / total_weight

                if avg_similarity >= threshold:
                    duplicates.append({
                        "row1": i + 1,
                        "row2": j + 1,
                        "similarity": round(avg_similarity, 2),
                        "field_similarities": field_similarities,
                        "data1": {k: str(v)[:50] for k, v in row1.items() if v},
                        "data2": {k: str(v)[:50] for k, v in row2.items() if v}
                    })

    duplicates.sort(key=lambda x: x["similarity"], reverse=True)
    return duplicates[:50]


async def consulting_chat(
    messages: list[dict],
    is_summary_request: bool = False,
    file_context: dict = None
) -> dict:
    """
    AI-powered consulting chat for B2B CRM data import.
    """
    system_prompt = """당신은 B2B CRM 데이터 관리 컨설턴트입니다.
사용자가 세일즈맵(Salesmap)에 데이터를 임포트하려고 합니다.
사용자의 비즈니스 유형과 데이터 관리 요구사항을 파악하여 적절한 오브젝트(회사, 고객, 리드, 딜)와 필드를 추천해주세요.

## 오브젝트 설명
- 회사(Company): B2B 거래처, 조직 정보
- 고객(People): 개인 연락처, 담당자 정보
- 리드(Lead): 잠재 영업 기회, 초기 상담
- 딜(Deal): 진행 중인 거래, 계약

## 주요 질문 포인트
1. 어떤 사업을 하시나요? (B2B/B2C, 업종)
2. 현재 어떤 데이터를 관리하고 계신가요?
3. 어떤 목적으로 데이터를 임포트하시나요?
4. 기존에 CRM을 사용하셨나요?

## 응답 형식
- 마크다운 문법을 사용하지 마세요 (**, ##, ``` 등 금지)
- 일반 텍스트로만 응답하세요
- 친근하고 전문적인 톤으로 대화하세요
- 한국어로 답변하세요"""

    # Analyze column types if file context is provided
    column_type_analysis = None
    if file_context:
        columns = file_context.get('columns', [])
        sample_data = file_context.get('sample_data', [])
        if columns and sample_data:
            column_type_analysis = analyze_column_types(sample_data, columns)

        file_info = f"""

## 업로드된 파일 정보
- 파일명: {file_context.get('filename', 'Unknown')}
- 컬럼: {', '.join(file_context.get('columns', [])[:10])}
- 총 행 수: {file_context.get('total_rows', 0)}
- 샘플 데이터: {json.dumps(file_context.get('sample_data', [])[:3], ensure_ascii=False)}"""

        if column_type_analysis:
            file_info += f"""

## 컬럼별 필드 유형 분석 결과
{json.dumps(column_type_analysis, ensure_ascii=False, indent=2)}

### 필드 유형 설명
- text: 일반 텍스트
- number: 숫자 (금액, 수량 등)
- email: 이메일 주소
- phone: 전화번호
- date: 날짜 (YYYY-MM-DD)
- datetime: 날짜+시간
- url: URL 주소
- select: 단일 선택 (제한된 옵션)
- multiselect: 복수 선택 (쉼표로 구분)
- boolean: True/False"""
        system_prompt += file_info

    if is_summary_request:
        system_prompt += """

## 요약 요청
대화 내용을 바탕으로 다음 JSON 형식으로 추천을 생성하세요.

### 세일즈맵 데이터 이관 필수 규칙 (반드시 준수!)

#### 1. 오브젝트별 필수 필드
- People (고객): "이름" 필드 필수
- Organization (회사): "이름" 필드 필수
- Lead (리드): "이름" 필드 필수 + 반드시 "연결된 고객 이름" 또는 "연결된 회사 이름" 중 하나 이상 필요
- Deal (딜): "이름" 필드 필수 + 반드시 "연결된 고객 이름" 또는 "연결된 회사 이름" 중 하나 이상 필요

#### 2. 딜/리드의 연결 관계 (매우 중요!)
- 딜 또는 리드를 가져올 때 고객(People) 또는 회사(Organization)와 연결이 필수입니다
- 연결 방법: 파일에 고객 이름이나 회사 이름 컬럼이 있어야 합니다
- 딜/리드를 추천할 때는 반드시 people 또는 company도 함께 추천해야 합니다

#### 3. 필드 이름 규칙
- 각 필드는 "오브젝트명 - 필드명" 형식으로 매핑됩니다
- 예: "People - 이름", "Organization - 이름", "Deal - 파이프라인", "Lead - 상태"

### 컬럼 분석 원칙 (매우 중요!)

#### 배타적 분류 규칙
- 각 컬럼은 columns_to_keep 또는 columns_to_skip 중 하나에만 포함되어야 합니다
- 절대로 같은 컬럼이 두 리스트에 동시에 나타나면 안됩니다
- columns_to_keep + columns_to_skip = 전체 컬럼 수가 되어야 합니다

#### 유지 대상 컬럼 (columns_to_keep - 적극적으로 유지):
- 고객/회사 정보 (이름, 연락처, 이메일, 주소 등)
- 비즈니스 데이터 (금액, 상태, 날짜, 메모 등)
- 분류/태그 정보 (유형, 그룹, 카테고리 등)
- 사용자가 직접 입력한 모든 데이터
- 딜/리드 연결용 고객명, 회사명 컬럼

#### 제외 대상 컬럼 (columns_to_skip - 명확한 경우에만):
- 시스템 내부용 ID (auto-increment, UUID 등 의미 없는 식별자)
- 완전히 빈 컬럼 (모든 값이 null/빈값)
- 중복 컬럼 (동일한 데이터가 다른 이름으로 존재)
- 임시/테스트 데이터 컬럼

### 필드 유형 추천 규칙
- 값이 제한된 경우 (10개 이하의 반복되는 값) → select (단일 선택)
- 쉼표로 구분된 복수 값이 있는 경우 → multiselect (복수 선택)
- 숫자만 있는 경우 → number
- 날짜 형식인 경우 → date 또는 datetime
- 이메일 형식 → email
- 전화번호 형식 → phone
- True/False, 예/아니오 등 → boolean
- 그 외 → text

{
  "summary": "사용자 비즈니스 요약 (1-2문장)",
  "recommended_objects": ["people", "deal"],
  "recommended_fields": [
    {
      "object_type": "people",
      "field_id": "customer_group",
      "field_label": "고객 그룹",
      "field_type": "select",
      "field_type_reason": "5개의 고정된 그룹 값만 존재",
      "reason": "추천 이유"
    }
  ],
  "column_analysis": {
    "total_columns": 10,
    "columns_to_keep": [
      {
        "column_name": "고객명",
        "recommended_type": "text",
        "target_object": "people",
        "target_field": "name",
        "reason": "고객 이름 - 필수 정보"
      }
    ],
    "columns_to_skip": [
      {
        "column_name": "row_id",
        "reason": "시스템 자동생성 ID - CRM에서 새로 생성됨"
      }
    ]
  },
  "confirmation_message": "위 내용이 맞으시면 확인을 눌러주세요. 제외 컬럼이 있다면 확인해주세요."
}

### 검증 체크리스트 (JSON 출력 전 확인)
1. columns_to_keep과 columns_to_skip에 중복된 컬럼이 없는가?
2. 딜/리드를 추천하면 people 또는 company도 함께 추천했는가?
3. 딜/리드 추천 시 연결용 필드(연결된 고객 이름 또는 연결된 회사 이름)가 recommended_fields에 있는가?

JSON만 응답하세요."""

    try:
        openai_client = get_openai_client()

        all_messages = [{"role": "system", "content": system_prompt}]
        all_messages.extend(messages)

        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=all_messages,
            temperature=0.7 if not is_summary_request else 0.3,
            response_format={"type": "json_object"} if is_summary_request else None
        )

        content = response.choices[0].message.content

        if is_summary_request:
            try:
                data = json.loads(content)
                return {
                    "type": "summary",
                    "content": None,
                    "data": data
                }
            except json.JSONDecodeError:
                return {
                    "type": "message",
                    "content": content,
                    "data": None
                }
        else:
            return {
                "type": "message",
                "content": content,
                "data": None
            }

    except Exception as e:
        print(f"Consulting chat error: {e}")
        return {
            "type": "error",
            "content": f"AI 응답 오류: {str(e)}",
            "data": None
        }


async def ai_detect_duplicates(
    data: list[dict],
    field_mappings: list[dict],
    threshold: float = 0.7
) -> list[dict]:
    """
    Use AI with Chain-of-Thought to detect semantic duplicates.
    Returns duplicate analysis with AI's reasoning process.
    """
    # First, run basic duplicate detection
    basic_duplicates = await detect_duplicates(data, field_mappings, threshold=threshold)

    if not basic_duplicates:
        return []

    # Use AI to analyze ambiguous cases
    ambiguous_cases = [d for d in basic_duplicates if threshold <= d["similarity"] < 0.95]

    if not ambiguous_cases:
        return basic_duplicates

    cases_for_ai = ambiguous_cases[:10]

    prompt = f"""당신은 데이터 품질 전문가입니다.

## 잠재적 중복 레코드
{json.dumps(cases_for_ai, ensure_ascii=False, indent=2)}

## 중복 판단 과정
각 후보 쌍에 대해 분석하세요.

<thinking>
### 후보 쌍 분석

각 쌍에 대해:

Row {{row1}} vs Row {{row2}}

1. 필드별 비교:
   - 이름: "{{name1}}" vs "{{name2}}" → 동일인/다른 사람/불확실
   - 이메일: 도메인이 같은가? 아이디 패턴이 유사한가?
   - 회사: (주), 주식회사 등 변형 고려

2. 종합 판단:
   - 결론: 중복이다 / 중복 아니다 / 확인 필요
   - 신뢰도: 0.0-1.0
   - 핵심 근거

3. 추천 액션:
   - 병합 / 개별 유지 / 사용자 확인

(모든 쌍에 대해 반복)

### 분석 요약
- 확실한 중복: N개
- 가능성 높은 중복: N개
- 검토 필요: N개
</thinking>

분석 완료 후 JSON 결과:
{{
  "analysis": [
    {{
      "row1": number,
      "row2": number,
      "is_duplicate": true/false,
      "confidence": 0.0-1.0,
      "reason": "판단 근거 요약",
      "recommended_action": "merge/keep_separate/needs_review"
    }}
  ],
  "summary": {{
    "confirmed_duplicates": number,
    "likely_duplicates": number,
    "needs_review": number
  }}
}}"""

    try:
        openai_client = get_openai_client()
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a data quality expert. First show your thinking process in <thinking> tags, then provide the JSON result."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=4000
        )

        content = response.choices[0].message.content
        parsed = parse_thinking_response(content)

        ai_result = parsed["result"]
        thinking = parsed["thinking"]

        # Merge AI analysis with basic results
        ai_analysis_map = {
            (a["row1"], a["row2"]): a
            for a in ai_result.get("analysis", [])
        }

        for dup in basic_duplicates:
            key = (dup["row1"], dup["row2"])
            if key in ai_analysis_map:
                dup["ai_analysis"] = ai_analysis_map[key]

        # Add thinking to the first result for UI display
        if basic_duplicates:
            basic_duplicates[0]["ai_thinking"] = thinking

        return basic_duplicates

    except Exception as e:
        print(f"AI duplicate detection error: {e}")
        return basic_duplicates


async def analyze_data_quality(
    data: list[dict],
    field_mappings: list[dict],
    object_types: list[str]
) -> dict:
    """
    Use AI with Chain-of-Thought to analyze data quality before import.
    Returns quality analysis with AI's reasoning process.
    """
    # Prepare data summary
    sample_data = data[:10]
    total_rows = len(data)

    # Get mapped columns
    mapped_fields = {m["source_column"]: m["target_field"] for m in field_mappings}

    prompt = f"""당신은 CRM 데이터 품질 검증 전문가입니다.

## 데이터 개요
- 총 행 수: {total_rows}
- 오브젝트 유형: {', '.join(object_types)}
- 매핑된 필드: {json.dumps(mapped_fields, ensure_ascii=False)}

## 샘플 데이터 (처음 10행)
{json.dumps(sample_data, ensure_ascii=False, indent=2)}

## 검증 과정

<thinking>
### 1. 필수 필드 검증
각 오브젝트별 필수 필드 확인:
- company: name 필수
- people: name 필수
- lead: name 필수, people_name 또는 company_name 중 하나 필수
- deal: name 필수, people_name 또는 company_name 중 하나 필수

Row by row 검사 (샘플 기준):
- Row 1: [✅/❌] 필수 필드 상태
- Row 2: ...

### 2. 형식 검증
- 이메일: xxx@xxx.xxx 형식 확인
- 전화번호: 숫자와 하이픈만 있는지
- URL: http/https로 시작하는지
- 날짜: 유효한 날짜 형식인지

발견된 형식 오류:
- Row N의 "필드명": "값" → 오류 유형

### 3. 데이터 일관성
- 동일 필드의 값들이 일관된 형식인지
- 이상치나 의심되는 값
- 빈 값의 비율

### 4. 잠재적 문제
- 마이그레이션 시 발생할 수 있는 이슈
- 자동 수정 가능한 항목
- 사용자 확인이 필요한 항목

### 5. 최종 판정
- 정상: N개 (N%)
- 오류: N개 (import 불가)
- 경고: N개 (import 가능하나 확인 권장)
</thinking>

검증 결과 JSON:
{{
  "validation_passed": true/false,
  "summary": {{
    "total_rows": number,
    "valid_rows": number,
    "error_rows": number,
    "warning_rows": number
  }},
  "errors": [
    {{
      "row": number,
      "field": "필드명",
      "value": "현재값",
      "message": "오류 메시지",
      "severity": "error"
    }}
  ],
  "warnings": [
    {{
      "row": number,
      "field": "필드명",
      "value": "현재값",
      "message": "경고 메시지",
      "severity": "warning"
    }}
  ],
  "auto_fixable": [
    {{
      "row": number,
      "field": "필드명",
      "current": "현재값",
      "suggested": "수정 제안",
      "fix_type": "format_phone/format_email/trim_whitespace"
    }}
  ],
  "recommendations": ["전반적인 개선 권장사항"]
}}"""

    try:
        openai_client = get_openai_client()
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a data quality expert. First show your thinking process in <thinking> tags, then provide the JSON result."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.2,
            max_tokens=4000
        )

        content = response.choices[0].message.content
        parsed = parse_thinking_response(content)

        result = parsed["result"]
        result["thinking"] = parsed["thinking"]

        return result
    except Exception as e:
        print(f"Data quality analysis error: {e}")
        return {
            "validation_passed": True,
            "summary": {"total_rows": len(data), "valid_rows": len(data), "error_rows": 0, "warning_rows": 0},
            "errors": [],
            "warnings": [],
            "error": str(e)
        }
