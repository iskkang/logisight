import Link from 'next/link';
import { Search } from 'lucide-react';

const MENU = [
  { label: '홈',         href: '/' },
  { label: '뉴스',       href: '/news' },
  { label: '운임·지수',  href: '/rates' },
  { label: '유라시아',    href: '/eurasia' },
  { label: '정책·규제',  href: '/policy' },
  { label: '산업별',     href: '/industries' },
];

export function Navigation() {
  return (
    <nav className="bg-navy-900 h-12 px-5 flex items-center justify-between">
      <Link href="/" className="text-white text-base font-medium tracking-tight">
        Logi<span className="text-cyan">sight</span>
      </Link>

      <ul className="flex items-center">
        {MENU.map((item, idx) => (
          <li key={item.href}>
            <Link
              href={item.href}
              className={`text-white/70 hover:text-white text-xs px-3 h-12 flex items-center border-b-2 ${
                idx === 0 ? 'border-cyan text-white' : 'border-transparent'
              }`}
            >
              {item.label}
            </Link>
          </li>
        ))}
      </ul>

      <div className="flex items-center gap-2.5">
        <div className="relative">
          <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-white/50" />
          <input
            type="text"
            placeholder="기사·노선·HS코드"
            className="bg-white/10 border-0 rounded-md pl-7 pr-2.5 py-1.5 text-white text-[11px] w-40 placeholder:text-white/40 focus:outline-none focus:ring-1 focus:ring-cyan"
          />
        </div>
        <span className="bg-cyan text-navy-900 text-[10px] font-medium px-1.5 py-0.5 rounded">LIVE</span>
      </div>
    </nav>
  );
}
