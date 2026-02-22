import React, { useState, useEffect } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { fetchGitHubStats } from '../utils/github';

const REPO_OWNER = 'bozp-pzob';
const REPO_NAME = 'ai-news';

const Navbar: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isAuthenticated, login } = useAuth();
  const [stars, setStars] = useState<number | null>(null);
  
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

  // Fetch GitHub stars on mount
  useEffect(() => {
    fetchGitHubStats(REPO_OWNER, REPO_NAME)
      .then(data => setStars(data.stars))
      .catch(() => setStars(null));
  }, []);

  // Handle Launch App click - login if needed, then go to dashboard
  const handleLaunchAppClick = () => {
    if (isAuthenticated) {
      navigate('/dashboard');
    } else {
      sessionStorage.setItem('postLoginRedirect', '/dashboard');
      login();
    }
  };

  const formatStars = (count: number): string => {
    if (count >= 1000) {
      return `${(count / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    }
    return count.toString();
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
          </div>
          <div className="flex items-center gap-3">
            {/* GitHub Stars Button — visible on landing page */}
            {isLandingPage && (
              <a
                href={`https://github.com/${REPO_OWNER}/${REPO_NAME}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm font-medium border border-stone-700 text-stone-300 hover:border-stone-500 hover:text-white transition-colors"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path>
                  <path d="M9 18c-4.51 2-5-2-7-2"></path>
                </svg>
                {stars !== null && (
                  <>
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="none" className="text-yellow-500">
                      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
                    </svg>
                    <span>{formatStars(stars)}</span>
                  </>
                )}
                {stars === null && <span>GitHub</span>}
              </a>
            )}

            {(isBuilderPage || isDashboardPage) ? (
              <Link 
                to="/" 
                className="text-gray-600 hover:text-amber-600 px-3 py-2 rounded-md text-sm font-medium"
              >
                Home
              </Link>
            ) : (
              <>
                <Link
                  to="/explore"
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isLandingPage 
                      ? 'text-stone-400 hover:text-white' 
                      : 'text-gray-600 hover:text-amber-600'
                  }`}
                >
                  Explore
                </Link>
                <Link
                  to="/builder"
                  className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors ${
                    isLandingPage 
                      ? 'text-stone-400 hover:text-white' 
                      : 'text-gray-600 hover:text-amber-600'
                  }`}
                >
                  Builder
                </Link>
                <button 
                  onClick={handleLaunchAppClick}
                  className="bg-white text-black hover:bg-amber-600 hover:text-white transition-colors px-3 py-1.5 rounded-md text-sm font-medium"
                >
                  Login
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </nav>
  );
};

export default Navbar;
