"""
LLM 프롬프트 템플릿
Triage, Mapping, Export 단계별 프롬프트 정의
"""

# ============================================================================
# Triage (A단계) - 컬럼 분류 프롬프트
# ============================================================================

TRIAGE_SYSTEM_PROMPT = """당신은 CRM 데이터 이관 전문가입니다.
사용자가 업로드한 데이터 파일의 컬럼을 분석하여 세일즈맵 CRM에 어떻게 매핑할지 분류합니다.

## 분류 목표
비즈니스에 **핵심적인 컬럼만 선별**하여 유지합니다.
- 이름, 이메일, 전화번호, 회사명, 담당자 등 **필수 정보**
- 출처, 상태, 날짜 등 **추적에 필요한 정보**
- 금액, 수량 등 **비즈니스 메트릭**

## 제외 대상 (적극적으로 제외)
1. **내부 시스템 컬럼**: id, _id, seq, row_num 등
2. **100% 비어있는 컬럼**: 모든 행에 값이 없음
3. **중복 컬럼**: 다른 컬럼과 동일한 데이터
4. **불필요한 메타 정보**: 마지막 수신/전송 이메일, 다음 활동 등 이관 후 의미없는 정보
5. **_로 끝나는 커스텀 필드 중 불필요한 것**: 내부용 계산 필드, 중복 참조 필드
6. **빈 값이 80% 이상인 컬럼**: 데이터 품질이 낮음

## 한글 → 영어 오브젝트 변환 (필수!)
원본 컬럼이 "X - Y" 형식일 때 반드시 영어로 변환:
- "리드" → Lead
- "고객" → People
- "조직", "회사" → Organization
- "딜", "거래" → Deal

예시 (반드시 이 형식으로):
- "리드 - 이름" → target_object: "lead", suggested_field_label: "Lead - 이름"
- "고객 - 이메일" → target_object: "people", suggested_field_label: "People - 이메일"
- "조직 - 이름" → target_object: "company", suggested_field_label: "Organization - 이름"

## 필드명 정리 규칙
- 뒤의 언더스코어(_) 제거: "고객구분_" → "고객구분"
- 불필요한 괄호 정보 간소화: "타임스탬프(견적서 요청시간)" → "견적서 요청시간"
- "생성된 리드" → "생성 날짜", "생성된 조직" → "생성 날짜"

## 배타적 분류 규칙
- 모든 컬럼은 keep 또는 skip 중 하나에만 포함
- 누락된 컬럼 없이 전체 분류 필수

## 세일즈맵 오브젝트
- people (고객): 개인 연락처 - People로 출력
- company (회사, 조직): 조직/법인 - Organization으로 출력
- deal (딜): 영업 기회 - Deal로 출력
- lead (리드): 잠재 고객 - Lead로 출력

## 응답 형식
반드시 아래 JSON 형식으로 응답하세요:
```json
{
  "thinking": "분석 과정 설명...",
  "columns_to_keep": [
    {
      "column_name": "원본 컬럼명 (정확히)",
      "target_object": "people|company|deal|lead",
      "suggested_field_label": "Lead - 이름 형식 (영어 오브젝트 + 한글 필드)",
      "suggested_field_type": "text|email|phone|number|date|datetime|select|boolean|user",
      "is_required": false,
      "reason": "유지 사유"
    }
  ],
  "columns_to_skip": [
    {
      "column_name": "컬럼명 (정확히)",
      "reason": "빈 값만 있음|내부 식별자|다른 열과 중복|시스템 생성 값|불필요한 메타정보|데이터 품질 낮음",
      "detail": "상세 설명"
    }
  ],
  "recommended_objects": ["lead", "people", "company"]
}
```"""

TRIAGE_USER_PROMPT_TEMPLATE = """## 분석할 데이터

### 컬럼 목록 ({column_count}개)
{columns_list}

### 컬럼 통계
{column_stats}

### 샘플 데이터 (처음 {sample_count}행)
{sample_data}

{business_context}

위 데이터를 분석하여 각 컬럼을 분류해주세요.
기억하세요: 기본값은 KEEP이며, 90% 이상의 컬럼을 유지해야 합니다."""


# ============================================================================
# Mapping (B단계) - 필드 매핑 프롬프트
# ============================================================================

MAPPING_SYSTEM_PROMPT = """당신은 CRM 필드 매핑 전문가입니다.
Triage 단계에서 유지하기로 결정된 컬럼들을 세일즈맵의 기존 필드 또는 새 커스텀 필드에 매핑합니다.

## 매핑 우선순위
1. 기존 시스템 필드와 일치하면 해당 필드에 매핑
2. 기존 커스텀 필드와 일치하면 해당 필드에 매핑
3. 일치하는 필드가 없으면 새 커스텀 필드 생성 제안

## 필드 라벨 형식 (필수)
모든 target_field_label은 "오브젝트 - 필드명" 형식:
- 올바른 예: "고객 - 이메일", "딜 - 예상 금액"
- 잘못된 예: "email", "고객 이메일"

## 필드 타입
- text: 일반 텍스트
- textarea: 긴 텍스트 (메모, 설명)
- number: 숫자, 금액
- email: 이메일 주소
- phone: 전화번호
- url: 웹사이트 URL
- date: 날짜 (YYYY-MM-DD)
- datetime: 날짜+시간
- select: 단일 선택
- multiselect: 다중 선택
- boolean: 예/아니오
- user: 담당자 (시스템 사용자)

## 필수/유니크 필드
- people: name(필수), email(유니크)
- company: name(필수)
- deal: name(필수), pipeline(필수)
- lead: name(필수), email(유니크)

## 응답 형식
```json
{
  "thinking": "매핑 결정 과정...",
  "mappings": [
    {
      "source_column": "원본 컬럼명",
      "target_object": "people|company|deal|lead",
      "target_field_id": "기존필드ID 또는 null",
      "target_field_label": "오브젝트 - 필드명",
      "field_type": "text|email|...",
      "is_new_field": false,
      "is_required": false,
      "is_unique": false,
      "confidence": 0.95
    }
  ],
  "unmapped_columns": [],
  "warnings": []
}
```"""

MAPPING_USER_PROMPT_TEMPLATE = """## 매핑할 컬럼 ({column_count}개)

{columns_to_keep}

## 선택된 오브젝트
{object_types}

## 사용 가능한 기존 필드

{available_fields}

## 샘플 데이터
{sample_data}

위 컬럼들을 세일즈맵 필드에 매핑해주세요.
기존 필드에 매핑 가능하면 해당 필드를, 없으면 새 커스텀 필드를 제안하세요."""


# ============================================================================
# 헬퍼 함수
# ============================================================================

def build_triage_prompt(
    columns: list[str],
    sample_data: list[dict],
    column_stats: list[dict] = None,
    business_context: str = None,
) -> tuple[str, str]:
    """Triage 프롬프트 생성"""
    columns_list = "\n".join(f"- {col}" for col in columns)

    stats_text = ""
    if column_stats:
        stats_lines = []
        for stat in column_stats:
            line = f"- {stat['column_name']}: {stat['non_empty_count']}/{stat['total_rows']}행 값 있음"
            if stat.get('sample_values'):
                samples = ", ".join(str(v)[:20] for v in stat['sample_values'][:3])
                line += f" (예: {samples})"
            stats_lines.append(line)
        stats_text = "\n".join(stats_lines)
    else:
        stats_text = "(통계 없음)"

    import json
    sample_text = json.dumps(sample_data[:5], ensure_ascii=False, indent=2)

    context_text = ""
    if business_context:
        context_text = f"\n### 비즈니스 컨텍스트\n{business_context}\n"

    user_prompt = TRIAGE_USER_PROMPT_TEMPLATE.format(
        column_count=len(columns),
        columns_list=columns_list,
        column_stats=stats_text,
        sample_count=min(5, len(sample_data)),
        sample_data=sample_text,
        business_context=context_text,
    )

    return TRIAGE_SYSTEM_PROMPT, user_prompt


def build_mapping_prompt(
    columns_to_keep: list[dict],
    object_types: list[str],
    available_fields: dict[str, list[dict]],
    sample_data: list[dict],
) -> tuple[str, str]:
    """Mapping 프롬프트 생성"""
    import json

    # 유지할 컬럼 정보
    columns_text = json.dumps(columns_to_keep, ensure_ascii=False, indent=2)

    # 오브젝트 타입
    object_names = {
        "people": "고객",
        "company": "회사",
        "deal": "딜",
        "lead": "리드",
    }
    objects_text = ", ".join(f"{object_names.get(t, t)}({t})" for t in object_types)

    # 사용 가능한 필드
    fields_parts = []
    for obj_type, fields in available_fields.items():
        obj_name = object_names.get(obj_type, obj_type)
        fields_parts.append(f"### {obj_name} ({obj_type})")
        for f in fields:
            req = " [필수]" if f.get('required') else ""
            unique = " [유니크]" if f.get('unique') else ""
            fields_parts.append(f"- {f['id']}: {f['label']} ({f['type']}){req}{unique}")
        fields_parts.append("")
    fields_text = "\n".join(fields_parts)

    # 샘플 데이터
    sample_text = json.dumps(sample_data[:3], ensure_ascii=False, indent=2)

    user_prompt = MAPPING_USER_PROMPT_TEMPLATE.format(
        column_count=len(columns_to_keep),
        columns_to_keep=columns_text,
        object_types=objects_text,
        available_fields=fields_text,
        sample_data=sample_text,
    )

    return MAPPING_SYSTEM_PROMPT, user_prompt
