import { useState, useCallback } from 'react';
import { validateSalesmapApiKey, fetchSalesmapFields, uploadFile } from '../services/api';
import type { SalesmapField, UploadResponse } from '../types';

const STEPS = [
  { title: 'API 연결', description: '세일즈맵 API Key를 입력하세요' },
  { title: '필드 확인', description: '오브젝트와 필드를 확인하세요' },
  { title: '파일 검증', description: '파일을 업로드하고 검증하세요' },
];

const OBJECT_TYPES = [
  { id: 'people', name: '고객', icon: '👤' },
  { id: 'company', name: '회사', icon: '🏢' },
  { id: 'lead', name: '리드', icon: '🎯' },
  { id: 'deal', name: '딜', icon: '💰' },
];

interface ValidationIssue {
  column: string;
  type: 'success' | 'warning' | 'error';
  message: string;
  suggestion?: string;
}

export function SimpleImport() {
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1: API Key
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Step 2: Fields
  const [selectedObjects, setSelectedObjects] = useState<string[]>([]);
  const [salesmapFields, setSalesmapFields] = useState<Record<string, SalesmapField[]>>({});
  const [isFetchingFields, setIsFetchingFields] = useState(false);

  // Step 3: File & Validation
  const [uploadedFile, setUploadedFile] = useState<UploadResponse | null>(null);
  const [fileData, setFileData] = useState<Record<string, unknown>[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [isValidatingFile, setIsValidatingFile] = useState(false);

  // Step 1: Validate API Key
  const handleValidateApiKey = async () => {
    if (!apiKey.trim()) return;

    setIsValidating(true);
    setApiError(null);

    try {
      const result = await validateSalesmapApiKey(apiKey);
      if (result.valid) {
        setCurrentStep(1);
      } else {
        setApiError(result.message || 'API 키가 유효하지 않습니다');
      }
    } catch (error) {
      setApiError('API 키 검증 중 오류가 발생했습니다');
    } finally {
      setIsValidating(false);
    }
  };

  // Step 2: Toggle object selection
  const handleObjectToggle = (objectId: string) => {
    setSelectedObjects(prev =>
      prev.includes(objectId)
        ? prev.filter(id => id !== objectId)
        : [...prev, objectId]
    );
  };

  // Step 2: Fetch fields for selected objects
  const handleFetchFields = async () => {
    if (selectedObjects.length === 0) return;

    setIsFetchingFields(true);
    try {
      const result = await fetchSalesmapFields(apiKey, selectedObjects);
      if (result.success) {
        const fieldsMap: Record<string, SalesmapField[]> = {};
        for (const objResult of result.results) {
          fieldsMap[objResult.object_type] = objResult.fields;
        }
        setSalesmapFields(fieldsMap);
        setCurrentStep(2);
      }
    } catch (error) {
      console.error('Failed to fetch fields:', error);
    } finally {
      setIsFetchingFields(false);
    }
  };

  // Step 3: Handle file upload
  const handleFileUpload = useCallback(async (file: File) => {
    setIsUploading(true);
    setValidationIssues([]);

    try {
      const result = await uploadFile(file);
      setUploadedFile(result);
      setFileData(result.data || []);

      // Validate file against salesmap fields
      validateFileAgainstFields(result.columns, result.data || []);
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setIsUploading(false);
    }
  }, [salesmapFields, selectedObjects]);

  // Validate uploaded file columns against salesmap fields
  const validateFileAgainstFields = (columns: string[], data: Record<string, unknown>[]) => {
    setIsValidatingFile(true);
    const issues: ValidationIssue[] = [];

    // Get all available field labels
    const availableFields: { label: string; type: string; required: boolean; objectType: string }[] = [];
    for (const objType of selectedObjects) {
      const fields = salesmapFields[objType] || [];
      fields.forEach(f => {
        if (!f.is_system) {
          availableFields.push({
            label: f.label,
            type: f.type,
            required: f.required,
            objectType: objType,
          });
        }
      });
    }

    // Check each column
    for (const col of columns) {
      // Try to find matching field
      const matchingField = availableFields.find(f =>
        f.label === col ||
        f.label.toLowerCase() === col.toLowerCase() ||
        col.includes(f.label) ||
        f.label.includes(col)
      );

      if (matchingField) {
        // Check data format
        const sampleValues = data.slice(0, 10).map(row => row[col]).filter(Boolean);
        const formatIssue = checkDataFormat(sampleValues, matchingField.type);

        if (formatIssue) {
          issues.push({
            column: col,
            type: 'warning',
            message: `${matchingField.label} 필드와 매칭됨 - ${formatIssue}`,
            suggestion: getFormatSuggestion(matchingField.type),
          });
        } else {
          issues.push({
            column: col,
            type: 'success',
            message: `${matchingField.label} 필드와 매칭됨`,
          });
        }
      } else {
        // No matching field
        issues.push({
          column: col,
          type: 'error',
          message: '매칭되는 세일즈맵 필드가 없습니다',
          suggestion: '세일즈맵에서 필드를 먼저 생성하거나, 컬럼명을 기존 필드와 동일하게 수정하세요',
        });
      }
    }

    // Check required fields
    const requiredFields = availableFields.filter(f => f.required);
    for (const rf of requiredFields) {
      const hasColumn = columns.some(col =>
        col === rf.label || col.toLowerCase() === rf.label.toLowerCase()
      );
      if (!hasColumn) {
        issues.unshift({
          column: rf.label,
          type: 'error',
          message: `필수 필드 누락: ${rf.label}`,
          suggestion: `파일에 "${rf.label}" 컬럼을 추가하세요`,
        });
      }
    }

    setValidationIssues(issues);
    setIsValidatingFile(false);
  };

  // Check data format against expected type
  const checkDataFormat = (values: unknown[], fieldType: string): string | null => {
    if (values.length === 0) return null;

    switch (fieldType) {
      case 'email':
        const invalidEmails = values.filter(v =>
          typeof v === 'string' && v && !v.includes('@')
        );
        if (invalidEmails.length > 0) {
          return `이메일 형식이 아닌 값이 있습니다 (예: ${invalidEmails[0]})`;
        }
        break;
      case 'phone':
        const invalidPhones = values.filter(v =>
          typeof v === 'string' && v && !/[\d\-+().\s]/.test(v)
        );
        if (invalidPhones.length > 0) {
          return `전화번호 형식이 아닌 값이 있습니다`;
        }
        break;
      case 'number':
        const invalidNumbers = values.filter(v =>
          v !== null && v !== undefined && v !== '' && isNaN(Number(String(v).replace(/,/g, '')))
        );
        if (invalidNumbers.length > 0) {
          return `숫자가 아닌 값이 있습니다 (예: ${invalidNumbers[0]})`;
        }
        break;
      case 'date':
      case 'datetime':
        const invalidDates = values.filter(v => {
          if (!v || v === '') return false;
          const d = new Date(String(v));
          return isNaN(d.getTime());
        });
        if (invalidDates.length > 0) {
          return `날짜 형식이 아닌 값이 있습니다 (예: ${invalidDates[0]})`;
        }
        break;
    }
    return null;
  };

  const getFormatSuggestion = (fieldType: string): string => {
    switch (fieldType) {
      case 'email': return '이메일 형식: user@example.com';
      case 'phone': return '전화번호 형식: 010-1234-5678';
      case 'number': return '숫자만 입력 (콤마 없이)';
      case 'date': return '날짜 형식: YYYY-MM-DD';
      case 'datetime': return '날짜시간 형식: YYYY-MM-DD HH:mm';
      default: return '';
    }
  };

  const successCount = validationIssues.filter(i => i.type === 'success').length;
  const warningCount = validationIssues.filter(i => i.type === 'warning').length;
  const errorCount = validationIssues.filter(i => i.type === 'error').length;
  const canImport = errorCount === 0 && uploadedFile;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">세일즈맵 데이터 가져오기</h1>
          <p className="text-slate-600 mt-1">간단한 3단계로 데이터를 가져오세요</p>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center mb-8">
          {STEPS.map((step, idx) => (
            <div key={idx} className="flex items-center">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                idx < currentStep ? 'bg-green-500 text-white' :
                idx === currentStep ? 'bg-blue-600 text-white' :
                'bg-slate-200 text-slate-500'
              }`}>
                {idx < currentStep ? '✓' : idx + 1}
              </div>
              <span className={`ml-2 text-sm ${idx === currentStep ? 'text-blue-600 font-medium' : 'text-slate-500'}`}>
                {step.title}
              </span>
              {idx < STEPS.length - 1 && (
                <div className={`w-12 h-0.5 mx-3 ${idx < currentStep ? 'bg-green-500' : 'bg-slate-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">

          {/* Step 1: API Key */}
          {currentStep === 0 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-2">세일즈맵 API 연결</h2>
                <p className="text-slate-600 text-sm">세일즈맵 설정에서 API 키를 복사해주세요</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-..."
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {apiError && (
                  <p className="mt-2 text-sm text-red-600">{apiError}</p>
                )}
              </div>

              <button
                onClick={handleValidateApiKey}
                disabled={!apiKey.trim() || isValidating}
                className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {isValidating ? '확인 중...' : '연결 확인'}
              </button>
            </div>
          )}

          {/* Step 2: Object & Field Selection */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-2">오브젝트 선택</h2>
                <p className="text-slate-600 text-sm">가져올 데이터 유형을 선택하세요 (복수 선택 가능)</p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {OBJECT_TYPES.map(obj => (
                  <button
                    key={obj.id}
                    onClick={() => handleObjectToggle(obj.id)}
                    className={`p-4 rounded-lg border-2 text-left transition-all ${
                      selectedObjects.includes(obj.id)
                        ? 'border-blue-500 bg-blue-50'
                        : 'border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <span className="text-2xl">{obj.icon}</span>
                    <span className="ml-2 font-medium">{obj.name}</span>
                  </button>
                ))}
              </div>

              {/* Show fetched fields */}
              {Object.keys(salesmapFields).length > 0 && (
                <div className="border border-slate-200 rounded-lg p-4">
                  <h3 className="font-medium text-slate-800 mb-3">사용 가능한 필드</h3>
                  {selectedObjects.map(objType => {
                    const fields = salesmapFields[objType] || [];
                    const editableFields = fields.filter(f => !f.is_system);
                    return (
                      <div key={objType} className="mb-4 last:mb-0">
                        <p className="text-sm font-medium text-slate-600 mb-2">
                          {OBJECT_TYPES.find(o => o.id === objType)?.name} ({editableFields.length}개)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {editableFields.map(f => (
                            <span
                              key={f.id}
                              className={`px-2 py-1 text-xs rounded ${
                                f.required ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {f.label}{f.required && ' *'}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentStep(0)}
                  className="px-6 py-3 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
                >
                  이전
                </button>
                <button
                  onClick={handleFetchFields}
                  disabled={selectedObjects.length === 0 || isFetchingFields}
                  className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                >
                  {isFetchingFields ? '필드 조회 중...' : '필드 확인 후 다음'}
                </button>
              </div>
            </div>
          )}

          {/* Step 3: File Upload & Validation */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-2">파일 업로드 & 검증</h2>
                <p className="text-slate-600 text-sm">
                  파일을 업로드하면 자동으로 검증합니다
                </p>
              </div>

              {/* File upload area */}
              {!uploadedFile ? (
                <div
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) handleFileUpload(file);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-blue-400 transition-colors"
                >
                  {isUploading ? (
                    <div className="flex flex-col items-center">
                      <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mb-3" />
                      <p className="text-slate-600">업로드 중...</p>
                    </div>
                  ) : (
                    <>
                      <div className="text-4xl mb-3">📁</div>
                      <p className="text-slate-700 font-medium mb-2">파일을 드래그하거나 클릭하여 선택</p>
                      <p className="text-slate-500 text-sm mb-4">CSV, XLSX, XLS 지원</p>
                      <label className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700">
                        파일 선택
                        <input
                          type="file"
                          className="hidden"
                          accept=".csv,.xlsx,.xls"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(file);
                          }}
                        />
                      </label>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {/* Uploaded file info */}
                  <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">📊</span>
                      <div>
                        <p className="font-medium text-green-800">{uploadedFile.filename}</p>
                        <p className="text-sm text-green-600">{uploadedFile.total_rows}행 · {uploadedFile.columns.length}열</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setUploadedFile(null);
                        setFileData([]);
                        setValidationIssues([]);
                      }}
                      className="text-slate-500 hover:text-slate-700"
                    >
                      다른 파일
                    </button>
                  </div>

                  {/* Validation results */}
                  {validationIssues.length > 0 && (
                    <div className="space-y-4">
                      {/* Summary */}
                      <div className="flex gap-4 p-4 bg-slate-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                          <span className="text-sm">성공 {successCount}개</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 bg-amber-500 rounded-full"></span>
                          <span className="text-sm">경고 {warningCount}개</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 bg-red-500 rounded-full"></span>
                          <span className="text-sm">오류 {errorCount}개</span>
                        </div>
                      </div>

                      {/* Issues list */}
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {validationIssues.map((issue, idx) => (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg border ${
                              issue.type === 'success' ? 'bg-green-50 border-green-200' :
                              issue.type === 'warning' ? 'bg-amber-50 border-amber-200' :
                              'bg-red-50 border-red-200'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <span className={`text-sm ${
                                issue.type === 'success' ? 'text-green-600' :
                                issue.type === 'warning' ? 'text-amber-600' :
                                'text-red-600'
                              }`}>
                                {issue.type === 'success' ? '✓' : issue.type === 'warning' ? '⚠' : '✗'}
                              </span>
                              <div className="flex-1">
                                <p className={`font-medium text-sm ${
                                  issue.type === 'success' ? 'text-green-800' :
                                  issue.type === 'warning' ? 'text-amber-800' :
                                  'text-red-800'
                                }`}>
                                  {issue.column}
                                </p>
                                <p className={`text-sm ${
                                  issue.type === 'success' ? 'text-green-600' :
                                  issue.type === 'warning' ? 'text-amber-600' :
                                  'text-red-600'
                                }`}>
                                  {issue.message}
                                </p>
                                {issue.suggestion && (
                                  <p className="text-xs text-slate-500 mt-1">
                                    💡 {issue.suggestion}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentStep(1)}
                  className="px-6 py-3 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
                >
                  이전
                </button>
                <button
                  disabled={!canImport}
                  className={`flex-1 py-3 rounded-lg font-medium ${
                    canImport
                      ? 'bg-green-600 text-white hover:bg-green-700'
                      : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  {canImport ? '가져오기 실행' : errorCount > 0 ? `오류 ${errorCount}개 수정 필요` : '파일을 업로드하세요'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
