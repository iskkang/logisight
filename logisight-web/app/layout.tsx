import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Logisight — 물류를 읽는 새로운 시선',
  description: '운임 지수와 시장 뉴스, 정책 변화. 흩어진 물류 정보를 매주 한 편의 분석으로 정리합니다. MTL Shipping Agency가 운영하는 한국 화주·포워더를 위한 물류 인텔리전스.',
  keywords: ['물류', '해운', '항공', '철도', 'TCR', 'TSR', '유라시아', 'SCFI', 'KCCI', '화물운임', '포워더'],
  openGraph: {
    title: 'Logisight — 물류를 읽는 새로운 시선',
    description: '한국 화주·포워더를 위한 물류 인텔리전스',
    locale: 'ko_KR',
    type: 'website',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
