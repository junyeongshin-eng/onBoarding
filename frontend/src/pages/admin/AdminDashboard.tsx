import { useState, useEffect } from 'react';
import { getAdminSessions, getAdminSessionDetail } from '../../services/api';
import type { AdminSession, AdminSessionDetail, AdminRowResult } from '../../services/api';

const OBJ_NAMES: Record<string, string> = {
  people: '고객',
  organization: '회사',
  deal: '딜',
  lead: '리드',
};

function formatDate(iso: string | null) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
  });
}

function duration(start: string, end: string | null) {
  if (!end) return '진행중';
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}초`;
  return `${Math.floor(sec / 60)}분 ${sec % 60}초`;
}

/** 결과 라벨 및 색상 결정 */
function getResultLabel(r: AdminRowResult): { label: string; color: string; bgColor: string } {
  if (r.success && r.action === 'update') {
    return { label: '업데이트', color: 'text-[#3b82f6]', bgColor: '' };
  }
  if (r.success) {
    return { label: '생성', color: 'text-[#22c55e]', bgColor: '' };
  }
  // 실패: action=create이고 중복 에러면 "중복 감지"
  if (!r.success && r.action !== 'update' && r.error?.includes('중복')) {
    return { label: '중복 감지', color: 'text-[#f59e0b]', bgColor: 'bg-[#fffbeb]' };
  }
  return { label: '실패', color: 'text-[#ef4444]', bgColor: 'bg-[#fef2f2]' };
}

/** summary에서 created/updated/failed 안전하게 가져오기 (이전 데이터 호환) */
function getSummaryCounts(summary: AdminSession['summary']) {
  if (!summary) return { created: 0, updated: 0, failed: 0 };
  return {
    created: summary.created ?? summary.success ?? 0,
    updated: summary.updated ?? 0,
    failed: summary.failed ?? 0,
  };
}

interface Props {
  password: string;
  onLogout: () => void;
}

export function AdminDashboard({ password, onLogout }: Props) {
  const [sessions, setSessions] = useState<AdminSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDetail, setSelectedDetail] = useState<AdminSessionDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    setLoading(true);
    try {
      const result = await getAdminSessions(password);
      setSessions(result.sessions);
    } catch {
      alert('세션 목록을 불러올 수 없습니다');
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (sessionId: string) => {
    setDetailLoading(true);
    setExpandedRows(new Set());
    try {
      const detail = await getAdminSessionDetail(password, sessionId);
      setSelectedDetail(detail);
    } catch {
      alert('세션 상세를 불러올 수 없습니다');
    } finally {
      setDetailLoading(false);
    }
  };

  const toggleRow = (idx: number) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  // Detail view
  if (selectedDetail) {
    const counts = getSummaryCounts(selectedDetail.summary);

    return (
      <div className="flex h-screen w-screen flex-col bg-[#F2F3F0]">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-[#CBCCC9] bg-white px-6 py-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setSelectedDetail(null)}
              className="flex items-center gap-1 rounded-lg px-3 py-1.5 font-primary text-sm text-[#666666] hover:bg-[#F2F3F0] transition-colors"
            >
              <span className="material-symbols-rounded" style={{ fontSize: 18 }}>arrow_back</span>
              목록
            </button>
            <div className="h-5 w-px bg-[#CBCCC9]" />
            <h1 className="font-primary text-lg font-semibold text-[#111111]">
              {selectedDetail.filename}
            </h1>
          </div>
          <span className="font-secondary text-sm text-[#666666]">
            {formatDate(selectedDetail.started_at)}
          </span>
        </header>

        {/* Summary */}
        <div className="flex gap-4 px-6 py-4">
          <div className="flex items-center gap-2 rounded-lg border border-[#CBCCC9] bg-white px-4 py-3">
            <span className="font-secondary text-sm text-[#666666]">총 행:</span>
            <span className="font-primary text-sm font-semibold text-[#111111]">{selectedDetail.total_rows}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[#CBCCC9] bg-white px-4 py-3">
            <span className="font-secondary text-sm text-[#666666]">요청:</span>
            <span className="font-primary text-sm font-semibold text-[#111111]">{selectedDetail.results.length}</span>
          </div>
          {selectedDetail.summary && (
            <>
              {counts.created > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-[#22c55e]/30 bg-[#f0fdf4] px-4 py-3">
                  <span className="material-symbols-rounded text-[#22c55e]" style={{ fontSize: 18 }}>check_circle</span>
                  <span className="font-primary text-sm font-semibold text-[#22c55e]">{counts.created}</span>
                  <span className="font-secondary text-sm text-[#666666]">생성</span>
                </div>
              )}
              {counts.updated > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-[#3b82f6]/30 bg-[#eff6ff] px-4 py-3">
                  <span className="material-symbols-rounded text-[#3b82f6]" style={{ fontSize: 18 }}>sync</span>
                  <span className="font-primary text-sm font-semibold text-[#3b82f6]">{counts.updated}</span>
                  <span className="font-secondary text-sm text-[#666666]">업데이트</span>
                </div>
              )}
              {counts.failed > 0 && (
                <div className="flex items-center gap-2 rounded-lg border border-[#ef4444]/30 bg-[#fef2f2] px-4 py-3">
                  <span className="material-symbols-rounded text-[#ef4444]" style={{ fontSize: 18 }}>cancel</span>
                  <span className="font-primary text-sm font-semibold text-[#ef4444]">{counts.failed}</span>
                  <span className="font-secondary text-sm text-[#666666]">실패</span>
                </div>
              )}
            </>
          )}
          <div className="flex items-center gap-2 rounded-lg border border-[#CBCCC9] bg-white px-4 py-3">
            <span className="font-secondary text-sm text-[#666666]">소요:</span>
            <span className="font-primary text-sm font-semibold text-[#111111]">
              {duration(selectedDetail.started_at, selectedDetail.ended_at)}
            </span>
          </div>
          {selectedDetail.object_types.map(ot => (
            <div key={ot} className="flex items-center rounded-full bg-[#FF8400]/15 px-3 py-1.5">
              <span className="font-primary text-xs font-medium text-[#FF8400]">{OBJ_NAMES[ot] || ot}</span>
            </div>
          ))}
        </div>

        {/* Results table */}
        <div className="mx-6 mb-6 flex flex-1 flex-col overflow-hidden rounded-lg border border-[#CBCCC9] bg-white">
          <div className="grid grid-cols-[60px_80px_80px_80px_1fr] items-center border-b border-[#CBCCC9] bg-[#F2F3F0] px-4 py-3">
            <span className="font-primary text-xs font-semibold text-[#666666]">행</span>
            <span className="font-primary text-xs font-semibold text-[#666666]">오브젝트</span>
            <span className="font-primary text-xs font-semibold text-[#666666]">결과</span>
            <span className="font-primary text-xs font-semibold text-[#666666]">시간</span>
            <span className="font-primary text-xs font-semibold text-[#666666]">에러</span>
          </div>
          <div className="flex-1 overflow-auto">
            {selectedDetail.results.map((r: AdminRowResult, idx: number) => {
              const resultInfo = getResultLabel(r);
              return (
                <div key={idx}>
                  <div
                    onClick={() => toggleRow(idx)}
                    className={`grid grid-cols-[60px_80px_80px_80px_1fr] items-center px-4 py-2.5 cursor-pointer border-b border-[#CBCCC9]/50 hover:bg-[#F2F3F0] ${resultInfo.bgColor}`}
                  >
                    <span className="font-secondary text-sm text-[#111111]">{r.row_index + 1}</span>
                    <span className="font-secondary text-xs text-[#666666]">{OBJ_NAMES[r.object_type] || r.object_type}</span>
                    <span className={`font-primary text-xs font-medium ${resultInfo.color}`}>
                      {resultInfo.label}
                    </span>
                    <span className="font-secondary text-xs text-[#666666]">
                      {new Date(r.timestamp).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                    </span>
                    <div className="flex items-center justify-between">
                      <span className="font-secondary text-xs text-[#ef4444] truncate">{r.error || ''}</span>
                      <span className="material-symbols-rounded text-[#666666]" style={{ fontSize: 16 }}>
                        {expandedRows.has(idx) ? 'expand_less' : 'expand_more'}
                      </span>
                    </div>
                  </div>

                  {expandedRows.has(idx) && (
                    <div className="grid grid-cols-2 gap-4 border-b border-[#CBCCC9] bg-[#F2F3F0] p-4">
                      <div className="flex flex-col gap-1">
                        <span className="font-primary text-xs font-semibold text-[#FF8400]">Request</span>
                        <pre className="max-h-48 overflow-auto rounded border border-[#CBCCC9] bg-white p-3 font-mono text-xs text-[#111111]">
                          {JSON.stringify(r.request, null, 2)}
                        </pre>
                      </div>
                      <div className="flex flex-col gap-1">
                        <span className="font-primary text-xs font-semibold text-[#FF8400]">Response</span>
                        <pre className="max-h-48 overflow-auto rounded border border-[#CBCCC9] bg-white p-3 font-mono text-xs text-[#111111]">
                          {JSON.stringify(r.response, null, 2)}
                        </pre>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
            {selectedDetail.results.length === 0 && (
              <div className="flex items-center justify-center py-12">
                <span className="font-secondary text-sm text-[#666666]">기록된 요청이 없습니다</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // List view
  return (
    <div className="flex h-screen w-screen flex-col bg-[#F2F3F0]">
      {/* Header */}
      <header className="flex items-center justify-between border-b border-[#CBCCC9] bg-white px-6 py-4">
        <div className="flex items-center gap-3">
          <span className="material-symbols-rounded text-[#FF8400]" style={{ fontSize: 28 }}>
            admin_panel_settings
          </span>
          <h1 className="font-primary text-lg font-semibold text-[#111111]">Import History</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={loadSessions}
            disabled={loading}
            className="flex items-center gap-1 rounded-lg border border-[#CBCCC9] px-3 py-1.5 font-primary text-sm text-[#666666] hover:bg-[#F2F3F0] transition-colors"
          >
            <span className={`material-symbols-rounded ${loading ? 'animate-spin' : ''}`} style={{ fontSize: 16 }}>refresh</span>
            새로고침
          </button>
          <button
            onClick={onLogout}
            className="flex items-center gap-1 rounded-lg border border-[#CBCCC9] px-3 py-1.5 font-primary text-sm text-[#666666] hover:bg-[#F2F3F0] transition-colors"
          >
            <span className="material-symbols-rounded" style={{ fontSize: 16 }}>logout</span>
            로그아웃
          </button>
        </div>
      </header>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <span className="material-symbols-rounded animate-spin text-[#FF8400]" style={{ fontSize: 32 }}>
              progress_activity
            </span>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 gap-3">
            <span className="material-symbols-rounded text-[#CBCCC9]" style={{ fontSize: 48 }}>
              folder_open
            </span>
            <p className="font-secondary text-base text-[#666666]">업로드 내역이 없습니다</p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {sessions.map((s: AdminSession) => {
              const counts = getSummaryCounts(s.summary);
              return (
                <div
                  key={s.id}
                  onClick={() => openDetail(s.id)}
                  className="flex items-center gap-4 rounded-lg border border-[#CBCCC9] bg-white px-5 py-4 cursor-pointer hover:border-[#FF8400] transition-colors"
                >
                  {/* Status icon */}
                  <span
                    className={`material-symbols-rounded ${
                      s.status === 'completed' ? 'text-[#22c55e]' : 'text-[#f59e0b]'
                    }`}
                    style={{ fontSize: 24 }}
                  >
                    {s.status === 'completed' ? 'check_circle' : 'pending'}
                  </span>

                  {/* File info */}
                  <div className="flex flex-1 flex-col gap-1 min-w-0">
                    <span className="font-primary text-sm font-medium text-[#111111] truncate">
                      {s.filename}
                    </span>
                    <span className="font-secondary text-xs text-[#666666]">
                      {formatDate(s.started_at)} | {s.total_rows}행 | {duration(s.started_at, s.ended_at)}
                    </span>
                  </div>

                  {/* Object type tags */}
                  <div className="flex items-center gap-1.5">
                    {s.object_types.map(ot => (
                      <span key={ot} className="rounded-full bg-[#FF8400]/15 px-2.5 py-1 font-primary text-xs font-medium text-[#FF8400]">
                        {OBJ_NAMES[ot] || ot}
                      </span>
                    ))}
                  </div>

                  {/* Results summary */}
                  {s.summary && (
                    <div className="flex items-center gap-3">
                      {counts.created > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="material-symbols-rounded text-[#22c55e]" style={{ fontSize: 16 }}>check_circle</span>
                          <span className="font-primary text-sm font-semibold text-[#22c55e]">{counts.created}</span>
                        </div>
                      )}
                      {counts.updated > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="material-symbols-rounded text-[#3b82f6]" style={{ fontSize: 16 }}>sync</span>
                          <span className="font-primary text-sm font-semibold text-[#3b82f6]">{counts.updated}</span>
                        </div>
                      )}
                      {counts.failed > 0 && (
                        <div className="flex items-center gap-1">
                          <span className="material-symbols-rounded text-[#ef4444]" style={{ fontSize: 16 }}>cancel</span>
                          <span className="font-primary text-sm font-semibold text-[#ef4444]">{counts.failed}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <span className="material-symbols-rounded text-[#CBCCC9]" style={{ fontSize: 20 }}>chevron_right</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {detailLoading && (
        <div className="fixed inset-0 flex items-center justify-center bg-black/20">
          <div className="rounded-xl bg-white p-6 shadow-lg">
            <span className="material-symbols-rounded animate-spin text-[#FF8400]" style={{ fontSize: 32 }}>
              progress_activity
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
