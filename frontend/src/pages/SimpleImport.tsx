import { useState, useCallback, useMemo, useEffect } from 'react';
import { validateSalesmapApiKey, fetchSalesmapFields, fetchPipelines, uploadFile, matchFieldsWithAI } from '../services/api';
import type { Pipeline } from '../services/api';
import type { SalesmapField, UploadResponse } from '../types';
import * as XLSX from 'xlsx';

const STEPS = [
  { title: 'API 연결', description: '세일즈맵 API Key를 입력하세요' },
  { title: '필드 확인', description: '오브젝트와 필드를 확인하세요' },
  { title: '파일 검증', description: '파일을 업로드하고 검증하세요' },
];

const OBJECT_TYPES = [
  { id: 'people', name: '고객', prefix: 'People', icon: '👤' },
  { id: 'company', name: '회사', prefix: 'Organization', icon: '🏢' },
  { id: 'lead', name: '리드', prefix: 'Lead', icon: '🎯' },
  { id: 'deal', name: '딜', prefix: 'Deal', icon: '💰' },
];

// 세일즈맵 컬럼 형식: "오브젝트 - 필드명"
// 기본 오브젝트: People, Organization, Lead, Deal
// 상품: Deal_Product1, Deal_Product2, ... (일반상품/구독상품)
// 노트: Deal_Note1, Lead_Note1, People_Note1, Organization_Note1, ...
const BASIC_PREFIXES = ['People', 'Organization', 'Lead', 'Deal'];

// prefix가 유효한지 체크 (기본 오브젝트 + 상품 + 노트)
const isValidPrefix = (prefix: string): boolean => {
  if (BASIC_PREFIXES.includes(prefix)) return true;
  // Deal_Product1, Deal_Product2, ... 형식
  if (/^Deal_Product\d+$/.test(prefix)) return true;
  // Deal_Note1, Lead_Note1, People_Note1, Organization_Note1, ... 형식
  if (/^(Deal|Lead|People|Organization)_Note\d+$/.test(prefix)) return true;
  return false;
};

const REQUIRED_FIELDS: Record<string, string[]> = {
  people: ['People - 이름'],
  company: ['Organization - 이름'],
  lead: ['Lead - 이름'], // + People/Organization 중 하나 필요
  deal: ['Deal - 이름', 'Deal - 파이프라인', 'Deal - 파이프라인 단계'], // + People/Organization 중 하나 필요
};

// 컬럼명에서 오브젝트 타입 감지
const detectObjectsFromColumns = (columns: string[]): { detected: string[]; details: Record<string, string[]> } => {
  const prefixToObject: Record<string, string> = {
    'People': 'people',
    'Organization': 'company',
    'Lead': 'lead',
    'Deal': 'deal',
  };

  // 한글 prefix도 지원
  const koreanToObject: Record<string, string> = {
    '고객': 'people', '사람': 'people',
    '회사': 'company', '조직': 'company',
    '리드': 'lead',
    '딜': 'deal', '거래': 'deal',
  };

  const detectedObjects = new Set<string>();
  const details: Record<string, string[]> = {};

  for (const col of columns) {
    if (!col.includes(' - ')) continue;

    const [prefix] = col.split(' - ');

    // 영어 prefix 확인
    if (prefixToObject[prefix]) {
      const objType = prefixToObject[prefix];
      detectedObjects.add(objType);
      if (!details[objType]) details[objType] = [];
      details[objType].push(col);
      continue;
    }

    // 한글 prefix 확인
    if (koreanToObject[prefix]) {
      const objType = koreanToObject[prefix];
      detectedObjects.add(objType);
      if (!details[objType]) details[objType] = [];
      details[objType].push(col);
      continue;
    }

    // Deal_Product, Deal_Note 등 특수 형식
    if (/^Deal_Product\d+$/.test(prefix) || /^Deal_Note\d+$/.test(prefix)) {
      detectedObjects.add('deal');
      if (!details['deal']) details['deal'] = [];
      details['deal'].push(col);
    }
    if (/^(Lead|People|Organization)_Note\d+$/.test(prefix)) {
      const baseObj = prefix.split('_')[0];
      const objType = prefixToObject[baseObj];
      if (objType) {
        detectedObjects.add(objType);
        if (!details[objType]) details[objType] = [];
        details[objType].push(col);
      }
    }
  }

  return { detected: Array.from(detectedObjects), details };
};

interface ValidationIssue {
  column: string;
  type: 'success' | 'warning' | 'error';
  message: string;
  suggestion?: string;
  fixedColumn?: string; // 자동 수정된 컬럼명
}

export function SimpleImport() {
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1: API Key
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Step 2: Fields
  const [selectedObjects, setSelectedObjects] = useState<string[]>([]);
  const [salesmapFields, setSalesmapFields] = useState<Record<string, SalesmapField[]>>({});
  const [isFetchingFields, setIsFetchingFields] = useState(false);
  const [detectedObjectDetails, setDetectedObjectDetails] = useState<Record<string, string[]>>({});

  // Pipeline (deal/lead)
  const [dealPipelines, setDealPipelines] = useState<Pipeline[]>([]);
  const [leadPipelines, setLeadPipelines] = useState<Pipeline[]>([]);
  const [selectedDealPipelineId, setSelectedDealPipelineId] = useState<string>('');
  const [selectedDealStageId, setSelectedDealStageId] = useState<string>('');
  const [selectedLeadPipelineId, setSelectedLeadPipelineId] = useState<string>('');
  const [isFetchingPipelines, setIsFetchingPipelines] = useState(false);

  // Step 3: File & Validation
  const [showMappingModal, setShowMappingModal] = useState(false);
  const [showPreview, setShowPreview] = useState(false); // 미리보기 모드
  const [uploadedFile, setUploadedFile] = useState<UploadResponse | null>(null);
  const [fileData, setFileData] = useState<Record<string, unknown>[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [validationIssues, setValidationIssues] = useState<ValidationIssue[]>([]);
  const [columnMappings, setColumnMappings] = useState<Record<string, string>>({}); // 원본 컬럼 → 수정된 컬럼

  // 사용 가능한 모든 세일즈맵 필드 목록 (오브젝트별)
  const availableFieldsByObject = useMemo(() => {
    const fieldsByObj: Record<string, string[]> = {};
    for (const objType of selectedObjects) {
      const objInfo = OBJECT_TYPES.find(o => o.id === objType);
      if (!objInfo) continue;
      const objFields = salesmapFields[objType] || [];
      fieldsByObj[objInfo.prefix] = objFields.map(f => `${objInfo.prefix} - ${f.label}`);
    }
    return fieldsByObj;
  }, [selectedObjects, salesmapFields]);

  // 전체 필드 목록 (플랫)
  const availableFields = useMemo(() => {
    return Object.values(availableFieldsByObject).flat();
  }, [availableFieldsByObject]);

  // 수정된 데이터 (미리보기용)
  const correctedData = useMemo(() => {
    if (fileData.length === 0) return { columns: [], rows: [] };

    // 원본 컬럼 목록
    const originalColumns = uploadedFile?.columns || [];

    // 수정된 컬럼 목록
    const newColumns = originalColumns.map(col => columnMappings[col] || col);

    // 수정된 행 데이터
    const rows = fileData.map(row => {
      const newRow: Record<string, unknown> = {};
      for (const col of originalColumns) {
        const newCol = columnMappings[col] || col;
        newRow[newCol] = row[col];
      }
      return newRow;
    });

    return { columns: newColumns, rows };
  }, [fileData, columnMappings, uploadedFile]);

  // AI 매칭 로딩 상태
  const [isMatchingWithAI, setIsMatchingWithAI] = useState(false);

  // 모달 열 때 AI 자동 매칭 초기화
  const openMappingModal = useCallback(async () => {
    const errorIssues = validationIssues.filter(i => i.type === 'error');
    const initialMappings: Record<string, string> = {};

    // fixedColumn이 있는 것들은 먼저 설정
    const columnsNeedingAI: string[] = [];
    for (const issue of errorIssues) {
      if (issue.fixedColumn) {
        initialMappings[issue.column] = issue.fixedColumn;
      } else {
        columnsNeedingAI.push(issue.column);
      }
    }

    setColumnMappings(initialMappings);
    setShowMappingModal(true);

    // AI 매칭 필요한 컬럼이 있으면 API 호출
    if (columnsNeedingAI.length > 0) {
      setIsMatchingWithAI(true);
      try {
        const response = await matchFieldsWithAI({
          error_columns: columnsNeedingAI,
          available_fields: availableFieldsByObject,
        });

        if (response.success && response.mappings) {
          setColumnMappings(prev => ({
            ...prev,
            ...response.mappings,
          }));
        }
      } catch (error) {
        console.error('AI 매칭 실패:', error);
      } finally {
        setIsMatchingWithAI(false);
      }
    }
  }, [validationIssues, availableFieldsByObject]);

  // 수정된 엑셀 파일 다운로드
  const downloadCorrectedFile = useCallback(() => {
    if (!uploadedFile || fileData.length === 0) return;

    // 컬럼 이름 변환
    const correctedData = fileData.map(row => {
      const newRow: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        const newKey = columnMappings[key] || key;
        newRow[newKey] = value;
      }
      return newRow;
    });

    // 새 워크북 생성
    const ws = XLSX.utils.json_to_sheet(correctedData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Sheet1');

    // 파일명 생성
    const originalName = uploadedFile.filename.replace(/\.[^.]+$/, '');
    const fileName = `${originalName}_수정됨.xlsx`;

    // 다운로드
    XLSX.writeFile(wb, fileName);
    setShowMappingModal(false);
  }, [uploadedFile, fileData, columnMappings]);

  // Step 1: Validate API Key
  const handleValidateApiKey = async () => {
    if (!apiKey.trim()) return;

    setIsValidating(true);
    setApiError(null);

    try {
      const result = await validateSalesmapApiKey(apiKey);
      if (result.valid) {
        setCurrentStep(1);
      } else {
        setApiError(result.message || 'API 키가 유효하지 않습니다');
      }
    } catch (error) {
      setApiError('API 키 검증 중 오류가 발생했습니다');
    } finally {
      setIsValidating(false);
    }
  };

  // Step 2: 파일로 오브젝트 자동 감지
  const handleAutoDetectFromFile = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const result = await uploadFile(file);
      setUploadedFile(result);
      setFileData(result.data || []);

      // 컬럼명에서 오브젝트 감지
      const { detected, details } = detectObjectsFromColumns(result.columns);

      if (detected.length > 0) {
        setSelectedObjects(detected);
        setDetectedObjectDetails(details);
      }
    } catch (error) {
      console.error('파일 업로드 오류:', error);
    } finally {
      setIsUploading(false);
    }
  }, []);

  // Step 2: Toggle object selection
  const handleObjectToggle = (objectId: string) => {
    setSelectedObjects(prev =>
      prev.includes(objectId)
        ? prev.filter(id => id !== objectId)
        : [...prev, objectId]
    );
  };

  // 선택된 딜 파이프라인의 스테이지 목록
  const dealStages = useMemo(() => {
    if (!selectedDealPipelineId) return [];
    const pipeline = dealPipelines.find(p => p.id === selectedDealPipelineId);
    return pipeline?.pipelineStageList || [];
  }, [dealPipelines, selectedDealPipelineId]);

  // 딜 파이프라인 변경 시 스테이지 초기화
  const handleDealPipelineChange = (pipelineId: string) => {
    setSelectedDealPipelineId(pipelineId);
    setSelectedDealStageId('');
  };

  // 딜은 파이프라인+스테이지 필수, 리드는 선택
  const isPipelineValid = useMemo(() => {
    const needsDeal = selectedObjects.includes('deal');
    if (needsDeal && (!selectedDealPipelineId || !selectedDealStageId)) return false;
    return true;
  }, [selectedObjects, selectedDealPipelineId, selectedDealStageId]);

  // Step 2: Fetch fields for selected objects
  const handleFetchFields = async () => {
    if (selectedObjects.length === 0) return;

    setIsFetchingFields(true);
    setIsFetchingPipelines(true);
    try {
      // 필드 조회
      const result = await fetchSalesmapFields(apiKey, selectedObjects);
      if (result.success) {
        const fieldsMap: Record<string, SalesmapField[]> = {};
        for (const objResult of result.results) {
          fieldsMap[objResult.object_type] = objResult.fields;
        }
        setSalesmapFields(fieldsMap);
      }

      // 파이프라인 조회 (deal/lead 선택 시)
      const pipelinePromises: Promise<void>[] = [];
      if (selectedObjects.includes('deal')) {
        pipelinePromises.push(
          fetchPipelines(apiKey, 'deal').then(res => {
            if (res.success) {
              setDealPipelines(res.pipelineList);
              // 파이프라인이 1개면 자동 선택
              if (res.pipelineList.length === 1) {
                setSelectedDealPipelineId(res.pipelineList[0].id);
              }
            }
          })
        );
      }
      if (selectedObjects.includes('lead')) {
        pipelinePromises.push(
          fetchPipelines(apiKey, 'lead').then(res => {
            if (res.success) {
              setLeadPipelines(res.pipelineList);
              if (res.pipelineList.length === 1) {
                setSelectedLeadPipelineId(res.pipelineList[0].id);
              }
            }
          })
        );
      }
      await Promise.all(pipelinePromises);

      // 파이프라인 검증 통과 또는 deal/lead 없으면 다음으로
      if (!selectedObjects.includes('deal') && !selectedObjects.includes('lead')) {
        setCurrentStep(2);
      }
      // deal/lead 있을 때는 파이프라인 선택 UI가 나오므로 여기서 step 이동하지 않음
      // 단, 파이프라인 선택이 이미 완료된 경우(자동 선택 등)는 예외
    } catch (error) {
      console.error('Failed to fetch fields:', error);
    } finally {
      setIsFetchingFields(false);
      setIsFetchingPipelines(false);
    }
  };

  // 파이프라인 선택 완료 후 다음 단계
  const handlePipelineConfirm = () => {
    if (!isPipelineValid) return;
    setCurrentStep(2);
  };

  // Step 3: Handle file upload
  const handleFileUpload = useCallback(async (file: File) => {
    setIsUploading(true);
    setValidationIssues([]);
    setColumnMappings({});

    try {
      const result = await uploadFile(file);
      setUploadedFile(result);
      setFileData(result.data || []);

      // Validate file against salesmap fields
      validateFileAgainstFields(result.columns, result.data || []);
    } catch (error) {
      console.error('Upload error:', error);
    } finally {
      setIsUploading(false);
    }
  }, [salesmapFields, selectedObjects]);

  // Step 3 진입 시 이미 파일이 있으면 자동 검증
  useEffect(() => {
    if (currentStep === 2 && uploadedFile && validationIssues.length === 0 && Object.keys(salesmapFields).length > 0) {
      validateFileAgainstFields(uploadedFile.columns, fileData);
    }
  }, [currentStep, uploadedFile, salesmapFields]);

  // 컬럼명을 세일즈맵 형식으로 변환 시도: "오브젝트 - 필드명"
  const tryFixColumnName = (col: string): { fixed: string; prefix: string } | null => {
    // 이미 올바른 형식인 경우
    if (col.includes(' - ')) {
      const [prefix] = col.split(' - ');
      if (isValidPrefix(prefix)) {
        return null; // 수정 불필요
      }
    }

    // "리드 - 이름" → "Lead - 이름" 변환
    const koreanToPrefix: Record<string, string> = {
      '고객': 'People', '사람': 'People',
      '회사': 'Organization', '조직': 'Organization',
      '리드': 'Lead',
      '딜': 'Deal', '거래': 'Deal',
    };

    for (const [korean, prefix] of Object.entries(koreanToPrefix)) {
      if (col.startsWith(korean + ' - ')) {
        const fieldName = col.substring(korean.length + 3);
        return { fixed: `${prefix} - ${fieldName}`, prefix };
      }
      if (col.startsWith(korean + '-')) {
        const fieldName = col.substring(korean.length + 1).trim();
        return { fixed: `${prefix} - ${fieldName}`, prefix };
      }
    }

    // "이름", "이메일" 등 필드명만 있는 경우 - 선택된 오브젝트 기반으로 추천
    const commonFields: Record<string, string> = {
      '이름': 'name', '이메일': 'email', '전화': 'phone', '전화번호': 'phone',
      '주소': 'address', '담당자': 'owner', '메모': 'note',
    };

    if (commonFields[col]) {
      // 선택된 첫 번째 오브젝트의 prefix 사용
      const firstObj = OBJECT_TYPES.find(o => selectedObjects.includes(o.id));
      if (firstObj) {
        return { fixed: `${firstObj.prefix} - ${col}`, prefix: firstObj.prefix };
      }
    }

    return null;
  };

  // Validate uploaded file columns against salesmap fields
  const validateFileAgainstFields = (columns: string[], data: Record<string, unknown>[]) => {
    const issues: ValidationIssue[] = [];

    // 세일즈맵 필드 맵 생성: "People - 이름" 형식
    const availableFieldsMap: Record<string, { type: string; required: boolean }> = {};
    for (const objType of selectedObjects) {
      const objInfo = OBJECT_TYPES.find(o => o.id === objType);
      if (!objInfo) continue;

      const fields = salesmapFields[objType] || [];
      fields.forEach(f => {
        // 모든 필드 포함 (시스템 필드 + 커스텀 필드)
        const fullLabel = `${objInfo.prefix} - ${f.label}`;
        availableFieldsMap[fullLabel] = { type: f.type, required: f.required };
        // 원본 label도 추가 (fallback)
        availableFieldsMap[f.label] = { type: f.type, required: f.required };
      });
    }

    // 감지된 오브젝트 타입 추적
    const detectedPrefixes = new Set<string>();

    // 각 컬럼 검증
    for (const col of columns) {
      // 1. 컬럼명 형식 검사 ("오브젝트 - 필드명")
      let hasValidFormat = false;
      if (col.includes(' - ')) {
        const [prefix] = col.split(' - ');
        hasValidFormat = isValidPrefix(prefix);
      }

      if (!hasValidFormat) {
        // 형식이 잘못됨 - 수정 제안
        const fix = tryFixColumnName(col);
        if (fix) {
          issues.push({
            column: col,
            type: 'warning',
            message: '컬럼명 형식이 올바르지 않습니다',
            suggestion: `"${fix.fixed}" 형식으로 변경하세요`,
            fixedColumn: fix.fixed,
          });
          detectedPrefixes.add(fix.prefix);
        } else {
          issues.push({
            column: col,
            type: 'error',
            message: '세일즈맵 형식이 아닙니다',
            suggestion: '"오브젝트 - 필드명" 형식으로 변경하세요 (예: People - 이름)',
          });
        }
        continue;
      }

      // 2. prefix 추출 및 추적
      const [prefix] = col.split(' - ');
      detectedPrefixes.add(prefix);

      // 3. 특수 형식 (Product, Note) 처리 - 무조건 성공
      const isProductField = /^Deal_Product\d+ - /.test(col);
      const isNoteField = /^(Deal|Lead|People|Organization)_Note\d+ - /.test(col);

      if (isProductField || isNoteField) {
        issues.push({
          column: col,
          type: 'success',
          message: isProductField ? '상품 필드' : '노트 필드',
        });
        continue;
      }

      // 4. 세일즈맵 필드와 매칭 확인
      const fieldInfo = availableFieldsMap[col];
      if (fieldInfo) {
        // 데이터 형식 검사
        const sampleValues = data.slice(0, 10).map(row => row[col]).filter(Boolean);
        const formatIssue = checkDataFormat(sampleValues, fieldInfo.type);

        if (formatIssue) {
          issues.push({
            column: col,
            type: 'warning',
            message: formatIssue,
            suggestion: getFormatSuggestion(fieldInfo.type),
          });
        } else {
          issues.push({
            column: col,
            type: 'success',
            message: '필드 매칭 완료',
          });
        }
      } else {
        // 세일즈맵 API에 없는 필드 → 오류 (AI 매핑 필요)
        issues.push({
          column: col,
          type: 'error',
          message: '세일즈맵에 없는 필드입니다',
          suggestion: '세일즈맵 필드로 매핑하거나, 세일즈맵에서 커스텀 필드를 먼저 생성하세요',
        });
      }
    }

    // 4. 필수 필드 검사
    for (const objType of selectedObjects) {
      const required = REQUIRED_FIELDS[objType] || [];
      for (const reqField of required) {
        if (!columns.includes(reqField)) {
          issues.unshift({
            column: reqField,
            type: 'error',
            message: `필수 필드 누락`,
            suggestion: `파일에 "${reqField}" 컬럼을 추가하세요`,
          });
        }
      }
    }

    // 5. Lead/Deal은 People 또는 Organization 연결 필요
    if (selectedObjects.includes('lead') || selectedObjects.includes('deal')) {
      const hasPeople = columns.some(c => c.startsWith('People - '));
      const hasOrg = columns.some(c => c.startsWith('Organization - '));

      if (!hasPeople && !hasOrg) {
        const objName = selectedObjects.includes('lead') ? '리드' : '딜';
        issues.unshift({
          column: 'People/Organization',
          type: 'error',
          message: `${objName}에는 고객 또는 회사 정보가 필요합니다`,
          suggestion: '"People - 이름" 또는 "Organization - 이름" 컬럼을 추가하세요',
        });
      }
    }

    setValidationIssues(issues);
  };

  // Check data format against expected type
  const checkDataFormat = (values: unknown[], fieldType: string): string | null => {
    if (values.length === 0) return null;

    switch (fieldType) {
      case 'email':
        const invalidEmails = values.filter(v =>
          typeof v === 'string' && v && !v.includes('@')
        );
        if (invalidEmails.length > 0) {
          return `이메일 형식이 아닌 값이 있습니다 (예: ${invalidEmails[0]})`;
        }
        break;
      case 'phone':
        const invalidPhones = values.filter(v =>
          typeof v === 'string' && v && !/[\d\-+().\s]/.test(v)
        );
        if (invalidPhones.length > 0) {
          return `전화번호 형식이 아닌 값이 있습니다`;
        }
        break;
      case 'number':
        const invalidNumbers = values.filter(v =>
          v !== null && v !== undefined && v !== '' && isNaN(Number(String(v).replace(/,/g, '')))
        );
        if (invalidNumbers.length > 0) {
          return `숫자가 아닌 값이 있습니다 (예: ${invalidNumbers[0]})`;
        }
        break;
      case 'date':
      case 'datetime':
        const invalidDates = values.filter(v => {
          if (!v || v === '') return false;
          const d = new Date(String(v));
          return isNaN(d.getTime());
        });
        if (invalidDates.length > 0) {
          return `날짜 형식이 아닌 값이 있습니다 (예: ${invalidDates[0]})`;
        }
        break;
    }
    return null;
  };

  const getFormatSuggestion = (fieldType: string): string => {
    switch (fieldType) {
      case 'email': return '이메일 형식: user@example.com';
      case 'phone': return '전화번호 형식: 010-1234-5678';
      case 'number': return '숫자만 입력 (콤마 없이)';
      case 'date': return '날짜 형식: YYYY-MM-DD';
      case 'datetime': return '날짜시간 형식: YYYY-MM-DD HH:mm';
      default: return '';
    }
  };

  const successCount = validationIssues.filter(i => i.type === 'success').length;
  const warningCount = validationIssues.filter(i => i.type === 'warning').length;
  const errorCount = validationIssues.filter(i => i.type === 'error').length;

  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-slate-900">세일즈맵 데이터 가져오기</h1>
          <p className="text-slate-600 mt-1">간단한 3단계로 데이터를 가져오세요</p>
        </div>

        {/* Steps indicator */}
        <div className="flex items-center mb-8">
          {STEPS.map((step, idx) => (
            <div key={idx} className="flex items-center">
              <div className={`flex items-center justify-center w-8 h-8 rounded-full text-sm font-medium ${
                idx < currentStep ? 'bg-green-500 text-white' :
                idx === currentStep ? 'bg-blue-600 text-white' :
                'bg-slate-200 text-slate-500'
              }`}>
                {idx < currentStep ? '✓' : idx + 1}
              </div>
              <span className={`ml-2 text-sm ${idx === currentStep ? 'text-blue-600 font-medium' : 'text-slate-500'}`}>
                {step.title}
              </span>
              {idx < STEPS.length - 1 && (
                <div className={`w-12 h-0.5 mx-3 ${idx < currentStep ? 'bg-green-500' : 'bg-slate-200'}`} />
              )}
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">

          {/* Step 1: API Key */}
          {currentStep === 0 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-2">세일즈맵 API 연결</h2>
                <p className="text-slate-600 text-sm">세일즈맵 설정에서 API 키를 복사해주세요</p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-2">API Key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="개인설정 > 연동 > API에서 확인 가능합니다"
                  className="w-full px-4 py-3 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {apiError && (
                  <p className="mt-2 text-sm text-red-600">{apiError}</p>
                )}
              </div>

              <button
                onClick={handleValidateApiKey}
                disabled={!apiKey.trim() || isValidating}
                className="w-full py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
              >
                {isValidating ? '확인 중...' : '연결 확인'}
              </button>
            </div>
          )}

          {/* Step 2: Object & Field Selection */}
          {currentStep === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-2">오브젝트 선택</h2>
                <p className="text-slate-600 text-sm">가져올 데이터 유형을 선택하세요 (복수 선택 가능)</p>
              </div>

              {/* 파일로 자동 감지 */}
              <div
                onDrop={(e) => {
                  e.preventDefault();
                  const file = e.dataTransfer.files[0];
                  if (file) handleAutoDetectFromFile(file);
                }}
                onDragOver={(e) => e.preventDefault()}
                className="border-2 border-dashed border-slate-300 rounded-xl p-4 text-center hover:border-blue-400 transition-colors bg-slate-50"
              >
                {isUploading ? (
                  <div className="flex items-center justify-center gap-2 py-2">
                    <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
                    <span className="text-slate-600">파일 분석 중...</span>
                  </div>
                ) : uploadedFile ? (
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-green-500">✓</span>
                      <span className="text-sm font-medium text-slate-700">{uploadedFile.filename}</span>
                      <span className="text-xs text-slate-500">({uploadedFile.total_rows}행)</span>
                    </div>
                    <button
                      onClick={() => {
                        setUploadedFile(null);
                        setFileData([]);
                        setDetectedObjectDetails({});
                      }}
                      className="text-xs text-slate-500 hover:text-slate-700"
                    >
                      다른 파일
                    </button>
                  </div>
                ) : (
                  <label className="cursor-pointer">
                    <div className="flex items-center justify-center gap-2 py-2">
                      <span className="text-xl">🔍</span>
                      <span className="text-sm text-slate-600">파일을 업로드하면 오브젝트를 <strong>자동 감지</strong>합니다</span>
                    </div>
                    <input
                      type="file"
                      className="hidden"
                      accept=".csv,.xlsx,.xls"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) handleAutoDetectFromFile(file);
                      }}
                    />
                  </label>
                )}
              </div>

              {/* 감지된 오브젝트 상세 */}
              {Object.keys(detectedObjectDetails).length > 0 && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <p className="text-sm font-medium text-blue-800 mb-2">🎯 자동 감지된 오브젝트</p>
                  <div className="space-y-1">
                    {Object.entries(detectedObjectDetails).map(([objType, columns]) => {
                      const objInfo = OBJECT_TYPES.find(o => o.id === objType);
                      return (
                        <div key={objType} className="text-xs text-blue-700">
                          <span className="font-medium">{objInfo?.icon} {objInfo?.name}</span>
                          <span className="text-blue-500 ml-1">({columns.length}개 컬럼)</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="relative">
                <div className="absolute inset-0 flex items-center">
                  <div className="w-full border-t border-slate-200"></div>
                </div>
                <div className="relative flex justify-center text-xs">
                  <span className="px-2 bg-white text-slate-500">또는 직접 선택</span>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {OBJECT_TYPES.map(obj => {
                  const isSelected = selectedObjects.includes(obj.id);
                  const isDetected = detectedObjectDetails[obj.id]?.length > 0;
                  return (
                    <button
                      key={obj.id}
                      onClick={() => handleObjectToggle(obj.id)}
                      className={`p-4 rounded-lg border-2 text-left transition-all relative ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      <span className="text-2xl">{obj.icon}</span>
                      <span className="ml-2 font-medium">{obj.name}</span>
                      {isDetected && (
                        <span className="absolute top-2 right-2 text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                          자동 감지
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* Show fetched fields */}
              {Object.keys(salesmapFields).length > 0 && (
                <div className="border border-slate-200 rounded-lg p-4">
                  <h3 className="font-medium text-slate-800 mb-3">사용 가능한 필드</h3>
                  {selectedObjects.map(objType => {
                    const fields = salesmapFields[objType] || [];
                    const editableFields = fields.filter(f => !f.is_system);
                    return (
                      <div key={objType} className="mb-4 last:mb-0">
                        <p className="text-sm font-medium text-slate-600 mb-2">
                          {OBJECT_TYPES.find(o => o.id === objType)?.name} ({editableFields.length}개)
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {editableFields.map(f => (
                            <span
                              key={f.id}
                              className={`px-2 py-1 text-xs rounded ${
                                f.required ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-600'
                              }`}
                            >
                              {f.label}{f.required && ' *'}
                            </span>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 파이프라인 선택 (deal/lead) */}
              {(dealPipelines.length > 0 || leadPipelines.length > 0) && (
                <div className="border border-slate-200 rounded-lg p-4 space-y-4">
                  <h3 className="font-medium text-slate-800">파이프라인 선택</h3>

                  {/* 딜 파이프라인 */}
                  {selectedObjects.includes('deal') && dealPipelines.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-slate-700">
                        💰 딜 파이프라인 <span className="text-red-500">*필수</span>
                      </p>
                      <select
                        value={selectedDealPipelineId}
                        onChange={(e) => handleDealPipelineChange(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">파이프라인을 선택하세요</option>
                        {dealPipelines.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>

                      {selectedDealPipelineId && dealStages.length > 0 && (
                        <div>
                          <p className="text-sm font-medium text-slate-700 mb-2">
                            파이프라인 단계 <span className="text-red-500">*필수</span>
                          </p>
                          <select
                            value={selectedDealStageId}
                            onChange={(e) => setSelectedDealStageId(e.target.value)}
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          >
                            <option value="">파이프라인 단계를 선택하세요</option>
                            {dealStages.map(s => (
                              <option key={s.id} value={s.id}>
                                {s.name}{s.description ? ` - ${s.description}` : ''}
                              </option>
                            ))}
                          </select>
                        </div>
                      )}
                    </div>
                  )}

                  {/* 리드 파이프라인 */}
                  {selectedObjects.includes('lead') && leadPipelines.length > 0 && (
                    <div className="space-y-3">
                      <p className="text-sm font-medium text-slate-700">
                        🎯 리드 파이프라인
                      </p>
                      <select
                        value={selectedLeadPipelineId}
                        onChange={(e) => setSelectedLeadPipelineId(e.target.value)}
                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      >
                        <option value="">파이프라인을 선택하세요</option>
                        {leadPipelines.map(p => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentStep(0)}
                  className="px-6 py-3 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
                >
                  이전
                </button>
                {/* 파이프라인 선택이 필요한 경우 (deal/lead 파이프라인 조회 완료) */}
                {(dealPipelines.length > 0 || leadPipelines.length > 0) ? (
                  <button
                    onClick={handlePipelineConfirm}
                    disabled={!isPipelineValid}
                    className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  >
                    {!isPipelineValid ? '파이프라인을 선택하세요' : '다음'}
                  </button>
                ) : (
                  <button
                    onClick={handleFetchFields}
                    disabled={selectedObjects.length === 0 || isFetchingFields}
                    className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  >
                    {isFetchingFields || isFetchingPipelines ? '조회 중...' : '필드 확인 후 다음'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Step 3: File Upload & Validation */}
          {currentStep === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-slate-900 mb-2">파일 업로드 & 검증</h2>
                <p className="text-slate-600 text-sm">
                  파일을 업로드하면 자동으로 검증합니다
                </p>
              </div>

              {/* File upload area */}
              {!uploadedFile ? (
                <div
                  onDrop={(e) => {
                    e.preventDefault();
                    const file = e.dataTransfer.files[0];
                    if (file) handleFileUpload(file);
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  className="border-2 border-dashed border-slate-300 rounded-xl p-8 text-center hover:border-blue-400 transition-colors"
                >
                  {isUploading ? (
                    <div className="flex flex-col items-center">
                      <div className="animate-spin h-8 w-8 border-4 border-blue-600 border-t-transparent rounded-full mb-3" />
                      <p className="text-slate-600">업로드 중...</p>
                    </div>
                  ) : (
                    <>
                      <div className="text-4xl mb-3">📁</div>
                      <p className="text-slate-700 font-medium mb-2">파일을 드래그하거나 클릭하여 선택</p>
                      <p className="text-slate-500 text-sm mb-4">CSV, XLSX, XLS 지원</p>
                      <label className="inline-block px-6 py-2 bg-blue-600 text-white rounded-lg cursor-pointer hover:bg-blue-700">
                        파일 선택
                        <input
                          type="file"
                          className="hidden"
                          accept=".csv,.xlsx,.xls"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) handleFileUpload(file);
                          }}
                        />
                      </label>
                    </>
                  )}
                </div>
              ) : (
                <>
                  {/* Uploaded file info */}
                  <div className="flex items-center justify-between p-4 bg-green-50 border border-green-200 rounded-lg">
                    <div className="flex items-center gap-3">
                      <span className="text-2xl">📊</span>
                      <div>
                        <p className="font-medium text-green-800">{uploadedFile.filename}</p>
                        <p className="text-sm text-green-600">{uploadedFile.total_rows}행 · {uploadedFile.columns.length}열</p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setUploadedFile(null);
                        setValidationIssues([]);
                      }}
                      className="text-slate-500 hover:text-slate-700"
                    >
                      다른 파일
                    </button>
                  </div>

                  {/* Validation results */}
                  {validationIssues.length > 0 && (
                    <div className="space-y-4">
                      {/* Summary */}
                      <div className="flex gap-4 p-4 bg-slate-50 rounded-lg">
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 bg-green-500 rounded-full"></span>
                          <span className="text-sm">성공 {successCount}개</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 bg-amber-500 rounded-full"></span>
                          <span className="text-sm">경고 {warningCount}개</span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="w-3 h-3 bg-red-500 rounded-full"></span>
                          <span className="text-sm">오류 {errorCount}개</span>
                        </div>
                      </div>

                      {/* Issues list */}
                      <div className="space-y-2 max-h-80 overflow-y-auto">
                        {validationIssues.map((issue, idx) => (
                          <div
                            key={idx}
                            className={`p-3 rounded-lg border ${
                              issue.type === 'success' ? 'bg-green-50 border-green-200' :
                              issue.type === 'warning' ? 'bg-amber-50 border-amber-200' :
                              'bg-red-50 border-red-200'
                            }`}
                          >
                            <div className="flex items-start gap-2">
                              <span className={`text-sm ${
                                issue.type === 'success' ? 'text-green-600' :
                                issue.type === 'warning' ? 'text-amber-600' :
                                'text-red-600'
                              }`}>
                                {issue.type === 'success' ? '✓' : issue.type === 'warning' ? '⚠' : '✗'}
                              </span>
                              <div className="flex-1">
                                <p className={`font-medium text-sm ${
                                  issue.type === 'success' ? 'text-green-800' :
                                  issue.type === 'warning' ? 'text-amber-800' :
                                  'text-red-800'
                                }`}>
                                  {issue.column}
                                </p>
                                <p className={`text-sm ${
                                  issue.type === 'success' ? 'text-green-600' :
                                  issue.type === 'warning' ? 'text-amber-600' :
                                  'text-red-600'
                                }`}>
                                  {issue.message}
                                </p>
                                {issue.suggestion && (
                                  <p className="text-xs text-slate-500 mt-1">
                                    💡 {issue.suggestion}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}

              <div className="flex gap-3">
                <button
                  onClick={() => setCurrentStep(1)}
                  className="px-6 py-3 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
                >
                  이전
                </button>
                {errorCount > 0 ? (
                  <button
                    onClick={openMappingModal}
                    className="flex-1 py-3 rounded-lg font-medium bg-amber-500 text-white hover:bg-amber-600"
                  >
                    🔧 오류 {errorCount}개 수정하고 가져오기
                  </button>
                ) : (
                  <button
                    disabled={!uploadedFile}
                    className={`flex-1 py-3 rounded-lg font-medium ${
                      uploadedFile
                        ? 'bg-green-600 text-white hover:bg-green-700'
                        : 'bg-slate-300 text-slate-500 cursor-not-allowed'
                    }`}
                  >
                    {uploadedFile ? '가져오기 실행' : '파일을 업로드하세요'}
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        {/* AI 필드 매핑 모달 */}
        {showMappingModal && (
          <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[85vh] overflow-hidden">
              <div className="p-6 border-b border-slate-200">
                <div className="flex items-center justify-between">
                  <h2 className="text-lg font-semibold text-slate-900">🔧 오류 필드 수정</h2>
                  <button
                    onClick={() => { setShowMappingModal(false); setShowPreview(false); }}
                    className="text-slate-400 hover:text-slate-600"
                  >
                    ✕
                  </button>
                </div>
                {/* 탭 */}
                <div className="flex gap-2 mt-4">
                  <button
                    onClick={() => setShowPreview(false)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      !showPreview
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    📝 필드 매핑
                  </button>
                  <button
                    onClick={() => setShowPreview(true)}
                    className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                      showPreview
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    👀 데이터 미리보기
                  </button>
                </div>
              </div>

              {/* 필드 매핑 뷰 */}
              {!showPreview && (
                <div className="p-6 overflow-y-auto max-h-[50vh]">
                  {isMatchingWithAI && (
                    <div className="mb-4 p-4 bg-blue-50 border border-blue-200 rounded-lg flex items-center gap-3">
                      <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full" />
                      <span className="text-blue-700">AI가 최적의 필드를 찾고 있습니다...</span>
                    </div>
                  )}
                  {validationIssues.filter(i => i.type === 'error').map((issue, idx) => (
                    <div key={idx} className="mb-4 p-4 bg-slate-50 border border-slate-200 rounded-lg">
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-red-500">✗</span>
                        <span className="font-medium text-slate-800">{issue.column}</span>
                        <span className="text-xs text-slate-500">→</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className={columnMappings[issue.column] ? "text-green-500" : "text-slate-300"}>✓</span>
                        <select
                          value={columnMappings[issue.column] || ''}
                          onChange={(e) => setColumnMappings(prev => ({
                            ...prev,
                            [issue.column]: e.target.value
                          }))}
                          disabled={isMatchingWithAI}
                          className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-slate-100"
                        >
                          <option value="">{isMatchingWithAI ? 'AI 분석 중...' : '필드 선택...'}</option>
                          {availableFields.map(field => (
                            <option key={field} value={field}>
                              {field}
                            </option>
                          ))}
                        </select>
                        {columnMappings[issue.column] && !isMatchingWithAI && (
                          <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded whitespace-nowrap">
                            🤖 AI 추천
                          </span>
                        )}
                      </div>
                    </div>
                  ))}

                  {validationIssues.filter(i => i.type === 'error').length === 0 && (
                    <div className="text-center py-8 text-slate-500">
                      모든 오류가 수정되었습니다!
                    </div>
                  )}
                </div>
              )}

              {/* 데이터 미리보기 뷰 */}
              {showPreview && (
                <div className="p-6 overflow-auto max-h-[50vh]">
                  <div className="mb-3 flex items-center justify-between">
                    <span className="text-sm text-slate-600">
                      총 {correctedData.rows.length}행 · {correctedData.columns.length}열
                    </span>
                    <span className="text-xs text-slate-500">
                      (최대 100행 미리보기)
                    </span>
                  </div>
                  <div className="overflow-x-auto border border-slate-200 rounded-lg">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-100 sticky top-0">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-medium text-slate-500 border-b">#</th>
                          {correctedData.columns.map((col, idx) => {
                            const isChanged = Object.values(columnMappings).includes(col);
                            return (
                              <th
                                key={idx}
                                className={`px-3 py-2 text-left text-xs font-medium border-b whitespace-nowrap ${
                                  isChanged ? 'text-blue-700 bg-blue-50' : 'text-slate-500'
                                }`}
                              >
                                {isChanged && <span className="mr-1">✨</span>}
                                {col}
                              </th>
                            );
                          })}
                        </tr>
                      </thead>
                      <tbody className="bg-white">
                        {correctedData.rows.slice(0, 100).map((row, rowIdx) => (
                          <tr key={rowIdx} className="hover:bg-slate-50">
                            <td className="px-3 py-2 text-slate-400 border-b">{rowIdx + 1}</td>
                            {correctedData.columns.map((col, colIdx) => {
                              const value = row[col];
                              const displayValue = value === null || value === undefined || value === ''
                                ? '-'
                                : String(value);
                              return (
                                <td
                                  key={colIdx}
                                  className="px-3 py-2 text-slate-700 border-b max-w-[200px] truncate"
                                  title={displayValue}
                                >
                                  {displayValue}
                                </td>
                              );
                            })}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {correctedData.rows.length > 100 && (
                    <p className="mt-2 text-center text-xs text-slate-500">
                      ... 외 {correctedData.rows.length - 100}행 더 있음
                    </p>
                  )}
                </div>
              )}

              <div className="p-6 border-t border-slate-200 flex gap-3">
                <button
                  onClick={() => { setShowMappingModal(false); setShowPreview(false); }}
                  className="px-6 py-3 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
                >
                  취소
                </button>
                {!showPreview ? (
                  <button
                    onClick={() => setShowPreview(true)}
                    disabled={Object.keys(columnMappings).length === 0 || isMatchingWithAI}
                    className="flex-1 py-3 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed"
                  >
                    👀 미리보기
                  </button>
                ) : (
                  <>
                    <button
                      onClick={() => setShowPreview(false)}
                      className="px-6 py-3 border border-slate-300 rounded-lg font-medium text-slate-700 hover:bg-slate-50"
                    >
                      ← 매핑 수정
                    </button>
                    <button
                      onClick={downloadCorrectedFile}
                      className="flex-1 py-3 bg-green-600 text-white rounded-lg font-medium hover:bg-green-700"
                    >
                      📥 수정된 파일 다운로드
                    </button>
                  </>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
