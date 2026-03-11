export function WelcomeStep() {
  return (
    <div className="text-center py-8">
      <div className="mb-6">
        <div className="w-20 h-20 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <svg className="w-10 h-10 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
          </svg>
        </div>
        <h3 className="text-2xl font-bold text-slate-800 mb-2">Salesmap 데이터 가져오기</h3>
        <p className="text-slate-600 max-w-md mx-auto">
          CSV 또는 Excel 파일에서 데이터를 가져와 Salesmap의 4가지 오브젝트에 저장할 수 있습니다.
        </p>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-8 max-w-2xl mx-auto">
        <div className="p-4 bg-slate-50 rounded-lg text-left">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
              </svg>
            </div>
            <h4 className="font-semibold text-slate-800">회사</h4>
          </div>
          <p className="text-sm text-slate-500">회사/조직 정보 (회사명, 직원 수, 주소 등)</p>
        </div>

        <div className="p-4 bg-slate-50 rounded-lg text-left">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
              </svg>
            </div>
            <h4 className="font-semibold text-slate-800">고객</h4>
          </div>
          <p className="text-sm text-slate-500">고객/연락처 정보 (이름, 이메일, 전화번호 등)</p>
        </div>

        <div className="p-4 bg-slate-50 rounded-lg text-left">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-purple-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-purple-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
              </svg>
            </div>
            <h4 className="font-semibold text-slate-800">리드</h4>
          </div>
          <p className="text-sm text-slate-500">잠재 고객 정보 (상태: New → MQL → Working)</p>
        </div>

        <div className="p-4 bg-slate-50 rounded-lg text-left">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-orange-100 rounded-lg flex items-center justify-center">
              <svg className="w-5 h-5 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h4 className="font-semibold text-slate-800">딜</h4>
          </div>
          <p className="text-sm text-slate-500">거래 정보 (금액, 상태: Convert → SQL → Won/Lost)</p>
        </div>
      </div>

      <div className="mt-8 p-4 bg-blue-50 rounded-lg max-w-2xl mx-auto">
        <p className="text-sm text-blue-700">
          <span className="font-medium">지원 파일 형식:</span> CSV, XLSX, XLS
        </p>
      </div>
    </div>
  );
}
