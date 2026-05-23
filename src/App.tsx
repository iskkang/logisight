import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import Home from './pages/Home';
import CadiDashboard from './pages/CadiDashboard';
import NewsAnalysis from './pages/NewsAnalysis';
import Methodology from './pages/Methodology';
import LoadingState from './components/shared/LoadingState';
import './i18n';

const LANGS = ['ko', 'en', 'ru', 'uz', 'zh'] as const;

function Nav() {
  const { t, i18n } = useTranslation();
  const navClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm transition-colors ${isActive ? 'text-sky-400 font-medium' : 'text-slate-300 hover:text-white'}`;

  return (
    <nav className="bg-slate-900 text-white px-6 py-3 flex items-center gap-6 flex-wrap">
      <span className="font-bold text-base tracking-tight text-white">
        Logisight
        <span className="ml-2 text-xs bg-sky-700 px-1.5 py-0.5 rounded text-sky-200">CADI β</span>
      </span>

      <div className="flex gap-4">
        <NavLink to="/"             className={navClass}>{t('nav.home')}</NavLink>
        <NavLink to="/cadi"         className={navClass}>{t('nav.cadi')}</NavLink>
        <NavLink to="/news"         className={navClass}>{t('nav.news')}</NavLink>
        <NavLink to="/methodology"  className={navClass}>{t('nav.methodology')}</NavLink>
      </div>

      <div className="ml-auto flex gap-1">
        {LANGS.map(lng => (
          <button
            key={lng}
            onClick={() => i18n.changeLanguage(lng)}
            className={`px-2 py-0.5 rounded text-xs transition-colors ${
              i18n.language === lng
                ? 'bg-sky-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-700'
            }`}
          >
            {lng.toUpperCase()}
          </button>
        ))}
      </div>
    </nav>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <div className="min-h-screen bg-slate-50">
        <Nav />
        <Suspense fallback={<LoadingState />}>
          <Routes>
            <Route path="/"            element={<Home />} />
            <Route path="/cadi"        element={<CadiDashboard />} />
            <Route path="/news"        element={<NewsAnalysis />} />
            <Route path="/methodology" element={<Methodology />} />
          </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  );
}
