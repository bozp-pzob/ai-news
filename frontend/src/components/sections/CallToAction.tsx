import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

export const CallToAction: React.FC = () => {
  const navigate = useNavigate();
  const { isAuthenticated, login } = useAuth();

  // Handle Launch App click - login if needed, then go to dashboard
  const handleLaunchAppClick = () => {
    if (isAuthenticated) {
      navigate('/dashboard');
    } else {
      // Store redirect destination and trigger login
      sessionStorage.setItem('postLoginRedirect', '/dashboard');
      login();
    }
  };

  return (
    <section className="py-24 px-6 text-center relative overflow-hidden">
      {/* Removed background effects */}
      
      {/* Removed radial gradient */}
      
      {/* Removed animated grid */}
      
      <div className="container mx-auto relative z-10">
        <div className="max-w-4xl mx-auto relative z-10 animate-fadeIn" style={{ animationDelay: '0.2s', opacity: 0 }}>
          <h2 className="text-4xl md:text-5xl font-bold mb-6 text-amber-300" style={{ WebkitBackgroundClip: 'text' }}>
            Ready to cut through the noise?
          </h2>
          <p className="text-xl mb-10 max-w-2xl mx-auto text-stone-400">
            Try Digital Gardener today and let AI help you cultivate, curate, and grow your content.
          </p>
          
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <button 
              onClick={handleLaunchAppClick}
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-12 px-10 py-2 relative group overflow-hidden bg-amber-300 text-black hover:bg-amber-400"
            >
              <span className="relative flex items-center gap-2 font-medium">
                Launch App
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 group-hover:translate-x-1 transition-transform">
                  <path d="M5 12h14"></path>
                  <path d="m12 5 7 7-7 7"></path>
                </svg>
              </span>
            </button>
            
            <a 
              href="https://github.com/bozp-pzob/digital-gardener" 
              target="_blank" 
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-12 px-10 py-2 border border-amber-300/30 bg-transparent text-white hover:bg-amber-300/10"
            >
              <span className="flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                  <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path>
                  <path d="M9 18c-4.51 2-5-2-7-2"></path>
                </svg>
                View on GitHub
              </span>
            </a>
          </div>
        </div>
      </div>
    </section>
  );
};

export default CallToAction; 