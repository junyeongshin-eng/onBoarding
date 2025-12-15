import { useState, useCallback } from 'react';
import { Wizard } from '../components/Wizard/Wizard';
import { WelcomeStep } from '../components/Wizard/WelcomeStep';
import { FileUpload } from '../components/FileUpload/FileUpload';
import { ObjectSelector } from '../components/ObjectSelector/ObjectSelector';
import { FieldMapper } from '../components/FieldMapper/FieldMapper';
import { ReviewStep } from '../components/Review/ReviewStep';
import { SuccessStep } from '../components/Review/SuccessStep';
import { importData } from '../services/api';
import type { UploadResponse, FieldMapping, ImportResponse, ExtendedCRMField } from '../types';

const STEPS = [
  { title: '시작하기', description: '데이터 가져오기를 시작합니다' },
  { title: '파일 업로드', description: 'CSV 또는 Excel 파일을 업로드하세요' },
  { title: '오브젝트 선택', description: '가져올 데이터 유형을 선택하세요 (복수 선택 가능)' },
  { title: '필드 매핑', description: '파일의 열을 Salesmap 필드에 매핑하세요' },
  { title: '검토', description: '가져오기 내용을 확인하세요' },
];

export function Onboarding() {
  const [currentStep, setCurrentStep] = useState(0);
  const [uploadedFile, setUploadedFile] = useState<UploadResponse | null>(null);
  const [fileData, setFileData] = useState<Record<string, unknown>[]>([]);
  const [selectedObjectTypes, setSelectedObjectTypes] = useState<string[]>([]);
  const [fieldMappings, setFieldMappings] = useState<FieldMapping[]>([]);
  const [customFields, setCustomFields] = useState<ExtendedCRMField[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [importResult, setImportResult] = useState<ImportResponse | null>(null);

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

  const handleObjectTypesChange = useCallback((types: string[]) => {
    setSelectedObjectTypes(types);
    // Reset mappings when object types change
    setFieldMappings([]);
  }, []);

  const canProgress = () => {
    switch (currentStep) {
      case 0: // Welcome
        return true;
      case 1: // Upload
        return uploadedFile !== null;
      case 2: // Object Type
        return selectedObjectTypes.length > 0;
      case 3: // Field Mapping
        // At least one mapping required
        return fieldMappings.length > 0;
      case 4: // Review
        return true;
      default:
        return false;
    }
  };

  const handleNext = () => {
    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const handleBack = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  const handleComplete = async () => {
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
        errors: [error instanceof Error ? error.message : '가져오기 실패'],
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleStartOver = () => {
    setCurrentStep(0);
    setUploadedFile(null);
    setFileData([]);
    setSelectedObjectTypes([]);
    setFieldMappings([]);
    setCustomFields([]);
    setImportResult(null);
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
        return <WelcomeStep />;
      case 1:
        return <FileUpload onUploadComplete={handleUploadComplete} uploadedFile={uploadedFile} />;
      case 2:
        return <ObjectSelector selectedTypes={selectedObjectTypes} onSelect={handleObjectTypesChange} />;
      case 3:
        return selectedObjectTypes.length > 0 ? (
          <FieldMapper
            objectTypes={selectedObjectTypes}
            sourceColumns={uploadedFile?.columns || []}
            mappings={fieldMappings}
            customFields={customFields}
            onMappingsChange={setFieldMappings}
            onCustomFieldsChange={setCustomFields}
          />
        ) : null;
      case 4:
        return uploadedFile && selectedObjectTypes.length > 0 ? (
          <ReviewStep
            uploadedFile={uploadedFile}
            objectTypes={selectedObjectTypes}
            mappings={fieldMappings}
            customFields={customFields}
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
      isLastStep={currentStep === STEPS.length - 1}
      isFirstStep={currentStep === 0}
      onComplete={handleComplete}
      isLoading={isLoading}
    >
      {renderStepContent()}
    </Wizard>
  );
}
