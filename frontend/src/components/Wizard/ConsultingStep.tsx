import { useState, useEffect, useRef, useCallback } from 'react';
import type { ConsultingResult, RecommendedField, UploadResponse } from '../../types';
import { consultingChat, uploadFile, type ChatMessage, type FileContext } from '../../services/api';

interface ConsultingStepProps {
  onComplete: (result: ConsultingResult, fileData?: { uploadResponse: UploadResponse; data: Record<string, unknown>[] }) => void;
  existingResult?: ConsultingResult | null;
}

interface DisplayMessage {
  id: string;
  type: 'bot' | 'user';
  content: string;
}

interface SuggestedInsight {
  text: string;
  icon: string;
  category: 'object' | 'field' | 'quality';
}

export default function ConsultingStep({ onComplete, existingResult }: ConsultingStepProps) {
  // File upload state
  const [uploadedFile, setUploadedFile] = useState<UploadResponse | null>(null);
  const [fileData, setFileData] = useState<Record<string, unknown>[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Analysis state
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisComplete, setAnalysisComplete] = useState(false);
  const [suggestedInsights, setSuggestedInsights] = useState<SuggestedInsight[]>([]);

  // Chat state
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [apiMessages, setApiMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSummary, setShowSummary] = useState(false);
  const [summaryData, setSummaryData] = useState<{
    summary: string;
    recommended_objects: string[];
    recommended_fields: Array<{
      object_type: string;
      field_id: string;
      field_label: string;
      field_type?: string;
      field_type_reason?: string;
      reason: string;
    }>;
    column_analysis?: {
      total_columns: number;
      columns_to_keep: Array<{
        column_name: string;
        recommended_type: string;
        target_object?: string;
        target_field?: string;
        reason: string;
      }>;
      columns_to_skip: Array<{
        column_name: string;
        reason: string;
      }>;
    };
    confirmation_message: string;
  } | null>(null);
  const [chatStarted, setChatStarted] = useState(false);

  const chatContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get file context for API
  const getFileContext = useCallback((): FileContext | undefined => {
    if (!uploadedFile) return undefined;
    return {
      filename: uploadedFile.filename,
      columns: uploadedFile.columns,
      sample_data: fileData.slice(0, 5),
      total_rows: uploadedFile.total_rows,
    };
  }, [uploadedFile, fileData]);

  // Generate suggested insights based on file analysis
  const generateSuggestedInsights = useCallback((columns: string[], sampleData: Record<string, unknown>[]) => {
    const insights: SuggestedInsight[] = [];

    // Check for common column patterns
    const hasLead = columns.some(c => c.includes('리드') || c.toLowerCase().includes('lead'));
    const hasOrg = columns.some(c => c.includes('조직') || c.includes('회사') || c.toLowerCase().includes('company'));
    const hasPeople = columns.some(c => c.includes('고객') || c.toLowerCase().includes('people') || c.toLowerCase().includes('customer'));
    const hasDeal = columns.some(c => c.includes('딜') || c.includes('거래') || c.toLowerCase().includes('deal'));
    const hasEmail = columns.some(c => c.includes('이메일') || c.toLowerCase().includes('email'));
    const hasPhone = columns.some(c => c.includes('전화') || c.toLowerCase().includes('phone'));
    const hasAmount = columns.some(c => c.includes('금액') || c.includes('매출') || c.toLowerCase().includes('amount') || c.toLowerCase().includes('revenue'));
    const hasStatus = columns.some(c => c.includes('상태') || c.includes('단계') || c.toLowerCase().includes('status') || c.toLowerCase().includes('stage'));

    // Object-related insights
    if (hasLead) {
      insights.push({ text: '리드/잠재고객 데이터를 관리하고 계시네요', icon: '🎯', category: 'object' });
    }
    if (hasPeople || hasEmail || hasPhone) {
      insights.push({ text: '고객 연락처 정보가 있어요', icon: '👤', category: 'object' });
    }
    if (hasOrg) {
      insights.push({ text: '회사/조직 정보를 함께 관리하시네요', icon: '🏢', category: 'object' });
    }
    if (hasDeal || hasAmount) {
      insights.push({ text: '영업 기회/딜 데이터도 있네요', icon: '💰', category: 'object' });
    }

    // Field-related insights
    if (hasEmail && hasPhone) {
      insights.push({ text: '이메일과 전화번호로 연락처를 관리해요', icon: '📧', category: 'field' });
    }
    if (hasStatus) {
      insights.push({ text: '상태/단계별로 데이터를 추적하고 계시네요', icon: '📊', category: 'field' });
    }

    // Quality insights based on sample data
    const totalRows = sampleData.length;
    if (totalRows > 0) {
      const emptyRatios = columns.map(col => {
        const emptyCount = sampleData.filter(row => !row[col] || row[col] === '').length;
        return emptyCount / totalRows;
      });
      const avgEmptyRatio = emptyRatios.reduce((a, b) => a + b, 0) / emptyRatios.length;
      if (avgEmptyRatio < 0.2) {
        insights.push({ text: '데이터 품질이 좋아요! 빈 값이 적네요', icon: '✅', category: 'quality' });
      }
    }

    return insights.slice(0, 4); // Limit to 4 insights
  }, []);

  // Analyze file and generate initial analysis
  const analyzeFile = useCallback(async (file: UploadResponse, data: Record<string, unknown>[]) => {
    setIsAnalyzing(true);

    const fileContext: FileContext = {
      filename: file.filename,
      columns: file.columns,
      sample_data: data.slice(0, 5),
      total_rows: file.total_rows,
    };

    // Generate suggested insights
    const insights = generateSuggestedInsights(file.columns, data);
    setSuggestedInsights(insights);

    // Create initial analysis message
    const analysisPrompt = `파일이 업로드되었습니다. 데이터를 분석해서 어떤 CRM 오브젝트(리드, 고객, 회사, 딜)에 적합한지, 주요 컬럼은 무엇인지 간단히 분석해주세요. 그리고 데이터를 더 잘 이해하기 위해 사용자에게 물어볼 질문 1-2개를 제안해주세요.`;

    const initialMessages: ChatMessage[] = [
      { role: 'user', content: analysisPrompt }
    ];

    try {
      const response = await consultingChat(initialMessages, false, fileContext);

      if (response.type === 'message' && response.content) {
        const welcomeMsg = `📊 **${file.filename}** 분석 완료!\n\n${response.content}`;
        setMessages([{ id: 'analysis', type: 'bot', content: welcomeMsg }]);
        setApiMessages([
          { role: 'user', content: analysisPrompt },
          { role: 'assistant', content: response.content }
        ]);
      } else {
        // Fallback message
        const fallbackMsg = `📊 **${file.filename}** 업로드 완료!\n\n**컬럼 ${file.columns.length}개 발견:**\n${file.columns.slice(0, 8).join(', ')}${file.columns.length > 8 ? ` 외 ${file.columns.length - 8}개` : ''}\n\n아래에서 맞는 항목을 선택해주세요.`;
        setMessages([{ id: 'analysis', type: 'bot', content: fallbackMsg }]);
        setApiMessages([{ role: 'assistant', content: fallbackMsg }]);
      }
    } catch (error) {
      console.error('Analysis error:', error);
      const fallbackMsg = `📊 **${file.filename}** 업로드 완료!\n\n데이터에 ${file.columns.length}개의 컬럼이 있습니다.\n아래에서 맞는 항목을 선택해주세요.`;
      setMessages([{ id: 'analysis', type: 'bot', content: fallbackMsg }]);
      setApiMessages([{ role: 'assistant', content: fallbackMsg }]);
    } finally {
      setIsAnalyzing(false);
      setAnalysisComplete(true);
      setChatStarted(true);
    }
  }, [generateSuggestedInsights]);

  // Handle file upload
  const handleFile = useCallback(async (file: File) => {
    setIsUploading(true);
    setUploadError(null);

    try {
      const result = await uploadFile(file);
      setUploadedFile(result);
      setFileData(result.data || []);

      // Automatically analyze the file
      await analyzeFile(result, result.data || []);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setIsUploading(false);
    }
  }, [analyzeFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  // Start chat without file
  const startChatWithoutFile = useCallback(() => {
    const welcomeMsg = '안녕하세요! 세일즈맵 CRM 데이터 가져오기를 도와드릴게요.\n\n파일이 없어도 괜찮아요. 어떤 데이터를 관리하고 계신지 알려주시면 적합한 오브젝트와 필드를 추천해드릴게요.';
    setMessages([{ id: 'welcome', type: 'bot', content: welcomeMsg }]);
    setApiMessages([{ role: 'assistant', content: welcomeMsg }]);
    setChatStarted(true);
    setSuggestedInsights([
      { text: '리드/잠재고객 데이터를 관리하고 있어요', icon: '🎯', category: 'object' },
      { text: '고객과 회사 정보를 가져오고 싶어요', icon: '👥', category: 'object' },
      { text: '영업 기회/딜 데이터가 있어요', icon: '💰', category: 'object' },
      { text: '여러 종류의 데이터가 섞여있어요', icon: '📁', category: 'object' },
    ]);
  }, []);

  // Handle suggested insight click - confirm the insight and continue conversation
  const handleSuggestedInsight = useCallback((insightText: string) => {
    // Clear insights after selection
    setSuggestedInsights([]);

    const userMsgId = `user-${Date.now()}`;
    const confirmMessage = `네, 맞아요. ${insightText}`;
    setMessages(prev => [...prev, { id: userMsgId, type: 'user', content: confirmMessage }]);

    const newApiMessages: ChatMessage[] = [...apiMessages, { role: 'user', content: confirmMessage }];
    setApiMessages(newApiMessages);

    // Send to API for follow-up
    setIsLoading(true);
    consultingChat(newApiMessages, false, getFileContext())
      .then(response => {
        if (response.type === 'message' && response.content) {
          setMessages(prev => [...prev, { id: `bot-${Date.now()}`, type: 'bot', content: response.content! }]);
          setApiMessages(prev => [...prev, { role: 'assistant', content: response.content! }]);
        }
      })
      .catch(console.error)
      .finally(() => setIsLoading(false));
  }, [apiMessages, getFileContext]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (chatContainerRef.current) {
      chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
    }
  }, [messages, isLoading]);

  // Focus input after loading
  useEffect(() => {
    if (!isLoading && inputRef.current && chatStarted) {
      inputRef.current.focus();
    }
  }, [isLoading, chatStarted]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;

    const userMessage = inputValue.trim();
    setInputValue('');

    const userMsgId = `user-${Date.now()}`;
    setMessages(prev => [...prev, { id: userMsgId, type: 'user', content: userMessage }]);

    const newApiMessages: ChatMessage[] = [...apiMessages, { role: 'user', content: userMessage }];
    setApiMessages(newApiMessages);

    setIsLoading(true);

    try {
      const response = await consultingChat(newApiMessages, false, getFileContext());

      if (response.type === 'error') {
        setMessages(prev => [...prev, { id: `error-${Date.now()}`, type: 'bot', content: response.content || 'AI 응답 오류가 발생했습니다.' }]);
      } else if (response.type === 'message' && response.content) {
        setMessages(prev => [...prev, { id: `bot-${Date.now()}`, type: 'bot', content: response.content! }]);
        setApiMessages(prev => [...prev, { role: 'assistant', content: response.content! }]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [...prev, { id: `error-${Date.now()}`, type: 'bot', content: 'AI 서버 연결에 실패했습니다.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleRequestSummary = async () => {
    setIsLoading(true);
    try {
      const response = await consultingChat(apiMessages, true, getFileContext());

      if (response.type === 'summary' && response.data) {
        setSummaryData(response.data);
        setShowSummary(true);
      } else {
        setMessages(prev => [...prev, { id: `error-${Date.now()}`, type: 'bot', content: '요약 생성에 실패했습니다. 대화를 계속해주세요.' }]);
      }
    } catch (error) {
      console.error('Summary error:', error);
      setMessages(prev => [...prev, { id: `error-${Date.now()}`, type: 'bot', content: 'AI 서버 연결에 실패했습니다.' }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleConfirmSummary = () => {
    if (!summaryData) return;

    const recommendedFields: RecommendedField[] = summaryData.recommended_fields.map(f => ({
      objectType: f.object_type,
      fieldId: f.field_id,
      fieldLabel: f.field_label,
      fieldType: f.field_type,
      fieldTypeReason: f.field_type_reason,
      reason: f.reason,
    }));

    const result: ConsultingResult = {
      businessType: 'B2B',
      recommendedObjectTypes: summaryData.recommended_objects,
      recommendedFields,
      columnAnalysis: summaryData.column_analysis ? {
        totalColumns: summaryData.column_analysis.total_columns,
        columnsToKeep: summaryData.column_analysis.columns_to_keep.map(c => ({
          columnName: c.column_name,
          recommendedType: c.recommended_type,
          targetObject: c.target_object,
          targetField: c.target_field,
          reason: c.reason,
        })),
        columnsToSkip: summaryData.column_analysis.columns_to_skip.map(c => ({
          columnName: c.column_name,
          reason: c.reason,
        })),
      } : undefined,
      answers: [],
    };

    if (uploadedFile && fileData.length > 0) {
      onComplete(result, { uploadResponse: uploadedFile, data: fileData });
    } else {
      onComplete(result);
    }
  };

  const handleContinueChat = () => {
    setShowSummary(false);
    setSummaryData(null);
    setMessages(prev => [...prev, { id: `continue-${Date.now()}`, type: 'bot', content: '더 자세한 내용을 알려주세요. 어떤 부분이 부족한가요?' }]);
  };

  const getObjectName = (type: string) => {
    const names: Record<string, string> = { company: '회사', people: '고객', lead: '리드', deal: '딜' };
    return names[type] || type;
  };

  const getFieldTypeName = (type: string) => {
    const names: Record<string, string> = {
      text: '텍스트', number: '숫자', email: '이메일', phone: '전화번호',
      date: '날짜', datetime: '날짜+시간', url: 'URL', select: '단일선택',
      multiselect: '복수선택', boolean: 'True/False', textarea: '긴 텍스트',
      user: '사용자', users: '사용자(복수)', relation: '연결',
    };
    return names[type] || type;
  };

  if (existingResult) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-green-50 border border-green-200 rounded-xl p-6 text-center">
          <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-6 h-6 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h3 className="text-lg font-semibold text-green-800 mb-2">컨설팅 완료</h3>
          <p className="text-green-600 mb-4">추천 오브젝트가 설정되었습니다.</p>
          <div className="flex flex-wrap gap-2 justify-center">
            {existingResult.recommendedObjectTypes.map(type => (
              <span key={type} className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm">
                {getObjectName(type)}
              </span>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Summary confirmation view
  if (showSummary && summaryData) {
    return (
      <div className="max-w-2xl mx-auto">
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
              <svg className="w-5 h-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-blue-800">컨설팅 결과 확인</h3>
          </div>

          <div className="mb-4 p-4 bg-white rounded-lg">
            <p className="text-slate-700">{summaryData.summary}</p>
          </div>

          <div className="mb-4">
            <h4 className="font-medium text-slate-700 mb-2">추천 오브젝트</h4>
            <div className="flex flex-wrap gap-2">
              {summaryData.recommended_objects.map(type => (
                <span key={type} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium">
                  {getObjectName(type)}
                </span>
              ))}
            </div>
          </div>

          {summaryData.recommended_fields.length > 0 && (
            <div className="mb-4">
              <h4 className="font-medium text-slate-700 mb-2">추천 필드</h4>
              <div className="space-y-2">
                {summaryData.recommended_fields.map((field, idx) => (
                  <div key={idx} className="flex items-center gap-2 text-sm flex-wrap">
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded">{getObjectName(field.object_type)}</span>
                    <span className="text-slate-700 font-medium">{field.field_label}</span>
                    {field.field_type && (
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-600 rounded text-xs">{getFieldTypeName(field.field_type)}</span>
                    )}
                    <span className="text-slate-500">- {field.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {summaryData.column_analysis && (
            <div className="mb-4">
              <h4 className="font-medium text-slate-700 mb-2">컬럼 분석 결과 (총 {summaryData.column_analysis.total_columns}개)</h4>
              {summaryData.column_analysis.columns_to_keep.length > 0 && (
                <div className="bg-green-50 rounded-lg p-3 border border-green-200 mb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="font-medium text-green-800 text-sm">유지할 컬럼 ({summaryData.column_analysis.columns_to_keep.length}개)</span>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    {summaryData.column_analysis.columns_to_keep.slice(0, 5).map((col, idx) => (
                      <div key={idx} className="flex items-center gap-2 flex-wrap">
                        <span className="text-green-800 font-medium">{col.column_name}</span>
                        <span className="text-green-600">→</span>
                        {col.target_object && (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">{getObjectName(col.target_object)}</span>
                        )}
                        <span className="px-1.5 py-0.5 bg-white text-green-700 rounded text-xs border border-green-200">{getFieldTypeName(col.recommended_type)}</span>
                      </div>
                    ))}
                    {summaryData.column_analysis.columns_to_keep.length > 5 && (
                      <p className="text-green-600 text-xs">외 {summaryData.column_analysis.columns_to_keep.length - 5}개 더...</p>
                    )}
                  </div>
                </div>
              )}
              {summaryData.column_analysis.columns_to_skip.length > 0 && (
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="font-medium text-amber-800 text-sm">제외 추천 컬럼 ({summaryData.column_analysis.columns_to_skip.length}개)</span>
                  </div>
                  <div className="space-y-1 text-sm">
                    {summaryData.column_analysis.columns_to_skip.slice(0, 3).map((col, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-amber-800 font-medium">{col.column_name}</span>
                        <span className="text-amber-600 text-xs">- {col.reason}</span>
                      </div>
                    ))}
                    {summaryData.column_analysis.columns_to_skip.length > 3 && (
                      <p className="text-amber-600 text-xs">외 {summaryData.column_analysis.columns_to_skip.length - 3}개 더...</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          <p className="text-slate-600 mb-6">{summaryData.confirmation_message}</p>

          <div className="flex gap-3 justify-center">
            <button onClick={handleContinueChat} className="px-6 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-medium transition-colors">
              더 이야기하기
            </button>
            <button onClick={handleConfirmSummary} className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors">
              확인하고 계속하기
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      {/* File Upload Area */}
      {!chatStarted && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          className="border-2 border-dashed border-slate-300 hover:border-blue-400 rounded-xl p-6 text-center transition-colors"
        >
          {isUploading || isAnalyzing ? (
            <div className="flex flex-col items-center">
              <svg className="animate-spin h-8 w-8 text-blue-600 mb-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-slate-600">{isUploading ? '파일 업로드 중...' : 'AI가 데이터를 분석하고 있어요...'}</p>
            </div>
          ) : (
            <>
              <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="text-slate-700 font-medium mb-1">가져올 데이터 파일을 업로드해주세요</p>
              <p className="text-slate-500 text-sm mb-3">AI가 파일을 분석해서 적합한 설정을 추천해드려요</p>
              <label className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors">
                파일 선택
                <input type="file" className="hidden" accept=".csv,.xlsx,.xls" onChange={handleInputChange} />
              </label>
              <p className="text-xs text-slate-400 mt-2">CSV, XLSX, XLS 지원</p>
            </>
          )}

          {uploadError && (
            <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-red-600 text-sm">{uploadError}</div>
          )}
        </div>
      )}

      {/* Skip file upload button */}
      {!chatStarted && !isUploading && !isAnalyzing && (
        <button onClick={startChatWithoutFile} className="w-full py-3 text-slate-600 hover:text-blue-600 text-sm transition-colors">
          파일 없이 대화로 시작하기 →
        </button>
      )}

      {/* Uploaded file info */}
      {uploadedFile && chatStarted && (
        <div className="flex items-center gap-3 p-3 bg-green-50 border border-green-200 rounded-lg">
          <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
            <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-medium text-green-800 text-sm">{uploadedFile.filename}</p>
            <p className="text-xs text-green-600">{uploadedFile.total_rows}개 행 · {uploadedFile.columns.length}개 열</p>
          </div>
        </div>
      )}

      {/* Suggested insights */}
      {chatStarted && suggestedInsights.length > 0 && (
        <div className="bg-blue-50 border border-blue-100 rounded-xl p-4">
          <p className="text-sm text-blue-700 font-medium mb-3">🔍 이런 데이터가 있는 것 같아요. 맞으면 선택해주세요:</p>
          <div className="flex flex-wrap gap-2">
            {suggestedInsights.map((insight, idx) => (
              <button
                key={idx}
                onClick={() => handleSuggestedInsight(insight.text)}
                disabled={isLoading}
                className="px-4 py-2.5 bg-white border border-blue-200 rounded-lg text-sm text-slate-700 hover:bg-blue-100 hover:border-blue-400 hover:text-blue-800 transition-colors disabled:opacity-50 flex items-center gap-2"
              >
                <span>{insight.icon}</span>
                <span>{insight.text}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Chat container */}
      {chatStarted && (
        <>
          <div ref={chatContainerRef} className="h-[300px] overflow-y-auto bg-slate-50 rounded-xl p-4 space-y-4">
            {messages.map(message => (
              <div key={message.id} className={`flex ${message.type === 'user' ? 'justify-end' : 'items-start gap-3'}`}>
                {message.type === 'bot' && (
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                )}
                <div className={`max-w-[80%] px-4 py-3 rounded-2xl whitespace-pre-wrap ${
                  message.type === 'bot' ? 'bg-white border border-slate-200 rounded-tl-none text-slate-700' : 'bg-blue-600 text-white rounded-tr-none'
                }`}>
                  <p>{message.content}</p>
                </div>
              </div>
            ))}

            {isLoading && (
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                  <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                </div>
                <div className="bg-white border border-slate-200 rounded-2xl rounded-tl-none px-4 py-3">
                  <div className="flex gap-1">
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="bg-white border border-slate-200 rounded-xl p-3">
            <div className="flex gap-2">
              <input
                ref={inputRef}
                type="text"
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                onKeyPress={handleKeyPress}
                placeholder="질문을 입력하세요..."
                className="flex-1 px-4 py-2.5 bg-slate-50 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                disabled={isLoading}
              />
              <button
                onClick={handleSend}
                disabled={!inputValue.trim() || isLoading}
                className="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white rounded-lg transition-colors"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
                </svg>
              </button>
            </div>
          </div>

          {/* Action buttons */}
          {messages.length >= 2 && !isLoading && (
            <div className="flex justify-center">
              <button
                onClick={handleRequestSummary}
                className="px-6 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors flex items-center gap-2"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                컨설팅 정리하기
              </button>
            </div>
          )}

          <p className="text-center text-sm text-slate-500">
            대화를 나눈 후 "컨설팅 정리하기"를 눌러 추천을 확인하세요
          </p>
        </>
      )}
    </div>
  );
}
