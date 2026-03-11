import { useState, useCallback } from 'react';
import { uploadFile } from '../../services/api';
import type { UploadResponse } from '../../types';

interface FileUploadProps {
  onUploadComplete: (data: UploadResponse & { data: Record<string, unknown>[] }) => void;
  uploadedFile: UploadResponse | null;
}

export function FileUpload({ onUploadComplete, uploadedFile }: FileUploadProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(async (file: File) => {
    setIsUploading(true);
    setError(null);

    try {
      const result = await uploadFile(file);
      onUploadComplete(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : '업로드 실패');
    } finally {
      setIsUploading(false);
    }
  }, [onUploadComplete]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  }, [handleFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }, [handleFile]);

  if (uploadedFile) {
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="w-10 h-10 bg-green-100 rounded-lg flex items-center justify-center">
            <svg className="w-5 h-5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <div className="flex-1">
            <p className="font-medium text-green-800">{uploadedFile.filename}</p>
            <p className="text-sm text-green-600">{uploadedFile.total_rows}개 행, {uploadedFile.columns.length}개 열</p>
          </div>
          <button
            onClick={() => onUploadComplete({ ...uploadedFile, data: [], filename: '', columns: [], preview: [], total_rows: 0 })}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            파일 변경
          </button>
        </div>

        <div className="overflow-x-auto">
          <p className="text-sm font-medium text-slate-700 mb-2">미리보기 (처음 5개 행)</p>
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="bg-slate-50">
                {uploadedFile.columns.map((col, i) => (
                  <th key={i} className="px-3 py-2 text-left font-medium text-slate-600 border border-slate-200">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {uploadedFile.preview.map((row, i) => (
                <tr key={i} className="hover:bg-slate-50">
                  {uploadedFile.columns.map((col, j) => (
                    <td key={j} className="px-3 py-2 border border-slate-200 text-slate-600 truncate max-w-[200px]">
                      {String(row[col] ?? '')}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`border-2 border-dashed rounded-xl p-12 text-center transition-colors ${
          isDragging
            ? 'border-blue-500 bg-blue-50'
            : 'border-slate-300 hover:border-slate-400'
        }`}
      >
        {isUploading ? (
          <div className="flex flex-col items-center">
            <svg className="animate-spin h-10 w-10 text-blue-600 mb-4" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
            <p className="text-slate-600">파일 업로드 및 분석 중...</p>
          </div>
        ) : (
          <>
            <div className="w-16 h-16 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
              </svg>
            </div>
            <p className="text-slate-600 mb-2">
              파일을 여기에 <span className="font-medium">드래그 앤 드롭</span>하거나{' '}
              <label className="text-blue-600 cursor-pointer hover:underline">
                파일 찾기
                <input
                  type="file"
                  className="hidden"
                  accept=".csv,.xlsx,.xls"
                  onChange={handleInputChange}
                />
              </label>
            </p>
            <p className="text-sm text-slate-400">CSV, XLSX, XLS 파일을 지원합니다</p>
          </>
        )}
      </div>

      {error && (
        <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}
    </div>
  );
}
