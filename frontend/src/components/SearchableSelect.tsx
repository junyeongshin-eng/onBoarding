import { useState, useRef, useEffect, useCallback } from 'react';

export interface FieldOption {
  key: string;
  name: string;
  required?: boolean;
  isCustom?: boolean;
}

export interface GroupedOption {
  objectType: string;
  objectName: string;
  fields: FieldOption[];
}

interface SearchableSelectProps {
  value: string; // "objectType.fieldKey" 형식
  options: GroupedOption[];
  onChange: (value: string) => void;
  placeholder?: string;
  selectedValues?: string[]; // 이미 선택된 값들 (멀티 매핑 시 체크 표시용)
}

export function SearchableSelect({
  value,
  options,
  onChange,
  placeholder = '필드 선택',
  selectedValues = [],
}: SearchableSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 현재 선택된 값의 표시 텍스트
  const selectedLabel = (() => {
    if (!value) return '';
    const [objType, fieldKey] = value.split('.');
    const group = options.find(g => g.objectType === objType);
    const field = group?.fields.find(f => f.key === fieldKey);
    if (group && field) {
      return `[${group.objectName}] ${field.name}`;
    }
    return '';
  })();

  // 검색 필터링된 옵션
  const filteredOptions = (() => {
    if (!searchQuery.trim()) return options;

    const query = searchQuery.toLowerCase();
    return options
      .map(group => ({
        ...group,
        fields: group.fields.filter(
          f =>
            f.name.toLowerCase().includes(query) ||
            f.key.toLowerCase().includes(query)
        ),
      }))
      .filter(group => group.fields.length > 0);
  })();

  // 플랫 리스트 (키보드 탐색용)
  const flatList = filteredOptions.flatMap(group =>
    group.fields.map(field => ({
      value: `${group.objectType}.${field.key}`,
      label: `[${group.objectName}] ${field.name}`,
      required: field.required,
      isCustom: field.isCustom,
    }))
  );

  // 외부 클릭 감지
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // 드롭다운 열릴 때 검색창 포커스
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  // 키보드 탐색
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!isOpen) {
        if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
          e.preventDefault();
          setIsOpen(true);
        }
        return;
      }

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          setHighlightedIndex(prev =>
            prev < flatList.length - 1 ? prev + 1 : prev
          );
          break;
        case 'ArrowUp':
          e.preventDefault();
          setHighlightedIndex(prev => (prev > 0 ? prev - 1 : 0));
          break;
        case 'Enter':
          e.preventDefault();
          if (highlightedIndex >= 0 && highlightedIndex < flatList.length) {
            onChange(flatList[highlightedIndex].value);
            setIsOpen(false);
            setSearchQuery('');
          }
          break;
        case 'Escape':
          e.preventDefault();
          setIsOpen(false);
          setSearchQuery('');
          break;
      }
    },
    [isOpen, flatList, highlightedIndex, onChange]
  );

  // 하이라이트 스크롤
  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`);
      item?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  const handleSelect = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearchQuery('');
  };

  const handleClear = (e: React.MouseEvent) => {
    e.stopPropagation();
    onChange('');
  };

  let flatIndex = -1;

  return (
    <div ref={containerRef} className="relative" onKeyDown={handleKeyDown}>
      {/* 트리거 버튼 */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`flex items-center justify-between rounded-lg border px-3 text-left font-secondary text-sm transition-colors ${
          selectedValues.length > 0
            ? 'h-7 min-w-[80px] border-dashed border-[#CBCCC9] bg-white text-[#666666] hover:border-[#FF8400] hover:text-[#FF8400]'
            : value
            ? 'h-9 w-full border-[#FF8400] bg-[#FFF7ED] text-[#111111]'
            : 'h-9 w-full border-[#CBCCC9] bg-white text-[#666666] hover:border-[#999999]'
        } focus:outline-none focus:border-[#FF8400]`}
      >
        <span className={`truncate ${value ? 'font-medium' : ''}`}>
          {selectedValues.length > 0 ? placeholder : (selectedLabel || placeholder)}
        </span>
        <div className="flex items-center gap-1">
          {value && selectedValues.length === 0 && (
            <span
              onClick={handleClear}
              className="material-symbols-rounded text-[#666666] hover:text-[#111111] cursor-pointer"
              style={{ fontSize: 16 }}
            >
              close
            </span>
          )}
          <span
            className={`material-symbols-rounded text-[#666666] transition-transform ${isOpen ? 'rotate-180' : ''}`}
            style={{ fontSize: 18 }}
          >
            expand_more
          </span>
        </div>
      </button>

      {/* 드롭다운 */}
      {isOpen && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full min-w-[280px] rounded-lg border border-[#CBCCC9] bg-white shadow-lg">
          {/* 검색 입력 */}
          <div className="border-b border-[#CBCCC9] p-2">
            <div className="relative">
              <span
                className="material-symbols-rounded absolute left-2.5 top-1/2 -translate-y-1/2 text-[#666666]"
                style={{ fontSize: 18 }}
              >
                search
              </span>
              <input
                ref={inputRef}
                type="text"
                value={searchQuery}
                onChange={e => {
                  setSearchQuery(e.target.value);
                  setHighlightedIndex(0);
                }}
                placeholder="필드 검색..."
                className="h-9 w-full rounded-md border border-[#CBCCC9] bg-[#F2F3F0] pl-9 pr-3 font-secondary text-sm text-[#111111] placeholder-[#666666] focus:border-[#FF8400] focus:outline-none"
              />
            </div>
          </div>

          {/* 옵션 목록 */}
          <div ref={listRef} className="max-h-[280px] overflow-auto p-1">
            {filteredOptions.length === 0 ? (
              <div className="flex items-center justify-center py-6 text-[#666666]">
                <span className="material-symbols-rounded mr-2" style={{ fontSize: 18 }}>
                  search_off
                </span>
                <span className="font-secondary text-sm">검색 결과 없음</span>
              </div>
            ) : (
              filteredOptions.map(group => (
                <div key={group.objectType} className="mb-1">
                  {/* 그룹 헤더 */}
                  <div className="sticky top-0 bg-[#F2F3F0] px-3 py-1.5 font-primary text-xs font-semibold text-[#FF8400]">
                    [{group.objectName}]
                  </div>

                  {/* 필드 목록 - 기본 필드 먼저, 커스텀 필드 나중에 */}
                  {group.fields
                    .sort((a, b) => {
                      // 필수 필드 먼저
                      if (a.required && !b.required) return -1;
                      if (!a.required && b.required) return 1;
                      // 커스텀 필드는 나중에
                      if (a.isCustom && !b.isCustom) return 1;
                      if (!a.isCustom && b.isCustom) return -1;
                      return 0;
                    })
                    .map(field => {
                      flatIndex++;
                      const optionValue = `${group.objectType}.${field.key}`;
                      const isSelected = value === optionValue;
                      const isAlreadyMapped = selectedValues.includes(optionValue);
                      const isHighlighted = highlightedIndex === flatIndex;

                      return (
                        <div
                          key={optionValue}
                          data-index={flatIndex}
                          onClick={() => handleSelect(optionValue)}
                          className={`flex cursor-pointer items-center justify-between rounded-md px-3 py-2 ${
                            isSelected
                              ? 'bg-[#FF8400] text-white'
                              : isAlreadyMapped
                              ? 'bg-[#FFF7ED]'
                              : isHighlighted
                              ? 'bg-[#FFF7ED]'
                              : 'hover:bg-[#F2F3F0]'
                          }`}
                        >
                          <div className="flex items-center gap-1.5">
                            {isAlreadyMapped && (
                              <span className="material-symbols-rounded text-[#22c55e]" style={{ fontSize: 16 }}>check</span>
                            )}
                            <span className={`font-secondary text-sm ${isSelected || isAlreadyMapped ? 'font-medium' : ''}`}>
                              {field.name}
                              {field.required && (
                                <span className={`ml-1 ${isSelected ? 'text-white' : 'text-[#ef4444]'}`}>*</span>
                              )}
                            </span>
                          </div>
                          {field.isCustom && (
                            <span
                              className={`rounded-full px-1.5 py-0.5 text-[10px] ${
                                isSelected ? 'bg-white/20 text-white' : 'bg-[#E7E8E5] text-[#666666]'
                              }`}
                            >
                              커스텀
                            </span>
                          )}
                        </div>
                      );
                    })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
