import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ThreeScene from '../ThreeScene';
import { ErrorBoundary } from '../ErrorBoundary';
import { useAuth } from '../../context/AuthContext';

export const Hero: React.FC = () => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();

  // Handle mouse movement for parallax effect
  const handleMouseMove = (e: React.MouseEvent) => {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = (e.clientY / window.innerHeight) * 2 - 1;
    setMousePos({ x, y });
  };

  // Smooth scroll to next section
  const scrollToLearnMore = () => {
    const nextSection = document.querySelector('section');
    if (nextSection) {
      window.scrollTo({
        top: nextSection.offsetTop,
        behavior: 'smooth'
      });
    }
  };

  // Handle Launch App click - login if needed, then go to dashboard
  const handleLaunchApp = () => {
    if (isAuthenticated) {
      navigate('/dashboard');
    } else {
      // Store redirect destination and trigger login
      sessionStorage.setItem('postLoginRedirect', '/dashboard');
      login();
    }
  };

  return (
    <div 
      className="relative min-h-screen overflow-hidden"
      onMouseMove={handleMouseMove}
    >
      {/* Right Section with 3D Scene */}
      <div className="absolute inset-0 lg:w-full z-0">
        {/* 3D Scene - wrapped in ErrorBoundary since Three.js can fail on some devices */}
        <ErrorBoundary fallback={<div className="w-full h-full bg-stone-950" />}>
          <ThreeScene mouseX={mousePos.x} mouseY={mousePos.y} />
        </ErrorBoundary>
      </div>

      {/* Content */}
      <div className="relative grid grid-cols-1 lg:grid-cols-2 min-h-screen z-10">
        {/* Left Section */}
        <div className="relative flex flex-col justify-center p-8 lg:p-16 z-20">
          <div className="absolute inset-0 bg-gradient-to-br from-stone-950/90 to-transparent transform -skew-x-12" />

          <div className="relative space-y-8">
            <div className="animate-fadeIn" style={{ animationDelay: "0.2s", opacity: 0 }}>
              <h1 className="text-5xl lg:text-7xl font-bold tracking-tighter mb-4">
                <span className="block text-white">Digital</span>
                <span className="block pb-4 text-amber-300">
                  Gardener
                </span>
              </h1>
              <p className="text-lg text-stone-400 max-w-md">
                Cultivate and curate your content garden with the power of artificial intelligence.
              </p>
            </div>

            <div className="flex flex-wrap gap-4 animate-fadeIn" style={{ animationDelay: "0.4s", opacity: 0 }}>
              {/* Try for Free Button - Primary CTA */}
              <button 
                onClick={handleLaunchApp}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-11 px-8 py-2 bg-amber-300 text-black hover:bg-amber-400"
              >
                Try for Free
              </button>

              <a 
                href="https://github.com/bozp-pzob/digital-gardener" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center bg-stone-900/90 justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-stone-800 h-11 px-8 py-2 hover:border-stone-700 text-white"
              >
                <span className="flex items-center gap-2">
                  Learn More
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                    <path d="M12 5v14"></path>
                    <path d="m19 12-7 7-7-7"></path>
                  </svg>
                </span>
              </a>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero; 