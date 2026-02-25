import { useState, useCallback, useMemo } from 'react';
import { uploadFile, validateSalesmapApiKey, fetchSalesmapFields, fetchPipelines, fetchUsers, salesmapAutoMapping, startImportSession, endImportSession } from '../services/api';
import type { SalesmapUser } from '../services/api';
import type { UploadResponse } from '../types';
import { SearchableSelect, type GroupedOption } from '../components/SearchableSelect';

const STEPS = [
  { id: 'upload', title: '파일 업로드', icon: 'upload_file' },
  { id: 'api', title: 'API 연결', icon: 'key' },
  { id: 'mapping', title: '필드 매핑', icon: 'sync_alt' },
  { id: 'import', title: '가져오기', icon: 'cloud_upload' },
];

type ObjectType = 'people' | 'organization' | 'deal' | 'lead';

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
  const [salesmapFields, setSalesmapFields] = useState<Record<ObjectType, SalesmapField[]>>({
    people: [],
    organization: [],
    deal: [],
    lead: [],
  });
  const [isLoadingFields, setIsLoadingFields] = useState(false);
  const [objectMappings, setObjectMappings] = useState<Record<ObjectType, ObjectMappingState>>({
    people: { enabled: true, columnMappings: {}, connectionField: 'people', connectionColumn: '' },
    organization: { enabled: false, columnMappings: {}, connectionField: 'people', connectionColumn: '' },
    deal: { enabled: false, columnMappings: {}, connectionField: 'people', connectionColumn: '', pipelineId: '', pipelineStageId: '', defaultStatus: 'In progress' },
    lead: { enabled: false, columnMappings: {}, connectionField: 'people', connectionColumn: '', pipelineId: '', pipelineStageId: '' },
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
  });
  const [importResults, setImportResults] = useState<Record<ObjectType, {
    success: number;
    updated: number;
    failed: number;
    errors: { row: number; message: string }[];
  } | null>>({
    people: null,
    organization: null,
    deal: null,
    lead: null,
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
    if (config?.needsConnection) {
      if (!objectMappings.people.enabled && !objectMappings.organization.enabled) {
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
          const fieldsResult = await fetchSalesmapFields(apiKey, ['people', 'organization', 'deal', 'lead']);
          console.log('fieldsResult:', fieldsResult);

          const newFields: Record<ObjectType, SalesmapField[]> = {
            people: [],
            organization: [],
            deal: [],
            lead: [],
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
                // 노트(메모) 필드 추가 - body.memo로 전달됨
                parsedFields.push({
                  id: '__memo__',
                  key: '__memo__',
                  name: '노트(메모)',
                  type: 'text',
                  required: false,
                  isCustom: false,
                });
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

          // 파이프라인 목록 + 사용자 목록 조회
          try {
            const [dealPipelineData, leadPipelineData, usersData] = await Promise.all([
              fetchPipelines(apiKey, 'deal'),
              fetchPipelines(apiKey, 'lead'),
              fetchUsers(apiKey),
            ]);

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

  // Salesmap API로 업로드 (Cascading: organization → people → deal/lead)
  const handleImport = async () => {
    if (!uploadedFile || fileData.length === 0) return;

    setIsImporting(true);

    const API_BASE = import.meta.env.VITE_API_URL || '/api';

    // 생성 순서 정의: organization → people → deal → lead
    const creationOrder: ObjectType[] = ['organization', 'people', 'deal', 'lead'];
    const activeInOrder = creationOrder.filter(t => objectMappings[t].enabled);

    // 세션 시작 (로깅용, 실패해도 import 계속)
    let sessionId: string | null = null;
    try {
      const sessionResult = await startImportSession(
        uploadedFile.filename,
        fileData.length,
        activeInOrder,
      );
      sessionId = sessionResult.session_id;
    } catch (e) {
      console.error('Session start failed (non-fatal):', e);
    }

    // 각 오브젝트별 결과 초기화
    const resultsMap: Record<ObjectType, { success: number; updated: number; failed: number; errors: { row: number; message: string }[] }> = {
      people: { success: 0, updated: 0, failed: 0, errors: [] },
      organization: { success: 0, updated: 0, failed: 0, errors: [] },
      deal: { success: 0, updated: 0, failed: 0, errors: [] },
      lead: { success: 0, updated: 0, failed: 0, errors: [] },
    };

    // 헬퍼 함수: API 호출 및 body 생성
    // Salesmap API 형식: { name: "이름", fieldList: [{ name: "필드명", stringValue: "값" }] }
    const buildBody = (row: Record<string, unknown>, objectType: ObjectType) => {
      const mapping = objectMappings[objectType];
      const fields = salesmapFields[objectType];

      // 기본 필드 (top-level)
      const body: Record<string, unknown> = {};
      // 커스텀 필드 (fieldList)
      const fieldList: Array<{ name: string; stringValue?: string; numberValue?: number; booleanValue?: boolean; dateValue?: string; userValueId?: string }> = [];

      // 이름(name) 필드 키 찾기 - "이름" 또는 "name"
      const nameFieldKey = fields.find(f => f.key === '이름' || f.key === 'name')?.key || '이름';

      // 딜/리드 특수 필드 키 찾기
      const statusFieldKey = fields.find(f => f.key === '상태' || f.key === 'status')?.key;
      const priceFieldKey = fields.find(f => f.key === '금액' || f.key === 'price' || f.key === 'amount')?.key;

      console.log(`[buildBody] ${objectType} - columnMappings:`, mapping.columnMappings);
      console.log(`[buildBody] ${objectType} - nameFieldKey:`, nameFieldKey);

      // 메모 매핑 여부 확인
      const memoColumn = Object.entries(mapping.columnMappings).find(([, fk]) => fk === '__memo__');
      console.log(`[buildBody] ${objectType} - memo mapping:`, memoColumn ? `"${memoColumn[0]}" → __memo__` : '없음');

      for (const [column, fieldKey] of Object.entries(mapping.columnMappings)) {
        const fieldDef = fields.find(f => f.key === fieldKey);

        // 메모 필드 디버깅
        if (fieldKey === '__memo__') {
          console.log(`[buildBody] ${objectType} - __memo__ fieldDef found:`, !!fieldDef, 'raw value:', JSON.stringify(row[column]), 'type:', typeof row[column]);
        }

        if (fieldDef) {
          let value = row[column];

          // 빈 값은 건너뛰기 (null, undefined, 빈 문자열, "-")
          if (value === null || value === undefined || value === '' || value === '-') {
            if (fieldKey === '__memo__') {
              console.log(`[buildBody] ${objectType} - memo SKIPPED (empty value)`);
            }
            continue;
          }

          // 이름(name) 필드는 top-level로 설정
          if (fieldKey === nameFieldKey || fieldKey === '이름' || fieldKey === 'name') {
            body.name = String(value);
            continue;
          }

          // 노트(메모) 필드는 body.memo로 설정
          if (fieldKey === '__memo__') {
            console.log(`[buildBody] ${objectType} - memo value:`, value);
            body.memo = String(value);
            continue;
          }

          // 딜: 상태(status) 필드는 top-level로 설정
          if (objectType === 'deal' && (fieldKey === statusFieldKey || fieldKey === '상태' || fieldKey === 'status')) {
            // 상태 값 변환: 한글 -> API 값
            const statusValue = String(value);
            if (statusValue === '진행중' || statusValue === 'In progress' || statusValue === '진행 중') {
              body.status = 'In progress';
            } else if (statusValue === '성사' || statusValue === 'Won' || statusValue === '성공') {
              body.status = 'Won';
            } else if (statusValue === '실패' || statusValue === 'Lost') {
              body.status = 'Lost';
            } else {
              body.status = 'In progress'; // 기본값
            }
            continue;
          }

          // 딜: 금액(price) 필드는 top-level로 설정
          if (objectType === 'deal' && (fieldKey === priceFieldKey || fieldKey === '금액' || fieldKey === 'price' || fieldKey === 'amount')) {
            body.price = Number(String(value).replace(/,/g, ''));
            continue;
          }

          // 파이프라인/단계 필드는 임시 키로 저장 (이름→ID 변환용)
          if (fieldKey === '파이프라인' || fieldKey === 'pipeline') {
            body.__pipelineName = String(value);
            continue;
          }
          if (fieldKey === '파이프라인 단계' || fieldKey === 'pipeline_stage') {
            body.__pipelineStageName = String(value);
            continue;
          }

          // 담당자 필드: 이름→userValueId 변환
          if (fieldKey === '담당자') {
            const userName = String(value).trim();
            const matchedUser = salesmapUsers.find(u => u.name.trim() === userName);
            if (matchedUser) {
              fieldList.push({ name: fieldKey, userValueId: matchedUser.id });
            } else {
              console.warn(`[buildBody] ${objectType} - 담당자 "${userName}" 매칭 실패, 건너뜀`);
            }
            continue;
          }

          // 날짜 타입 판별: 선언된 type, 필드명, 또는 값 형식으로 감지
          const isDateField = fieldDef.type === 'date' || fieldDef.type === 'datetime'
            || /날짜|date/i.test(fieldKey) || /날짜|date/i.test(fieldDef.name);
          const isDateLikeValue = /^\d{4}[-./]\d{1,2}[-./]\d{1,2}(T\d{2}:\d{2}(:\d{2})?)?/.test(String(value).trim());

          // 타입에 따른 처리
          if (fieldDef.type === 'number') {
            const numValue = Number(String(value).replace(/,/g, ''));
            fieldList.push({ name: fieldKey, numberValue: numValue });
          } else if (fieldDef.type === 'boolean') {
            const boolValue = value === true || value === 'true' || value === 'Y' || value === '예';
            fieldList.push({ name: fieldKey, booleanValue: boolValue });
          } else if (isDateField || isDateLikeValue) {
            // 날짜 문자열을 YYYY-MM-DD 또는 ISO 형식으로 변환
            const raw = String(value).trim();
            const normalized = raw.replace(/[./]/g, '-'); // 2026.02.12 → 2026-02-12
            const parsed = new Date(normalized);
            if (!isNaN(parsed.getTime())) {
              const dateValue = parsed.toISOString().split('T')[0]; // YYYY-MM-DD
              fieldList.push({ name: fieldKey, dateValue });
            } else {
              fieldList.push({ name: fieldKey, dateValue: raw });
            }
          } else {
            // 텍스트, 이메일, 전화 등 모든 문자열 타입
            fieldList.push({ name: fieldKey, stringValue: String(value) });
          }
        }
      }

      // fieldList가 있으면 추가
      if (fieldList.length > 0) {
        body.fieldList = fieldList;
      }

      console.log(`[buildBody] ${objectType} - final body:`, body);
      return body;
    };

    const createObject = async (objectType: ObjectType, body: Record<string, unknown>, rowIndex: number): Promise<{ success: boolean; data?: any; message?: string; reason?: string; wasUpdated?: boolean }> => {
      const config = OBJECT_CONFIGS.find(c => c.id === objectType)!;
      const requestBody = { data: body };

      console.log(`[createObject] ${objectType} - Sending request to ${config.endpoint}:`, requestBody);

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Salesmap-Api-Key': apiKey,
      };
      if (sessionId) {
        headers['X-Import-Session-Id'] = sessionId;
        headers['X-Import-Row-Index'] = String(rowIndex);
      }

      const response = await fetch(`${API_BASE}/salesmap/proxy${config.endpoint}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(requestBody),
      });
      const result = await response.json();

      console.log(`[createObject] ${objectType} - Response:`, result);

      // 중복 실패 시 처리
      if (!result.success && result.data?.id) {
        const duplicateId = result.data.id;

        // upsert 비활성 → 업데이트 시도 없이 중복 ID만 반환 (연결용)
        if (!upsertEnabled) {
          console.log(`[createObject] ${objectType} - Duplicate detected (id: ${duplicateId}), upsert disabled → skip update`);
          return { success: false, data: { id: duplicateId }, message: result.message || '중복 데이터 (업데이트 꺼짐)', reason: result.reason };
        }

        // upsert 활성 → 자동 업데이트
        console.log(`[createObject] ${objectType} - Duplicate detected (id: ${duplicateId}), attempting update...`);

        const updateResponse = await fetch(`${API_BASE}/salesmap/proxy${config.endpoint}/${duplicateId}`, {
          method: 'POST',
          headers,
          body: JSON.stringify(requestBody),
        });
        const updateResult = await updateResponse.json();

        console.log(`[createObject] ${objectType} - Update response:`, updateResult);

        // 업데이트 성공 시 원래 중복 ID를 data에 포함시켜 반환
        if (updateResult.success) {
          return { ...updateResult, data: { ...updateResult.data, id: duplicateId }, wasUpdated: true };
        }
        // 업데이트도 실패하면 실패 반환 (중복 ID는 유지)
        return { ...updateResult, data: { id: duplicateId }, wasUpdated: false };
      }

      return result;
    };

    // 행별로 순차 처리 (cascading)
    for (let i = 0; i < fileData.length; i++) {
      const row = fileData[i];
      let organizationId: string | null = null;
      let peopleId: string | null = null;

      // 1. Organization 생성
      if (objectMappings.organization.enabled) {
        try {
          const body = buildBody(row, 'organization');
          const result = await createObject('organization', body, i);

          if (result.success && result.data) {
            // API 응답에서 organizationId 추출
            organizationId = result.data.organization?.id || result.data.id || null;
            if (result.wasUpdated) {
              resultsMap.organization.updated++;
            } else {
              resultsMap.organization.success++;
            }
          } else {
            // 실패했지만 중복 ID가 있으면 연결용으로 사용
            if (result.data?.id) {
              organizationId = result.data.id;
            }
            resultsMap.organization.failed++;
            resultsMap.organization.errors.push({
              row: i + 1,
              message: result.reason || result.message || '회사 생성 실패',
            });
          }
        } catch (error) {
          resultsMap.organization.failed++;
          resultsMap.organization.errors.push({
            row: i + 1,
            message: error instanceof Error ? error.message : '회사 생성 요청 실패',
          });
        }
      }

      // 2. People 생성 (organizationId 연결)
      if (objectMappings.people.enabled) {
        try {
          const body = buildBody(row, 'people');

          // 회사가 생성되었으면 자동 연결
          if (organizationId) {
            body.organizationId = organizationId;
          }

          const result = await createObject('people', body, i);

          if (result.success && result.data) {
            // API 응답에서 peopleId 추출
            peopleId = result.data.people?.id || result.data.id || null;
            if (result.wasUpdated) {
              resultsMap.people.updated++;
            } else {
              resultsMap.people.success++;
            }
          } else {
            // 실패했지만 중복 ID가 있으면 연결용으로 사용
            if (result.data?.id) {
              peopleId = result.data.id;
            }
            resultsMap.people.failed++;
            resultsMap.people.errors.push({
              row: i + 1,
              message: result.reason || result.message || '고객 생성 실패',
            });
          }
        } catch (error) {
          resultsMap.people.failed++;
          resultsMap.people.errors.push({
            row: i + 1,
            message: error instanceof Error ? error.message : '고객 생성 요청 실패',
          });
        }
      }

      // 3. Deal 생성 (peopleId + organizationId 둘 다 연결)
      if (objectMappings.deal.enabled) {
        try {
          const body = buildBody(row, 'deal');
          const mapping = objectMappings.deal;

          // 회사와 고객 둘 다 연결
          if (organizationId) {
            body.organizationId = organizationId;
          }
          if (peopleId) {
            body.peopleId = peopleId;
          }

          // 딜 필수 필드 설정
          if (!body.status) {
            body.status = mapping.defaultStatus || 'In progress';
          }

          // 파이프라인 이름→ID 변환 (행별 매핑)
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
          // fallback: 매칭 실패 또는 값 없음 → UI 설정값
          if (!body.pipelineId && mapping.pipelineId) {
            body.pipelineId = mapping.pipelineId;
          }
          if (!body.pipelineStageId && mapping.pipelineStageId) {
            body.pipelineStageId = mapping.pipelineStageId;
          }

          const result = await createObject('deal', body, i);

          if (result.success) {
            if (result.wasUpdated) {
              resultsMap.deal.updated++;
            } else {
              resultsMap.deal.success++;
            }
          } else {
            resultsMap.deal.failed++;
            resultsMap.deal.errors.push({
              row: i + 1,
              message: result.reason || result.message || '딜 생성 실패',
            });
          }
        } catch (error) {
          resultsMap.deal.failed++;
          resultsMap.deal.errors.push({
            row: i + 1,
            message: error instanceof Error ? error.message : '딜 생성 요청 실패',
          });
        }
      }

      // 4. Lead 생성 (peopleId + organizationId 둘 다 연결)
      if (objectMappings.lead.enabled) {
        try {
          const body = buildBody(row, 'lead');
          const mapping = objectMappings.lead;

          // 회사와 고객 둘 다 연결
          if (organizationId) {
            body.organizationId = organizationId;
          }
          if (peopleId) {
            body.peopleId = peopleId;
          }

          // 파이프라인 이름→ID 변환 (행별 매핑)
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
          // fallback: 매칭 실패 또는 값 없음 → UI 설정값
          if (!body.pipelineId && mapping.pipelineId) {
            body.pipelineId = mapping.pipelineId;
          }
          if (!body.pipelineStageId && mapping.pipelineStageId) {
            body.pipelineStageId = mapping.pipelineStageId;
          }

          const result = await createObject('lead', body, i);

          if (result.success) {
            if (result.wasUpdated) {
              resultsMap.lead.updated++;
            } else {
              resultsMap.lead.success++;
            }
          } else {
            resultsMap.lead.failed++;
            resultsMap.lead.errors.push({
              row: i + 1,
              message: result.reason || result.message || '리드 생성 실패',
            });
          }
        } catch (error) {
          resultsMap.lead.failed++;
          resultsMap.lead.errors.push({
            row: i + 1,
            message: error instanceof Error ? error.message : '리드 생성 요청 실패',
          });
        }
      }

      // 진행률 업데이트 (모든 활성 오브젝트 동일하게)
      const progress = Math.round(((i + 1) / fileData.length) * 100);
      setImportProgress(prev => {
        const updated = { ...prev };
        for (const objType of activeInOrder) {
          updated[objType] = progress;
        }
        return updated;
      });
    }

    // 세션 종료 (실패해도 무시)
    if (sessionId) {
      try {
        await endImportSession(sessionId);
      } catch (e) {
        console.error('Session end failed (non-fatal):', e);
      }
    }

    // 최종 결과 저장
    setImportResults(prev => ({
      ...prev,
      ...Object.fromEntries(
        activeInOrder.map(objType => [objType, resultsMap[objType]])
      ),
    }));

    setIsImporting(false);
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
            <div className="flex items-center gap-3 rounded-lg border border-[#CBCCC9] bg-white px-4 py-3">
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
                {/* Connection notice for deal/lead */}
                {enabledObjects.some(c => c.needsConnection) && (
                  <div className={`flex items-center gap-3 rounded-lg border px-4 py-3 ${
                    objectMappings.people.enabled || objectMappings.organization.enabled
                      ? 'border-[#22c55e] bg-[#f0fdf4]'
                      : 'border-[#ef4444] bg-[#fef2f2]'
                  }`}>
                    <span
                      className={`material-symbols-rounded ${
                        objectMappings.people.enabled || objectMappings.organization.enabled
                          ? 'text-[#22c55e]'
                          : 'text-[#ef4444]'
                      }`}
                      style={{ fontSize: 18 }}
                    >
                      {objectMappings.people.enabled || objectMappings.organization.enabled ? 'link' : 'error'}
                    </span>
                    {(objectMappings.people.enabled || objectMappings.organization.enabled) ? (
                      <span className="font-secondary text-sm text-[#166534]">
                        딜/리드 연결이 자동으로 설정됩니다: 회사 → 고객 → 딜/리드 순서로 생성되며, 생성된 ID가 자동 연결됩니다.
                      </span>
                    ) : (
                      <span className="font-secondary text-sm text-[#991b1b]">
                        딜/리드는 고객 또는 회사 연결이 필요합니다. 위에서 고객 또는 회사를 활성화해주세요.
                      </span>
                    )}
                  </div>
                )}

                {/* 딜/리드 설정 (파이프라인, 상태) */}
                {(objectMappings.deal.enabled || objectMappings.lead.enabled) && (
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
                  </div>
                )}

                {/* 필드 매핑 테이블 */}
                <div className="flex flex-1 flex-col overflow-hidden rounded border border-[#CBCCC9] bg-white">
                  {/* 테이블 헤더 */}
                  <div className="grid grid-cols-[minmax(180px,1fr)_100px_minmax(280px,1.5fr)] items-center border-b border-[#CBCCC9] bg-[#F2F3F0] px-4 py-3">
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

                      // 현재 매핑 상태 확인 (모든 오브젝트에서)
                      let currentMappingKey = '';
                      let currentObjectType: ObjectType | null = null;
                      for (const config of enabledObjects) {
                        const fieldKey = objectMappings[config.id].columnMappings[col];
                        if (fieldKey) {
                          currentMappingKey = `${config.id}.${fieldKey}`;
                          currentObjectType = config.id;
                          break;
                        }
                      }

                      const isMapped = !!currentMappingKey;

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
                          className={`grid grid-cols-[minmax(180px,1fr)_100px_minmax(280px,1.5fr)] items-center px-4 py-2.5 ${
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

                          {/* SearchableSelect 드롭다운 */}
                          <SearchableSelect
                            value={currentMappingKey}
                            options={groupedOptions}
                            onChange={(newValue) => {
                              // 기존 매핑 제거
                              if (currentObjectType) {
                                handleMappingChange(currentObjectType, col, '');
                              }

                              // 새 매핑 추가
                              if (newValue) {
                                const [objType, fieldKey] = newValue.split('.');
                                handleMappingChange(objType as ObjectType, col, fieldKey);
                              }
                            }}
                            placeholder="필드 선택"
                          />
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
