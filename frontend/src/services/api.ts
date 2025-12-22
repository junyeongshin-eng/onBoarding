import type { UploadResponse, ObjectType, ObjectFieldsResponse, ImportRequest, ImportResponse, ValidationResult, AutoMapResponse, DuplicateDetectionResponse, FieldMapping, ApiKeyValidationResponse, FetchFieldsResponse } from '../types';

// In development, Vite proxy handles /api -> localhost:8000
// In production, use the VITE_API_URL environment variable
const API_BASE = import.meta.env.VITE_API_URL || '/api';

export async function uploadFile(file: File): Promise<UploadResponse & { data: Record<string, unknown>[] }> {
  const formData = new FormData();
  formData.append('file', file);

  let response: Response;
  try {
    response = await fetch(`${API_BASE}/upload`, {
      method: 'POST',
      body: formData,
    });
  } catch (e) {
    throw new Error('서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인하세요.');
  }

  if (!response.ok) {
    let errorMessage = '업로드 실패';
    const text = await response.text();
    if (text) {
      try {
        const error = JSON.parse(text);
        errorMessage = error.detail || errorMessage;
      } catch {
        errorMessage = text || '업로드 실패: 서버 오류가 발생했습니다';
      }
    }
    throw new Error(errorMessage);
  }

  const responseText = await response.text();
  if (!responseText) {
    throw new Error('서버에서 빈 응답을 받았습니다');
  }

  try {
    return JSON.parse(responseText);
  } catch {
    throw new Error('서버 응답을 파싱할 수 없습니다');
  }
}

export async function getObjectTypes(): Promise<ObjectType[]> {
  const response = await fetch(`${API_BASE}/object-types`);
  const data = await response.json();
  return data.object_types;
}

export async function getCRMFields(objectType: string): Promise<ObjectFieldsResponse> {
  const response = await fetch(`${API_BASE}/crm-fields/${objectType}`);
  if (!response.ok) {
    throw new Error('필드 정보를 가져올 수 없습니다');
  }
  return response.json();
}

export async function validateImport(request: ImportRequest): Promise<ValidationResult> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/import/validate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
  } catch (e) {
    throw new Error('서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인하세요.');
  }

  if (!response.ok) {
    let errorMessage = '검증 실패';
    const text = await response.text();
    if (text) {
      try {
        const error = JSON.parse(text);
        errorMessage = error.detail || errorMessage;
      } catch {
        errorMessage = text || '검증 실패: 서버 오류가 발생했습니다';
      }
    }
    throw new Error(errorMessage);
  }

  const responseText = await response.text();
  if (!responseText) {
    throw new Error('서버에서 빈 응답을 받았습니다');
  }

  try {
    return JSON.parse(responseText) as ValidationResult;
  } catch {
    throw new Error('서버 응답을 파싱할 수 없습니다');
  }
}

export async function importData(request: ImportRequest, validRowIndices?: number[]): Promise<ImportResponse> {
  // Filter data if validRowIndices is provided
  const filteredRequest = validRowIndices
    ? { ...request, data: request.data.filter((_, idx) => validRowIndices.includes(idx)) }
    : request;
  // Generate and download the Excel file
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(filteredRequest),
    });
  } catch (e) {
    throw new Error('파일 생성 중 서버 연결 오류가 발생했습니다');
  }

  if (!response.ok) {
    let errorMessage = '파일 생성 실패';
    const text = await response.text();
    if (text) {
      try {
        const error = JSON.parse(text);
        errorMessage = error.detail || errorMessage;
      } catch {
        errorMessage = text || '파일 생성 실패: 서버 오류가 발생했습니다';
      }
    }
    throw new Error(errorMessage);
  }

  // Download the file
  const blob = await response.blob();
  const contentDisposition = response.headers.get('Content-Disposition');
  let filename = 'salesmap_import.xlsx';

  if (contentDisposition) {
    const match = contentDisposition.match(/filename="(.+)"/);
    if (match) {
      filename = match[1];
    }
  }

  // Create download link
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  window.URL.revokeObjectURL(url);

  return {
    success: true,
    imported_count: filteredRequest.data.length,
    errors: [],
  };
}

export interface AvailableField {
  key: string;
  id: string;
  label: string;
  object_type: string;
  description?: string;
}

export async function autoMapFields(
  sourceColumns: string[],
  sampleData: Record<string, unknown>[],
  targetObjectTypes: string[],
  availableFields?: AvailableField[]
): Promise<AutoMapResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/import/auto-map`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        source_columns: sourceColumns,
        sample_data: sampleData,
        target_object_types: targetObjectTypes,
        available_fields: availableFields,
      }),
    });
  } catch (e) {
    throw new Error('AI 자동 매핑 서버 연결 오류');
  }

  if (!response.ok) {
    throw new Error('AI 자동 매핑 실패');
  }

  return response.json();
}

export async function detectDuplicates(
  data: Record<string, unknown>[],
  fieldMappings: FieldMapping[],
  useAi: boolean = false,
  threshold: number = 0.85
): Promise<DuplicateDetectionResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/import/detect-duplicates`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        data,
        field_mappings: fieldMappings,
        use_ai: useAi,
        threshold,
      }),
    });
  } catch (e) {
    throw new Error('중복 감지 서버 연결 오류');
  }

  if (!response.ok) {
    throw new Error('중복 감지 실패');
  }

  return response.json();
}

// Salesmap API Integration
export async function validateSalesmapApiKey(apiKey: string): Promise<ApiKeyValidationResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/salesmap/validate-key`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ api_key: apiKey }),
    });
  } catch (e) {
    throw new Error('서버에 연결할 수 없습니다');
  }

  if (!response.ok) {
    throw new Error('API 키 검증 실패');
  }

  return response.json();
}

export async function fetchSalesmapFields(
  apiKey: string,
  objectTypes: string[]
): Promise<FetchFieldsResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/salesmap/fetch-fields`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        api_key: apiKey,
        object_types: objectTypes,
      }),
    });
  } catch (e) {
    throw new Error('필드 조회 서버 연결 오류');
  }

  if (!response.ok) {
    throw new Error('필드 조회 실패');
  }

  return response.json();
}

// AI Consulting Chat
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface FileContext {
  filename: string;
  columns: string[];
  sample_data: Record<string, unknown>[];
  total_rows: number;
}

export interface ConsultingChatResponse {
  type: 'message' | 'summary' | 'error';
  content?: string;
  data?: {
    summary: string;
    recommended_objects: string[];
    recommended_fields: Array<{
      object_type: string;
      field_id: string;
      field_label: string;
      reason: string;
    }>;
    confirmation_message: string;
  };
}

export async function consultingChat(
  messages: ChatMessage[],
  isSummaryRequest: boolean = false,
  fileContext?: FileContext
): Promise<ConsultingChatResponse> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/consulting/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages,
        is_summary_request: isSummaryRequest,
        file_context: fileContext,
      }),
    });
  } catch (e) {
    throw new Error('AI 서버 연결 오류');
  }

  if (!response.ok) {
    throw new Error('AI 응답 실패');
  }

  return response.json();
}
