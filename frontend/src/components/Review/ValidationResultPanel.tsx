import { useState } from 'react';
import type { ValidationResult, ValidationError, DuplicateRecord } from '../../types';

interface ValidationResultPanelProps {
  result: ValidationResult;
  duplicates?: DuplicateRecord[];
  onCancel: () => void;
  onImportAll: () => void;
  onImportValid: () => void;
  isLoading: boolean;
}

export function ValidationResultPanel({
  result,
  duplicates = [],
  onCancel,
  onImportAll,
  onImportValid,
  isLoading,
}: ValidationResultPanelProps) {
  const [showErrors, setShowErrors] = useState(false);
  const [showDuplicates, setShowDuplicates] = useState(false);

  const downloadErrorReport = () => {
    const errorRows = result.errors.map((e) => `${e.row}행: [${e.field}] ${e.message}`);
    const content = `데이터 검사 오류 리포트\n${'='.repeat(50)}\n\n총 행 수: ${result.total_rows}\n성공: ${result.valid_rows}건\n오류: ${result.error_count}건\n경고: ${result.warning_count}건\n\n오류 목록:\n${errorRows.join('\n')}`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'validation_errors.txt';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.URL.revokeObjectURL(url);
  };

  // Group errors by row
  const errorsByRow = result.errors.reduce((acc, err) => {
    if (!acc[err.row]) {
      acc[err.row] = [];
    }
    acc[err.row].push(err);
    return acc;
  }, {} as Record<number, ValidationError[]>);

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <div className="p-6 bg-white border border-slate-200 rounded-xl shadow-sm">
        <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
          <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
          </svg>
          데이터 검사 결과
        </h3>

        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="p-4 bg-green-50 rounded-lg text-center">
            <div className="text-3xl font-bold text-green-600">{result.valid_rows}</div>
            <div className="text-sm text-green-700">성공</div>
          </div>
          <div className="p-4 bg-red-50 rounded-lg text-center">
            <div className="text-3xl font-bold text-red-600">{result.error_count}</div>
            <div className="text-sm text-red-700">오류</div>
          </div>
          <div className="p-4 bg-amber-50 rounded-lg text-center">
            <div className="text-3xl font-bold text-amber-600">{result.warning_count}</div>
            <div className="text-sm text-amber-700">경고</div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mb-4">
          <div className="flex justify-between text-sm text-slate-600 mb-1">
            <span>검사 완료</span>
            <span>{result.valid_rows} / {result.total_rows} 행 성공</span>
          </div>
          <div className="w-full h-3 bg-slate-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full"
              style={{ width: `${(result.valid_rows / result.total_rows) * 100}%` }}
            />
          </div>
        </div>

        {/* Error/Warning buttons */}
        {result.errors.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={() => setShowErrors(!showErrors)}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-2"
            >
              <svg className={`w-4 h-4 transition-transform ${showErrors ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
              {showErrors ? '오류 목록 닫기' : '오류 목록 보기'}
            </button>
            <button
              onClick={downloadErrorReport}
              className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              오류 파일 다운로드
            </button>
          </div>
        )}
      </div>

      {/* Error List */}
      {showErrors && result.errors.length > 0 && (
        <div className="p-4 bg-white border border-slate-200 rounded-xl max-h-64 overflow-y-auto">
          <h4 className="font-medium text-slate-800 mb-3">오류 및 경고 목록</h4>
          <div className="space-y-2">
            {Object.entries(errorsByRow).slice(0, 50).map(([row, errors]) => (
              <div key={row} className="p-3 bg-slate-50 rounded-lg">
                <div className="font-medium text-slate-700 mb-1">{row}행</div>
                {errors.map((err, idx) => (
                  <div
                    key={idx}
                    className={`text-sm flex items-start gap-2 ${
                      err.severity === 'error' ? 'text-red-600' : 'text-amber-600'
                    }`}
                  >
                    {err.severity === 'error' ? (
                      <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                      </svg>
                    )}
                    <span>[{err.field}] {err.message}</span>
                  </div>
                ))}
              </div>
            ))}
            {Object.keys(errorsByRow).length > 50 && (
              <div className="text-center text-slate-500 text-sm py-2">
                ... 외 {Object.keys(errorsByRow).length - 50}건 더 있음
              </div>
            )}
          </div>
        </div>
      )}

      {/* Duplicates Section */}
      {duplicates.length > 0 && (
        <div className="p-6 bg-white border border-amber-200 rounded-xl shadow-sm">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <svg className="w-6 h-6 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
            </svg>
            잠재적 중복 데이터 감지
          </h3>

          <div className="p-4 bg-amber-50 rounded-lg mb-4">
            <p className="text-amber-800">
              <span className="font-medium">{duplicates.length}건</span>의 잠재적 중복 레코드가 발견되었습니다.
              중복 데이터가 있으면 가져오기 후 수동으로 병합해야 할 수 있습니다.
            </p>
          </div>

          <button
            onClick={() => setShowDuplicates(!showDuplicates)}
            className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors flex items-center gap-2"
          >
            <svg className={`w-4 h-4 transition-transform ${showDuplicates ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
            {showDuplicates ? '중복 목록 닫기' : '중복 목록 보기'}
          </button>

          {showDuplicates && (
            <div className="mt-4 space-y-3 max-h-64 overflow-y-auto">
              {duplicates.slice(0, 20).map((dup, idx) => (
                <div key={idx} className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-medium text-slate-700">
                      {dup.row1}행 ↔ {dup.row2}행
                    </span>
                    <span className={`px-2 py-1 text-xs font-medium rounded ${
                      dup.similarity >= 0.9 ? 'bg-red-100 text-red-700' :
                      dup.similarity >= 0.8 ? 'bg-amber-100 text-amber-700' :
                      'bg-yellow-100 text-yellow-700'
                    }`}>
                      유사도: {Math.round(dup.similarity * 100)}%
                    </span>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-sm">
                    <div className="p-2 bg-white rounded">
                      {Object.entries(dup.data1).slice(0, 3).map(([key, value]) => (
                        <div key={key} className="truncate text-slate-600">
                          <span className="font-medium">{key}:</span> {value}
                        </div>
                      ))}
                    </div>
                    <div className="p-2 bg-white rounded">
                      {Object.entries(dup.data2).slice(0, 3).map(([key, value]) => (
                        <div key={key} className="truncate text-slate-600">
                          <span className="font-medium">{key}:</span> {value}
                        </div>
                      ))}
                    </div>
                  </div>
                  {dup.ai_analysis && (
                    <div className="mt-2 p-2 bg-purple-50 rounded text-sm text-purple-700">
                      <span className="font-medium">AI 분석:</span> {dup.ai_analysis.reason}
                      {dup.ai_analysis.is_duplicate && ' (중복 가능성 높음)'}
                    </div>
                  )}
                </div>
              ))}
              {duplicates.length > 20 && (
                <div className="text-center text-slate-500 text-sm py-2">
                  ... 외 {duplicates.length - 20}건 더 있음
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex justify-between items-center p-4 bg-slate-50 rounded-xl">
        <button
          onClick={onCancel}
          disabled={isLoading}
          className="px-6 py-2.5 bg-slate-200 text-slate-700 rounded-lg font-medium hover:bg-slate-300 transition-colors disabled:opacity-50"
        >
          취소
        </button>
        <div className="flex gap-3">
          {result.valid_rows > 0 && result.valid_rows < result.total_rows && (
            <button
              onClick={onImportValid}
              disabled={isLoading}
              className="px-6 py-2.5 bg-amber-500 text-white rounded-lg font-medium hover:bg-amber-600 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  처리 중...
                </>
              ) : (
                <>오류 제외 후 파일 생성 ({result.valid_rows}건)</>
              )}
            </button>
          )}
          {result.success && (
            <button
              onClick={onImportAll}
              disabled={isLoading}
              className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
            >
              {isLoading ? (
                <>
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  처리 중...
                </>
              ) : (
                <>전체 파일 생성 ({result.total_rows}건)</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
