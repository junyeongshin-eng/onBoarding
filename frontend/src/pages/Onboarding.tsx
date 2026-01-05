import { useState, useCallback, useEffect } from 'react';
import { Wizard } from '../components/Wizard/Wizard';
import ConsultingStep from '../components/Wizard/ConsultingStep';
import { ApiKeyStep } from '../components/Wizard/ApiKeyStep';
import { FileUpload } from '../components/FileUpload/FileUpload';
import { ObjectSelector } from '../components/ObjectSelector/ObjectSelector';
import { FieldMapper } from '../components/FieldMapper/FieldMapper';
import { ReviewStep } from '../components/Review/ReviewStep';
import { SuccessStep } from '../components/Review/SuccessStep';
import { ValidationResultPanel } from '../components/Review/ValidationResultPanel';
import { importData, validateImport, detectDuplicates, fetchSalesmapFields } from '../services/api';
import type { UploadResponse, FieldMapping, ImportResponse, ExtendedCRMField, ValidationResult, DuplicateRecord, SalesmapField, ConsultingResult, MissingFieldInfo } from '../types';

const STEPS = [
  { title: '컨설팅', description: '데이터 관리 방식을 알려주세요' },
  { title: 'API 연결', description: '세일즈맵 API Key를 입력하세요' },
  { title: '오브젝트 선택', description: '가져올 데이터 유형을 선택하세요' },
  { title: '파일 업로드', description: 'CSV 또는 Excel 파일을 업로드하세요' },
  { title: '필드 매핑', description: '파일의 열을 세일즈맵 필드에 매핑하세요' },
  { title: '검토', description: '가져오기 내용을 확인하세요' },
  { title: '검사', description: '데이터를 검사합니다' },
];

export function Onboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  // Consulting state
  const [consultingResult, setConsultingResult] = useState<ConsultingResult | null>(null);
  const [isConsultingComplete, setIsConsultingComplete] = useState(false);
  // API Key state
  const [apiKey, setApiKey] = useState('');
  const [isApiKeyValidated, setIsApiKeyValidated] = useState(false);
  // Salesmap fields fetched from API
  const [salesmapFields, setSalesmapFields] = useState<Record<string, SalesmapField[]>>({});
  const [isFetchingFields, setIsFetchingFields] = useState(false);
  // Other states
  const [uploadedFile, setUploadedFile] = useState<UploadResponse | null>(null);
  const [fileData, setFileData] = useState<Record<string, unknown>[]>([]);
  const [selectedObjectTypes, setSelectedObjectTypes] = useState<string[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [customFields, setCustomFields] = useState<ExtendedCRMField[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);
  const [validationResult, setValidationResult] = useState<ValidationResult | null>(null);
  const [duplicates, setDuplicates] = useState<DuplicateRecord[]>([]);
  // Missing fields validation
  const [missingFields, setMissingFields] = useState<MissingFieldInfo[]>([]);
  const [fieldValidationDone, setFieldValidationDone] = useState(false);

  const handleUploadComplete = useCallback((data: UploadResponse & { data: Record<string, unknown>[] }) => {
    if (data.filename) {
      setUploadedFile(data);
      setFileData(data.data || []);
    } else {
      setUploadedFile(null);
      setFileData([]);
      setFieldMappings([]);
    }
  }, []);

  // Validate recommended fields against Salesmap fields
  const validateRecommendedFields = useCallback((
    recommendedFields: ConsultingResult['recommendedFields'],
    salesmapFieldsMap: Record<string, SalesmapField[]>,
    objectTypes: string[]
  ): MissingFieldInfo[] => {
    const missing: MissingFieldInfo[] = [];

    // Check recommended fields from consulting
    for (const field of recommendedFields) {
      if (!objectTypes.includes(field.objectType)) continue;

      const availableFields = salesmapFieldsMap[field.objectType] || [];
      const exists = availableFields.some(f => f.id === field.fieldId || f.label === field.fieldLabel);

      if (!exists) {
        missing.push({
          objectType: field.objectType,
          fieldId: field.fieldId,
          fieldLabel: field.fieldLabel,
          reason: field.reason,
        });
      }
    }

    // Check required connection fields for lead/deal
    for (const objType of objectTypes) {
      if (objType === 'lead' || objType === 'deal') {
        const availableFields = salesmapFieldsMap[objType] || [];
        const hasPeopleName = availableFields.some(f => f.id === 'people_name' || f.label === '연결된 고객 이름');
        const hasCompanyName = availableFields.some(f => f.id === 'company_name' || f.label === '연결된 회사 이름');

        if (!hasPeopleName && !hasCompanyName) {
          // Add both as options - user needs at least one
          missing.push({
            objectType: objType,
            fieldId: 'people_name',
            fieldLabel: '연결된 고객 이름',
            reason: `${objType === 'lead' ? '리드' : '딜'}는 고객 또는 회사와 연결이 필수입니다`,
          });
        }
      }
    }

    return missing;
  }, []);

  const fetchFieldsForTypes = async (types: string[]) => {
    if (!apiKey || types.length === 0) return false;

    setIsFetchingFields(true);
    setFieldValidationDone(false);
    try {
      const result = await fetchSalesmapFields(apiKey, types);

      if (result.success) {
        const fieldsMap: Record<string, SalesmapField[]> = {};
        for (const objResult of result.results) {
          fieldsMap[objResult.object_type] = objResult.fields;
        }
        setSalesmapFields(fieldsMap);

        // Validate recommended fields
        if (consultingResult?.recommendedFields) {
          const missing = validateRecommendedFields(
            consultingResult.recommendedFields,
            fieldsMap,
            types
          );
          setMissingFields(missing);
        }
        setFieldValidationDone(true);
        return true;
      } else {
        console.error('Failed to fetch fields');
        return false;
      }
    } catch (error) {
      console.error('Error fetching fields:', error);
      return false;
    } finally {
      setIsFetchingFields(false);
    }
  };

  const handleObjectTypesChange = useCallback(async (types: string[]) => {
    setSelectedObjectTypes(types);
    // Reset mappings when object types change
    setFieldMappings([]);
    setSalesmapFields({});

    // Automatically fetch fields when object types are selected
    if (apiKey && types.length > 0) {
      await fetchFieldsForTypes(types);
    }
  }, [apiKey]);

  const handleConsultingComplete = useCallback((
    result: ConsultingResult,
    fileDataFromConsulting?: { uploadResponse: UploadResponse; data: Record<string, unknown>[] }
  ) => {
    setConsultingResult(result);
    setIsConsultingComplete(true);
    // Pre-select recommended object types (fields will be fetched when entering step 2)
    if (result.recommendedObjectTypes.length > 0) {
      setSelectedObjectTypes(result.recommendedObjectTypes);
    }
    // If file was uploaded during consulting, use it
    if (fileDataFromConsulting) {
      setUploadedFile(fileDataFromConsulting.uploadResponse);
      setFileData(fileDataFromConsulting.data);
    }
  }, []);

  // Fetch fields when entering object selection step with pre-selected objects
  useEffect(() => {
    if (currentStep === 2 && apiKey && selectedObjectTypes.length > 0 && Object.keys(salesmapFields).length === 0) {
      fetchFieldsForTypes(selectedObjectTypes);
    }
  }, [currentStep, apiKey, selectedObjectTypes, salesmapFields]);

  const canProgress = () => {
    switch (currentStep) {
      case 0: // Consulting
        return isConsultingComplete;
      case 1: // API Key
        return isApiKeyValidated;
      case 2: // Object Type
        // Must have selected types, field validation done, and no missing fields
        return selectedObjectTypes.length > 0 && fieldValidationDone && missingFields.length === 0;
      case 3: // Upload
        return uploadedFile !== null;
      case 4: // Field Mapping
        // At least one mapping required
        return fieldMappings.length > 0;
      case 5: // Review
        return true;
      case 6: // Validation - handled separately
        return false;
      default:
        return false;
    }
  };

  const handleNext = async () => {
    if (currentStep === 2) {
      // Moving from Object Selection to File Upload
      // Fields should already be fetched when object types were selected
      // But if not, fetch them now
      if (Object.keys(salesmapFields).length === 0 && selectedObjectTypes.length > 0) {
        setIsLoading(true);
        await fetchFieldsForTypes(selectedObjectTypes);
        setIsLoading(false);
      }
      setCurrentStep(currentStep + 1);
    } else if (currentStep === 5) {
      // Moving from Review to Validation - run validation
      await handleValidate();
    } else if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep === 6) {
      // Going back from validation clears the result
      setValidationResult(null);
    }
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleValidate = async () => {
    if (!uploadedFile || selectedObjectTypes.length === 0) return;

    setIsLoading(true);
    try {
      // Run validation and duplicate detection in parallel
      const [validationRes, duplicateRes] = await Promise.all([
        validateImport({
          filename: uploadedFile.filename,
          object_types: selectedObjectTypes,
          data: fileData,
          field_mappings: fieldMappings,
          custom_fields: customFields,
        }),
        detectDuplicates(fileData, fieldMappings, false, 0.85),
      ]);

      setValidationResult(validationRes);
      setDuplicates(duplicateRes.duplicates);
      setCurrentStep(6); // Move to validation step
    } catch (error) {
      console.error('Validation failed:', error);
      setImportResult({
        success: false,
        imported_count: 0,
        errors: [error instanceof Error ? error.message : '검증 실패'],
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportAll = async () => {
    if (!uploadedFile || selectedObjectTypes.length === 0) return;

    setIsLoading(true);
    try {
      const result = await importData({
        filename: uploadedFile.filename,
        object_types: selectedObjectTypes,
        data: fileData,
        field_mappings: fieldMappings,
        custom_fields: customFields,
      });
      setImportResult(result);
    } catch (error) {
      console.error('Import failed:', error);
      setImportResult({
        success: false,
        imported_count: 0,
        errors: [error instanceof Error ? error.message : '파일 생성 실패'],
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleImportValid = async () => {
    if (!uploadedFile || selectedObjectTypes.length === 0 || !validationResult) return;

    setIsLoading(true);
    try {
      const result = await importData(
        {
          filename: uploadedFile.filename,
          object_types: selectedObjectTypes,
          data: fileData,
          field_mappings: fieldMappings,
          custom_fields: customFields,
        },
        validationResult.valid_row_indices
      );
      setImportResult(result);
    } catch (error) {
      console.error('Import failed:', error);
      setImportResult({
        success: false,
        imported_count: 0,
        errors: [error instanceof Error ? error.message : '파일 생성 실패'],
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleComplete = async () => {
    // This is now handled by handleImportAll or handleImportValid
    await handleImportAll();
  };

  // Re-check fields (for retry after adding missing fields in Salesmap)
  const handleRecheckFields = async () => {
    if (selectedObjectTypes.length > 0) {
      await fetchFieldsForTypes(selectedObjectTypes);
    }
  };

  const handleStartOver = () => {
    setCurrentStep(0);
    setConsultingResult(null);
    setIsConsultingComplete(false);
    setApiKey('');
    setIsApiKeyValidated(false);
    setSalesmapFields({});
    setUploadedFile(null);
    setFileData([]);
    setSelectedObjectTypes([]);
    setFieldMappings([]);
    setCustomFields([]);
    setImportResult(null);
    setValidationResult(null);
    setDuplicates([]);
    setMissingFields([]);
    setFieldValidationDone(false);
  };

  const handleCancelValidation = () => {
    setCurrentStep(5); // Go back to review
    setValidationResult(null);
    setDuplicates([]);
  };

  if (importResult) {
    return (
      <div className="min-h-screen bg-slate-50">
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6">
            <SuccessStep
              result={importResult}
              objectTypes={selectedObjectTypes}
              onStartOver={handleStartOver}
            />
          </div>
        </div>
      </div>
    );
  }

  const renderStepContent = () => {
    switch (currentStep) {
      case 0:
        return (
          <ConsultingStep
            onComplete={handleConsultingComplete}
            existingResult={consultingResult}
          />
        );
      case 1:
        return (
          <ApiKeyStep
            apiKey={apiKey}
            onApiKeyChange={setApiKey}
            onValidated={setIsApiKeyValidated}
            isValidated={isApiKeyValidated}
          />
        );
      case 2:
        return (
          <ObjectSelector
            selectedTypes={selectedObjectTypes}
            onSelect={handleObjectTypesChange}
            salesmapFields={salesmapFields}
            isFetchingFields={isFetchingFields}
            recommendedTypes={consultingResult?.recommendedObjectTypes}
            missingFields={missingFields}
            fieldValidationDone={fieldValidationDone}
            onRecheckFields={handleRecheckFields}
          />
        );
      case 3:
        return <FileUpload onUploadComplete={handleUploadComplete} uploadedFile={uploadedFile} />;
      case 4:
        return selectedObjectTypes.length > 0 ? (
          <FieldMapper
            objectTypes={selectedObjectTypes}
            sourceColumns={uploadedFile?.columns || []}
            mappings={fieldMappings}
            customFields={customFields}
            sampleData={fileData.slice(0, 5)}
            salesmapFields={salesmapFields}
            onMappingsChange={setFieldMappings}
            onCustomFieldsChange={setCustomFields}
            recommendedFields={consultingResult?.recommendedFields}
          />
        ) : null;
      case 5:
        return uploadedFile && selectedObjectTypes.length > 0 ? (
          <ReviewStep
            uploadedFile={uploadedFile}
            objectTypes={selectedObjectTypes}
            mappings={fieldMappings}
            customFields={customFields}
          />
        ) : null;
      case 6:
        return validationResult ? (
          <ValidationResultPanel
            result={validationResult}
            duplicates={duplicates}
            onCancel={handleCancelValidation}
            onImportAll={handleImportAll}
            onImportValid={handleImportValid}
            isLoading={isLoading}
          />
        ) : null;
      default:
        return null;
    }
  };

  return (
    <Wizard
      steps={STEPS}
      currentStep={currentStep}
      onNext={handleNext}
      onBack={handleBack}
      canProgress={canProgress()}
      isLastStep={currentStep === 5} // Review step is the last step before validation
      isFirstStep={currentStep === 0}
      onComplete={handleComplete}
      isLoading={isLoading || isFetchingFields}
      hideNavigation={currentStep === 6} // Hide navigation on validation step
    >
      {renderStepContent()}
    </Wizard>
  );
}
