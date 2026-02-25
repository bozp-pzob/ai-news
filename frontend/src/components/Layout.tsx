import React, { ReactNode } from 'react';
import { useLocation } from 'react-router-dom';
import Navbar from './Navbar';

interface LayoutProps {
  children: ReactNode;
  showNavbar?: boolean;
}

const Layout: React.FC<LayoutProps> = ({ children, showNavbar = true }) => {
  const location = useLocation();
  const isLandingPage = location.pathname === '/';
  
  // Apply background color based on route
  const bgClass = isLandingPage ? 'bg-stone-50' : 'bg-white';

  return (
    <div className={`min-h-screen flex flex-col ${bgClass} relative overflow-hidden`}>
      {showNavbar && <Navbar />}
      <main className="flex-grow relative z-10">
        {children}
      </main>
    </div>
  );
};

export default Layout; 