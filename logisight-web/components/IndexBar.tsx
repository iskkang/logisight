import type { IndexBarItem } from '@/lib/types';

export function IndexBar({
  indices,
  lastUpdated,
}: {
  indices: IndexBarItem[];
  lastUpdated: string;
}) {
  return (
    <div className="bg-white border-b border-slate-200 px-3 lg:px-5 py-2 flex items-center overflow-x-auto sticky top-0 z-10">
      <div className="max-w-page mx-auto flex items-center w-full">
        {indices.map((idx, i) => (
          <div
            key={idx.name}
            className={`flex flex-col px-3 lg:px-5 min-w-[90px] lg:min-w-[120px] flex-shrink-0 ${
              i < indices.length - 1 ? 'border-r border-slate-200' : ''
            }`}
          >
            <div className="text-[10px] lg:text-[11px] text-slate-500 font-medium mb-0.5">
              {idx.name}
            </div>
            <div className="text-xs lg:text-[15px] font-medium text-slate-800">
              {idx.value}
              <span className={`text-[10px] ml-1 ${
                idx.change_sign === 'up'   ? 'text-success' :
                idx.change_sign === 'down' ? 'text-danger'  :
                'text-slate-400'
              }`}>
                {idx.change_pct !== null && (idx.change_pct > 0 ? '+' : '')}
                {idx.change_pct}%
              </span>
            </div>
          </div>
        ))}

        {/* 업데이트 시각 — 모바일 숨김 */}
        <div className="hidden lg:flex flex-col px-5 min-w-[120px] flex-shrink-0 ml-auto">
          <div className="text-[11px] text-slate-500 font-medium mb-0.5">업데이트</div>
          <div className="text-[11px] text-slate-500">{lastUpdated}</div>
        </div>
      </div>
    </div>
  );
}
