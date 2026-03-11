# CLAUDE.md — Surat (세일즈맵 AI 에이전트)

## 프로젝트 개요

세일즈맵 CRM API를 사용하는 AI 에이전트 프로젝트. B2B 영업 CRM 데이터를 조회·생성·수정하고, 유저에게 비즈니스 컨설팅을 제공한다.

---

## 세일즈맵 API 기본 설정

```
Base URL: https://salesmap.kr/api
API Version: v2
Auth: Bearer <token> (Authorization 헤더)
Content-Type: application/json
Rate Limit: 100 요청 / 10초 (워크스페이스 단위), 초과 시 HTTP 429
권장 요청 간격: 0.1~0.15초
```

### 응답 공통 패턴

- 목록 조회: 각 항목에 `id` + 한글 필드명이 직접 속성으로 반환
- 관계형 필드: `{"id": "uuid", "name": "이름"}` 객체 또는 배열
- 페이지네이션: `nextCursor`가 `null`이면 마지막 페이지, 페이지당 50건
- **단일 조회(`GET /v2/{resource}/{id}`)는 모두 배열로 래핑됨** — 반드시 `[0]`으로 접근
  - `data.people[0]`, `data.deal[0]`, `data.organization[0]`, `data.lead[0]`

---

## 핵심 오브젝트 & 영업 흐름

| 오브젝트 | 비즈니스 의미 |
|---------|-------------|
| **고객 (People)** | 실제 영업 대상 담당자 |
| **회사 (Organization)** | 고객이 소속된 기업, B2B 계약 주체 |
| **리드 (Lead)** | 아직 검증되지 않은 잠재 기회 |
| **딜 (Deal)** | 검증된 영업 기회, 매출과 직결 |
| **파이프라인 (Pipeline)** | 딜/리드의 진행 단계 흐름 |
| **견적서 (Quote)** | 딜/리드에 연결된 가격 제안서 |
| **상품 (Product)** | 판매 제품/서비스 (일반/구독) |
| **시퀀스 (Sequence)** | 자동화된 이메일 캠페인 |
| **TODO** | 영업 담당자의 할 일 (읽기 전용) |
| **메모 (Memo)** | 고객/딜 등에 남기는 내부 기록 |
| **웹 폼 (WebForm)** | 외부 리드 수집 폼 |
| **커스텀 오브젝트** | 워크스페이스별 맞춤 데이터 |

영업 흐름: `웹폼 제출 → 고객+회사 자동생성 → 리드 생성 → 시퀀스 등록 → 응답 시 딜 전환 → 파이프라인 진행 → 견적서 발송 → 성사/실패`

---

## 엔드포인트 요약

### CRUD

| 오브젝트 | 목록 | 단일 | 생성 | 수정 |
|---------|------|------|------|------|
| 회사 | `GET /v2/organization` | `GET /v2/organization/{id}` | `POST /v2/organization` (name 필수) | `POST /v2/organization/{id}` |
| 고객 | `GET /v2/people` | `GET /v2/people/{id}` | `POST /v2/people` (name 필수) | `POST /v2/people/{id}` |
| 딜 | `GET /v2/deal` | `GET /v2/deal/{id}` | `POST /v2/deal` (name, status, pipelineId, pipelineStageId 필수) | `POST /v2/deal/{id}` |
| 리드 | `GET /v2/lead` | `GET /v2/lead/{id}` | `POST /v2/lead` (name 필수, peopleId 또는 organizationId 하나 이상 필수) | `POST /v2/lead/{id}` |
| 커스텀 오브젝트 | `GET /v2/custom-object` | `GET /v2/custom-object/{id}` | `POST /v2/custom-object` (customObjectDefinitionId 필수) | `POST /v2/custom-object/{id}` |
| 상품 | `GET /v2/product` | — | `POST /v2/product` (name 필수) | — |
| TODO | `GET /v2/todo` | — | **없음 (읽기 전용)** | — |
| 메모 | `GET /v2/memo` | — | 오브젝트 수정 시 `memo` 파라미터 사용 | — |
| 사용자 | `GET /v2/user`, `GET /v2/user/me` | — | — | — |
| 팀 | `GET /v2/team` | — | — | — |
| 웹 폼 | `GET /v2/webForm` | — | — | — |
| 웹 폼 제출 | `GET /v2/webForm/{id}/submit` | — | — | — |

### 히스토리 & 액티비티

```
GET /v2/{resource}/history    — 필드 변경 감사 로그
GET /v2/{resource}/activity   — 이벤트 타임라인
```

지원 리소스: `people`, `organization`, `deal`, `lead`, `custom-object`
**반드시 slash notation. dot notation은 전부 404.**

### 기타 엔드포인트

| 엔드포인트 | 용도 |
|-----------|------|
| `GET /v2/people-temp/{email}` | 이메일로 고객 상세 조회 (전체 필드 반환) |
| `POST /v2/object/{targetType}/search` | 복합 조건 검색 (people/organization/deal/lead) |
| `GET /v2/deal/pipeline`, `GET /v2/lead/pipeline` | 파이프라인 목록+단계 |
| `GET /v2/deal/{id}/quote`, `GET /v2/lead/{id}/quote` | 견적서 조회 |
| `POST /v2/quote` | 견적서 생성 |
| `GET /v2/field/{type}` | 필드 정의 조회 (deal/lead/people/organization/product/quote/todo/custom-object) |
| `GET /v2/email/{emailId}` | 이메일 단일 조회 (목록 조회 없음) |
| `GET /v2/sequence` | 시퀀스 목록 (**`_id` 사용, `id` 아님**) |
| `GET /v2/sequence/{id}/step` | 시퀀스 단계 조회 |
| `GET /v2/sequence/{id}/enrollment` | 시퀀스 등록 고객 목록 |
| `GET /v2/sequence/enrollment/{enrollId}/timeline` | 고객별 시퀀스 진행 타임라인 |

---

## fieldList 데이터 필드 유형

생성/수정 API에서 `fieldList` 배열로 커스텀 필드 값을 지정한다.
**필드 이름은 세일즈맵 워크스페이스의 한글 이름과 정확히 일치해야 한다.**

### 기본 유형

| 유형 | value 키 | 예시 |
|------|---------|------|
| 텍스트 | `stringValue` | `{"name": "이메일", "stringValue": "test@test.com"}` |
| 숫자 | `numberValue` | `{"name": "인센티브", "numberValue": 50000}` |
| True/False | `booleanValue` | `{"name": "구글 폼 제출", "booleanValue": true}` |
| 날짜 | `dateValue` | `{"name": "생년월일", "dateValue": "1990-05-15"}` |
| 단일 선택 | `stringValue` | 등록된 옵션 값만 가능 |
| 복수 선택 | `stringValueList` | `{"name": "복수 선택", "stringValueList": ["1", "2"]}` |

**날짜 주의:** `dateValue`에 날짜만 보내면 KST→UTC 변환되어 -9시간 조정됨.

### 관계 유형

| 유형 | value 키 |
|------|---------|
| 사용자(단일) | `userValueId` |
| 사용자(복수) | `userValueIdList` |
| 회사(단일) | `organizationValueId` |
| 회사(복수) | `organizationValueIdList` |
| 고객(단일) | `peopleValueId` |
| 고객(복수) | `peopleValueIdList` |
| 딜(복수) | `dealValueIdList` |
| 리드(복수) | `leadValueIdList` |
| 파이프라인 | `pipelineValueId` |
| 파이프라인 단계 | `pipelineStageValueId` |
| 웹 폼(단일) | `webformValueId` |
| 시퀀스(단일) | `sequenceValueId` |
| 시퀀스(복수) | `sequenceValueIdList` |
| 커스텀 오브젝트(복수) | `customObjectValueIdList` |
| 팀(복수) | `teamValueIdList` (**Deal/Lead에서만 가능**) |

### fieldList 주의사항

- **딜 `금액`은 fieldList가 아닌 top-level `price` 파라미터로 전달.** fieldList에 넣으면 에러.
- 파이프라인/파이프라인 단계는 딜/리드 생성 시 별도 body 파라미터(`pipelineId`, `pipelineStageId`)로도 지정 가능.
- 선택형 필드의 값은 CRM에 등록된 옵션과 정확히 일치해야 함. 미등록 값 → 에러.

---

## top-level 파라미터 (fieldList가 아닌 body 최상위)

| 오브젝트 | 파라미터 | 용도 |
|----------|----------|------|
| People | `name`, `email`, `phone`, `ownerId`, `organizationId` | 이름/이메일/전화/담당자/회사 변경 |
| Organization | `name`, `phone`, `industry`, `parentOrganizationId` | 이름/전화/종목/모회사 변경 |
| Deal | `name`, `price`, `status`, `pipelineId`+`pipelineStageId`, `peopleId`, `organizationId` | 이름/금액/상태/파이프라인/고객/회사 변경 |
| Lead | `name`, `pipelineId`+`pipelineStageId`, `peopleId`, `organizationId` | 이름/파이프라인/고객/회사 변경 |

---

## 읽기전용 필드 (수정 불가)

커스텀 필드는 기본적으로 모두 수정 가능. 아래는 수정 불가능한 것만 정리.

### 읽기전용 시스템 필드 (공통)

모든 오브젝트에서 읽기전용: `RecordId`, `수정 날짜`, 딜/리드/TODO/시퀀스/노트/웹폼 관련 집계/최근 필드들.

### 항상 읽기전용인 커스텀 필드 타입

| 타입 | 비고 |
|------|------|
| `formula` (수식) | 사용자 정의 수식 필드 전부 |
| `multiAttachment` (첨부파일) | 파일 업로드 별도 처리 필요 |
| `multiPeopleGroup` (고객 그룹) | API 미지원 |
| `multiTeam` (팀) | People/Org에서 불가. **Deal/Lead의 커스텀 팀 필드는 `teamValueIdList`로 가능** |

### 수정 관련 주의사항

1. **이름/이메일/전화**: fieldList가 아닌 body 최상위 파라미터로만 수정
2. **담당자**: People/Org는 `ownerId` top-level. 커스텀 사용자 필드는 `userValueId`
3. **딜 금액**: `price` top-level 파라미터 전용
4. **`pipelineStageId`**: 반드시 `pipelineId`와 함께 전송
5. **빈 값 설정**: 빈 문자열 `""` 가능 (기존 값 클리어). 복수선택은 빈 배열 `[]` 불가
6. **`생성 날짜`**: People/Org/Deal 모두 dateValue로 덮어쓰기 가능
7. **Deal `마감일`**: 201 응답이지만 값 미반영 (특수 시스템 필드 추정)

---

## Search Record API

```
POST /v2/object/{targetType}/search
targetType: people | organization | deal | lead
Rate Limit: 요청당 10 포인트 소모
응답: { objectList: [{ id, name }], nextCursor } — id와 name만 반환
```

- `filterGroupList`: 그룹 간 OR, 최대 3개. 필수 (빈 배열 불가)
- `filters`: 필터 간 AND, 최대 3개
- `fieldName`: 한글 이름
- `value`: `EXISTS`/`NOT_EXISTS`만 생략 가능. 빈 문자열 불가

**Operator**: `EQ`, `NEQ`, `EXISTS`, `NOT_EXISTS`, `CONTAINS`, `NOT_CONTAINS`, `LT`, `LTE`, `GT`, `GTE`, `IN`, `NOT_IN`, `LIST_CONTAIN`, `LIST_NOT_CONTAIN`, `DATE_ON_OR_AFTER`, `DATE_ON_OR_BEFORE`, `DATE_IS_SPECIFIC_DAY`, `DATE_BETWEEN`, `DATE_MORE_THAN_DAYS_AGO`, `DATE_LESS_THAN_DAYS_AGO`, `DATE_LESS_THAN_DAYS_LATER`, `DATE_MORE_THAN_DAYS_LATER`, `DATE_AGO`, `DATE_LATER`

**주의:**
- Relation 필드: UUID 값만 허용, `CONTAINS`/`NOT_CONTAINS` 불가
- MultiSelect: `LIST_CONTAIN`/`LIST_NOT_CONTAIN` 사용 (`EQ`/`NEQ` 아님)
- `DATE_BETWEEN` value: `["2025-01-01", "2025-12-31"]` 배열
- `custom-object` 타입 미지원

---

## 시퀀스 관련 주의사항

- **시퀀스 ID는 `_id` 사용** (`id` 아님)
- Enrollment 리스트 키: `sequenceEnrollmentList` (문서의 `enrollmentList` 아님)
- Enrollment ID: `_id` 사용, 등록일: `createdAt` (문서의 `enrolledAt` 아님)
- Timeline 이벤트 유형: `eventType` (문서의 `type` 아님), 단계: `stepIndex` (0-based), 시간: `date`

### Timeline eventType

| eventType | 의미 | 비즈니스 시그널 |
|-----------|------|---------------|
| `sendEmail` | 이메일 발송됨 | 단계 실행 확인 |
| `emailOpen` | 이메일 오픈 (여러 번 가능) | 관심 있음 |
| `emailLinkClick` | 링크 클릭 | 강한 관심 |
| `emailReply` | 이메일 회신 | 가장 강한 시그널, 즉시 follow-up 필요 |

---

## 웹훅

```json
{
  "event": "생성|수정|삭제|병합",
  "occurredAt": "datetime",
  "source": "사용자|API|시스템|데이터 가져오기|시퀀스|웹 폼|워크플로우|고객",
  "sourceId": "userId (source에 따라 다름, 시스템이면 null)",
  "objectType": "딜|리드|고객|회사|커스텀 오브젝트명",
  "objectId": "uuid",
  "eventId": "uuid (동일 행위로 여러 웹훅 발생 시 같은 ID)",
  "fieldName": "수정 시만",
  "beforeField": "수정 시만",
  "afterField": "수정 시만"
}
```

- 타임아웃: 10초 이내 응답 필요
- 재시도: 실패 시 10분 간격, 최대 10회
- 즉시 200 응답 후 비동기 처리 권장

---

## 연관관계 (Association)

```
GET /v2/object/{targetType}/{targetId}/association/{toTargetType}/primary   → { associationIdList }
GET /v2/object/{targetType}/{targetId}/association/{toTargetType}/custom    → { associationItemList: [{id, label}] }
```

Primary로 안 나오면 Custom으로도 시도.

---

## 공통 에러

```json
{"success": false, "message": "Unauthorized"}
{"success": false, "message": "Bad Request", "reason": "구체적 사유"}
{"success": false, "message": "Too Many Requests"}
{"success": false, "message": "Not Found"}
```

- 회사명 중복: `reason`에 중복 메시지 + `data.id`로 기존 회사 ID 반환
- 미등록 선택 옵션: `"정의 되지 않은 값을 입력했습니다."`
- 딜 금액 fieldList: `"금액 값은 fieldList이 아닌 파라메터 입니다."`

---

## API 제한사항 (2026-02-27 검증)

### 동작하지 않는 것

- **삭제 API**: 모든 오브젝트의 `POST /v2/{resource}/delete` 라우트는 존재하나 body 형식 미공개. `DELETE` 메서드 → 405.
- **이메일 본문**: `GET /v2/email/{id}` 응답에 body 없음 (메타데이터만)
- **이메일 목록 조회**: `GET /v2/email` → 404
- **견적서 목록 조회**: `GET /v2/quote` → 500 에러
- **TODO 생성**: `POST /v2/todo` → 500 (읽기 전용)
- **시퀀스 등록 생성**: `POST /v2/sequence/enrollment` → 500
- **커스텀 오브젝트 definition 목록 조회 API**: 없음
- **리드→딜 전환 API**: 없음

---

## 베스트 프랙티스

1. 요청 간격 0.1~0.15초 (rate limit 방지)
2. 배치 처리: 5개씩 `Promise.allSettled`
3. 웹훅 응답: 10초 내 200, 처리는 비동기
4. 중복 이벤트: `eventId + objectId`로 감지
5. 회사 중복: 생성 실패 시 에러의 `data.id`로 기존 회사 활용
6. 필드명: 세일즈맵 UI의 한글 이름과 정확히 일치
7. 시퀀스 ID: `_id` 사용
8. 필드 정의 동적 조회: `GET /v2/field/{type}`
9. 딜 금액: `price` top-level
10. 이메일 조회: activity에서 emailId → `GET /v2/email/{id}` 개별 조회
11. 고객 이메일 검색: 상세 필요 시 `people-temp`, 조건 검색은 Search Record API
