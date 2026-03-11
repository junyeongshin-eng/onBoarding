import type { ImportResponse } from '../../types';

interface SuccessStepProps {
  result: ImportResponse;
  objectTypes: string[];
  onStartOver: () => void;
}

const OBJECT_NAMES: Record<string, string> = {
  company: '회사',
  people: '고객',
  lead: '리드',
  deal: '딜',
};

export function SuccessStep({ result, objectTypes, onStartOver }: SuccessStepProps) {
  return (
    <div className="text-center py-8">
      <div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-6">
        <svg className="w-10 h-10 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>

      <h2 className="text-2xl font-bold text-slate-800 mb-2">파일 생성 완료!</h2>
      <p className="text-slate-600 mb-4">
        {objectTypes.map((t) => OBJECT_NAMES[t]).join(', ')} 데이터가 Salesmap 가져오기 형식으로 변환되었습니다.
      </p>
      <p className="text-slate-500 text-sm mb-8">
        다운로드된 Excel 파일을 Salesmap에서 가져오기 하세요.
      </p>

      <div className="grid md:grid-cols-2 gap-4 mb-8 max-w-md mx-auto">
        <div className="p-4 bg-slate-50 rounded-xl">
          <p className="text-3xl font-bold text-green-600">{result.imported_count}</p>
          <p className="text-sm text-slate-500">변환된 데이터</p>
        </div>
        <div className="p-4 bg-slate-50 rounded-xl">
          <p className="text-3xl font-bold text-slate-600">{objectTypes.length}</p>
          <p className="text-sm text-slate-500">오브젝트 수</p>
        </div>
      </div>

      {result.errors.length > 0 && (
        <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl text-left max-w-md mx-auto">
          <h4 className="font-medium text-amber-800 mb-2">일부 문제가 발생했습니다:</h4>
          <ul className="text-sm text-amber-700 list-disc list-inside">
            {result.errors.map((error, i) => (
              <li key={i}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Instructions */}
      <div className="mb-8 p-4 bg-blue-50 border border-blue-200 rounded-xl text-left max-w-lg mx-auto">
        <h4 className="font-medium text-blue-800 mb-2">다음 단계:</h4>
        <ol className="text-sm text-blue-700 list-decimal list-inside space-y-1">
          <li>다운로드된 Excel 파일을 확인하세요</li>
          <li>Salesmap에서 [설정] → [데이터 이관]으로 이동하세요</li>
          <li>Excel 파일을 업로드하여 가져오기를 완료하세요</li>
        </ol>
      </div>

      <div className="flex justify-center gap-4">
        <button
          onClick={onStartOver}
          className="px-6 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-medium hover:bg-slate-200 transition-colors"
        >
          추가 데이터 변환
        </button>
        <a
          href="https://salesmap.com"
          target="_blank"
          rel="noopener noreferrer"
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors"
        >
          Salesmap에서 가져오기
        </a>
      </div>
    </div>
  );
}
