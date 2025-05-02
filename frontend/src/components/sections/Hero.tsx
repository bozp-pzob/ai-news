import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import ThreeScene from '../ThreeScene';

export const Hero: React.FC = () => {
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });

  // Handle mouse movement for parallax effect
  const handleMouseMove = (e: React.MouseEvent) => {
    const x = (e.clientX / window.innerWidth) * 2 - 1;
    const y = (e.clientY / window.innerHeight) * 2 - 1;
    setMousePos({ x, y });
  };

  // Smooth scroll to next section
  const scrollToNextSection = () => {
    const nextSection = document.querySelector('section');
    if (nextSection) {
      window.scrollTo({
        top: nextSection.offsetTop,
        behavior: 'smooth'
      });
    }
  };

  return (
    <div 
      className="relative min-h-screen overflow-hidden"
      onMouseMove={handleMouseMove}
    >
      {/* Right Section with 3D Scene */}
      <div className="absolute inset-0 lg:w-full z-0">
        {/* 3D Scene */}
        <ThreeScene mouseX={mousePos.x} mouseY={mousePos.y} />
      </div>

      {/* Content */}
      <div className="relative grid grid-cols-1 lg:grid-cols-2 min-h-screen z-10">
        {/* Left Section */}
        <div className="relative flex flex-col justify-center p-8 lg:p-16 z-20">
          <div className="absolute inset-0 bg-gradient-to-br from-stone-950/90 to-transparent transform -skew-x-12" />

          <div className="relative space-y-8">
            <div className="animate-fadeIn" style={{ animationDelay: "0.2s", opacity: 0 }}>
              <div className="inline-block px-4 py-1 mb-4 border border-stone-800 rounded-full">
                <span className="text-sm font-mono text-stone-400">v1.0.0 BETA</span>
              </div>
              <h1 className="text-5xl lg:text-7xl font-bold tracking-tighter mb-4">
                <span className="block text-white">AI-News</span>
                <span className="block pb-4 text-amber-300">
                  Aggregator
                </span>
              </h1>
              <p className="text-lg text-stone-400 max-w-md">
                Experience content aggregation reimagined through the lens of artificial intelligence.
              </p>
            </div>

            <div className="flex flex-wrap gap-4 animate-fadeIn" style={{ animationDelay: "0.4s", opacity: 0 }}>
              <button 
                onClick={scrollToNextSection}
                className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-11 px-8 py-2 bg-white text-black hover:bg-amber-300 hover:text-black relative group overflow-hidden"
              >
                <div className="absolute inset-0 from-amber-300 to-stone-700 translate-y-full group-hover:translate-y-0 transition-transform duration-300" />
                <span className="relative flex items-center gap-2">
                  Get Started
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 group-hover:translate-x-1 transition-transform">
                    <path d="M5 12h14"></path>
                    <path d="m12 5 7 7-7 7"></path>
                  </svg>
                </span>
              </button>

              <a 
                href="https://github.com/bozp-pzob/ai-news" 
                target="_blank" 
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 border border-stone-800 h-11 px-8 py-2 hover:border-stone-700 text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 mr-2">
                  <path d="M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65-.17.6-.22 1.23-.15 1.85v4"></path>
                  <path d="M9 18c-4.51 2-5-2-7-2"></path>
                </svg>
                <span>View Source</span>
              </a>
            </div>

            {/* Stats section - can be activated or replaced with another element */}
            <div 
              className="grid grid-cols-3 gap-8 pt-12 mt-12 border-t border-stone-800/50 animate-fadeIn" 
              style={{ animationDelay: "0.6s", opacity: 0 }}
            >
              {/* Empty stats section */}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Hero; 