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

const INITIAL_MESSAGE_NO_FILE = '안녕하세요! B2B 영업 CRM 데이터 가져오기를 도와드릴게요. 먼저 가져올 데이터 파일이 있으시면 위에서 업로드해주세요. 없으시면 바로 대화를 시작해도 됩니다!';
const INITIAL_MESSAGE_WITH_FILE = (filename: string, columns: string[]) =>
  `파일을 확인했어요! 📊\n\n**${filename}**\n컬럼: ${columns.slice(0, 5).join(', ')}${columns.length > 5 ? ` 외 ${columns.length - 5}개` : ''}\n\n이 데이터를 어떻게 활용하고 계신가요? 어떤 정보가 가장 중요한지 알려주세요.`;

export default function ConsultingStep({ onComplete, existingResult }: ConsultingStepProps) {
  // File upload state
  const [uploadedFile, setUploadedFile] = useState<UploadResponse | null>(null);
  const [fileData, setFileData] = useState<Record<string, unknown>[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

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

  // Handle file upload
  const handleFile = useCallback(async (file: File) => {
    setIsUploading(true);
    setUploadError(null);

    try {
      const result = await uploadFile(file);
      setUploadedFile(result);
      setFileData(result.data || []);

      // Start chat with file context message
      const welcomeMsg = INITIAL_MESSAGE_WITH_FILE(result.filename, result.columns);
      setMessages([{ id: 'welcome', type: 'bot', content: welcomeMsg }]);
      setApiMessages([{ role: 'assistant', content: welcomeMsg }]);
      setChatStarted(true);
    } catch (err) {
      setUploadError(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setIsUploading(false);
    }
  }, []);

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
    setMessages([{ id: 'welcome', type: 'bot', content: INITIAL_MESSAGE_NO_FILE }]);
    setApiMessages([{ role: 'assistant', content: INITIAL_MESSAGE_NO_FILE }]);
    setChatStarted(true);
  }, []);

  // Initialize chat if returning to existing result
  useEffect(() => {
    if (existingResult) {
      return;
    }
  }, [existingResult]);

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

    // Add user message to display
    const userMsgId = `user-${Date.now()}`;
    setMessages(prev => [
      ...prev,
      { id: userMsgId, type: 'user', content: userMessage },
    ]);

    // Add to API messages
    const newApiMessages: ChatMessage[] = [
      ...apiMessages,
      { role: 'user', content: userMessage },
    ];
    setApiMessages(newApiMessages);

    setIsLoading(true);

    try {
      const response = await consultingChat(newApiMessages, false, getFileContext());

      if (response.type === 'error') {
        setMessages(prev => [
          ...prev,
          { id: `error-${Date.now()}`, type: 'bot', content: response.content || 'AI 응답 오류가 발생했습니다.' },
        ]);
      } else if (response.type === 'message' && response.content) {
        const botMsgId = `bot-${Date.now()}`;
        setMessages(prev => [
          ...prev,
          { id: botMsgId, type: 'bot', content: response.content! },
        ]);
        setApiMessages(prev => [
          ...prev,
          { role: 'assistant', content: response.content! },
        ]);
      }
    } catch (error) {
      console.error('Chat error:', error);
      setMessages(prev => [
        ...prev,
        { id: `error-${Date.now()}`, type: 'bot', content: 'AI 서버 연결에 실패했습니다. 잠시 후 다시 시도해주세요.' },
      ]);
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
        setMessages(prev => [
          ...prev,
          { id: `error-${Date.now()}`, type: 'bot', content: '요약 생성에 실패했습니다. 대화를 계속해주세요.' },
        ]);
      }
    } catch (error) {
      console.error('Summary error:', error);
      setMessages(prev => [
        ...prev,
        { id: `error-${Date.now()}`, type: 'bot', content: 'AI 서버 연결에 실패했습니다.' },
      ]);
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

    // Pass file data if uploaded
    if (uploadedFile && fileData.length > 0) {
      onComplete(result, { uploadResponse: uploadedFile, data: fileData });
    } else {
      onComplete(result);
    }
  };

  const handleContinueChat = () => {
    setShowSummary(false);
    setSummaryData(null);
    setMessages(prev => [
      ...prev,
      { id: `continue-${Date.now()}`, type: 'bot', content: '더 자세한 내용을 알려주세요. 어떤 부분이 부족한가요?' },
    ]);
  };

  const getObjectName = (type: string) => {
    const names: Record<string, string> = {
      company: '회사',
      people: '고객',
      lead: '리드',
      deal: '딜',
    };
    return names[type] || type;
  };

  const getFieldTypeName = (type: string) => {
    const names: Record<string, string> = {
      text: '텍스트',
      number: '숫자',
      email: '이메일',
      phone: '전화번호',
      date: '날짜',
      datetime: '날짜+시간',
      url: 'URL',
      select: '단일선택',
      multiselect: '복수선택',
      boolean: 'True/False',
      textarea: '긴 텍스트',
      user: '사용자',
      users: '사용자(복수)',
      relation: '연결',
      pipeline: '파이프라인',
      pipeline_stage: '파이프라인 단계',
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
          <p className="text-green-600 mb-4">
            추천 오브젝트가 설정되었습니다.
          </p>
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
                    <span className="px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                      {getObjectName(field.object_type)}
                    </span>
                    <span className="text-slate-700 font-medium">{field.field_label}</span>
                    {field.field_type && (
                      <span className="px-2 py-0.5 bg-purple-100 text-purple-600 rounded text-xs">
                        {getFieldTypeName(field.field_type)}
                      </span>
                    )}
                    <span className="text-slate-500">- {field.reason}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Column Analysis */}
          {summaryData.column_analysis && (
            <div className="mb-4">
              <h4 className="font-medium text-slate-700 mb-2">
                컬럼 분석 결과 (총 {summaryData.column_analysis.total_columns}개)
              </h4>

              {/* Columns to keep */}
              {summaryData.column_analysis.columns_to_keep.length > 0 && (
                <div className="bg-green-50 rounded-lg p-3 border border-green-200 mb-2">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span className="font-medium text-green-800 text-sm">
                      유지할 컬럼 ({summaryData.column_analysis.columns_to_keep.length}개)
                    </span>
                  </div>
                  <div className="space-y-1.5 text-sm">
                    {summaryData.column_analysis.columns_to_keep.map((col, idx) => (
                      <div key={idx} className="flex items-center gap-2 flex-wrap">
                        <span className="text-green-800 font-medium">{col.column_name}</span>
                        <span className="text-green-600">→</span>
                        {col.target_object && (
                          <span className="px-1.5 py-0.5 bg-green-100 text-green-700 rounded text-xs">
                            {getObjectName(col.target_object)}
                          </span>
                        )}
                        <span className="px-1.5 py-0.5 bg-white text-green-700 rounded text-xs border border-green-200">
                          {getFieldTypeName(col.recommended_type)}
                        </span>
                        <span className="text-green-600 text-xs">- {col.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Columns to skip */}
              {summaryData.column_analysis.columns_to_skip.length > 0 && (
                <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                  <div className="flex items-center gap-2 mb-2">
                    <svg className="w-4 h-4 text-amber-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    <span className="font-medium text-amber-800 text-sm">
                      제외 추천 컬럼 ({summaryData.column_analysis.columns_to_skip.length}개)
                    </span>
                  </div>
                  <div className="space-y-1 text-sm">
                    {summaryData.column_analysis.columns_to_skip.map((col, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-amber-800 font-medium">{col.column_name}</span>
                        <span className="text-amber-600 text-xs">- {col.reason}</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-amber-700 mt-2">
                    * 제외 컬럼도 필요하다면 필드 매핑 단계에서 직접 매핑할 수 있습니다
                  </p>
                </div>
              )}
            </div>
          )}

          <p className="text-slate-600 mb-6">{summaryData.confirmation_message}</p>

          <div className="flex gap-3 justify-center">
            <button
              onClick={handleContinueChat}
              className="px-6 py-2.5 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-lg font-medium transition-colors"
            >
              더 이야기하기
            </button>
            <button
              onClick={handleConfirmSummary}
              className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
            >
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
          {isUploading ? (
            <div className="flex flex-col items-center">
              <svg className="animate-spin h-8 w-8 text-blue-600 mb-3" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <p className="text-slate-600">파일 분석 중...</p>
            </div>
          ) : (
            <>
              <div className="w-12 h-12 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-3">
                <svg className="w-6 h-6 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
                </svg>
              </div>
              <p className="text-slate-700 font-medium mb-1">가져올 데이터 파일이 있으신가요?</p>
              <p className="text-slate-500 text-sm mb-3">
                파일을 업로드하면 AI가 데이터를 분석해서 더 정확한 추천을 해드려요
              </p>
              <label className="inline-block px-4 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700 transition-colors">
                파일 선택
                <input
                  type="file"
                  className="hidden"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleInputChange}
                />
              </label>
              <p className="text-xs text-slate-400 mt-2">CSV, XLSX, XLS 지원</p>
            </>
          )}

          {uploadError && (
            <div className="mt-3 p-2 bg-red-50 border border-red-200 rounded text-red-600 text-sm">
              {uploadError}
            </div>
          )}
        </div>
      )}

      {/* Skip file upload button */}
      {!chatStarted && !isUploading && (
        <button
          onClick={startChatWithoutFile}
          className="w-full py-3 text-slate-600 hover:text-blue-600 text-sm transition-colors"
        >
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

      {/* Chat container */}
      {chatStarted && (
        <>
          <div
            ref={chatContainerRef}
            className="h-[300px] overflow-y-auto bg-slate-50 rounded-xl p-4 space-y-4"
          >
            {messages.map(message => (
              <div
                key={message.id}
                className={`flex ${message.type === 'user' ? 'justify-end' : 'items-start gap-3'}`}
              >
                {message.type === 'bot' && (
                  <div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center flex-shrink-0">
                    <svg className="w-4 h-4 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  </div>
                )}
                <div
                  className={`max-w-[80%] px-4 py-3 rounded-2xl whitespace-pre-wrap ${
                    message.type === 'bot'
                      ? 'bg-white border border-slate-200 rounded-tl-none text-slate-700'
                      : 'bg-blue-600 text-white rounded-tr-none'
                  }`}
                >
                  <p>{message.content}</p>
                </div>
              </div>
            ))}

            {/* Typing indicator */}
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
                placeholder="데이터 활용 방식을 알려주세요..."
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
          {messages.length >= 3 && !isLoading && (
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

          {/* Hint text */}
          <p className="text-center text-sm text-slate-500">
            충분히 대화를 나눈 후 "컨설팅 정리하기"를 눌러 추천을 확인하세요
          </p>
        </>
      )}
    </div>
  );
}
