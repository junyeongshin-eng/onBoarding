import type { ReactNode } from 'react';

interface WizardStep {
  title: string;
  description: string;
}

interface WizardProps {
  steps: WizardStep[];
  currentStep: number;
  children: ReactNode;
  onNext: () => void;
  onBack: () => void;
  canProgress: boolean;
  isLastStep: boolean;
  isFirstStep: boolean;
  onComplete?: () => void;
  isLoading?: boolean;
  hideNavigation?: boolean;
}

export function Wizard({
  steps,
  currentStep,
  children,
  onNext,
  onBack,
  canProgress,
  isLastStep,
  isFirstStep,
  onComplete,
  isLoading = false,
  hideNavigation = false,
}: WizardProps) {
  return (
    <div className="min-h-screen bg-slate-50">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Progress Steps */}
        <div className="mb-8">
          <div className="flex items-center justify-between">
            {steps.map((step, index) => (
              <div key={index} className="flex items-center">
                <div className="flex flex-col items-center">
                  <div
                    className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                      index < currentStep
                        ? 'bg-green-500 text-white'
                        : index === currentStep
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-200 text-slate-500'
                    }`}
                  >
                    {index < currentStep ? (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      index + 1
                    )}
                  </div>
                  <span className="mt-2 text-xs font-medium text-slate-600 text-center max-w-[80px]">
                    {step.title}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div
                    className={`h-0.5 w-16 mx-2 ${
                      index < currentStep ? 'bg-green-500' : 'bg-slate-200'
                    }`}
                  />
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Step Content */}
        <div className="bg-white rounded-xl shadow-sm border border-slate-200 p-6 mb-6">
          <h2 className="text-xl font-semibold text-slate-800 mb-2">
            {steps[currentStep].title}
          </h2>
          <p className="text-slate-500 mb-6">{steps[currentStep].description}</p>
          {children}
        </div>

        {/* Navigation */}
        {!hideNavigation && (
          <div className="flex justify-between">
            <button
              onClick={onBack}
              disabled={isFirstStep}
              className={`px-6 py-2.5 rounded-lg font-medium transition-colors ${
                isFirstStep
                  ? 'bg-slate-100 text-slate-400 cursor-not-allowed'
                  : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
              }`}
            >
              이전
            </button>
            <button
              onClick={isLastStep ? onComplete : onNext}
              disabled={!canProgress || isLoading}
              className={`px-6 py-2.5 rounded-lg font-medium transition-colors ${
                !canProgress || isLoading
                  ? 'bg-blue-300 text-white cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  검사 중...
                </span>
              ) : isLastStep ? (
                '데이터 검사'
              ) : (
                '계속'
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
