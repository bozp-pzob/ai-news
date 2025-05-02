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
  const bgClass = isLandingPage ? 'bg-stone-950' : 'bg-white';

  return (
    <div className={`min-h-screen flex flex-col ${bgClass} relative overflow-hidden`}>
      {isLandingPage && (
        <>
          {/* Common background effects for landing page */}
          <div 
            className="fixed inset-0 opacity-10"
            style={{
              background: `
                radial-gradient(circle at 50% 50%, 
                  rgba(138, 43, 226, 0.2), 
                  rgba(0, 255, 255, 0.2),
                  rgba(255, 0, 255, 0.2)
                )
              `,
              filter: "blur(100px)",
              transform: "scale(1.2)",
              zIndex: 0
            }}
          />

          {/* Common grid pattern for landing page */}
          <div 
            className="fixed inset-0 opacity-5"
            style={{
              backgroundImage: `
                linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px),
                linear-gradient(0deg, rgba(255,255,255,0.1) 1px, transparent 1px)
              `,
              backgroundSize: '20px 20px',
              zIndex: 0
            }}
          />
        </>
      )}
      {showNavbar && <Navbar />}
      <main className="flex-grow relative z-10">
        {children}
      </main>
    </div>
  );
};

export default Layout; 