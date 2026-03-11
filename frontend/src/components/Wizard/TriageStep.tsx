import { useState, useEffect } from 'react';
import type {
  TriageResult,
  TriageColumnKeep,
  TriageColumnSkip,
  SalesmapObjectType,
  ColumnStats,
} from '../../types';

interface TriageStepProps {
  columns: string[];
  sampleData: Record<string, unknown>[];
  columnStats?: ColumnStats[];
  triageResult?: TriageResult | null;
  isLoading: boolean;
  error?: string | null;
  onRunTriage: () => void;
  onTriageChange: (result: TriageResult) => void;
}

const OBJECT_NAMES: Record<SalesmapObjectType, string> = {
  people: '고객',
  company: '회사',
  deal: '딜',
  lead: '리드',
};

export function TriageStep({
  columns,
  sampleData: _sampleData,
  columnStats: _columnStats,
  triageResult,
  isLoading,
  error,
  onRunTriage,
  onTriageChange,
}: TriageStepProps) {
  // Note: sampleData and columnStats are passed to parent for API call
  void _sampleData;
  void _columnStats;
  const [editMode, setEditMode] = useState(false);
  const [localResult, setLocalResult] = useState<TriageResult | null>(triageResult || null);

  useEffect(() => {
    if (triageResult) {
      setLocalResult(triageResult);
    }
  }, [triageResult]);

  const handleMoveToKeep = (column: TriageColumnSkip) => {
    if (!localResult) return;

    const newKeep: TriageColumnKeep = {
      column_name: column.column_name,
      target_object: 'people',
      suggested_field_label: `고객 - ${column.column_name}`,
      suggested_field_type: 'text',
      is_required: false,
      reason: '수동 추가',
    };

    const updated: TriageResult = {
      ...localResult,
      columns_to_keep: [...localResult.columns_to_keep, newKeep],
      columns_to_skip: localResult.columns_to_skip.filter(
        (c) => c.column_name !== column.column_name
      ),
    };

    setLocalResult(updated);
    onTriageChange(updated);
  };

  const handleMoveToSkip = (column: TriageColumnKeep) => {
    if (!localResult) return;

    const newSkip: TriageColumnSkip = {
      column_name: column.column_name,
      reason: '내부 식별자',
      detail: '수동 제외',
    };

    const updated: TriageResult = {
      ...localResult,
      columns_to_keep: localResult.columns_to_keep.filter(
        (c) => c.column_name !== column.column_name
      ),
      columns_to_skip: [...localResult.columns_to_skip, newSkip],
    };

    setLocalResult(updated);
    onTriageChange(updated);
  };

  const handleObjectChange = (columnName: string, newObject: SalesmapObjectType) => {
    if (!localResult) return;

    const updated: TriageResult = {
      ...localResult,
      columns_to_keep: localResult.columns_to_keep.map((col) =>
        col.column_name === columnName
          ? {
              ...col,
              target_object: newObject,
              suggested_field_label: `${OBJECT_NAMES[newObject]} - ${col.column_name}`,
            }
          : col
      ),
    };

    setLocalResult(updated);
    onTriageChange(updated);
  };

  const keepCount = localResult?.columns_to_keep.length || 0;
  const skipCount = localResult?.columns_to_skip.length || 0;
  const totalColumns = columns.length;
  const keepRatio = totalColumns > 0 ? (keepCount / totalColumns) * 100 : 0;

  if (!triageResult && !isLoading) {
    return (
      <div className="space-y-6">
        <div className="text-center py-8">
          <div className="text-6xl mb-4">📊</div>
          <h3 className="text-lg font-semibold text-slate-900 mb-2">
            컬럼 분류 시작
          </h3>
          <p className="text-slate-600 mb-6">
            업로드된 파일의 {columns.length}개 컬럼을 분석하여
            <br />
            유지할 컬럼과 제외할 컬럼을 자동으로 분류합니다.
          </p>
          <button
            onClick={onRunTriage}
            className="px-6 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
          >
            AI 분석 시작
          </button>
        </div>

        {/* 컬럼 미리보기 */}
        <div className="bg-slate-50 rounded-lg p-4">
          <h4 className="font-medium text-slate-700 mb-3">
            분석할 컬럼 ({columns.length}개)
          </h4>
          <div className="flex flex-wrap gap-2">
            {columns.map((col) => (
              <span
                key={col}
                className="px-2 py-1 bg-white border border-slate-200 rounded text-sm text-slate-700"
              >
                {col}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
        <p className="text-slate-600">AI가 컬럼을 분석 중입니다...</p>
        <p className="text-sm text-slate-400 mt-2">잠시만 기다려주세요</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-red-50 border border-red-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <span className="text-red-500">❌</span>
          <div>
            <h4 className="font-medium text-red-800">분석 오류</h4>
            <p className="text-sm text-red-600 mt-1">{error}</p>
            <button
              onClick={onRunTriage}
              className="mt-3 px-4 py-2 bg-red-100 text-red-700 rounded hover:bg-red-200 text-sm"
            >
              다시 시도
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* 요약 통계 */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-green-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-green-700">{keepCount}</div>
          <div className="text-sm text-green-600">유지할 컬럼</div>
        </div>
        <div className="bg-slate-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-slate-700">{skipCount}</div>
          <div className="text-sm text-slate-600">제외할 컬럼</div>
        </div>
        <div className="bg-blue-50 rounded-lg p-4 text-center">
          <div className="text-2xl font-bold text-blue-700">{keepRatio.toFixed(0)}%</div>
          <div className="text-sm text-blue-600">유지 비율</div>
        </div>
      </div>

      {/* 추천 오브젝트 */}
      {localResult?.recommended_objects && localResult.recommended_objects.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
          <h4 className="font-medium text-blue-800 mb-2">추천 오브젝트</h4>
          <div className="flex gap-2">
            {localResult.recommended_objects.map((obj) => (
              <span
                key={obj}
                className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm"
              >
                {OBJECT_NAMES[obj]}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* 편집 모드 토글 */}
      <div className="flex justify-between items-center">
        <h3 className="font-semibold text-slate-900">컬럼 분류 결과</h3>
        <button
          onClick={() => setEditMode(!editMode)}
          className={`px-3 py-1 text-sm rounded ${
            editMode
              ? 'bg-blue-600 text-white'
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}
        >
          {editMode ? '편집 완료' : '수동 편집'}
        </button>
      </div>

      {/* 유지할 컬럼 */}
      <div>
        <h4 className="text-sm font-medium text-green-700 mb-2 flex items-center gap-2">
          <span>✅</span>
          유지할 컬럼 ({keepCount}개)
        </h4>
        <div className="border border-green-200 rounded-lg overflow-hidden">
          <table className="min-w-full divide-y divide-green-200">
            <thead className="bg-green-50">
              <tr>
                <th className="px-4 py-2 text-left text-xs font-medium text-green-700">
                  컬럼명
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-green-700">
                  오브젝트
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-green-700">
                  필드 라벨
                </th>
                <th className="px-4 py-2 text-left text-xs font-medium text-green-700">
                  타입
                </th>
                {editMode && (
                  <th className="px-4 py-2 text-left text-xs font-medium text-green-700">
                    작업
                  </th>
                )}
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-green-100">
              {localResult?.columns_to_keep.map((col) => (
                <tr key={col.column_name}>
                  <td className="px-4 py-2 text-sm text-slate-900">
                    {col.column_name}
                    {col.is_required && (
                      <span className="ml-1 text-red-500">*</span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm">
                    {editMode ? (
                      <select
                        value={col.target_object}
                        onChange={(e) =>
                          handleObjectChange(
                            col.column_name,
                            e.target.value as SalesmapObjectType
                          )
                        }
                        className="text-sm border border-slate-300 rounded px-2 py-1"
                      >
                        {Object.entries(OBJECT_NAMES).map(([key, name]) => (
                          <option key={key} value={key}>
                            {name}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-700">
                        {OBJECT_NAMES[col.target_object]}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2 text-sm text-slate-600">
                    {col.suggested_field_label}
                  </td>
                  <td className="px-4 py-2 text-sm text-slate-500">
                    {col.suggested_field_type}
                  </td>
                  {editMode && (
                    <td className="px-4 py-2">
                      <button
                        onClick={() => handleMoveToSkip(col)}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        제외
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* 제외할 컬럼 */}
      {localResult?.columns_to_skip && localResult.columns_to_skip.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-slate-500 mb-2 flex items-center gap-2">
            <span>🚫</span>
            제외할 컬럼 ({skipCount}개)
          </h4>
          <div className="border border-slate-200 rounded-lg overflow-hidden">
            <table className="min-w-full divide-y divide-slate-200">
              <thead className="bg-slate-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                    컬럼명
                  </th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                    사유
                  </th>
                  {editMode && (
                    <th className="px-4 py-2 text-left text-xs font-medium text-slate-500">
                      작업
                    </th>
                  )}
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-slate-100">
                {localResult.columns_to_skip.map((col) => (
                  <tr key={col.column_name} className="text-slate-400">
                    <td className="px-4 py-2 text-sm">{col.column_name}</td>
                    <td className="px-4 py-2 text-sm">
                      {col.reason}
                      {col.detail && (
                        <span className="ml-1 text-slate-300">({col.detail})</span>
                      )}
                    </td>
                    {editMode && (
                      <td className="px-4 py-2">
                        <button
                          onClick={() => handleMoveToKeep(col)}
                          className="text-xs text-green-600 hover:text-green-800"
                        >
                          유지
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* AI 추론 과정 */}
      {localResult?.thinking && (
        <details className="bg-slate-50 rounded-lg p-4">
          <summary className="cursor-pointer text-sm font-medium text-slate-600">
            AI 분석 과정 보기
          </summary>
          <pre className="mt-3 text-xs text-slate-500 whitespace-pre-wrap">
            {localResult.thinking}
          </pre>
        </details>
      )}

      {/* 다시 분석 버튼 */}
      <div className="flex justify-end">
        <button
          onClick={onRunTriage}
          className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-100 rounded"
        >
          다시 분석
        </button>
      </div>
    </div>
  );
}
