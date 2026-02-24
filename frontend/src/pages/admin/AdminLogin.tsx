import { useState } from 'react';
import { adminLogin } from '../../services/api';

interface Props {
  onLogin: (password: string) => void;
}

export function AdminLogin({ onLogin }: Props) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;

    setLoading(true);
    setError(null);

    try {
      const result = await adminLogin(password);
      if (result.success) {
        onLogin(password);
      } else {
        setError(result.message || '비밀번호가 올바르지 않습니다');
      }
    } catch {
      setError('서버에 연결할 수 없습니다');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-screen w-screen items-center justify-center bg-[#F2F3F0]">
      <form onSubmit={handleSubmit} className="flex w-full max-w-sm flex-col gap-6 rounded-xl border border-[#CBCCC9] bg-white p-8">
        <div className="flex flex-col items-center gap-3">
          <span className="material-symbols-rounded text-[#FF8400]" style={{ fontSize: 48 }}>
            admin_panel_settings
          </span>
          <h1 className="font-primary text-xl font-semibold text-[#111111]">Admin</h1>
          <p className="font-secondary text-sm text-[#666666]">관리자 비밀번호를 입력하세요</p>
        </div>

        <div className="flex flex-col gap-2">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="비밀번호"
            autoFocus
            className="h-12 w-full rounded-lg border border-[#CBCCC9] bg-[#F2F3F0] px-4 font-secondary text-sm text-[#111111] placeholder-[#666666] focus:border-[#FF8400] focus:outline-none"
          />
          {error && (
            <p className="font-secondary text-sm text-[#ef4444] text-center">{error}</p>
          )}
        </div>

        <button
          type="submit"
          disabled={!password.trim() || loading}
          className="flex h-10 items-center justify-center rounded-lg bg-[#FF8400] font-primary text-sm font-medium text-[#111111] hover:bg-[#E67700] transition-colors disabled:opacity-50"
        >
          {loading ? '확인 중...' : '로그인'}
        </button>
      </form>
    </div>
  );
}
