export interface UploadResponse {
  filename: string;
  columns: string[];
  preview: Record<string, unknown>[];
  total_rows: number;
}

export interface ObjectType {
  id: string;
  name: string;
  description: string;
}

export interface CRMField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  unique?: boolean;
  options?: string[];
}

export interface ExtendedCRMField extends CRMField {
  objectType: string;
  objectName: string;
  isCustom?: boolean;
}

export interface ObjectFieldsResponse {
  name: string;
  fields: CRMField[];
}

export interface FieldMapping {
  source_column: string;
  target_field: string; // format: "objectType.fieldId"
}

export interface ImportRequest {
  filename: string;
  object_types: string[];
  data: Record<string, unknown>[];
  field_mappings: FieldMapping[];
  custom_fields: ExtendedCRMField[];
}

export interface ImportResponse {
  success: boolean;
  imported_count: number;
  errors: string[];
}

export interface ValidationError {
  row: number;
  field: string;
  message: string;
  severity: 'error' | 'warning';
}

export interface ValidationResult {
  success: boolean;
  total_rows: number;
  valid_rows: number;
  error_count: number;
  warning_count: number;
  errors: ValidationError[];
  valid_row_indices: number[];
}

export interface OnboardingState {
  step: number;
  uploadedFile: UploadResponse | null;
  fileData: Record<string, unknown>[];
  selectedObjectTypes: string[];
  fieldMappings: FieldMapping[];
  customFields: ExtendedCRMField[];
}

// AI-related types
export interface AutoMapResponse {
  mappings: Record<string, string | null>;
  confidence: Record<string, number>;
  error?: string;
}

export interface DuplicateRecord {
  row1: number;
  row2: number;
  similarity: number;
  field_similarities: Record<string, number>;
  data1: Record<string, string>;
  data2: Record<string, string>;
  ai_analysis?: {
    is_duplicate: boolean;
    confidence: number;
    reason: string;
  };
}

export interface DuplicateDetectionResponse {
  duplicates: DuplicateRecord[];
  total_checked: number;
}

// Salesmap API types
export interface ApiKeyValidationResponse {
  valid: boolean;
  message: string;
}

export interface SalesmapField {
  id: string;
  label: string;
  type: string;
  required: boolean;
  is_system: boolean;
  editable: boolean;  // 수정 가능 여부 (시스템 필드가 아니면 true)
}

export interface ObjectFieldsResult {
  object_type: string;
  object_name: string;
  success: boolean;
  fields: SalesmapField[];
  error?: string;
  warning?: string;
}

export interface FetchFieldsResponse {
  success: boolean;
  results: ObjectFieldsResult[];
}

// Consulting step types
export interface ConsultingAnswer {
  questionId: string;
  answer: boolean | string | string[];
}

export interface RecommendedField {
  objectType: string;
  fieldId: string;
  fieldLabel: string;
  fieldType?: string; // 추천 필드 유형 (text, number, select, date 등)
  fieldTypeReason?: string; // 필드 유형 추천 이유
  reason: string;
}

// Column analysis result
export interface ColumnToKeep {
  columnName: string;
  recommendedType: string;
  targetObject?: string;
  targetField?: string;
  reason: string;
}

export interface ColumnToSkip {
  columnName: string;
  reason: string;
}

export interface ColumnAnalysis {
  totalColumns: number;
  columnsToKeep: ColumnToKeep[];
  columnsToSkip: ColumnToSkip[];
}

export interface ConsultingResult {
  businessType: string;
  recommendedObjectTypes: string[];
  recommendedFields: RecommendedField[];
  columnAnalysis?: ColumnAnalysis; // 컬럼 분석 결과
  answers: ConsultingAnswer[];
}

// Missing field validation types
export interface MissingFieldInfo {
  objectType: string;
  fieldId: string;
  fieldLabel: string;
  reason: string;
}

// ============================================================================
// Wrapper 아키텍처 타입 (Triage, Mapping, Export)
// ============================================================================

// 오브젝트 타입
export type SalesmapObjectType = 'people' | 'company' | 'deal' | 'lead';

// 필드 타입
export type SalesmapFieldType =
  | 'text' | 'textarea' | 'number' | 'email' | 'phone' | 'url'
  | 'date' | 'datetime' | 'select' | 'multiselect' | 'boolean'
  | 'user' | 'users' | 'file';

// 제외 사유
export type SkipReason = '빈 값만 있음' | '내부 식별자' | '다른 열과 중복' | '시스템 생성 값';

// 컬럼 통계
export interface ColumnStats {
  column_name: string;
  total_rows: number;
  non_empty_count: number;
  empty_count: number;
  unique_count: number;
  sample_values: string[];
}

// Triage 결과 - 유지할 컬럼
export interface TriageColumnKeep {
  column_name: string;
  target_object: SalesmapObjectType;
  suggested_field_label: string;
  suggested_field_type: SalesmapFieldType;
  is_required: boolean;
  reason: string;
}

// Triage 결과 - 제외할 컬럼
export interface TriageColumnSkip {
  column_name: string;
  reason: SkipReason;
  detail?: string;
}

// Triage 결과
export interface TriageResult {
  columns_to_keep: TriageColumnKeep[];
  columns_to_skip: TriageColumnSkip[];
  recommended_objects: SalesmapObjectType[];
  thinking?: string;
}

// 검증 오류 항목
export interface ValidationErrorItem {
  field: string;
  message: string;
  severity: 'error' | 'warning' | 'info';
  suggestion?: string;
}

// 검증 결과
export interface WrapperValidationResult {
  is_valid: boolean;
  errors: ValidationErrorItem[];
  warnings: ValidationErrorItem[];
  auto_fixes: Array<{
    field: string;
    original_value: string;
    fixed_value: string;
    fix_type: string;
  }>;
  stats: Record<string, unknown>;
}

// Triage API 요청
export interface TriageRequest {
  columns: string[];
  sample_data: Record<string, unknown>[];
  column_stats?: ColumnStats[];
  business_context?: string;
}

// Triage API 응답
export interface TriageResponse {
  success: boolean;
  result?: TriageResult;
  validation?: WrapperValidationResult;
  repair_attempts: number;
  error?: string;
}

// Mapping 결과 - 필드 매핑
export interface MappingFieldMapping {
  source_column: string;
  target_object: SalesmapObjectType;
  target_field_id?: string;
  target_field_label: string;
  field_type: SalesmapFieldType;
  is_new_field: boolean;
  is_required: boolean;
  is_unique: boolean;
  confidence: number;
}

// Mapping 결과
export interface MappingResult {
  mappings: MappingFieldMapping[];
  unmapped_columns: string[];
  warnings: string[];
  thinking?: string;
}

// Mapping API 요청
export interface MappingRequest {
  columns_to_keep: TriageColumnKeep[];
  object_types: SalesmapObjectType[];
  available_fields: Record<string, SalesmapField[]>;
  sample_data: Record<string, unknown>[];
}

// Mapping API 응답
export interface MappingResponse {
  success: boolean;
  result?: MappingResult;
  validation?: WrapperValidationResult;
  repair_attempts: number;
  error?: string;
}

// Export 요청
export interface ExportRequest {
  data: Record<string, unknown>[];
  mappings: MappingFieldMapping[];
  object_types: SalesmapObjectType[];
  format: 'xlsx' | 'csv';
  include_summary: boolean;
}

// Export 응답
export interface ExportResponse {
  success: boolean;
  filename: string;
  file_path?: string;
  download_url?: string;
  stats: Record<string, unknown>;
  errors: string[];
}

// 파일 분석 응답
export interface AnalyzeResponse {
  success: boolean;
  columns: string[];
  total_rows: number;
  column_stats: ColumnStats[];
  sample_data: Record<string, unknown>[];
  skip_candidates: Array<{
    column_name: string;
    reason: string;
  }>;
  error?: string;
}
