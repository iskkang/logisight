import type { Config } from 'tailwindcss';

const config: Config = {
  content: [
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Pretendard Variable', 'Pretendard', '-apple-system', 'BlinkMacSystemFont', 'system-ui', 'Roboto', 'sans-serif'],
      },
      colors: {
        // Brand: 다크 네이비 + 시안
        navy: {
          DEFAULT: '#0F2D5A',
          50: '#E6EBF3',
          100: '#C2CDDF',
          400: '#1B4D8C',
          700: '#143B73',
          900: '#0F2D5A',
        },
        cyan: {
          DEFAULT: '#38BDF8',
          light: '#7DD3FC',
        },
        // Semantic
        success: '#10B981',
        warning: '#F59E0B',
        danger: '#EF4444',
      },
      fontSize: {
        // 위계 4단 (GBTS 반면교사: 위계 명확하게)
        'hero': ['30px', { lineHeight: '1.2', letterSpacing: '-0.6px' }],
        'h2': ['22px', { lineHeight: '1.3', letterSpacing: '-0.4px' }],
        'h3': ['16px', { lineHeight: '1.4', letterSpacing: '-0.2px' }],
        'body': ['13px', { lineHeight: '1.7' }],
        'meta': ['11px', { lineHeight: '1.5' }],
      },
      maxWidth: {
        'page': '1280px',
      },
    },
  },
  plugins: [],
};

export default config;
