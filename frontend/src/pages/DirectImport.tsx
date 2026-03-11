import { useState, useCallback, useMemo } from 'react';
import { uploadFile, validateSalesmapApiKey, fetchSalesmapFields, fetchPipelines, fetchUsers, fetchProducts, salesmapAutoMapping, startBulkImport } from '../services/api';
import type { SalesmapUser, SalesmapProduct } from '../services/api';
import type { UploadResponse } from '../types';
import { SearchableSelect, type GroupedOption } from '../components/SearchableSelect';

const STEPS = [
  { id: 'upload', title: '파일 업로드', icon: 'upload_file' },
  { id: 'api', title: 'API 연결', icon: 'key' },
  { id: 'mapping', title: '필드 매핑', icon: 'sync_alt' },
  { id: 'import', title: '가져오기', icon: 'cloud_upload' },
];

type ObjectType = 'people' | 'organization' | 'deal' | 'lead' | 'product' | 'quote';

interface ObjectConfig {
  id: ObjectType;
  name: string;
  endpoint: string;
  needsConnection?: boolean;
}

const OBJECT_CONFIGS: ObjectConfig[] = [
  { id: 'people', name: '고객', endpoint: '/v2/people' },
  { id: 'organization', name: '회사', endpoint: '/v2/organization' },
  { id: 'deal', name: '딜', endpoint: '/v2/deal', needsConnection: true },
  { id: 'lead', name: '리드', endpoint: '/v2/lead', needsConnection: true },
  { id: 'product', name: '상품', endpoint: '/v2/product' },
  { id: 'quote', name: '견적서', endpoint: '/v2/quote', needsConnection: true },
];

// 필드 매핑에서 제외할 시스템 필드 키워드 (백엔드 is_system 보완)
const EXCLUDED_FIELD_KEYWORDS = [
  '진입한 날짜', '퇴장한 날짜', '누적 시간',  // 파이프라인 단계 추적 필드
  'RecordId', 'recordId',
];

// 상태(status) 필드만 매핑에서 제외 (파이프라인/단계는 행별 매핑 허용)
const STATUS_ONLY_FIELD_IDS = [
  '상태', 'status',
];

// API에서 가져온 필드 타입
interface SalesmapField {
  id: string;
  key: string;
  name: string;
  type: string;
  required?: boolean;
  isCustom?: boolean;
}

// 파이프라인 타입
interface PipelineStage {
  id: string;
  name: string;
  index: number;
  description?: string;
}

interface Pipeline {
  id: string;
  name: string;
  pipelineStageList: PipelineStage[];
}

// 오브젝트별 매핑 상태
interface ObjectMappingState {
  enabled: boolean;
  columnMappings: Record<string, string>; // column -> fieldKey
  connectionField: 'people' | 'organization';
  connectionColumn: string;
  // 딜/리드 전용
  pipelineId?: string;
  pipelineStageId?: string;
  defaultStatus?: string; // 딜 전용: 'In progress', 'Won', 'Lost'
  // 견적서 전용
  isMainQuote?: boolean;
  quoteConnection?: 'deal' | 'lead';
}

export function DirectImport() {
  const [currentStep, setCurrentStep] = useState(0);
  const [maxReachedStep, setMaxReachedStep] = useState(0); // 도달한 최대 스텝

  // Step 1: 파일 업로드
  const [uploadedFile, setUploadedFile] = useState<UploadResponse | null>(null);
  const [fileData, setFileData] = useState<Record<string, unknown>[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Step 2: API 연결
  const [apiKey, setApiKey] = useState('');
  const [isValidating, setIsValidating] = useState(false);
  const [apiError, setApiError] = useState<string | null>(null);

  // Step 3: 필드 매핑
  const [salesmapProducts, setSalesmapProducts] = useState<SalesmapProduct[]>([]);
  const [salesmapFields, setSalesmapFields] = useState<Record<ObjectType, SalesmapField[]>>({
    people: [],
    organization: [],
    deal: [],
    lead: [],
    product: [],
    quote: [],
  });
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [objectMappings, setObjectMappings] = useState<Record<ObjectType, ObjectMappingState>>({
    people: { enabled: true, columnMappings: {}, connectionField: 'people', connectionColumn: '' },
    organization: { enabled: false, columnMappings: {}, connectionField: 'people', connectionColumn: '' },
    deal: { enabled: false, columnMappings: {}, connectionField: 'people', connectionColumn: '', pipelineId: '', pipelineStageId: '', defaultStatus: 'In progress' },
    lead: { enabled: false, columnMappings: {}, connectionField: 'people', connectionColumn: '', pipelineId: '', pipelineStageId: '' },
    product: { enabled: false, columnMappings: {}, connectionField: 'people', connectionColumn: '' },
    quote: { enabled: false, columnMappings: {}, connectionField: 'people', connectionColumn: '', isMainQuote: true, quoteConnection: 'deal' },
  });

  // 자동매핑
  const [isAutoMapping, setIsAutoMapping] = useState(false);

  // 중복 시 자동 업데이트 (upsert) 토글
  const [upsertEnabled, setUpsertEnabled] = useState(true);

  // 파이프라인 목록 (딜/리드용)
  const [dealPipelines, setDealPipelines] = useState<Pipeline[]>([]);
  const [leadPipelines, setLeadPipelines] = useState<Pipeline[]>([]);

  // 사용자 목록 (담당자 매핑용)
  const [salesmapUsers, setSalesmapUsers] = useState<SalesmapUser[]>([]);

  // Step 4: 업로드
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<Record<ObjectType, number>>({
    people: 0,
    organization: 0,
    deal: 0,
    lead: 0,
    product: 0,
    quote: 0,
  });
  const [importResults, setImportResults] = useState<Record<ObjectType, {
    success: number;
    updated: number;
    failed: number;
    skipped: number;
    errors: { row: number; message: string }[];
  } | null>>({
    people: null,
    organization: null,
    deal: null,
    lead: null,
    product: null,
    quote: null,
  });

  // 활성화된 오브젝트 타입들
  const enabledObjects = useMemo(() => {
    return OBJECT_CONFIGS.filter(config => objectMappings[config.id].enabled);
  }, [objectMappings]);


  // 필수 필드 충족 여부 체크
  const isObjectMappingValid = useCallback((objectType: ObjectType) => {
    const mapping = objectMappings[objectType];
    if (!mapping.enabled) return true;

    const fields = salesmapFields[objectType];
    const requiredFields = fields.filter(f => f.required);
    const mappedFieldKeys = Object.values(mapping.columnMappings);

    for (const field of requiredFields) {
      if (!mappedFieldKeys.includes(field.key)) {
        return false;
      }
    }

    // deal/lead는 people 또는 organization이 반드시 활성화되어 있어야 함
    const config = OBJECT_CONFIGS.find(c => c.id === objectType);
    if (config?.needsConnection && objectType !== 'quote') {
      if (!objectMappings.people.enabled && !objectMappings.organization.enabled) {
        return false;
      }
    }

    // 견적서는 딜 또는 리드가 활성화되어야 하고, 상품도 활성화되어야 함
    if (objectType === 'quote') {
      if (!objectMappings.deal.enabled && !objectMappings.lead.enabled) {
        return false;
      }
      if (!objectMappings.product.enabled) {
        return false;
      }
    }

    // 딜은 파이프라인 필수
    if (objectType === 'deal') {
      if (!mapping.pipelineId || !mapping.pipelineStageId) {
        return false;
      }
    }

    return true;
  }, [objectMappings, salesmapFields]);

  // 전체 매핑 유효성
  const isAllMappingValid = useMemo(() => {
    return enabledObjects.every(config => isObjectMappingValid(config.id));
  }, [enabledObjects, isObjectMappingValid]);

  // 파일 업로드 핸들러
  const handleFileUpload = useCallback(async (file: File) => {
    setIsUploading(true);
    try {
      const result = await uploadFile(file);
      setUploadedFile(result);
      setFileData(result.data || []);
      goToNextStep();
    } catch (error) {
      console.error('Upload error:', error);
      alert('파일 업로드에 실패했습니다.');
    } finally {
      setIsUploading(false);
    }
  }, []);

  // API 키 검증 및 필드 조회
  const handleValidateApiKey = async () => {
    if (!apiKey.trim()) return;

    setIsValidating(true);
    setApiError(null);

    try {
      const result = await validateSalesmapApiKey(apiKey);
      if (result.valid) {
        // 필드 조회
        setIsLoadingFields(true);
        try {
          const fieldsResult = await fetchSalesmapFields(apiKey, ['people', 'organization', 'deal', 'lead', 'product', 'quote']);
          console.log('fieldsResult:', fieldsResult);

          const newFields: Record<ObjectType, SalesmapField[]> = {
            people: [],
            organization: [],
            deal: [],
            lead: [],
            product: [],
            quote: [],
          };

          // results 배열 형태 처리
          if (fieldsResult.results && Array.isArray(fieldsResult.results)) {
            for (const result of fieldsResult.results) {
              const objType = result.object_type as ObjectType;
              if (objType in newFields && result.success && result.fields) {
                const parsedFields = result.fields
                  .filter((f: any) => !f.is_system) // 시스템 필드 제외
                  .filter((f: any) => {
                    const label = f.label || f.id || '';
                    const id = f.id || '';
                    return !EXCLUDED_FIELD_KEYWORDS.some(kw => label.includes(kw) || id.includes(kw));
                  })
                  .filter((f: any) => {
                    // deal/lead: 상태만 별도 UI에서 관리 (파이프라인/단계는 행별 매핑 허용)
                    if (objType === 'deal' || objType === 'lead') {
                      const id = f.id || '';
                      const label = f.label || '';
                      return !STATUS_ONLY_FIELD_IDS.includes(id) && !STATUS_ONLY_FIELD_IDS.includes(label);
                    }
                    // 견적서: 메인 견적서 여부도 매핑 가능 (토글은 기본값)
                    return true;
                  })
                  .map((f: any) => ({
                    id: f.id,
                    key: f.id, // id를 key로 사용
                    name: f.label || f.id,
                    type: f.type || 'text',
                    required: f.required || false,
                    isCustom: f.is_custom || false,
                  }));
                // 노트(메모) 필드 추가 (상품/견적서는 메모 없음)
                if (objType !== 'product' && objType !== 'quote') {
                  parsedFields.push({
                    id: '__memo__',
                    key: '__memo__',
                    name: '노트(메모)',
                    type: 'text',
                    required: false,
                    isCustom: false,
                  });
                }
                // 견적서 전용 가상 필드 추가
                if (objType === 'quote') {
                  parsedFields.push(
                    { id: '__quoteAmount', key: '__quoteAmount', name: '수량', type: 'number', required: false, isCustom: false },
                    { id: '__paymentCount', key: '__paymentCount', name: '결제횟수', type: 'number', required: false, isCustom: false },
                    { id: '__paymentStartAt', key: '__paymentStartAt', name: '시작결제일', type: 'text', required: false, isCustom: false },
                  );
                }
                newFields[objType] = parsedFields;
              }
            }
          }
          // fields 객체 형태 처리 (기존 방식)
          else if ((fieldsResult as any).fields) {
            for (const [objType, fields] of Object.entries((fieldsResult as any).fields)) {
              if (objType in newFields) {
                const parsedFields2 = (fields as any[]).map(f => ({
                  id: f.id || f.key,
                  key: f.key || f.id,
                  name: f.name || f.label || f.key,
                  type: f.type || 'text',
                  required: f.required || false,
                  isCustom: f.isCustom || f.is_custom || false,
                }));
                // 노트(메모) 필드 추가
                parsedFields2.push({
                  id: '__memo__',
                  key: '__memo__',
                  name: '노트(메모)',
                  type: 'text',
                  required: false,
                  isCustom: false,
                });
                newFields[objType as ObjectType] = parsedFields2;
              }
            }
          }

          console.log('Parsed fields:', newFields);
          setSalesmapFields(newFields);

          // 기본 매핑: 이메일/전화 컬럼 → 고객(people) 필드
          if (uploadedFile?.columns) {
            const hasEmail = newFields.people.some((f: { id: string }) => f.id === '이메일');
            const hasPhone = newFields.people.some((f: { id: string }) => f.id === '전화');

            for (const col of uploadedFile.columns) {
              if (hasEmail && (col.includes('이메일') || col.toLowerCase().includes('email'))) {
                handleMappingChange('people', col, '이메일');
              }
              if (hasPhone && (col.includes('전화') || col.toLowerCase().includes('phone'))) {
                handleMappingChange('people', col, '전화');
              }
            }
          }

          // 파이프라인 목록 + 사용자 목록 + 상품 목록 조회
          try {
            const [dealPipelineData, leadPipelineData, usersData, productsData] = await Promise.all([
              fetchPipelines(apiKey, 'deal'),
              fetchPipelines(apiKey, 'lead'),
              fetchUsers(apiKey),
              fetchProducts(apiKey),
            ]);

            // 상품 목록
            if (productsData.success && productsData.productList?.length > 0) {
              setSalesmapProducts(productsData.productList);
              console.log('Products loaded:', productsData.productList.length);
            }

            // 사용자 목록
            if (usersData.success && usersData.userList?.length > 0) {
              setSalesmapUsers(usersData.userList);
              console.log('Users loaded:', usersData.userList.length);
            }

            // 딜 파이프라인
            if (dealPipelineData.success && dealPipelineData.pipelineList?.length > 0) {
              setDealPipelines(dealPipelineData.pipelineList);
              const firstPipeline = dealPipelineData.pipelineList[0];
              setObjectMappings(prev => ({
                ...prev,
                deal: {
                  ...prev.deal,
                  pipelineId: firstPipeline.id,
                  pipelineStageId: firstPipeline.pipelineStageList?.[0]?.id || '',
                },
              }));
            }

            // 리드 파이프라인
            if (leadPipelineData.success && leadPipelineData.pipelineList?.length > 0) {
              setLeadPipelines(leadPipelineData.pipelineList);
              const firstPipeline = leadPipelineData.pipelineList[0];
              setObjectMappings(prev => ({
                ...prev,
                lead: {
                  ...prev.lead,
                  pipelineId: firstPipeline.id,
                  pipelineStageId: firstPipeline.pipelineStageList?.[0]?.id || '',
                },
              }));
            }
          } catch (pipelineError) {
            console.error('Pipeline fetch error:', pipelineError);
          }
        } catch (fieldError) {
          console.error('Field fetch error:', fieldError);
        } finally {
          setIsLoadingFields(false);
        }

        goToNextStep();
      } else {
        setApiError(result.message || 'API 키가 유효하지 않습니다');
      }
    } catch {
      setApiError('API 키 검증 중 오류가 발생했습니다');
    } finally {
      setIsValidating(false);
    }
  };

  // 오브젝트 활성화/비활성화
  const toggleObjectEnabled = (objectType: ObjectType) => {
    setObjectMappings(prev => ({
      ...prev,
      [objectType]: {
        ...prev[objectType],
        enabled: !prev[objectType].enabled,
      },
    }));
  };

  // 매핑 변경 (통합 버전 - objectType 지정)
  const handleMappingChange = (objectType: ObjectType, column: string, fieldKey: string) => {
    setObjectMappings(prev => {
      const currentMappings = { ...prev[objectType].columnMappings };

      // 기존 매핑 제거 (같은 필드에 매핑된 다른 컬럼)
      for (const [col, field] of Object.entries(currentMappings)) {
        if (field === fieldKey && col !== column) {
          delete currentMappings[col];
        }
      }

      if (fieldKey) {
        currentMappings[column] = fieldKey;
      } else {
        delete currentMappings[column];
      }

      return {
        ...prev,
        [objectType]: {
          ...prev[objectType],
          columnMappings: currentMappings,
        },
      };
    });
  };


  // 자동매핑 핸들러
  const handleAutoMapping = async () => {
    if (!uploadedFile || fileData.length === 0) return;

    setIsAutoMapping(true);
    try {
      // available_fields 구성: name → label 변환
      const availableFields: Record<string, Array<{ id: string; label: string; required?: boolean }>> = {};
      for (const config of enabledObjects) {
        availableFields[config.id] = salesmapFields[config.id].map(f => ({
          id: f.key,
          label: f.name,
          required: f.required,
        }));
      }

      const result = await salesmapAutoMapping({
        columns: uploadedFile.columns,
        sample_data: fileData.slice(0, 5),
        available_fields: availableFields,
        enabled_objects: enabledObjects.map(c => c.id),
      });

      console.log('Auto-mapping result:', result);

      if (result.success && result.mappings) {
        for (const m of result.mappings) {
          if (m.object_type && m.field_key) {
            handleMappingChange(m.object_type as ObjectType, m.column, m.field_key);
          }
        }
      } else {
        alert(result.error || 'AI 자동 매핑에 실패했습니다.');
      }
    } catch (error) {
      console.error('Auto-mapping error:', error);
      alert('AI 자동 매핑 중 오류가 발생했습니다.');
    } finally {
      setIsAutoMapping(false);
    }
  };

  // buildBody: 행 데이터를 Salesmap API 형식으로 변환
  // Salesmap API 형식: { name: "이름", fieldList: [{ name: "필드명", stringValue: "값" }] }
  const buildBody = (row: Record<string, unknown>, objectType: ObjectType) => {
    const mapping = objectMappings[objectType];
    const fields = salesmapFields[objectType];

    const body: Record<string, unknown> = {};
    const fieldList: Array<{ name: string; stringValue?: string; stringValueList?: string[]; numberValue?: number; booleanValue?: boolean; dateValue?: string; userValueId?: string; userValueIdList?: string[]; peopleValueIdList?: string[] }> = [];

    const nameFieldKey = fields.find(f => f.key === '이름' || f.key === 'name')?.key || '이름';
    const statusFieldKey = fields.find(f => f.key === '상태' || f.key === 'status')?.key;
    const priceFieldKey = fields.find(f => f.key === '금액' || f.key === 'price' || f.key === 'amount')?.key;

    for (const [column, fieldKey] of Object.entries(mapping.columnMappings)) {
      const fieldDef = fields.find(f => f.key === fieldKey);

      if (fieldDef) {
        const value = row[column];
        if (value === null || value === undefined || value === '' || value === '-') continue;

        if (fieldKey === nameFieldKey || fieldKey === '이름' || fieldKey === 'name') {
          body.name = String(value);
          continue;
        }

        if (fieldKey === '__memo__') {
          body.memo = String(value);
          continue;
        }

        if (objectType === 'product' && (fieldKey === '금액' || fieldKey === 'price')) {
          body.price = Number(String(value).replace(/,/g, ''));
          continue;
        }

        if (objectType === 'quote') {
          if (fieldKey === '__quoteAmount') {
            body.__quoteAmount = Number(String(value).replace(/,/g, '')) || 1;
            continue;
          }
          if (fieldKey === '__paymentCount') {
            body.__paymentCount = Number(String(value).replace(/,/g, '')) || undefined;
            continue;
          }
          if (fieldKey === '__paymentStartAt') {
            body.__paymentStartAt = String(value);
            continue;
          }
        }

        if (objectType === 'deal' && (fieldKey === statusFieldKey || fieldKey === '상태' || fieldKey === 'status')) {
          const statusValue = String(value);
          if (statusValue === '진행중' || statusValue === 'In progress' || statusValue === '진행 중') {
            body.status = 'In progress';
          } else if (statusValue === '성사' || statusValue === 'Won' || statusValue === '성공') {
            body.status = 'Won';
          } else if (statusValue === '실패' || statusValue === 'Lost') {
            body.status = 'Lost';
          } else {
            body.status = 'In progress';
          }
          continue;
        }

        if (objectType === 'deal' && (fieldKey === priceFieldKey || fieldKey === '금액' || fieldKey === 'price' || fieldKey === 'amount')) {
          body.price = Number(String(value).replace(/,/g, ''));
          continue;
        }

        if (fieldKey === '파이프라인' || fieldKey === 'pipeline') {
          body.__pipelineName = String(value);
          continue;
        }
        if (fieldKey === '파이프라인 단계' || fieldKey === 'pipeline_stage') {
          body.__pipelineStageName = String(value);
          continue;
        }

        if (fieldDef.type === 'user') {
          const userName = String(value).trim();
          const matchedUser = salesmapUsers.find(u => u.name.trim() === userName);
          if (matchedUser) {
            fieldList.push({ name: fieldKey, userValueId: matchedUser.id });
          }
          continue;
        }

        if (fieldDef.type === 'multiUser') {
          const userNames = String(value).split(',').map(n => n.trim()).filter(Boolean);
          const userIds: string[] = [];
          for (const userName of userNames) {
            const matched = salesmapUsers.find(u => u.name.trim() === userName);
            if (matched) userIds.push(matched.id);
          }
          if (userIds.length > 0) {
            fieldList.push({ name: fieldKey, userValueIdList: userIds });
          }
          continue;
        }

        const isDateField = fieldDef.type === 'date' || fieldDef.type === 'datetime'
          || /날짜|date/i.test(fieldKey) || /날짜|date/i.test(fieldDef.name);
        const isDateLikeValue = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}(T\d{2}:\d{2}(:\d{2})?)?/.test(String(value).trim());

        if (fieldDef.type === 'number') {
          const numValue = Number(String(value).replace(/,/g, ''));
          fieldList.push({ name: fieldKey, numberValue: numValue });
        } else if (fieldDef.type === 'boolean') {
          const boolValue = value === true || value === 'true' || value === 'Y' || value === '예';
          fieldList.push({ name: fieldKey, booleanValue: boolValue });
        } else if (isDateField || isDateLikeValue) {
          const raw = String(value).trim();
          const normalized = raw.replace(/[./]/g, '-');
          const parsed = new Date(normalized);
          if (!isNaN(parsed.getTime())) {
            const dateValue = fieldDef.type === 'datetime'
              ? parsed.toISOString()
              : parsed.toISOString().split('T')[0];
            fieldList.push({ name: fieldKey, dateValue });
          } else {
            fieldList.push({ name: fieldKey, dateValue: raw });
          }
        } else if (fieldDef.type === 'multiSelect') {
          const values = String(value).split(',').map(v => v.trim()).filter(Boolean);
          fieldList.push({ name: fieldKey, stringValueList: values });
        } else if (fieldDef.type === 'multiPeople') {
          const ids = String(value).split(',').map(v => v.trim()).filter(Boolean);
          fieldList.push({ name: fieldKey, peopleValueIdList: ids });
        } else {
          fieldList.push({ name: fieldKey, stringValue: String(value) });
        }
      }
    }

    if (fieldList.length > 0) {
      body.fieldList = fieldList;
    }

    return body;
  };

  // Salesmap API로 업로드 (Backend SSE Streaming)
  const handleImport = async () => {
    if (!uploadedFile || fileData.length === 0) return;

    setIsImporting(true);

    const creationOrder: ObjectType[] = ['organization', 'people', 'deal', 'lead', 'product', 'quote'];
    const activeInOrder = creationOrder.filter(t => objectMappings[t].enabled);

    // Pre-build: 모든 행의 body를 프론트에서 미리 빌드
    const preBuiltRows = fileData.map((row) => {
      const rowBodies: Record<string, any> = {};

      for (const objType of activeInOrder) {
        const body = buildBody(row, objType);

        // deal/lead: 파이프라인 이름→ID 변환 + 기본 status 적용
        if (objType === 'deal') {
          const mapping = objectMappings.deal;
          if (!body.status) {
            body.status = mapping.defaultStatus || 'In progress';
          }
          if (body.__pipelineName) {
            const matched = dealPipelines.find(p => p.name.trim() === String(body.__pipelineName).trim());
            if (matched) {
              body.pipelineId = matched.id;
              if (body.__pipelineStageName) {
                const stage = matched.pipelineStageList.find(s => s.name.trim() === String(body.__pipelineStageName).trim());
                if (stage) body.pipelineStageId = stage.id;
              }
            }
            delete body.__pipelineName;
            delete body.__pipelineStageName;
          }
          if (!body.pipelineId && mapping.pipelineId) {
            body.pipelineId = mapping.pipelineId;
          }
          if (!body.pipelineStageId && mapping.pipelineStageId) {
            body.pipelineStageId = mapping.pipelineStageId;
          }
        }

        if (objType === 'lead') {
          const mapping = objectMappings.lead;
          if (body.__pipelineName) {
            const matched = leadPipelines.find(p => p.name.trim() === String(body.__pipelineName).trim());
            if (matched) {
              body.pipelineId = matched.id;
              if (body.__pipelineStageName) {
                const stage = matched.pipelineStageList.find(s => s.name.trim() === String(body.__pipelineStageName).trim());
                if (stage) body.pipelineStageId = stage.id;
              }
            }
            delete body.__pipelineName;
            delete body.__pipelineStageName;
          }
          if (!body.pipelineId && mapping.pipelineId) {
            body.pipelineId = mapping.pipelineId;
          }
          if (!body.pipelineStageId && mapping.pipelineStageId) {
            body.pipelineStageId = mapping.pipelineStageId;
          }
        }

        // quote: isMainQuote 기본값 적용
        if (objType === 'quote') {
          if (body['메인 견적서 여부'] !== undefined) {
            body.isMainQuote = Boolean(body['메인 견적서 여부']);
            delete body['메인 견적서 여부'];
          } else {
            body.isMainQuote = objectMappings.quote.isMainQuote !== false;
          }
        }

        rowBodies[objType] = body;
      }

      return rowBodies;
    });

    const abortController = new AbortController();

    try {
      await startBulkImport(
        {
          api_key: apiKey,
          upsert_enabled: upsertEnabled,
          active_objects: activeInOrder,
          product_cache: salesmapProducts.map(p => ({ id: p.id, name: p.name, price: p.price })),
          quote_connection: objectMappings.quote.quoteConnection || 'deal',
          rows: preBuiltRows,
          filename: uploadedFile.filename,
          total_rows: fileData.length,
        },
        {
          onProgress: (data) => {
            setImportProgress(prev => {
              const updated = { ...prev };
              for (const objType of activeInOrder) {
                updated[objType] = data.percent;
              }
              return updated;
            });
          },
          onComplete: (data) => {
            setImportResults(prev => ({
              ...prev,
              ...Object.fromEntries(
                activeInOrder.map(objType => [
                  objType,
                  data.results[objType] || { success: 0, updated: 0, failed: 0, skipped: 0, errors: [] },
                ])
              ),
            }));
            setIsImporting(false);
          },
          onError: (data) => {
            console.error('Import error:', data.message);
          },
        },
        abortController.signal,
      );
    } catch (error) {
      console.error('Bulk import error:', error);
      setIsImporting(false);
    }
  };

  // 스텝 이동 함수
  const goToStep = (step: number) => {
    if (step <= maxReachedStep) {
      setCurrentStep(step);
    }
  };

  // 다음 스텝으로 이동
  const goToNextStep = () => {
    const nextStep = currentStep + 1;
    setCurrentStep(nextStep);
    setMaxReachedStep(prev => Math.max(prev, nextStep));
  };

  return (
    <div className="flex h-screen w-screen bg-[#F2F3F0]">
      {/* Sidebar */}
      <aside className="flex h-full w-[280px] flex-col border-r border-[#CBCCC9] bg-[#E7E8E5]">
        {/* Logo */}
        <div className="flex h-[88px] items-center justify-center border-b border-[#CBCCC9] px-8">
          <div className="flex items-center gap-2">
            <img src="/salesmap-logo.png" alt="Salesmap" className="h-8 w-8 rounded" />
            <span className="font-primary text-lg font-bold text-[#111111]">
              Salesmap
            </span>
          </div>
        </div>

        {/* Steps */}
        <nav className="flex flex-1 flex-col gap-1 p-4">
          <div className="p-4">
            <span className="font-primary text-xs text-[#666666]">STEPS</span>
          </div>
          {STEPS.map((step, idx) => (
            <button
              key={step.id}
              onClick={() => goToStep(idx)}
              disabled={idx > maxReachedStep}
              className={`flex items-center gap-3 rounded-lg px-4 py-3 text-left transition-colors ${
                idx === currentStep
                  ? 'bg-[#FF8400] text-[#111111]'
                  : idx <= maxReachedStep
                  ? 'text-[#111111] hover:bg-[#CBCCC9]/50 cursor-pointer'
                  : 'text-[#666666] cursor-not-allowed'
              }`}
            >
              <span className="material-symbols-rounded" style={{ fontSize: 20 }}>
                {idx < maxReachedStep && idx !== currentStep ? 'check_circle' : step.icon}
              </span>
              <span className="font-primary text-sm font-medium">{step.title}</span>
            </button>
          ))}
        </nav>

        {/* File Info */}
        {uploadedFile && (
          <div className="border-t border-[#CBCCC9] p-6">
            <div className="flex items-center gap-3">
              <span className="material-symbols-rounded text-[#FF8400]" style={{ fontSize: 24 }}>
                description
              </span>
              <div className="flex-1 min-w-0">
                <p className="font-primary text-sm font-medium text-[#111111] truncate">
                  {uploadedFile.filename}
                </p>
                <p className="font-secondary text-xs text-[#666666]">
                  {uploadedFile.total_rows}행 / {uploadedFile.columns.length}열
                </p>
              </div>
            </div>
          </div>
        )}
      </aside>

      {/* Main Content */}
      <main className="flex flex-1 flex-col gap-6 overflow-hidden p-8">
        {/* Header */}
        <header className="flex items-center justify-between">
          <div className="flex flex-col gap-1">
            <h1 className="font-primary text-2xl font-semibold text-[#111111]">
              {STEPS[currentStep].title}
            </h1>
            <p className="font-secondary text-sm text-[#666666]">
              {currentStep === 0 && '업로드할 파일을 선택하세요'}
              {currentStep === 1 && '세일즈맵 API 키를 입력하세요'}
              {currentStep === 2 && '파일 컬럼을 세일즈맵 필드에 매핑하세요'}
              {currentStep === 3 && '세일즈맵으로 데이터를 가져옵니다'}
            </p>
          </div>

          {currentStep === 2 && (
            <div className="flex items-center gap-3">
              {/* 중복 시 자동 업데이트 토글 */}
              <button
                onClick={() => setUpsertEnabled(prev => !prev)}
                className="flex items-center gap-2 rounded-full border border-[#CBCCC9] bg-white px-4 py-2 transition-colors hover:bg-[#F2F3F0]"
              >
                <span className="font-secondary text-sm text-[#666666]">중복 시 자동 업데이트</span>
                <div className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${upsertEnabled ? 'bg-[#FF8400]' : 'bg-[#CBCCC9]'}`}>
                  <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${upsertEnabled ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                </div>
              </button>
              <button
                onClick={() => goToStep(1)}
                className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-[#CBCCC9] bg-[#F2F3F0] px-4 font-primary text-sm font-medium text-[#111111] hover:bg-[#E7E8E5] transition-colors"
              >
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>arrow_back</span>
                이전
              </button>
              <button
                onClick={goToNextStep}
                disabled={!isAllMappingValid || enabledObjects.length === 0}
                className="flex h-10 items-center justify-center gap-1.5 rounded-full bg-[#FF8400] px-4 font-primary text-sm font-medium text-[#111111] hover:bg-[#E67700] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                다음
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>arrow_forward</span>
              </button>
            </div>
          )}
        </header>

        {/* Step 1: 파일 업로드 */}
        {currentStep === 0 && (
          <div className="flex flex-1 flex-col items-center justify-center rounded border border-[#CBCCC9] bg-white p-12">
            <div
              onDrop={(e) => {
                e.preventDefault();
                const file = e.dataTransfer.files[0];
                if (file) handleFileUpload(file);
              }}
              onDragOver={(e) => e.preventDefault()}
              className="flex w-full max-w-md flex-col items-center gap-6 rounded-xl border-2 border-dashed border-[#CBCCC9] p-12 hover:border-[#FF8400] transition-colors"
            >
              {isUploading ? (
                <>
                  <div className="animate-spin">
                    <span className="material-symbols-rounded text-[#FF8400]" style={{ fontSize: 48 }}>
                      progress_activity
                    </span>
                  </div>
                  <p className="font-secondary text-base text-[#666666]">업로드 중...</p>
                </>
              ) : (
                <>
                  <span className="material-symbols-rounded text-[#FF8400]" style={{ fontSize: 48 }}>
                    cloud_upload
                  </span>
                  <div className="text-center">
                    <p className="font-primary text-base font-medium text-[#111111]">
                      파일을 드래그하거나 클릭하여 선택
                    </p>
                    <p className="font-secondary text-sm text-[#666666] mt-1">
                      CSV, XLSX, XLS 지원
                    </p>
                  </div>
                  <label className="flex h-10 items-center justify-center rounded-full bg-[#FF8400] px-6 font-primary text-sm font-medium text-[#111111] cursor-pointer hover:bg-[#E67700] transition-colors">
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
          </div>
        )}

        {/* Step 2: API 연결 */}
        {currentStep === 1 && (
          <div className="flex flex-1 flex-col items-center justify-center rounded border border-[#CBCCC9] bg-white p-12">
            <div className="flex w-full max-w-md flex-col gap-6">
              <div className="flex flex-col items-center gap-4">
                <span className="material-symbols-rounded text-[#FF8400]" style={{ fontSize: 48 }}>
                  key
                </span>
                <p className="font-primary text-base font-medium text-[#111111]">
                  세일즈맵 API 키를 입력하세요
                </p>
              </div>

              <div className="flex flex-col gap-2">
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk_..."
                  className="h-12 w-full rounded-full border border-[#CBCCC9] bg-[#F2F3F0] px-6 font-secondary text-sm text-[#111111] placeholder-[#666666] focus:border-[#FF8400] focus:outline-none"
                  onKeyDown={(e) => e.key === 'Enter' && handleValidateApiKey()}
                />
                {apiError && (
                  <p className="font-secondary text-sm text-[#ef4444] text-center">{apiError}</p>
                )}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => goToStep(0)}
                  className="flex h-10 flex-1 items-center justify-center rounded-full border border-[#CBCCC9] bg-[#F2F3F0] font-primary text-sm font-medium text-[#111111] hover:bg-[#E7E8E5] transition-colors"
                >
                  이전
                </button>
                <button
                  onClick={handleValidateApiKey}
                  disabled={!apiKey.trim() || isValidating || isLoadingFields}
                  className="flex h-10 flex-1 items-center justify-center rounded-full bg-[#FF8400] font-primary text-sm font-medium text-[#111111] hover:bg-[#E67700] transition-colors disabled:opacity-50"
                >
                  {isValidating ? '검증 중...' : isLoadingFields ? '필드 조회 중...' : '연결'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3: 필드 매핑 (통합 화면) */}
        {currentStep === 2 && (
          <div className="flex flex-1 flex-col gap-4 overflow-hidden">
            {/* Object type checkboxes */}
            <div className="flex flex-col gap-2 rounded-lg border border-[#CBCCC9] bg-white px-4 py-3">
              <div className="flex items-center gap-3">
                <span className="font-secondary text-sm text-[#666666]">업로드 대상:</span>
                {OBJECT_CONFIGS.map(config => (
                  <label
                    key={config.id}
                    className={`flex items-center gap-2 rounded-full px-4 py-2 cursor-pointer transition-colors ${
                      objectMappings[config.id].enabled
                        ? 'bg-[#FF8400] text-[#111111]'
                        : 'bg-[#F2F3F0] text-[#666666] hover:bg-[#E7E8E5]'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={objectMappings[config.id].enabled}
                      onChange={() => toggleObjectEnabled(config.id)}
                      className="sr-only"
                    />
                    <span className="material-symbols-rounded" style={{ fontSize: 18 }}>
                      {objectMappings[config.id].enabled ? 'check_box' : 'check_box_outline_blank'}
                    </span>
                    <span className="font-primary text-sm font-medium">{config.name}</span>
                    {!isObjectMappingValid(config.id) && objectMappings[config.id].enabled && (
                      <span className="material-symbols-rounded text-[#f59e0b]" style={{ fontSize: 16 }}>
                        warning
                      </span>
                    )}
                  </label>
                ))}
              </div>
              {/* 연결 경고 (에러일 때만 인라인 표시) */}
              {(objectMappings.deal.enabled || objectMappings.lead.enabled) &&
                !objectMappings.people.enabled && !objectMappings.organization.enabled && (
                <span className="font-secondary text-xs text-[#ef4444]">
                  딜/리드는 고객 또는 회사가 필요합니다.
                </span>
              )}
              {objectMappings.quote.enabled &&
                (!objectMappings.deal.enabled && !objectMappings.lead.enabled || !objectMappings.product.enabled) && (
                <span className="font-secondary text-xs text-[#ef4444]">
                  견적서는 딜/리드와 상품이 모두 필요합니다.
                </span>
              )}
            </div>

            {enabledObjects.length === 0 ? (
              <div className="flex flex-1 items-center justify-center rounded border border-[#CBCCC9] bg-white">
                <div className="text-center">
                  <span className="material-symbols-rounded text-[#666666]" style={{ fontSize: 48 }}>
                    info
                  </span>
                  <p className="font-secondary text-base text-[#666666] mt-2">
                    업로드할 오브젝트를 선택하세요
                  </p>
                </div>
              </div>
            ) : (
              <>
                {/* 딜/리드/견적서 설정 (파이프라인, 상태, 견적 옵션) */}
                {(objectMappings.deal.enabled || objectMappings.lead.enabled || objectMappings.quote.enabled) && (
                  <div className="flex flex-wrap gap-6 rounded-lg border border-[#CBCCC9] bg-white px-4 py-3">
                    {/* 딜 설정 */}
                    {objectMappings.deal.enabled && (
                      <div className="flex flex-col gap-2">
                        <span className="font-primary text-sm font-semibold text-[#FF8400]">딜 기본 설정 (매핑 없는 행에 적용)</span>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-2">
                            <span className="font-secondary text-xs text-[#666666]">상태:</span>
                            <select
                              value={objectMappings.deal.defaultStatus || 'In progress'}
                              onChange={(e) => setObjectMappings(prev => ({
                                ...prev,
                                deal: { ...prev.deal, defaultStatus: e.target.value },
                              }))}
                              className="rounded border border-[#CBCCC9] bg-white px-2 py-1 font-secondary text-xs text-[#111111] focus:outline-none"
                            >
                              <option value="In progress">진행중</option>
                              <option value="Won">성사</option>
                              <option value="Lost">실패</option>
                            </select>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-secondary text-xs text-[#666666]">파이프라인:</span>
                            <select
                              value={objectMappings.deal.pipelineId || ''}
                              onChange={(e) => {
                                const pipeline = dealPipelines.find(p => p.id === e.target.value);
                                setObjectMappings(prev => ({
                                  ...prev,
                                  deal: {
                                    ...prev.deal,
                                    pipelineId: e.target.value,
                                    pipelineStageId: pipeline?.pipelineStageList?.[0]?.id || '',
                                  },
                                }));
                              }}
                              className="rounded border border-[#CBCCC9] bg-white px-2 py-1 font-secondary text-xs text-[#111111] focus:outline-none"
                            >
                              {dealPipelines.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                          {objectMappings.deal.pipelineId && (
                            <div className="flex items-center gap-2">
                              <span className="font-secondary text-xs text-[#666666]">단계:</span>
                              <select
                                value={objectMappings.deal.pipelineStageId || ''}
                                onChange={(e) => setObjectMappings(prev => ({
                                  ...prev,
                                  deal: { ...prev.deal, pipelineStageId: e.target.value },
                                }))}
                                className="rounded border border-[#CBCCC9] bg-white px-2 py-1 font-secondary text-xs text-[#111111] focus:outline-none"
                              >
                                {dealPipelines.find(p => p.id === objectMappings.deal.pipelineId)?.pipelineStageList?.map(s => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 리드 설정 */}
                    {objectMappings.lead.enabled && (
                      <div className="flex flex-col gap-2">
                        <span className="font-primary text-sm font-semibold text-[#FF8400]">리드 설정</span>
                        <div className="flex flex-wrap items-center gap-3">
                          <div className="flex items-center gap-2">
                            <span className="font-secondary text-xs text-[#666666]">파이프라인:</span>
                            <select
                              value={objectMappings.lead.pipelineId || ''}
                              onChange={(e) => {
                                const pipeline = leadPipelines.find(p => p.id === e.target.value);
                                setObjectMappings(prev => ({
                                  ...prev,
                                  lead: {
                                    ...prev.lead,
                                    pipelineId: e.target.value,
                                    pipelineStageId: e.target.value ? (pipeline?.pipelineStageList?.[0]?.id || '') : '',
                                  },
                                }));
                              }}
                              className="rounded border border-[#CBCCC9] bg-white px-2 py-1 font-secondary text-xs text-[#111111] focus:outline-none"
                            >
                              <option value="">선택 안함</option>
                              {leadPipelines.map(p => (
                                <option key={p.id} value={p.id}>{p.name}</option>
                              ))}
                            </select>
                          </div>
                          {objectMappings.lead.pipelineId && (
                            <div className="flex items-center gap-2">
                              <span className="font-secondary text-xs text-[#666666]">단계:</span>
                              <select
                                value={objectMappings.lead.pipelineStageId || ''}
                                onChange={(e) => setObjectMappings(prev => ({
                                  ...prev,
                                  lead: { ...prev.lead, pipelineStageId: e.target.value },
                                }))}
                                className="rounded border border-[#CBCCC9] bg-white px-2 py-1 font-secondary text-xs text-[#111111] focus:outline-none"
                              >
                                <option value="">선택 안함</option>
                                {leadPipelines.find(p => p.id === objectMappings.lead.pipelineId)?.pipelineStageList?.map(s => (
                                  <option key={s.id} value={s.id}>{s.name}</option>
                                ))}
                              </select>
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 견적서 설정 */}
                    {objectMappings.quote.enabled && (
                      <div className="flex flex-col gap-2">
                        <span className="font-primary text-sm font-semibold text-[#FF8400]">견적서 설정</span>
                        <div className="flex flex-wrap items-center gap-3">
                          {/* 연결 대상 */}
                          <div className="flex items-center gap-2">
                            <span className="font-secondary text-xs text-[#666666]">연결:</span>
                            <select
                              value={objectMappings.quote.quoteConnection || 'deal'}
                              onChange={(e) => setObjectMappings(prev => ({
                                ...prev,
                                quote: { ...prev.quote, quoteConnection: e.target.value as 'deal' | 'lead' },
                              }))}
                              className="rounded border border-[#CBCCC9] bg-white px-2 py-1 font-secondary text-xs text-[#111111] focus:outline-none"
                            >
                              {objectMappings.deal.enabled && <option value="deal">딜</option>}
                              {objectMappings.lead.enabled && <option value="lead">리드</option>}
                            </select>
                          </div>
                          {/* 메인 견적 (기본값) */}
                          <div className="flex items-center gap-2">
                            <span className="font-secondary text-xs text-[#666666]">메인 견적 <span className="text-[#999999]">(기본값)</span>:</span>
                            <button
                              onClick={() => setObjectMappings(prev => ({
                                ...prev,
                                quote: { ...prev.quote, isMainQuote: !prev.quote.isMainQuote },
                              }))}
                              className="flex items-center gap-1"
                            >
                              <div className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${objectMappings.quote.isMainQuote !== false ? 'bg-[#FF8400]' : 'bg-[#CBCCC9]'}`}>
                                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white transition-transform ${objectMappings.quote.isMainQuote !== false ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                              </div>
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* 필드 매핑 테이블 */}
                <div className="flex flex-1 flex-col overflow-hidden rounded border border-[#CBCCC9] bg-white">
                  {/* 테이블 헤더 */}
                  <div className="grid grid-cols-[minmax(200px,1.2fr)_80px_minmax(280px,1.5fr)] items-center border-b border-[#CBCCC9] bg-[#F2F3F0] px-4 py-3">
                    <span className="font-primary text-sm font-semibold text-[#111111]">파일 컬럼</span>
                    <span className="font-primary text-sm font-semibold text-[#666666]">샘플</span>
                    <div className="flex items-center justify-between">
                      <span className="font-primary text-sm font-semibold text-[#FF8400]">세일즈맵 필드</span>
                      <button
                        onClick={handleAutoMapping}
                        disabled={isAutoMapping || enabledObjects.length === 0}
                        className="flex items-center gap-1.5 rounded-full bg-[#FF8400] px-3 py-1.5 font-primary text-xs font-medium text-[#111111] hover:bg-[#E67700] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        {isAutoMapping ? (
                          <>
                            <span className="material-symbols-rounded animate-spin" style={{ fontSize: 14 }}>progress_activity</span>
                            매핑 중...
                          </>
                        ) : (
                          <>
                            <span className="material-symbols-rounded" style={{ fontSize: 14 }}>auto_awesome</span>
                            자동매핑
                          </>
                        )}
                      </button>
                    </div>
                  </div>

                  {/* 테이블 바디 */}
                  <div className="flex-1 overflow-auto">
                    {uploadedFile?.columns.map((col, rowIdx) => {
                      const sampleValue = fileData[0]?.[col] ? String(fileData[0][col]).substring(0, 20) : '-';

                      // 현재 매핑 상태 확인 (모든 오브젝트에서 — 복수 매핑 지원)
                      const allMappings: { objectType: ObjectType; objectName: string; fieldKey: string; fieldName: string }[] = [];
                      for (const config of enabledObjects) {
                        const fieldKey = objectMappings[config.id].columnMappings[col];
                        if (fieldKey) {
                          const fieldDef = salesmapFields[config.id].find(f => f.key === fieldKey);
                          allMappings.push({
                            objectType: config.id,
                            objectName: config.name,
                            fieldKey,
                            fieldName: fieldDef?.name || fieldKey,
                          });
                        }
                      }

                      const isMapped = allMappings.length > 0;
                      const selectedValues = allMappings.map(m => `${m.objectType}.${m.fieldKey}`);

                      // SearchableSelect용 그룹화된 옵션 생성
                      const groupedOptions: GroupedOption[] = enabledObjects.map(config => ({
                        objectType: config.id,
                        objectName: config.name,
                        fields: salesmapFields[config.id].map(f => ({
                          key: f.key,
                          name: f.name,
                          required: f.required,
                          isCustom: f.isCustom,
                        })),
                      }));

                      return (
                        <div
                          key={col}
                          className={`grid grid-cols-[minmax(200px,1.2fr)_80px_minmax(280px,1.5fr)] items-center px-4 py-2.5 ${
                            rowIdx !== (uploadedFile?.columns.length || 0) - 1 ? 'border-b border-[#CBCCC9]' : ''
                          } ${isMapped ? 'bg-[#FFF7ED]' : 'hover:bg-[#F2F3F0]'}`}
                        >
                          {/* 컬럼명 */}
                          <div className="flex items-center gap-2 min-w-0 group">
                            <span
                              className={`material-symbols-rounded flex-shrink-0 ${
                                isMapped ? 'text-[#22c55e]' : 'text-[#CBCCC9]'
                              }`}
                              style={{ fontSize: 18 }}
                            >
                              {isMapped ? 'check_circle' : 'radio_button_unchecked'}
                            </span>
                            <span
                              className={`font-primary text-sm truncate ${isMapped ? 'font-medium text-[#111111]' : 'text-[#666666]'}`}
                              title={col}
                            >
                              {col}
                            </span>
                          </div>

                          {/* 샘플 데이터 */}
                          <span className="font-secondary text-xs text-[#666666] truncate" title={String(fileData[0]?.[col] || '')}>
                            {sampleValue}
                          </span>

                          {/* 매핑 필드: 칩 + 추가 드롭다운 */}
                          <div className="flex flex-wrap items-center gap-1.5">
                            {/* 매핑된 필드 칩 */}
                            {allMappings.map(m => (
                              <span
                                key={`${m.objectType}.${m.fieldKey}`}
                                className="inline-flex items-center gap-1 rounded-full border border-[#FF8400] bg-[#FFF7ED] px-2.5 py-1 font-secondary text-xs font-medium text-[#111111]"
                              >
                                <span className="text-[#FF8400]">[{m.objectName}]</span>
                                {m.fieldName}
                                <button
                                  onClick={() => handleMappingChange(m.objectType, col, '')}
                                  className="ml-0.5 text-[#666666] hover:text-[#ef4444] transition-colors"
                                >
                                  <span className="material-symbols-rounded" style={{ fontSize: 14 }}>close</span>
                                </button>
                              </span>
                            ))}

                            {/* 추가 드롭다운 */}
                            <SearchableSelect
                              value=""
                              options={groupedOptions}
                              selectedValues={selectedValues}
                              onChange={(newValue) => {
                                if (!newValue) return;
                                const [objType, fieldKey] = newValue.split('.');
                                const alreadyMapped = selectedValues.includes(newValue);
                                if (alreadyMapped) {
                                  // 토글: 이미 매핑된 값 클릭 → 제거
                                  handleMappingChange(objType as ObjectType, col, '');
                                } else {
                                  // 새 매핑 추가
                                  handleMappingChange(objType as ObjectType, col, fieldKey);
                                }
                              }}
                              placeholder={isMapped ? '+ 추가' : '필드 선택'}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 매핑 상태 요약 */}
                <div className="flex flex-col gap-2 rounded-lg border border-[#CBCCC9] bg-white px-4 py-3">
                  <div className="flex items-center gap-4">
                    {enabledObjects.map(config => {
                      const mapping = objectMappings[config.id];
                      const fields = salesmapFields[config.id];
                      const mappedCount = Object.keys(mapping.columnMappings).length;
                      const requiredFields = fields.filter(f => f.required);
                      const mappedRequired = requiredFields.filter(f =>
                        Object.values(mapping.columnMappings).includes(f.key)
                      );
                      const unmappedRequired = requiredFields.filter(f =>
                        !Object.values(mapping.columnMappings).includes(f.key)
                      );
                      const isValid = isObjectMappingValid(config.id);

                      return (
                        <div key={config.id} className="flex items-center gap-2">
                          <span
                            className={`material-symbols-rounded ${isValid ? 'text-[#22c55e]' : 'text-[#f59e0b]'}`}
                            style={{ fontSize: 16 }}
                          >
                            {isValid ? 'check_circle' : 'warning'}
                          </span>
                          <span className="font-primary text-sm font-medium text-[#111111]">{config.name}</span>
                          <span className="font-secondary text-xs text-[#666666]">
                            ({mappedRequired.length}/{requiredFields.length}필수, {mappedCount}개 매핑)
                          </span>
                          {unmappedRequired.length > 0 && (
                            <span className="font-secondary text-xs text-[#ef4444]">
                              미매칭: {unmappedRequired.map(f => f.name).join(', ')}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 구독 상품 안내 (결제횟수/시작결제일 매핑 시) */}
                {objectMappings.quote.enabled && (() => {
                  const quoteMappedKeys = Object.values(objectMappings.quote.columnMappings);
                  const hasPaymentCount = quoteMappedKeys.includes('__paymentCount');
                  const hasPaymentStartAt = quoteMappedKeys.includes('__paymentStartAt');
                  if (!hasPaymentCount && !hasPaymentStartAt) return null;
                  return (
                    <div className="flex items-center gap-3 rounded-lg border border-[#3b82f6] bg-[#eff6ff] px-4 py-3">
                      <span className="material-symbols-rounded text-[#3b82f6]" style={{ fontSize: 18 }}>info</span>
                      <span className="font-secondary text-sm text-[#1e40af]">
                        결제횟수 / 시작결제일은 <strong>구독 상품</strong>인 경우에만 필수입니다. 일반 상품이면 매핑하지 않아도 됩니다.
                      </span>
                    </div>
                  );
                })()}
              </>
            )}
          </div>
        )}

        {/* Step 4: 업로드 */}
        {currentStep === 3 && (
          <div className="flex flex-1 flex-col gap-6 overflow-auto">
            {/* Summary Cards */}
            {enabledObjects.map(config => {
              const mapping = objectMappings[config.id];
              const result = importResults[config.id];
              const progress = importProgress[config.id];

              return (
                <div key={config.id} className="flex flex-col gap-4 rounded border border-[#CBCCC9] bg-white p-6">
                  <div className="flex items-center justify-between">
                    <h2 className="font-primary text-base font-semibold text-[#111111]">
                      {config.name}
                    </h2>
                    <span className="font-secondary text-sm text-[#666666]">
                      {Object.keys(mapping.columnMappings).length}개 필드 매핑
                    </span>
                  </div>

                  {/* Progress */}
                  {isImporting && progress > 0 && progress < 100 && (
                    <div className="flex flex-col gap-2">
                      <div className="flex items-center justify-between">
                        <span className="font-secondary text-sm text-[#666666]">진행률</span>
                        <span className="font-primary text-sm font-medium text-[#FF8400]">{progress}%</span>
                      </div>
                      <div className="h-2 w-full overflow-hidden rounded-full bg-[#E7E8E5]">
                        <div
                          className="h-full bg-[#FF8400] transition-all duration-300"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Results */}
                  {result && (
                    <div className={`flex items-center gap-6 rounded-lg p-3 ${
                      result.failed === 0 ? 'bg-[#f0fdf4]' : 'bg-[#fef3c7]'
                    }`}>
                      <div className="flex items-center gap-2">
                        <span className="material-symbols-rounded text-[#22c55e]" style={{ fontSize: 20 }}>
                          check_circle
                        </span>
                        <span className="font-primary text-lg font-bold text-[#22c55e]">{result.success}</span>
                        <span className="font-secondary text-sm text-[#666666]">성공</span>
                      </div>
                      {result.updated > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-rounded text-[#3b82f6]" style={{ fontSize: 20 }}>
                            sync
                          </span>
                          <span className="font-primary text-lg font-bold text-[#3b82f6]">{result.updated}</span>
                          <span className="font-secondary text-sm text-[#666666]">업데이트</span>
                        </div>
                      )}
                      {result.skipped > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-rounded text-[#8b5cf6]" style={{ fontSize: 20 }}>
                            skip_next
                          </span>
                          <span className="font-primary text-lg font-bold text-[#8b5cf6]">{result.skipped}</span>
                          <span className="font-secondary text-sm text-[#666666]">기존 사용</span>
                        </div>
                      )}
                      {result.failed > 0 && (
                        <div className="flex items-center gap-2">
                          <span className="material-symbols-rounded text-[#ef4444]" style={{ fontSize: 20 }}>
                            cancel
                          </span>
                          <span className="font-primary text-lg font-bold text-[#ef4444]">{result.failed}</span>
                          <span className="font-secondary text-sm text-[#666666]">실패</span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Errors */}
                  {result && result.errors.length > 0 && (
                    <div className="max-h-24 overflow-y-auto rounded border border-[#CBCCC9] bg-[#F2F3F0] p-3">
                      {result.errors.slice(0, 5).map((err, idx) => (
                        <div key={idx} className="font-secondary text-xs text-[#ef4444]">
                          행 {err.row}: {err.message}
                        </div>
                      ))}
                      {result.errors.length > 5 && (
                        <div className="font-secondary text-xs text-[#666666]">
                          ... 외 {result.errors.length - 5}개 오류
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Actions */}
            <div className="flex gap-3">
              <button
                onClick={() => goToStep(2)}
                disabled={isImporting}
                className="flex h-10 items-center justify-center gap-1.5 rounded-full border border-[#CBCCC9] bg-[#F2F3F0] px-6 font-primary text-sm font-medium text-[#111111] hover:bg-[#E7E8E5] transition-colors disabled:opacity-50"
              >
                <span className="material-symbols-rounded" style={{ fontSize: 18 }}>arrow_back</span>
                이전
              </button>
              <button
                onClick={handleImport}
                disabled={isImporting}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-full bg-[#FF8400] font-primary text-sm font-medium text-[#111111] hover:bg-[#E67700] transition-colors disabled:opacity-50"
              >
                {isImporting ? (
                  <>
                    <span className="material-symbols-rounded animate-spin" style={{ fontSize: 18 }}>
                      progress_activity
                    </span>
                    업로드 중...
                  </>
                ) : (
                  <>
                    <span className="material-symbols-rounded" style={{ fontSize: 18 }}>cloud_upload</span>
                    세일즈맵에 업로드 ({enabledObjects.length}개 오브젝트)
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
