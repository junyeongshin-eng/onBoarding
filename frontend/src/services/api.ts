import type { UploadResponse, ObjectType, ObjectFieldsResponse, ImportRequest, ImportResponse } from '../types';

const API_BASE = '/api';

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

export async function importData(request: ImportRequest): Promise<ImportResponse> {
  // First, validate with preview endpoint
  let previewResponse: Response;
  try {
    previewResponse = await fetch(`${API_BASE}/import/preview`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });
  } catch (e) {
    throw new Error('서버에 연결할 수 없습니다. 백엔드 서버가 실행 중인지 확인하세요.');
  }

  if (!previewResponse.ok) {
    let errorMessage = '검증 실패';
    const text = await previewResponse.text();
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

  const previewText = await previewResponse.text();
  if (!previewText) {
    throw new Error('서버에서 빈 응답을 받았습니다');
  }

  let preview: ImportResponse;
  try {
    preview = JSON.parse(previewText) as ImportResponse;
  } catch {
    throw new Error('서버 응답을 파싱할 수 없습니다');
  }

  // If validation failed, return the errors
  if (!preview.success) {
    return preview;
  }

  // Generate and download the Excel file
  let response: Response;
  try {
    response = await fetch(`${API_BASE}/import`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
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
    imported_count: preview.imported_count,
    errors: [],
  };
}
