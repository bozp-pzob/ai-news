import React from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

const Navbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, login } = useAuth();
  
  const isBuilderPage = location.pathname === '/builder';
  const isDashboardPage = location.pathname.startsWith('/dashboard') || location.pathname.startsWith('/configs');
  const isLandingPage = location.pathname === '/';

  // Use a dark navbar for the landing page and light for the app
  const navbarClass = isLandingPage 
    ? "bg-stone-950 border-b border-stone-900 !z-1" 
    : "bg-white shadow-sm !z-1";
  
  const logoClass = isLandingPage
    ? "text-white"
    : "text-amber-600";

  const linkClass = isLandingPage
    ? "text-gray-300 hover:text-white"
    : "text-gray-600 hover:text-amber-600";

  // Handle Launch App click - login if needed, then go to dashboard
  const handleLaunchAppClick = () => {
    if (isAuthenticated) {
      navigate('/dashboard');
    } else {
      sessionStorage.setItem('postLoginRedirect', '/dashboard');
      login();
    }
  };

  return (
    <nav className={navbarClass}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-16">
          <div className="flex">
            <div className="flex-shrink-0 flex items-center">
              <Link to="/" className={`text-xl font-bold ${logoClass}`}>
                Digital Gardener
              </Link>
            </div>
            {/* <div className="hidden md:ml-6 md:flex md:space-x-8">
              <Link 
                to="/docs/intro" 
                className={`${linkClass} px-3 py-2 rounded-md text-sm font-medium`}
              >
                Documentation
              </Link>
            </div> */}
          </div>
          <div className="flex items-center">
            {(isBuilderPage || isDashboardPage) ? (
              <Link 
                to="/" 
                className="text-gray-600 hover:text-amber-600 px-3 py-2 rounded-md text-sm font-medium"
              >
                Home
              </Link>
            ) : (
              <button 
                onClick={handleLaunchAppClick}
                className="bg-white text-black hover:bg-amber-600 hover:text-white transition-colors px-3 py-2 rounded-md text-sm font-medium"
              >
                Launch App
              </button>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar; 