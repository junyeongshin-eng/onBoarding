import { useState, useEffect } from 'react';
import { getCRMFields } from '../../services/api';
import type { UploadResponse, FieldMapping, ExtendedCRMField } from '../../types';

interface ReviewStepProps {
  uploadedFile: UploadResponse;
  objectTypes: string[];
  mappings: FieldMapping[];
  customFields: ExtendedCRMField[];
}

const OBJECT_NAMES: Record<string, string> = {
  company: '회사',
  people: '고객',
  lead: '리드',
  deal: '딜',
};

export function ReviewStep({ uploadedFile, objectTypes, mappings, customFields }: ReviewStepProps) {
  const [allFields, setAllFields] = useState<ExtendedCRMField[]>([]);

  useEffect(() => {
    const loadFields = async () => {
      const fields: ExtendedCRMField[] = [];
      for (const objType of objectTypes) {
        const data = await getCRMFields(objType);
        fields.push(...data.fields.map((f) => ({
          ...f,
          objectType: objType,
          objectName: data.name,
        })));
      }
      setAllFields([...fields, ...customFields]);
    };
    loadFields();
  }, [objectTypes, customFields]);

  // Group mappings by object type
  const mappingsByObject = objectTypes.reduce((acc, objType) => {
    acc[objType] = mappings.filter((m) => m.target_field.startsWith(`${objType}.`));
    return acc;
  }, {} as Record<string, FieldMapping[]>);

  return (
    <div className="space-y-6">
      {/* Object Types */}
      <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
            </svg>
          </div>
          <div>
            <p className="text-sm text-blue-600">가져올 오브젝트</p>
            <p className="font-semibold text-blue-800">{objectTypes.map((t) => OBJECT_NAMES[t]).join(', ')}</p>
          </div>
        </div>
      </div>

      {/* File Summary */}
      <div className="p-4 bg-slate-50 rounded-xl">
        <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
          <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          파일 정보
        </h3>
        <div className="grid grid-cols-3 gap-4 text-sm">
          <div>
            <span className="text-slate-500">파일명</span>
            <p className="font-medium text-slate-800">{uploadedFile.filename}</p>
          </div>
          <div>
            <span className="text-slate-500">총 행 수</span>
            <p className="font-medium text-slate-800">{uploadedFile.total_rows}</p>
          </div>
          <div>
            <span className="text-slate-500">매핑된 열</span>
            <p className="font-medium text-slate-800">{mappings.length} / {uploadedFile.columns.length}</p>
          </div>
        </div>
      </div>

      {/* Field Mappings by Object */}
      {objectTypes.map((objType) => (
        <div key={objType} className="p-4 bg-slate-50 rounded-xl">
          <h3 className="font-semibold text-slate-800 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5 text-slate-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4" />
            </svg>
            {OBJECT_NAMES[objType]} 필드 매핑
          </h3>
          {mappingsByObject[objType]?.length > 0 ? (
            <div className="space-y-2">
              {mappingsByObject[objType].map((mapping, index) => (
                <div key={index} className="flex items-center gap-3 text-sm">
                  <span className="text-slate-600 bg-white px-2 py-1 rounded border border-slate-200">
                    {mapping.source_column}
                  </span>
                  <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 8l4 4m0 0l-4 4m4-4H3" />
                  </svg>
                  <span className="font-medium text-slate-800 bg-blue-50 px-2 py-1 rounded border border-blue-200">
                    {allFields.find((f) => `${f.objectType}.${f.id}` === mapping.target_field)?.label || mapping.target_field.split('.')[1]}
                    {allFields.find((f) => `${f.objectType}.${f.id}` === mapping.target_field)?.isCustom && (
                      <span className="ml-1 text-green-600">[사용자 정의]</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-slate-500">매핑된 필드 없음</p>
          )}
        </div>
      ))}

      {/* Custom Fields */}
      {customFields.length > 0 && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
          <h3 className="font-semibold text-green-800 mb-3">
            사용자 정의 필드 ({customFields.length}개)
          </h3>
          <div className="space-y-1 text-sm text-green-700">
            {customFields.map((field) => (
              <p key={field.id}>
                • {OBJECT_NAMES[field.objectType]} &gt; {field.label} ({field.type})
              </p>
            ))}
          </div>
        </div>
      )}

      {/* Confirmation */}
      <div className="p-4 bg-green-50 border border-green-200 rounded-xl">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div>
            <p className="font-medium text-green-800">파일 생성 준비 완료</p>
            <p className="text-sm text-green-600 mt-1">
              "파일 생성"을 클릭하면 {uploadedFile.total_rows}개의 데이터를 Salesmap 가져오기 형식의 Excel 파일로 변환합니다.
            </p>
          </div>
        </div>
      </div>

      {/* Import notes */}
      <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
        <p className="font-medium mb-2">가져오기 시 참고사항:</p>
        <ul className="list-disc list-inside space-y-1">
          <li>고유값 필드(이메일, 회사명 등)가 중복되면 오류가 발생할 수 있습니다</li>
          <li>날짜 형식은 YYYY-MM-DD 또는 YYYY-MM-DD HH:mm 형태여야 합니다</li>
          <li>사용자 정의 필드는 자동으로 생성됩니다</li>
        </ul>
      </div>
    </div>
  );
}
