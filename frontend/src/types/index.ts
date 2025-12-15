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

export interface OnboardingState {
  step: number;
  uploadedFile: UploadResponse | null;
  fileData: Record<string, unknown>[];
  selectedObjectTypes: string[];
  fieldMappings: FieldMapping[];
  customFields: ExtendedCRMField[];
}
