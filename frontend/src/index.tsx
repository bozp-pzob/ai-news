// frontend/src/index.tsx

import React, { Suspense } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Buffer } from 'buffer';
import './index.css';
import LandingPage from './pages/LandingPage';
import NotFoundPage from './pages/NotFoundPage';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ToastProvider } from './components/ToastProvider';
import { PrivyProvider } from './components/PrivyProvider';
import { AuthProvider } from './context/AuthContext';

// Lazy-loaded pages (code-split for smaller initial bundle)
const BuilderPage = React.lazy(() => import('./pages/BuilderPage'));
const DocsPage = React.lazy(() => import('./pages/DocsPage'));
const DashboardPage = React.lazy(() => import('./pages/DashboardPage'));
const ExplorePage = React.lazy(() => import('./pages/ExplorePage'));
const ConfigPage = React.lazy(() => import('./pages/ConfigPage'));
const NewConfigPage = React.lazy(() => import('./pages/NewConfigPage'));
const UpgradePage = React.lazy(() => import('./pages/UpgradePage'));
const AdminPage = React.lazy(() => import('./pages/AdminPage'));
const ConnectionsPage = React.lazy(() => import('./pages/ConnectionsPage'));

// Shared loading fallback for lazy-loaded pages
const PageLoadingFallback = (
  <div className="flex items-center justify-center min-h-screen bg-stone-50">
    <div className="w-8 h-8 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
  </div>
);

// Polyfill Buffer for browser (required by Privy wallet signing)
(window as any).Buffer = Buffer;

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);

root.render(
  <React.StrictMode>
    <PrivyProvider>
      <AuthProvider>
        <ToastProvider>
          <ErrorBoundary>
            <BrowserRouter>
              <Suspense fallback={PageLoadingFallback}>
                <Routes>
                  <Route path="/" element={<LandingPage />} />
                  <Route path="/explore" element={<ExplorePage />} />
                  <Route path="/builder" element={<BuilderPage />} />
                  <Route path="/builder/:id" element={<BuilderPage />} />
                  <Route path="/docs/*" element={<DocsPage />} />
                  <Route path="/dashboard" element={<DashboardPage />} />
                  <Route path="/configs/new" element={<NewConfigPage />} />
                  <Route path="/configs/:id" element={<ConfigPage />} />
                  <Route path="/upgrade" element={<UpgradePage />} />
                  <Route path="/connections" element={<ConnectionsPage />} />
                  <Route path="/admin" element={<AdminPage />} />
                  <Route path="*" element={<NotFoundPage />} />
                </Routes>
              </Suspense>
            </BrowserRouter>
          </ErrorBoundary>
        </ToastProvider>
      </AuthProvider>
    </PrivyProvider>
  </React.StrictMode>
);
