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
  is_custom: boolean;
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
  reason: string;
}

export interface ConsultingResult {
  businessType: string;
  recommendedObjectTypes: string[];
  recommendedFields: RecommendedField[];
  answers: ConsultingAnswer[];
}

// Missing field validation types
export interface MissingFieldInfo {
  objectType: string;
  fieldId: string;
  fieldLabel: string;
  reason: string;
}
