import type { ReactNode } from 'react';
import { useState, useEffect } from 'react';
import { getObjectTypes } from '../../services/api';
import type { ObjectType } from '../../types';

interface ObjectSelectorProps {
  selectedTypes: string[];
  onSelect: (types: string[]) => void;
}

const ICONS: Record<string, ReactNode> = {
  company: (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
    </svg>
  ),
  contact: (
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

export function ObjectSelector({ selectedTypes, onSelect }: ObjectSelectorProps) {
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
          return (
            <button
              key={type.id}
              onClick={() => toggleType(type.id)}
              className={`p-5 text-left rounded-xl border-2 transition-all ${
                isSelected
                  ? 'border-blue-500 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
              }`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                  <div className={`p-2 rounded-lg ${isSelected ? 'bg-blue-100 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                    {ICONS[type.id]}
                  </div>
                  <h4 className="text-lg font-semibold text-slate-800">{type.name}</h4>
                </div>
                <div className={`w-6 h-6 rounded border-2 flex items-center justify-center ${
                  isSelected ? 'border-blue-500 bg-blue-500' : 'border-slate-300'
                }`}>
                  {isSelected && (
                    <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                    </svg>
                  )}
                </div>
              </div>
              <p className="text-sm text-slate-500">{type.description}</p>
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
