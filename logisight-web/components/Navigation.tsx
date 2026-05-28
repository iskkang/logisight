'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Search, Menu, X } from 'lucide-react';

const MENU = [
  { label: '홈',        href: '/' },
  { label: '뉴스',      href: '/news' },
  { label: '운임·지수', href: '/rates' },
  { label: '유라시아',  href: '/eurasia' },
  { label: '정책·규제', href: '/policy' },
  { label: '산업별',    href: '/industries' },
];

export function Navigation() {
  const [open, setOpen] = useState(false);

  return (
    <nav className="bg-navy-900 relative z-20">
      {/* ── 메인 바 ─────────────────────────────────────────────────────── */}
      <div className="h-12 lg:h-16 px-5 flex items-center justify-between">
        <Link
          href="/"
          className="text-white text-base lg:text-xl font-medium tracking-tight"
          onClick={() => setOpen(false)}
        >
          Logi<span className="text-cyan">sight</span>
        </Link>

        {/* 데스크탑 메뉴 */}
        <ul className="hidden lg:flex items-center">
          {MENU.map((item, idx) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className={`text-white/70 hover:text-white text-sm px-3 h-16 flex items-center border-b-2 ${
                  idx === 0 ? 'border-cyan text-white' : 'border-transparent'
                }`}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2.5">
          {/* 검색 — 모바일 숨김 */}
          <div className="relative hidden lg:block">
            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/50" />
            <input
              type="text"
              placeholder="기사·노선·HS코드"
              className="bg-white/10 border-0 rounded-md pl-7 pr-2.5 py-1.5 text-white text-[11px] w-44 placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-cyan"
            />
          </div>
          <span className="bg-cyan text-navy-900 text-[10px] font-medium px-1.5 py-0.5 rounded">LIVE</span>

          {/* 햄버거 — 모바일만 */}
          <button
            className="lg:hidden text-white/70 hover:text-white p-1"
            onClick={() => setOpen((v) => !v)}
            aria-label="메뉴 열기"
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>

      {/* ── 모바일 드롭다운 ────────────────────────────────────────────── */}
      {open && (
        <div className="lg:hidden absolute top-full left-0 right-0 bg-navy-900 border-t border-white/10 shadow-lg">
          {MENU.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setOpen(false)}
              className="block py-3 px-6 text-sm text-white/80 hover:text-white hover:bg-white/5 border-b border-white/10 last:border-0"
            >
              {item.label}
            </Link>
          ))}
        </div>
      )}
    </nav>
  );
}
