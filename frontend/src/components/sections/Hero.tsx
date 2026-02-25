import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ThreeScene from '../ThreeScene';
import { ErrorBoundary } from '../ErrorBoundary';
import { useAuth } from '../../context/AuthContext';

export const Hero: React.FC = () => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const { isAuthenticated, login } = useAuth();
  const navigate = useNavigate();

  const handleMouseMove = (e: React.MouseEvent) => {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = (e.clientY / window.innerHeight) * 2 - 1;
    setMousePos({ x, y });
  };

  const handleLaunchApp = () => {
    if (isAuthenticated) {
      navigate('/dashboard');
    } else {
      sessionStorage.setItem('postLoginRedirect', '/dashboard');
      login();
    }
  };

  return (
    <div 
      className="relative min-h-screen overflow-hidden"
      onMouseMove={handleMouseMove}
    >
      {/* Garden Scene Background — full bleed */}
      <div className="absolute inset-0 z-0">
        <ErrorBoundary fallback={<div className="w-full h-full bg-stone-50" />}>
          <ThreeScene mouseX={mousePos.x} mouseY={mousePos.y} />
        </ErrorBoundary>
      </div>

      {/* Content overlay */}
      <div className="relative flex items-center min-h-screen z-10">
        <div className="w-full max-w-7xl mx-auto px-6 sm:px-8 lg:px-16">
          <div className="relative max-w-xl">
            {/* Readability scrim — soft frosted panel */}
            <div className="absolute -inset-8 -z-10 rounded-3xl bg-white/70 backdrop-blur-sm" />

            {/* Headline */}
            <div className="animate-fadeIn" style={{ animationDelay: '0.2s', opacity: 0 }}>
              <h1 className="text-5xl sm:text-6xl lg:text-7xl font-extrabold tracking-tight leading-[1.08] mb-5">
                <span className="block text-stone-800">Digital</span>
                <span className="block bg-gradient-to-r from-emerald-600 via-emerald-500 to-teal-500 bg-clip-text text-transparent">
                  Gardener
                </span>
              </h1>
            </div>

            {/* Subheadline */}
            <div className="animate-fadeIn" style={{ animationDelay: '0.4s', opacity: 0 }}>
              <p className="text-lg sm:text-xl text-stone-600 leading-relaxed max-w-md mb-8">
                Plant the seeds of your data, tend them with AI, and harvest insights that grow your community.
              </p>
            </div>

            {/* CTAs */}
            <div className="flex flex-wrap gap-4 animate-fadeIn" style={{ animationDelay: '0.55s', opacity: 0 }}>
              <button 
                onClick={handleLaunchApp}
                className="group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-base font-semibold h-12 px-8 bg-emerald-600 text-white hover:bg-emerald-700 shadow-lg shadow-emerald-600/25 hover:shadow-emerald-600/40 transition-all duration-200 hover:-translate-y-0.5"
              >
                Get Started Free
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 transition-transform group-hover:translate-x-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12h14" /><path d="m12 5 7 7-7 7" />
                </svg>
              </button>

              <button
                onClick={() => {
                  const nextSection = document.querySelector('section');
                  if (nextSection) {
                    window.scrollTo({ top: nextSection.offsetTop, behavior: 'smooth' });
                  }
                }}
                className="group inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl text-base font-semibold h-12 px-8 border border-stone-300 bg-white/80 hover:bg-white text-stone-700 hover:text-stone-900 hover:border-stone-400 shadow-sm hover:shadow transition-all duration-200 hover:-translate-y-0.5"
              >
                Learn More
                <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 transition-transform group-hover:translate-y-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 5v14" /><path d="m19 12-7 7-7-7" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>

    </div>
  );
};

export default Hero;
