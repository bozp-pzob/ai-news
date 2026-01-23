// frontend/src/index.tsx

import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Buffer } from 'buffer';
import './index.css';
import LandingPage from './pages/LandingPage';
import BuilderPage from './pages/BuilderPage';
import DocsPage from './pages/DocsPage';
import DashboardPage from './pages/DashboardPage';
import ConfigPage from './pages/ConfigPage';
import NewConfigPage from './pages/NewConfigPage';
import UpgradePage from './pages/UpgradePage';
import { ToastProvider } from './components/ToastProvider';
import { PrivyProvider } from './components/PrivyProvider';
import { AuthProvider } from './context/AuthContext';

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
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/builder" element={<BuilderPage />} />
              <Route path="/builder/:id" element={<BuilderPage />} />
              <Route path="/docs/*" element={<DocsPage />} />
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/configs/new" element={<NewConfigPage />} />
              <Route path="/configs/:id" element={<ConfigPage />} />
              <Route path="/upgrade" element={<UpgradePage />} />
            </Routes>
          </BrowserRouter>
        </ToastProvider>
      </AuthProvider>
    </PrivyProvider>
  </React.StrictMode>
);
