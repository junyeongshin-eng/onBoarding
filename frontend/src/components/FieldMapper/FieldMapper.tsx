import { useState, useEffect } from 'react';
import { getCRMFields } from '../../services/api';
import type { CRMField, FieldMapping } from '../../types';

interface ExtendedCRMField extends CRMField {
  objectType: string;
  objectName: string;
  isCustom?: boolean;
}

interface FieldMapperProps {
  objectTypes: string[];
  sourceColumns: string[];
  mappings: FieldMapping[];
  customFields: ExtendedCRMField[];
  onMappingsChange: (mappings: FieldMapping[]) => void;
  onCustomFieldsChange: (fields: ExtendedCRMField[]) => void;
}

const OBJECT_NAMES: Record<string, string> = {
  company: '회사',
  contact: '고객',
  lead: '리드',
  deal: '딜',
};

const FIELD_TYPES = [
  { id: 'text', label: '텍스트' },
  { id: 'number', label: '숫자' },
  { id: 'email', label: '이메일' },
  { id: 'phone', label: '전화번호' },
  { id: 'date', label: '날짜' },
  { id: 'select', label: '선택' },
  { id: 'url', label: 'URL' },
  { id: 'textarea', label: '긴 텍스트' },
];

export function FieldMapper({
  objectTypes,
  sourceColumns,
  mappings,
  customFields,
  onMappingsChange,
  onCustomFieldsChange,
}: FieldMapperProps) {
  const [allFields, setAllFields] = useState<ExtendedCRMField[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showAddField, setShowAddField] = useState(false);
  const [newField, setNewField] = useState({
    label: '',
    type: 'text',
    objectType: objectTypes[0] || 'contact',
  });

  useEffect(() => {
    const loadFields = async () => {
      setIsLoading(true);
      const fieldsByObject: ExtendedCRMField[] = [];

      for (const objType of objectTypes) {
        const data = await getCRMFields(objType);
        const extendedFields = data.fields.map((f) => ({
          ...f,
          objectType: objType,
          objectName: data.name,
        }));
        fieldsByObject.push(...extendedFields);
      }

      // Add custom fields
      const allFieldsWithCustom = [...fieldsByObject, ...customFields];
      setAllFields(allFieldsWithCustom);
      setIsLoading(false);

      // Auto-map fields with matching names (only if mappings is empty)
      if (mappings.length === 0) {
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
  }, [objectTypes, customFields.length]);

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
    setNewField({ label: '', type: 'text', objectType: objectTypes[0] || 'contact' });
    setShowAddField(false);
  };

  const handleRemoveCustomField = (fieldId: string) => {
    onCustomFieldsChange(customFields.filter((f) => f.id !== fieldId));
    // Remove any mappings using this field
    onMappingsChange(mappings.filter((m) => !m.target_field.endsWith(`.${fieldId}`)));
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

      {/* Status */}
      <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
        <span className="text-sm text-slate-600">
          매핑됨: {mappings.length} / {sourceColumns.length} 열
        </span>
        <span className={`text-sm ${mappedRequiredFields.length === requiredFields.length ? 'text-green-600' : 'text-amber-600'}`}>
          필수 항목: {mappedRequiredFields.length} / {requiredFields.length}
        </span>
      </div>

      {/* Field mappings */}
      <div className="space-y-3">
        {sourceColumns.map((col) => (
          <div key={col} className="flex items-center gap-4 p-3 bg-white border border-slate-200 rounded-lg">
            <div className="flex-1 min-w-0">
              <span className="font-medium text-slate-700 truncate block">{col}</span>
            </div>
            <div className="flex items-center text-slate-400 flex-shrink-0">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
              </svg>
            </div>
            <div className="flex-1 min-w-0">
              <select
                value={getMappedField(col)}
                onChange={(e) => handleMappingChange(col, e.target.value)}
                className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
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
                          {field.isCustom ? ' [사용자 정의]' : ''}
                          {isFieldUsed(fieldKey, col) ? ' (사용됨)' : ''}
                        </option>
                      );
                    })}
                  </optgroup>
                ))}
              </select>
            </div>
          </div>
        ))}
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
    </div>
  );
}
