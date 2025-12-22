import os
import json
from pathlib import Path
from openai import OpenAI
from typing import Optional
from difflib import SequenceMatcher
from dotenv import load_dotenv

# Load .env file from backend directory
env_path = Path(__file__).parent.parent.parent / ".env"
load_dotenv(env_path)

# Initialize OpenAI client
client: Optional[OpenAI] = None


def get_openai_client() -> OpenAI:
    global client
    if client is None:
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY environment variable is not set. Create a .env file in the backend folder with: OPENAI_API_KEY=your_key_here")
        client = OpenAI(api_key=api_key)
    return client


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
    "contact": {
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
            {"id": "owner", "label": "담당자", "description": "담당 영업사원"},
        ]
    }
}


async def auto_map_fields(
    source_columns: list[str],
    sample_data: list[dict],
    target_object_types: list[str],
    available_fields: list[dict] = None
) -> dict[str, str]:
    """
    Use AI to automatically map source columns to CRM fields.

    Args:
        source_columns: List of column names from uploaded file
        sample_data: Sample rows from the uploaded file
        target_object_types: List of object types selected by user
        available_fields: List of actual fields from Salesmap API (optional)

    Returns:
        Dictionary mapping source column -> target field (e.g., "이름" -> "contact.name")
    """
    # Build field options for the prompt
    field_options = []

    # Use available_fields if provided, otherwise fall back to hardcoded fields
    if available_fields:
        for field in available_fields:
            field_options.append({
                "key": field.get("key", f"{field.get('object_type', '')}.{field.get('id', '')}"),
                "label": field.get("label", field.get("id", "")),
                "description": field.get("description", field.get("label", ""))
            })
    else:
        # Fallback to hardcoded fields
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
    for col in source_columns[:10]:  # Limit columns
        values = [str(row.get(col, ""))[:50] for row in sample_data[:3] if row.get(col)]
        if values:
            sample_str += f"- {col}: {', '.join(values)}\n"

    prompt = f"""당신은 CRM 데이터 매핑 전문가입니다. 사용자가 업로드한 파일의 컬럼을 Salesmap CRM 필드에 매핑해야 합니다.

## 소스 컬럼 (업로드된 파일)
{', '.join(source_columns)}

## 샘플 데이터
{sample_str}

## 타겟 CRM 필드
{json.dumps(field_options, ensure_ascii=False, indent=2)}

## 작업
각 소스 컬럼을 가장 적합한 CRM 필드에 매핑하세요.
컬럼명과 샘플 데이터를 분석하여 의미적으로 가장 잘 맞는 필드를 선택하세요.
매핑이 불확실하면 null로 표시하세요.

JSON 형식으로만 응답하세요:
{{
  "mappings": {{
    "소스컬럼명": "object_type.field_id 또는 null",
    ...
  }},
  "confidence": {{
    "소스컬럼명": 0.0-1.0 (신뢰도),
    ...
  }}
}}"""

    try:
        openai_client = get_openai_client()
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a CRM data mapping expert. Respond only with valid JSON."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            response_format={"type": "json_object"}
        )

        result = json.loads(response.choices[0].message.content)
        return result
    except Exception as e:
        print(f"AI mapping error: {e}")
        # Fallback to simple rule-based mapping
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
    Detect potential duplicate records in the data.

    Args:
        data: List of data rows
        field_mappings: Field mappings to know which fields to compare
        threshold: Similarity threshold (0-1) for considering as duplicate

    Returns:
        List of duplicate groups with row indices and similarity scores
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
            if i >= j:  # Skip same row and already checked pairs
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
                        "row1": i + 1,  # 1-indexed for display
                        "row2": j + 1,
                        "similarity": round(avg_similarity, 2),
                        "field_similarities": field_similarities,
                        "data1": {k: str(v)[:50] for k, v in row1.items() if v},
                        "data2": {k: str(v)[:50] for k, v in row2.items() if v}
                    })

    # Sort by similarity (highest first)
    duplicates.sort(key=lambda x: x["similarity"], reverse=True)

    return duplicates[:50]  # Limit to top 50 duplicates


async def consulting_chat(
    messages: list[dict],
    is_summary_request: bool = False,
    file_context: dict = None
) -> dict:
    """
    AI-powered consulting chat for B2B CRM data import.

    Args:
        messages: Chat history with role and content
        is_summary_request: Whether to generate a summary
        file_context: Optional file information (filename, columns, sample_data, total_rows)

    Returns:
        AI response with message and optional recommendations
    """
    system_prompt = """당신은 B2B 영업 CRM 데이터 가져오기를 도와주는 전문 컨설턴트입니다.
사용자가 어떤 데이터를 관리하고 있는지 파악하여 세일즈맵 CRM에 최적의 설정을 추천해야 합니다.

## 세일즈맵 CRM 구조

세일즈맵에는 4가지 오브젝트만 존재합니다:
- company (회사): 거래처, 파트너사, 고객사 등 B2B 회사 정보
- contact (고객): 담당자, 연락처, 의사결정자 등 개인 정보
- lead (리드): 영업 기회, 잠재 거래, 문의 등
- deal (딜): 실제 거래, 계약, 수주 정보

각 오브젝트에는 커스텀 필드를 추가할 수 있습니다.
메모나 노트는 각 오브젝트의 '노트' 기능에 저장하면 됩니다 (별도 필드 불필요).

## 기본 필드 예시
- company: 회사명, 업종, 직원수, 주소, 웹사이트, 담당자
- contact: 이름, 이메일, 전화번호, 직책, 소속회사, 담당자
- lead: 리드명, 상태, 예상금액, 파이프라인, 담당자
- deal: 딜명, 상태, 금액, 마감일, 파이프라인, 구독정보(MRR)

## 대화 규칙
- 친절하고 전문적으로 대화하세요
- 짧고 명확하게 답변하세요
- 한 번에 하나의 질문만 하세요
- 이모지를 적절히 사용해 친근하게 대화하세요
- 사용자가 메모/노트를 언급하면 각 오브젝트의 노트 기능을 안내하세요"""

    # Add file context to system prompt if available
    if file_context:
        file_info = f"""

## 업로드된 파일 정보
- 파일명: {file_context.get('filename', '알 수 없음')}
- 총 행 수: {file_context.get('total_rows', 0)}개
- 컬럼 목록: {', '.join(file_context.get('columns', []))}

### 샘플 데이터 (처음 3행)
"""
        sample_data = file_context.get('sample_data', [])[:3]
        for i, row in enumerate(sample_data, 1):
            row_str = ', '.join([f"{k}: {v}" for k, v in list(row.items())[:5]])  # First 5 columns
            file_info += f"{i}. {row_str}\n"

        file_info += """
이 파일 데이터를 분석하여 어떤 오브젝트와 필드가 필요한지 파악하세요.
컬럼명과 샘플 데이터를 보고 적절한 매핑을 추천해주세요."""

        system_prompt += file_info

    if is_summary_request:
        system_prompt += """

## 요약 요청
이제 대화 내용을 바탕으로 추천 사항을 정리해주세요.

추천할 수 있는 오브젝트: company, contact, lead, deal (이 4가지만 존재)
메모/노트는 별도 필드가 아니라 각 오브젝트의 노트 기능 사용을 안내하세요.
파일이 업로드된 경우, 컬럼명을 분석하여 구체적인 필드 매핑을 추천하세요.

반드시 아래 JSON 형식으로만 응답하세요:
{
  "summary": "대화 내용 요약 (2-3문장)",
  "recommended_objects": ["company", "contact", "lead", "deal 중 해당하는 것들"],
  "recommended_fields": [
    {"object_type": "오브젝트타입", "field_id": "영문필드ID", "field_label": "한글필드명", "reason": "추천 이유"}
  ],
  "confirmation_message": "사용자에게 확인 요청하는 메시지"
}"""

    try:
        openai_client = get_openai_client()

        api_messages = [{"role": "system", "content": system_prompt}]
        api_messages.extend(messages)

        response_format = {"type": "json_object"} if is_summary_request else None

        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=api_messages,
            temperature=0.7,
            max_tokens=1000,
            response_format=response_format
        )

        content = response.choices[0].message.content

        if is_summary_request:
            return {"type": "summary", "data": json.loads(content)}
        else:
            return {"type": "message", "content": content}

    except Exception as e:
        print(f"Consulting chat error: {e}")
        return {"type": "error", "content": f"AI 응답 오류: {str(e)}"}


async def ai_detect_duplicates(
    data: list[dict],
    field_mappings: list[dict],
    sample_size: int = 100
) -> list[dict]:
    """
    Use AI to detect semantic duplicates that simple string matching might miss.

    Args:
        data: List of data rows
        field_mappings: Field mappings
        sample_size: Number of rows to analyze (for performance)

    Returns:
        List of potential duplicate pairs with AI analysis
    """
    # First, run basic duplicate detection
    basic_duplicates = await detect_duplicates(data, field_mappings, threshold=0.7)

    if not basic_duplicates:
        return []

    # Use AI to analyze ambiguous cases (similarity between 0.7 and 0.9)
    ambiguous_cases = [d for d in basic_duplicates if 0.7 <= d["similarity"] < 0.9]

    if not ambiguous_cases:
        return basic_duplicates

    # Prepare prompt for AI analysis
    cases_for_ai = ambiguous_cases[:10]  # Limit for API cost

    prompt = f"""다음은 잠재적 중복 레코드 쌍입니다. 각 쌍이 실제로 같은 사람/회사인지 분석해주세요.

{json.dumps(cases_for_ai, ensure_ascii=False, indent=2)}

각 케이스에 대해 JSON으로 응답하세요:
{{
  "analysis": [
    {{
      "row1": number,
      "row2": number,
      "is_duplicate": true/false,
      "confidence": 0.0-1.0,
      "reason": "판단 근거"
    }},
    ...
  ]
}}"""

    try:
        openai_client = get_openai_client()
        response = openai_client.chat.completions.create(
            model="gpt-4o-mini",
            messages=[
                {"role": "system", "content": "You are a data quality expert. Analyze potential duplicate records."},
                {"role": "user", "content": prompt}
            ],
            temperature=0.1,
            response_format={"type": "json_object"}
        )

        ai_result = json.loads(response.choices[0].message.content)

        # Merge AI analysis with basic results
        ai_analysis_map = {
            (a["row1"], a["row2"]): a
            for a in ai_result.get("analysis", [])
        }

        for dup in basic_duplicates:
            key = (dup["row1"], dup["row2"])
            if key in ai_analysis_map:
                dup["ai_analysis"] = ai_analysis_map[key]

        return basic_duplicates

    except Exception as e:
        print(f"AI duplicate detection error: {e}")
        return basic_duplicates
