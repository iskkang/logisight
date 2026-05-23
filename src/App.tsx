import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import { Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import Home from './pages/Home';
import CadiDashboard from './pages/CadiDashboard';
import NewsAnalysis from './pages/NewsAnalysis';
import Methodology from './pages/Methodology';
import Subscribe from './pages/Subscribe';
import LoadingState from './components/shared/LoadingState';
import './i18n';

const LANGS = ['ko', 'en', 'ru', 'uz', 'zh'] as const;

// Nav link style helper
const navClass = ({ isActive }: { isActive: boolean }) =>
  `text-sm transition-colors ${isActive ? 'text-sky-400 font-medium' : 'text-slate-300 hover:text-white'}`;

function Nav() {
  const { i18n } = useTranslation();

  return (
    <nav className="bg-slate-900 text-white px-6 py-3 flex items-center gap-6 flex-wrap">
      <NavLink to="/" className="font-bold text-base tracking-tight text-white hover:text-white">
        Logisight
        <span className="ml-2 text-xs bg-sky-700 px-1.5 py-0.5 rounded text-sky-200">CADI β</span>
      </NavLink>

      <div className="flex gap-4">
        {/* Intelligence drop-level: CADI is the flagship */}
        <NavLink to="/intelligence/cadi" className={navClass}>CADI</NavLink>
        <NavLink to="/news"              className={navClass}>News & Analysis</NavLink>
        <NavLink to="/methodology"       className={navClass}>Methodology</NavLink>
        <NavLink to="/subscribe"         className={navClass}>Subscribe</NavLink>
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
            {/* Core pages */}
            <Route path="/"                    element={<Home />} />
            <Route path="/intelligence/cadi"   element={<CadiDashboard />} />
            <Route path="/news"                element={<NewsAnalysis />} />
            <Route path="/methodology"         element={<Methodology />} />
            <Route path="/subscribe"           element={<Subscribe />} />

            {/* Legacy redirect — keep old /cadi URL working */}
            <Route path="/cadi" element={<Navigate to="/intelligence/cadi" replace />} />

            {/* Stub routes — full implementation deferred */}
            <Route path="/reports/weekly/:weekId" element={<NewsAnalysis />} />
            <Route path="/alerts/:slug"           element={<NewsAnalysis />} />
            <Route path="/analysis/:slug"         element={<NewsAnalysis />} />
            <Route path="/spotlights/:slug"       element={<NewsAnalysis />} />
          </Routes>
        </Suspense>
      </div>
    </BrowserRouter>
  );
}
