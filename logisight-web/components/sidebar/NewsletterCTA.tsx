'use client';

import { useState } from 'react';
import { Mail } from 'lucide-react';
import { supabase, hasSupabase } from '@/lib/supabase/client';

export function NewsletterCTA() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'submitting' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async () => {
    if (!email || state === 'submitting') return;
    setState('submitting');
    setErrorMsg('');

    // Supabase 미설정 시: mock success (개발 편의)
    if (!hasSupabase || !supabase) {
      console.log('[NewsletterCTA] mock subscribe:', email);
      setState('success');
      return;
    }

    const { error } = await supabase
      .from('newsletter_subscribers')
      .insert({ email, source: 'sidebar' });

    if (error) {
      // 23505 = unique violation (이미 구독 중)
      if (error.code === '23505') {
        setErrorMsg('이미 구독 중입니다');
      } else {
        setErrorMsg('잠시 후 다시 시도해주세요');
      }
      setState('error');
      return;
    }

    setState('success');
  };

  return (
    <aside className="bg-gradient-to-br from-navy-400 to-blue-700 rounded-xl p-4 mb-3.5 text-white relative overflow-hidden">
      <div className="text-[13px] font-medium leading-snug mb-1.5">
        매주 월요일, 시장 분석을 받아보세요
      </div>
      <div className="text-[11px] opacity-85 leading-relaxed mb-3">
        SCFI 동향, 주요 발표, 정책 변화를 정리한 주간 리포트입니다.
      </div>

      {state === 'success' ? (
        <div className="bg-white/10 border border-white/20 rounded-md py-2 text-[11px] text-center">
          구독 신청 완료
        </div>
      ) : (
        <>
          <input
            type="email"
            value={email}
            onChange={(e) => { setEmail(e.target.value); setState('idle'); }}
            placeholder="이메일 주소"
            disabled={state === 'submitting'}
            className="w-full bg-white text-slate-800 rounded-md px-2.5 py-2 text-[11px] mb-1.5 placeholder:text-slate-400 focus:outline-none disabled:opacity-50"
          />
          <button
            onClick={handleSubmit}
            disabled={state === 'submitting' || !email}
            className="w-full bg-cyan text-navy-900 rounded-md py-2 text-[11px] font-medium flex items-center justify-center gap-1.5 hover:brightness-110 transition disabled:opacity-50"
          >
            <Mail size={12} />
            {state === 'submitting' ? '신청 중…' : '구독하기'}
          </button>
          {state === 'error' && (
            <div className="text-[10px] text-rose-200 mt-1.5 text-center">
              {errorMsg}
            </div>
          )}
        </>
      )}

      <div className="text-[10px] opacity-70 mt-2 text-center">
        현재 1,240명 구독 중
      </div>
    </aside>
  );
}
