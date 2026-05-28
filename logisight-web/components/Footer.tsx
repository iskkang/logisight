import Link from 'next/link';

const FOOTER_LINKS = {
  서비스: [
    { label: '주간 분석',       href: '/news' },
    { label: '운임 대시보드',   href: '/rates' },
    { label: '정책·규제',       href: '/policy' },
    { label: '산업별 인사이트', href: '/industries' },
  ],
  뉴스: [
    { label: '해상',          href: '/news?cat=해상' },
    { label: '항공',          href: '/news?cat=항공' },
    { label: '철도·유라시아', href: '/news?cat=철도' },
    { label: '무역·정책',     href: '/news?cat=무역' },
  ],
  MTL: [
    { label: '회사소개',  href: '/' },
    { label: '뉴스레터',  href: '/news' },
    { label: '제휴 문의', href: '/' },
  ],
};

export function Footer() {
  return (
    <footer>
      <div className="bg-slate-800 px-5 py-6">
        <div className="max-w-page mx-auto grid grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr] gap-5">
          {/* 브랜드 — 모바일 2열 차지 */}
          <div className="col-span-2 lg:col-span-1">
            <div className="text-base lg:text-lg font-medium text-white mb-1">
              Logi<span className="text-cyan">sight</span>
            </div>
            <p className="text-xs lg:text-[13px] text-slate-400 leading-[1.7] mt-1.5 keep-all">
              MTL Shipping Agency가 운영하는<br />
              한국 화주·포워더를 위한 물류 인텔리전스
            </p>
            <div className="flex gap-1.5 mt-2 flex-wrap">
              <span className="text-[10px] text-cyan bg-cyan/10 px-1.5 py-0.5 rounded">
                유라시아 코리도어 전문
              </span>
              <span className="text-[10px] text-slate-400 bg-slate-700/40 px-1.5 py-0.5 rounded">
                공공데이터 기반
              </span>
            </div>
          </div>

          {Object.entries(FOOTER_LINKS).map(([title, links]) => (
            <div key={title}>
              <div className="text-[10px] font-medium text-slate-400 uppercase tracking-[0.08em] mb-2">
                {title}
              </div>
              {links.map((link) => (
                <Link
                  key={link.href}
                  href={link.href}
                  className="block text-xs lg:text-[13px] text-slate-500 hover:text-slate-300 mb-1.5"
                >
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </div>
      </div>

      <div className="bg-slate-900 px-5 py-2.5">
        <div className="max-w-page mx-auto flex flex-col lg:flex-row lg:justify-between lg:items-center gap-1 text-[10px] text-slate-500">
          <span>© 2026 MTL Shipping Agency · 공공데이터(PORT-MIS · 관세청 · 해양수산부) 기반</span>
          <span>logisight.mtlship.com</span>
        </div>
      </div>
    </footer>
  );
}
