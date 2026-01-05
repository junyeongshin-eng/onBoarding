import os
import json
from openai import OpenAI
from typing import Optional
from difflib import SequenceMatcher

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
    target_object_types: list[str]
) -> dict[str, str]:
    """
    Use AI to automatically map source columns to CRM fields.

    Args:
        source_columns: List of column names from uploaded file
        sample_data: Sample rows from the uploaded file
        target_object_types: List of object types selected by user

    Returns:
        Dictionary mapping source column -> target field (e.g., "이름" -> "people.name")
    """
    # Build field options for the prompt
    field_options = []
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
