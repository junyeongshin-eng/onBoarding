import { useState, useEffect } from 'react';
import { autoMapFields } from '../../services/api';
import type { CRMField, FieldMapping, SalesmapField, RecommendedField } from '../../types';

interface ExtendedCRMField extends CRMField {
  objectType: string;
  objectName: string;
  isCustom?: boolean;
  needsCreation?: boolean; // Field recommended but doesn't exist in Salesmap yet
}

interface FieldMapperProps {
  objectTypes: string[];
  sourceColumns: string[];
  mappings: FieldMapping[];
  customFields: ExtendedCRMField[];
  sampleData?: Record<string, unknown>[];
  salesmapFields?: Record<string, SalesmapField[]>;
  onMappingsChange: (mappings: FieldMapping[]) => void;
  onCustomFieldsChange: (fields: ExtendedCRMField[]) => void;
  recommendedFields?: RecommendedField[];
}

const OBJECT_NAMES: Record<string, string> = {
  company: '회사',
  people: '고객',
  lead: '리드',
  deal: '딜',
};

const FIELD_TYPES = [
  { id: 'text', label: '텍스트' },
  { id: 'number', label: '숫자' },
  { id: 'email', label: '이메일' },
  { id: 'phone', label: '전화번호' },
  { id: 'date', label: '날짜' },
  { id: 'datetime', label: '날짜(시간)' },
  { id: 'select', label: '단일 선택' },
  { id: 'multiselect', label: '복수 선택' },
  { id: 'boolean', label: 'True/False' },
  { id: 'user', label: '사용자(단일)' },
  { id: 'users', label: '사용자(복수)' },
  { id: 'url', label: 'URL' },
  { id: 'textarea', label: '긴 텍스트' },
  { id: 'relation', label: '연결(레코드)' },
  { id: 'pipeline', label: '파이프라인' },
  { id: 'pipeline_stage', label: '파이프라인 단계' },
];

const FIELD_TYPE_FORMATS: Record<string, { format: string; example: string }> = {
  text: { format: '자유 텍스트', example: '홍길동, 서울시 강남구' },
  number: { format: '숫자만 입력 (콤마 없이)', example: '1000000' },
  email: { format: '이메일 형식', example: 'user@company.com' },
  phone: { format: '전화번호', example: '010-1234-5678' },
  date: { format: 'YYYY-MM-DD', example: '2025-01-15' },
  datetime: { format: 'YYYY-MM-DD HH:mm', example: '2025-01-15 14:30' },
  select: { format: '사전 정의된 옵션 중 1개', example: '진행중' },
  multiselect: { format: '옵션을 쉼표로 구분', example: '옵션1, 옵션2' },
  boolean: { format: 'TRUE 또는 FALSE', example: 'TRUE' },
  user: { format: '워크스페이스 사용자 이메일', example: 'user@company.com' },
  users: { format: '이메일을 쉼표로 구분', example: 'a@co.com, b@co.com' },
  url: { format: 'URL 형식', example: 'https://example.com' },
  textarea: { format: '자유 텍스트 (여러 줄 가능)', example: '긴 설명 텍스트...' },
  relation: { format: '연결된 레코드 이름 또는 이메일', example: '홍길동 또는 hong@test.com' },
  pipeline: { format: '파이프라인 이름', example: 'Sales Pipeline' },
  pipeline_stage: { format: '파이프라인 단계 이름', example: 'Qualification' },
};

export function FieldMapper({
  objectTypes,
  sourceColumns,
  mappings,
  customFields,
  sampleData = [],
  salesmapFields = {},
  onMappingsChange,
  onCustomFieldsChange,
  recommendedFields = [],
}: FieldMapperProps) {
  const [allFields, setAllFields] = useState<ExtendedCRMField[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddField, setShowAddField] = useState(false);
  const [showFormatGuide, setShowFormatGuide] = useState(false);
  const [isAiMapping, setIsAiMapping] = useState(false);
  const [aiConfidence, setAiConfidence] = useState<Record<string, number>>({});
  const [aiError, setAiError] = useState<string | null>(null);
  const [newField, setNewField] = useState({
    label: '',
    type: 'text',
    objectType: objectTypes[0] || 'people',
  });

  useEffect(() => {
    const loadFields = () => {
      setIsLoading(true);
      const fieldsByObject: ExtendedCRMField[] = [];

      // Use salesmapFields if available, otherwise fall back to empty
      for (const objType of objectTypes) {
        const fields = salesmapFields[objType] || [];
        const extendedFields = fields
          .filter(f => !f.is_system) // Exclude system fields
          .map((f) => ({
            id: f.id,
            label: f.label,
            type: f.type,
            required: f.required,
            objectType: objType,
            objectName: OBJECT_NAMES[objType] || objType,
            isCustom: f.is_custom,
            needsCreation: false,
          }));
        fieldsByObject.push(...extendedFields);
      }

      // Add recommended fields that don't exist in Salesmap
      for (const rf of recommendedFields) {
        const existingFields = salesmapFields[rf.objectType] || [];
        const existsInSalesmap = existingFields.some(f => f.id === rf.fieldId);

        if (!existsInSalesmap) {
          // Check if already added
          const alreadyAdded = fieldsByObject.some(
            f => f.objectType === rf.objectType && f.id === rf.fieldId
          );
          if (!alreadyAdded) {
            fieldsByObject.push({
              id: rf.fieldId,
              label: rf.fieldLabel,
              type: 'text', // Default type for recommended fields
              required: false,
              objectType: rf.objectType,
              objectName: OBJECT_NAMES[rf.objectType] || rf.objectType,
              needsCreation: true,
            });
          }
        }
      }

      // Add custom fields
      const allFieldsWithCustom = [...fieldsByObject, ...customFields];
      setAllFields(allFieldsWithCustom);
      setIsLoading(false);

      // Auto-map fields with matching names (only if mappings is empty)
      if (mappings.length === 0 && allFieldsWithCustom.length > 0) {
        const autoMappings: FieldMapping[] = [];
        sourceColumns.forEach((col) => {
          const normalizedCol = col.toLowerCase().replace(/[_\s-]/g, '');
          const matchingField = allFieldsWithCustom.find((f) => {
            const normalizedLabel = f.label.toLowerCase().replace(/[_\s-]/g, '');
            const normalizedId = f.id.toLowerCase().replace(/[_\s-]/g, '');
            return normalizedCol === normalizedLabel || normalizedCol === normalizedId;
          });
          if (matchingField) {
            autoMappings.push({
              source_column: col,
              target_field: `${matchingField.objectType}.${matchingField.id}`,
            });
          }
        });
        if (autoMappings.length > 0) {
          onMappingsChange(autoMappings);
        }
      }
    };

    if (objectTypes.length > 0) {
      loadFields();
    }
  }, [objectTypes, customFields.length, salesmapFields, recommendedFields]);

  const handleMappingChange = (sourceColumn: string, targetField: string) => {
    const newMappings = mappings.filter((m) => m.source_column !== sourceColumn);
    if (targetField) {
      newMappings.push({ source_column: sourceColumn, target_field: targetField });
    }
    onMappingsChange(newMappings);
  };

  const getMappedField = (sourceColumn: string) => {
    return mappings.find((m) => m.source_column === sourceColumn)?.target_field || '';
  };

  const isFieldUsed = (fieldKey: string, currentColumn: string) => {
    return mappings.some((m) => m.target_field === fieldKey && m.source_column !== currentColumn);
  };

  const handleAddCustomField = () => {
    if (!newField.label.trim()) return;

    const customFieldId = `custom_${Date.now()}`;
    const newCustomField: ExtendedCRMField = {
      id: customFieldId,
      label: newField.label,
      type: newField.type,
      required: false,
      objectType: newField.objectType,
      objectName: OBJECT_NAMES[newField.objectType],
      isCustom: true,
    };

    onCustomFieldsChange([...customFields, newCustomField]);
    setNewField({ label: '', type: 'text', objectType: objectTypes[0] || 'people' });
    setShowAddField(false);
  };

  const handleRemoveCustomField = (fieldId: string) => {
    onCustomFieldsChange(customFields.filter((f) => f.id !== fieldId));
    // Remove any mappings using this field
    onMappingsChange(mappings.filter((m) => !m.target_field.endsWith(`.${fieldId}`)));
  };

  const handleAiAutoMap = async () => {
    setIsAiMapping(true);
    setAiError(null);
    try {
      // Build available fields from salesmapFields for AI
      const availableFields = Object.entries(salesmapFields).flatMap(([objType, fields]) =>
        fields
          .filter(f => !f.is_system)
          .map(f => ({
            key: `${objType}.${f.id}`,
            id: f.id,
            label: f.label,
            object_type: objType,
            description: f.label,
          }))
      );

      // Also include recommended fields that need to be created
      for (const rf of recommendedFields) {
        const existingFields = salesmapFields[rf.objectType] || [];
        const existsInSalesmap = existingFields.some(f => f.id === rf.fieldId);

        if (!existsInSalesmap) {
          const alreadyAdded = availableFields.some(
            f => f.object_type === rf.objectType && f.id === rf.fieldId
          );
          if (!alreadyAdded) {
            availableFields.push({
              key: `${rf.objectType}.${rf.fieldId}`,
              id: rf.fieldId,
              label: rf.fieldLabel,
              object_type: rf.objectType,
              description: `${rf.fieldLabel} (생성 필요)`,
            });
          }
        }
      }

      const result = await autoMapFields(sourceColumns, sampleData, objectTypes, availableFields);

      if (result.error) {
        setAiError(result.error);
        return;
      }

      // Apply AI mappings (including fields that need to be created)
      const newMappings: FieldMapping[] = [];
      for (const [sourceCol, targetField] of Object.entries(result.mappings)) {
        if (targetField) {
          // Verify the target field exists in allFields (includes needsCreation fields)
          const [objType, fieldId] = targetField.split('.');
          const fieldExists = allFields.some(
            f => f.objectType === objType && f.id === fieldId
          );
          if (fieldExists) {
            newMappings.push({
              source_column: sourceCol,
              target_field: targetField,
            });
          }
        }
      }

      if (newMappings.length > 0) {
        onMappingsChange(newMappings);
        setAiConfidence(result.confidence);
      } else {
        setAiError('AI가 적합한 매핑을 찾지 못했습니다');
      }
    } catch (error) {
      setAiError(error instanceof Error ? error.message : 'AI 자동 매핑 실패');
    } finally {
      setIsAiMapping(false);
    }
  };

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-600 bg-green-50';
    if (confidence >= 0.5) return 'text-amber-600 bg-amber-50';
    return 'text-red-600 bg-red-50';
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <svg className="animate-spin h-8 w-8 text-blue-600" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
      </div>
    );
  }

  // Group fields by object type
  const fieldsByObject = objectTypes.reduce((acc, objType) => {
    acc[objType] = [...allFields, ...customFields].filter((f) => f.objectType === objType);
    return acc;
  }, {} as Record<string, ExtendedCRMField[]>);

  const requiredFields = allFields.filter((f) => f.required);
  const mappedRequiredFields = requiredFields.filter((f) =>
    mappings.some((m) => m.target_field === `${f.objectType}.${f.id}`)
  );

  return (
    <div className="space-y-6">
      {/* Selected objects info */}
      <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm text-blue-700">
          <span className="font-medium">선택된 오브젝트:</span>{' '}
          {objectTypes.map((t) => OBJECT_NAMES[t]).join(', ')}
        </p>
      </div>

      {/* Recommended Fields from Consulting */}
      {recommendedFields.length > 0 && (
        <div className="p-4 border border-slate-200 rounded-lg">
          <h4 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
            </svg>
            컨설팅 기반 추천 필드
          </h4>
          <p className="text-sm text-slate-600 mb-3">
            비즈니스 유형에 따라 추천된 필드입니다. 아래 필드들을 매핑해주세요.
          </p>
          <div className="flex flex-wrap gap-2">
            {recommendedFields.map((rf) => {
              // Check if the field exists in Salesmap
              const fields = salesmapFields[rf.objectType] || [];
              const existsInSalesmap = fields.some(f => f.id === rf.fieldId);

              return (
                <div
                  key={`${rf.objectType}.${rf.fieldId}`}
                  className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${
                    existsInSalesmap
                      ? 'bg-green-50 border border-green-200 text-green-700'
                      : 'bg-orange-50 border border-orange-200 text-orange-700'
                  }`}
                  title={rf.reason}
                >
                  {existsInSalesmap ? (
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  )}
                  <span className="font-medium">{OBJECT_NAMES[rf.objectType]}</span>
                  <span>&gt;</span>
                  <span>{rf.fieldLabel}</span>
                  {!existsInSalesmap && (
                    <span className="text-xs bg-orange-100 px-1.5 py-0.5 rounded">
                      세일즈맵에서 생성 필요
                    </span>
                  )}
                </div>
              );
            })}
          </div>

          {/* Warning for missing fields */}
          {recommendedFields.some(rf => {
            const fields = salesmapFields[rf.objectType] || [];
            return !fields.some(f => f.id === rf.fieldId);
          }) && (
            <div className="mt-3 p-3 bg-orange-50 border border-orange-200 rounded-lg">
              <p className="text-sm text-orange-700 flex items-start gap-2">
                <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <span>
                  일부 추천 필드가 세일즈맵에 없습니다. 해당 필드를 세일즈맵에서 먼저 생성하거나,
                  아래 "새 필드 추가" 버튼으로 커스텀 필드를 만들어 매핑할 수 있습니다.
                </span>
              </p>
            </div>
          )}
        </div>
      )}

      {/* Available Salesmap Fields */}
      {Object.keys(salesmapFields).length > 0 && (
        <div className="border border-green-200 rounded-lg overflow-hidden">
          <div className="p-4 bg-green-50">
            <div className="flex items-center gap-2 mb-2">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span className="font-medium text-green-800">세일즈맵에서 조회된 필드 (사용 가능한 필드)</span>
            </div>
            <p className="text-sm text-green-700 mb-3">
              아래 필드만 매핑 가능합니다. 필요한 필드가 없으면 세일즈맵에서 먼저 생성해주세요.
            </p>
            <div className="flex gap-4 text-xs">
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 bg-slate-200 rounded"></span>
                <span className="text-slate-600">기본 필드</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 bg-purple-200 rounded"></span>
                <span className="text-purple-600">커스텀 필드</span>
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-3 bg-red-200 rounded"></span>
                <span className="text-red-600">필수 필드</span>
              </span>
            </div>
          </div>
          <div className="p-4 bg-white border-t border-green-200">
            <div className="grid gap-4">
              {objectTypes.map((objType) => {
                const fields = (salesmapFields[objType] || []).filter(f => !f.is_system);
                return (
                  <div key={objType}>
                    <div className="font-medium text-slate-800 mb-2 flex items-center gap-2">
                      <span className="px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded">
                        {OBJECT_NAMES[objType]}
                      </span>
                      <span className="text-slate-500 text-sm">({fields.length}개 필드)</span>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {fields.map((field) => (
                        <span
                          key={field.id}
                          className={`px-2 py-1 text-xs rounded border ${
                            field.required
                              ? 'bg-red-50 border-red-200 text-red-700'
                              : field.is_custom
                              ? 'bg-purple-50 border-purple-200 text-purple-700'
                              : 'bg-slate-50 border-slate-200 text-slate-600'
                          }`}
                          title={`${field.label} (${field.type})${field.required ? ' - 필수' : ''}${field.is_custom ? ' - 커스텀 필드' : ''}`}
                        >
                          {field.is_custom && (
                            <span className="mr-1 text-purple-500">
                              <svg className="w-3 h-3 inline-block" fill="currentColor" viewBox="0 0 20 20">
                                <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
                              </svg>
                            </span>
                          )}
                          {field.label}
                          {field.required && <span className="text-red-500 ml-1">*</span>}
                        </span>
                      ))}
                      {fields.length === 0 && (
                        <span className="text-slate-400 text-sm">조회된 필드가 없습니다</span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Warning if no fields found */}
      {Object.keys(salesmapFields).length === 0 && (
        <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="font-medium text-amber-800">세일즈맵 필드를 조회하지 못했습니다</span>
          </div>
          <p className="text-sm text-amber-700 mt-1">
            기본 필드 목록을 사용합니다. API 연결 상태를 확인해주세요.
          </p>
        </div>
      )}

      {/* Status and AI Auto-Map Button */}
      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
        <div className="flex items-center gap-4">
          <span className="text-sm text-slate-600">
            매핑됨: {mappings.length} / {sourceColumns.length} 열
          </span>
          <span className={`text-sm ${mappedRequiredFields.length === requiredFields.length ? 'text-green-600' : 'text-amber-600'}`}>
            필수 항목: {mappedRequiredFields.length} / {requiredFields.length}
          </span>
        </div>
        <button
          onClick={handleAiAutoMap}
          disabled={isAiMapping || sourceColumns.length === 0}
          className="px-4 py-2 bg-purple-600 text-white rounded-lg font-medium hover:bg-purple-700 disabled:bg-purple-300 disabled:cursor-not-allowed flex items-center gap-2 text-sm"
        >
          {isAiMapping ? (
            <>
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              AI 분석 중...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              AI 자동 매핑
            </>
          )}
        </button>
      </div>

      {/* AI Error Message */}
      {aiError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm flex items-center gap-2">
          <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {aiError}
        </div>
      )}

      {/* AI Confidence Info */}
      {Object.keys(aiConfidence).length > 0 && (
        <div className="p-3 bg-purple-50 border border-purple-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
            <span className="font-medium text-purple-800">AI 자동 매핑 완료</span>
          </div>
          <p className="text-sm text-purple-700">
            {Object.keys(aiConfidence).length}개 필드가 자동으로 매핑되었습니다.
            결과를 확인하고 필요시 수정하세요.
          </p>
        </div>
      )}

      {/* Field Type Format Guide */}
      <div className="border border-slate-200 rounded-lg overflow-hidden">
        <button
          onClick={() => setShowFormatGuide(!showFormatGuide)}
          className="w-full p-3 bg-slate-50 flex items-center justify-between hover:bg-slate-100 transition-colors"
        >
          <span className="font-medium text-slate-700 flex items-center gap-2">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            필드 유형별 입력 형식 안내
          </span>
          <svg className={`w-5 h-5 text-slate-500 transition-transform ${showFormatGuide ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {showFormatGuide && (
          <div className="p-4 bg-white border-t border-slate-200">
            <div className="grid gap-2 text-sm">
              <div className="grid grid-cols-3 gap-2 font-medium text-slate-700 pb-2 border-b border-slate-200">
                <span>필드 유형</span>
                <span>입력 형식</span>
                <span>예시</span>
              </div>
              {Object.entries(FIELD_TYPE_FORMATS).map(([type, info]) => (
                <div key={type} className="grid grid-cols-3 gap-2 text-slate-600 py-1">
                  <span className="font-medium">{FIELD_TYPES.find(t => t.id === type)?.label || type}</span>
                  <span>{info.format}</span>
                  <code className="bg-slate-100 px-1 rounded text-xs">{info.example}</code>
                </div>
              ))}
              <div className="mt-2 p-2 bg-amber-50 rounded text-amber-700 text-xs">
                <strong>참고:</strong> 파일(복수) 유형은 Import를 지원하지 않습니다. 계산 필드는 자동 계산되므로 Import가 불필요합니다.
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Field mappings */}
      <div className="space-y-3">
        {sourceColumns.map((col) => {
          const confidence = aiConfidence[col];
          return (
            <div key={col} className="flex items-center gap-4 p-3 bg-white border border-slate-200 rounded-lg">
              <div className="flex-1 min-w-0">
                <span className="font-medium text-slate-700 truncate block">{col}</span>
              </div>
              <div className="flex items-center text-slate-400 flex-shrink-0">
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                </svg>
              </div>
              <div className="flex-1 min-w-0 flex items-center gap-2">
                <select
                  value={getMappedField(col)}
                  onChange={(e) => handleMappingChange(col, e.target.value)}
                  className="flex-1 px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                >
                  <option value="">-- 이 열 건너뛰기 --</option>
                  {objectTypes.map((objType) => (
                    <optgroup key={objType} label={OBJECT_NAMES[objType]}>
                      {fieldsByObject[objType]?.map((field) => {
                        const fieldKey = `${objType}.${field.id}`;
                        return (
                          <option
                            key={fieldKey}
                            value={fieldKey}
                            disabled={isFieldUsed(fieldKey, col)}
                          >
                            {field.label}
                            {field.required ? ' *' : ''}
                            {field.unique ? ' (고유값)' : ''}
                            {field.isCustom ? ' [커스텀]' : ''}
                            {field.needsCreation ? ' ⚠️생성필요' : ''}
                            {isFieldUsed(fieldKey, col) ? ' (사용됨)' : ''}
                          </option>
                        );
                      })}
                    </optgroup>
                  ))}
                </select>
                {confidence !== undefined && (
                  <span
                    className={`px-2 py-1 text-xs font-medium rounded ${getConfidenceColor(confidence)}`}
                    title={`AI 신뢰도: ${Math.round(confidence * 100)}%`}
                  >
                    {Math.round(confidence * 100)}%
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add custom field button */}
      {!showAddField ? (
        <button
          onClick={() => setShowAddField(true)}
          className="w-full p-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-600 hover:border-blue-400 hover:text-blue-600 transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          새 필드 추가
        </button>
      ) : (
        <div className="p-4 bg-slate-50 rounded-lg border border-slate-200">
          <h4 className="font-medium text-slate-800 mb-3">새 필드 추가</h4>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm text-slate-600 mb-1">필드명</label>
              <input
                type="text"
                value={newField.label}
                onChange={(e) => setNewField({ ...newField, label: e.target.value })}
                placeholder="예: 고객 등급"
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">필드 유형</label>
              <select
                value={newField.type}
                onChange={(e) => setNewField({ ...newField, type: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {FIELD_TYPES.map((type) => (
                  <option key={type.id} value={type.id}>{type.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm text-slate-600 mb-1">오브젝트</label>
              <select
                value={newField.objectType}
                onChange={(e) => setNewField({ ...newField, objectType: e.target.value })}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                {objectTypes.map((t) => (
                  <option key={t} value={t}>{OBJECT_NAMES[t]}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="flex gap-2 mt-3">
            <button
              onClick={handleAddCustomField}
              disabled={!newField.label.trim()}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-blue-300 disabled:cursor-not-allowed"
            >
              추가
            </button>
            <button
              onClick={() => setShowAddField(false)}
              className="px-4 py-2 bg-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-300"
            >
              취소
            </button>
          </div>
        </div>
      )}

      {/* Custom fields list */}
      {customFields.length > 0 && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <h4 className="font-medium text-green-800 mb-2">사용자 정의 필드 ({customFields.length}개)</h4>
          <div className="space-y-2">
            {customFields.map((field) => (
              <div key={field.id} className="flex items-center justify-between text-sm">
                <span className="text-green-700">
                  {OBJECT_NAMES[field.objectType]} &gt; {field.label} ({FIELD_TYPES.find((t) => t.id === field.type)?.label})
                </span>
                <button
                  onClick={() => handleRemoveCustomField(field.id)}
                  className="text-red-500 hover:text-red-700"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Required fields warning */}
      {mappedRequiredFields.length < requiredFields.length && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-amber-700 text-sm">
          모든 필수 필드를 매핑해 주세요:{' '}
          {requiredFields
            .filter((f) => !mappings.some((m) => m.target_field === `${f.objectType}.${f.id}`))
            .map((f) => `${f.objectName} > ${f.label}`)
            .join(', ')}
        </div>
      )}

      {/* Fields that need to be created warning */}
      {(() => {
        const fieldsNeedingCreation = mappings
          .map(m => {
            const [objType, fieldId] = m.target_field.split('.');
            return allFields.find(f => f.objectType === objType && f.id === fieldId && f.needsCreation);
          })
          .filter(Boolean) as ExtendedCRMField[];

        if (fieldsNeedingCreation.length === 0) return null;

        return (
          <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg">
            <div className="flex items-start gap-2">
              <svg className="w-5 h-5 text-orange-600 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <div>
                <p className="font-medium text-orange-800 mb-2">
                  아래 필드는 세일즈맵에서 먼저 생성해야 합니다:
                </p>
                <div className="flex flex-wrap gap-2">
                  {fieldsNeedingCreation.map(field => (
                    <span
                      key={`${field.objectType}.${field.id}`}
                      className="px-2 py-1 bg-orange-100 text-orange-700 text-sm rounded"
                    >
                      {OBJECT_NAMES[field.objectType]} &gt; {field.label}
                    </span>
                  ))}
                </div>
                <p className="text-sm text-orange-700 mt-2">
                  세일즈맵 설정에서 해당 필드를 생성한 후 가져오기를 진행하세요.
                </p>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
