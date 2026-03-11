import type { ReactNode } from 'react';
import { useState, useEffect } from 'react';
import { getObjectTypes } from '../../services/api';
import type { ObjectType, SalesmapField, MissingFieldInfo } from '../../types';

interface ObjectSelectorProps {
  selectedTypes: string[];
  onSelect: (types: string[]) => void;
  salesmapFields?: Record<string, SalesmapField[]>;
  isFetchingFields?: boolean;
  recommendedTypes?: string[];
  missingFields?: MissingFieldInfo[];
  fieldValidationDone?: boolean;
  onRecheckFields?: () => void;
}

const ICONS: Record<string, ReactNode> = {
  company: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  people: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
    </svg>
  ),
  lead: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
    </svg>
  ),
  deal: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
};

export function ObjectSelector({
  selectedTypes,
  onSelect,
  salesmapFields = {},
  isFetchingFields = false,
  recommendedTypes = [],
  missingFields = [],
  fieldValidationDone = false,
  onRecheckFields,
}: ObjectSelectorProps) {

  const OBJECT_NAMES: Record<string, string> = {
    company: '회사',
    people: '고객',
    lead: '리드',
    deal: '딜',
  };
  const [objectTypes, setObjectTypes] = useState<ObjectType[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    getObjectTypes().then((types) => {
      setObjectTypes(types);
      setIsLoading(false);
    });
  }, []);

  const toggleType = (typeId: string) => {
    if (selectedTypes.includes(typeId)) {
      onSelect(selectedTypes.filter((t) => t !== typeId));
    } else {
      onSelect([...selectedTypes, typeId]);
    }
  };

  // Get field count for an object type (excluding system fields)
  const getFieldCount = (typeId: string) => {
    const fields = salesmapFields[typeId] || [];
    return fields.filter(f => !f.is_system).length;
  };

  // Check if deal or lead is selected without company or people
  const hasDealOrLead = selectedTypes.includes('deal') || selectedTypes.includes('lead');
  const hasCompanyOrPeople = selectedTypes.includes('company') || selectedTypes.includes('people');
  const needsConnectionObject = hasDealOrLead && !hasCompanyOrPeople;

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

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600 mb-4">
        가져올 데이터에 포함된 오브젝트를 모두 선택해주세요. 여러 개를 선택할 수 있습니다.
      </p>

      <div className="grid grid-cols-2 gap-4">
        {objectTypes.map((type) => {
          const isSelected = selectedTypes.includes(type.id);
          const isRecommended = recommendedTypes.includes(type.id);
          const fieldCount = getFieldCount(type.id);
          const hasFields = fieldCount > 0;
          // Show orange highlight when deal/lead is selected but company/people is needed
          const isConnectionRequired = needsConnectionObject && (type.id === 'company' || type.id === 'people');
          return (
            <button
              key={type.id}
              onClick={() => toggleType(type.id)}
              className={`relative p-5 text-left rounded-xl border-2 transition-all ${
                isSelected
                  ? 'border-blue-500 bg-blue-50'
                  : isConnectionRequired
                  ? 'border-orange-400 bg-orange-50 hover:border-orange-500'
                  : isRecommended
                  ? 'border-green-300 bg-green-50/50 hover:border-green-400'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              {/* Connection required badge */}
              {isConnectionRequired && !isSelected && (
                <span className="absolute top-2 right-2 px-2 py-0.5 bg-orange-100 text-orange-700 text-xs font-medium rounded-full flex items-center gap-1">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  필요
                </span>
              )}
              {/* Recommended badge */}
              {isRecommended && !isConnectionRequired && (
                <span className="absolute top-2 right-2 px-2 py-0.5 bg-green-100 text-green-700 text-xs font-medium rounded-full">
                  추천
                </span>
              )}
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${
                    isSelected
                      ? 'bg-blue-100 text-blue-600'
                      : isConnectionRequired
                      ? 'bg-orange-100 text-orange-600'
                      : isRecommended
                      ? 'bg-green-100 text-green-600'
                      : 'bg-slate-100 text-slate-500'
                  }`}>
                    {ICONS[type.id]}
                  </div>
                  <h4 className="text-lg font-semibold text-slate-800">{type.name}</h4>
                </div>
                <div className={`w-6 h-6 rounded border-2 flex items-center justify-center ${
                  isSelected
                    ? 'border-blue-500 bg-blue-500'
                    : isConnectionRequired
                    ? 'border-orange-400 bg-orange-100'
                    : 'border-slate-300'
                }`}>
                  {isSelected && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                  {isConnectionRequired && !isSelected && (
                    <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01" />
                    </svg>
                  )}
                </div>
              </div>
              <p className="text-sm text-slate-500">{type.description}</p>

              {/* Show field status for selected objects */}
              {isSelected && (
                <div className="mt-3 pt-3 border-t border-blue-200">
                  {isFetchingFields ? (
                    <div className="flex items-center gap-2 text-sm text-blue-600">
                      <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                      </svg>
                      <span>필드 조회 중...</span>
                    </div>
                  ) : hasFields ? (
                    <div className="flex items-center gap-2 text-sm text-green-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>{fieldCount}개 필드 조회됨</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-amber-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                      <span>기본 필드 사용</span>
                    </div>
                  )}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {selectedTypes.length > 0 && (
        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <p className="text-sm text-blue-700">
            <span className="font-medium">{selectedTypes.length}개 오브젝트 선택됨:</span>{' '}
            {selectedTypes.map((t) => objectTypes.find((o) => o.id === t)?.name).join(', ')}
          </p>
        </div>
      )}

      {/* Warning when deal/lead is selected without company/people */}
      {needsConnectionObject && (
        <div className="mt-4 p-4 bg-orange-50 border border-orange-300 rounded-xl">
          <div className="flex items-start gap-3">
            <div className="p-2 bg-orange-100 rounded-lg">
              <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <div>
              <h4 className="font-semibold text-orange-800">연결할 오브젝트를 선택해주세요</h4>
              <p className="text-sm text-orange-700 mt-1">
                {selectedTypes.includes('deal') && selectedTypes.includes('lead')
                  ? '딜과 리드는'
                  : selectedTypes.includes('deal')
                  ? '딜은'
                  : '리드는'
                } 같은 행에 있는 고객 또는 회사와 자동으로 연결됩니다.
                <br />
                <span className="font-medium">회사</span> 또는 <span className="font-medium">고객</span> 중 하나 이상을 선택해주세요.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Required fields info */}
      {selectedTypes.length > 0 && (
        <div className="mt-6 p-4 bg-amber-50 border border-amber-200 rounded-xl">
          <h4 className="font-medium text-amber-800 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            오브젝트별 필수 입력 조건
          </h4>
          <div className="space-y-2 text-sm">
            {selectedTypes.includes('company') && (
              <div className="flex items-start gap-2 text-amber-700">
                <span className="font-medium min-w-[60px]">회사:</span>
                <span>'이름' 필드 필수 (헤더: <code className="bg-amber-100 px-1 rounded">Organization - 이름</code>)</span>
              </div>
            )}
            {selectedTypes.includes('people') && (
              <div className="flex items-start gap-2 text-amber-700">
                <span className="font-medium min-w-[60px]">고객:</span>
                <span>'이름' 필드 필수 (헤더: <code className="bg-amber-100 px-1 rounded">People - 이름</code>)</span>
              </div>
            )}
            {selectedTypes.includes('lead') && (
              <div className="flex items-start gap-2 text-amber-700">
                <span className="font-medium min-w-[60px]">리드:</span>
                <span>'이름' 필드 필수 (헤더: <code className="bg-amber-100 px-1 rounded">Lead - 이름</code>)</span>
              </div>
            )}
            {selectedTypes.includes('deal') && (
              <div className="flex items-start gap-2 text-amber-700">
                <span className="font-medium min-w-[60px]">딜:</span>
                <span>'이름', '파이프라인', '파이프라인 단계' 필수</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Missing fields warning */}
      {fieldValidationDone && missingFields.length > 0 && (
        <div className="mt-6 p-4 bg-red-50 border border-red-200 rounded-xl">
          <h4 className="font-medium text-red-800 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            누락된 필드가 있습니다
          </h4>
          <p className="text-sm text-red-600 mb-3">
            다음 필드가 세일즈맵에 존재하지 않습니다. 세일즈맵에서 필드를 추가한 후 다시 확인해주세요.
          </p>
          <div className="space-y-2 mb-4">
            {missingFields.map((field, idx) => (
              <div key={idx} className="flex items-center gap-2 text-sm bg-white p-2 rounded-lg border border-red-100">
                <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium">
                  {OBJECT_NAMES[field.objectType] || field.objectType}
                </span>
                <span className="font-medium text-red-800">{field.fieldLabel}</span>
                <span className="text-red-600">- {field.reason}</span>
              </div>
            ))}
          </div>
          {onRecheckFields && (
            <button
              onClick={onRecheckFields}
              disabled={isFetchingFields}
              className="w-full py-2.5 bg-red-600 hover:bg-red-700 disabled:bg-red-300 text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
            >
              {isFetchingFields ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  확인 중...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  다시 확인하기
                </>
              )}
            </button>
          )}
        </div>
      )}

      {/* Field validation success */}
      {fieldValidationDone && missingFields.length === 0 && selectedTypes.length > 0 && !needsConnectionObject && (
        <div className="mt-6 p-4 bg-green-50 border border-green-200 rounded-xl">
          <div className="flex items-center gap-2 text-green-700">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="font-medium">✓ 다음 단계로 진행할 수 있습니다</span>
          </div>
          <p className="text-sm text-green-600 mt-1">
            모든 필수 필드가 세일즈맵에 존재합니다.
          </p>
        </div>
      )}

      {/* Progress blocking reasons */}
      {selectedTypes.length > 0 && (
        <div className="mt-6 p-4 bg-slate-100 border border-slate-200 rounded-xl">
          <h4 className="font-medium text-slate-700 mb-3 flex items-center gap-2">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
            </svg>
            다음 단계 진행 조건
          </h4>
          <div className="space-y-2 text-sm">
            {/* Condition 1: Object types selected */}
            <div className="flex items-center gap-2">
              {selectedTypes.length > 0 ? (
                <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" strokeWidth={2} />
                </svg>
              )}
              <span className={selectedTypes.length > 0 ? 'text-green-700' : 'text-slate-500'}>
                오브젝트 선택 완료
              </span>
            </div>

            {/* Condition 2: Connection object (if deal/lead selected) */}
            {hasDealOrLead && (
              <div className="flex items-center gap-2">
                {hasCompanyOrPeople ? (
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-orange-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                )}
                <span className={hasCompanyOrPeople ? 'text-green-700' : 'text-orange-600 font-medium'}>
                  {hasCompanyOrPeople ? '연결 오브젝트 선택됨' : '회사 또는 고객 선택 필요 (딜/리드 연결용)'}
                </span>
              </div>
            )}

            {/* Condition 3: Field validation */}
            <div className="flex items-center gap-2">
              {isFetchingFields ? (
                <svg className="w-4 h-4 text-blue-600 animate-spin" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              ) : fieldValidationDone ? (
                missingFields.length === 0 ? (
                  <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )
              ) : (
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <circle cx="12" cy="12" r="10" strokeWidth={2} />
                </svg>
              )}
              <span className={
                isFetchingFields ? 'text-blue-600' :
                fieldValidationDone && missingFields.length === 0 ? 'text-green-700' :
                fieldValidationDone && missingFields.length > 0 ? 'text-red-600 font-medium' :
                'text-slate-500'
              }>
                {isFetchingFields ? '필드 검증 중...' :
                 fieldValidationDone && missingFields.length === 0 ? '필드 검증 완료' :
                 fieldValidationDone && missingFields.length > 0 ? `누락된 필드 ${missingFields.length}개 (위에서 확인)` :
                 '필드 검증 대기'}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Object relationship info */}
      <div className="mt-6 p-4 bg-slate-50 rounded-xl">
        <h4 className="font-medium text-slate-700 mb-2">오브젝트 관계</h4>
        <div className="text-sm text-slate-600 space-y-1">
          <p>• <span className="font-medium">회사</span> → 여러 <span className="font-medium">고객</span>이 소속될 수 있음</p>
          <p>• <span className="font-medium">고객</span> → 여러 <span className="font-medium">리드/딜</span>에 연결 가능</p>
          <p>• <span className="font-medium">리드</span> → <span className="font-medium">딜</span>로 전환 가능</p>
        </div>
      </div>
    </div>
  );
}
