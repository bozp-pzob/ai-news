import React from 'react';
import { Link, useLocation } from 'react-router-dom';

const Navbar: React.FC = () => {
  const location = useLocation();
  const isAppPage = location.pathname === '/app';
  const isLandingPage = location.pathname === '/';

  // Use a dark navbar for the landing page and light for the app
  const navbarClass = isLandingPage 
    ? "bg-stone-950 border-b border-stone-900" 
    : "bg-white shadow-sm";
  
  const logoClass = isLandingPage
    ? "text-white"
    : "text-amber-600";

  return (
    <nav className={navbarClass}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link to="/" className={`text-xl font-bold ${logoClass}`}>
                AI News
              </Link>
            </div>
          </div>
          <div className="flex items-center">
            {isAppPage ? (
              <Link 
                to="/" 
                className="text-gray-600 hover:text-amber-600 px-3 py-2 rounded-md text-sm font-medium"
              >
                Home
              </Link>
            ) : (
              <Link 
                to="/app" 
                className="bg-white text-black hover:bg-amber-600 hover:text-white transition-colors px-3 py-2 rounded-md text-sm font-medium"
              >
                Launch App
              </Link>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar; 