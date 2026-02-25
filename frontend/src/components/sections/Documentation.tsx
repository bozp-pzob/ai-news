import React from 'react';
import { Link } from 'react-router-dom';

const Documentation: React.FC = () => {
  return (
    <section className="py-24 px-6 bg-stone-50 relative overflow-hidden">
      <div className="container mx-auto relative z-10">
        <div className="max-w-4xl mx-auto text-center mb-16 animate-fadeIn" style={{ animationDelay: '0.1s', opacity: 0 }}>
          <h2 className="text-4xl md:text-5xl font-bold mb-6 text-stone-800">
            Comprehensive Documentation
          </h2>
          <p className="text-xl mb-8 max-w-2xl mx-auto text-stone-500">
            Everything you need to know about setting up, configuring, and extending Digital Gardener.
          </p>
        </div>
        
        <div className="grid md:grid-cols-3 gap-8 max-w-5xl mx-auto">
          <div className="bg-white rounded-lg p-6 shadow-sm border border-stone-200 hover:border-emerald-500/50 transition-all hover:-translate-y-1">
            <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path>
                <polyline points="9 22 9 12 15 12 15 22"></polyline>
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-stone-800">Getting Started</h3>
            <p className="text-stone-500 mb-4">Learn how to install, configure and run Digital Gardener on your machine.</p>
            <Link to="/docs/intro" className="text-emerald-600 flex items-center gap-1 hover:underline font-medium">
              Read Guide
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="m9 18 6-6-6-6"></path>
              </svg>
            </Link>
          </div>
          
          <div className="bg-white rounded-lg p-6 shadow-sm border border-stone-200 hover:border-emerald-500/50 transition-all hover:-translate-y-1">
            <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"></path>
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-stone-800">Configuration</h3>
            <p className="text-stone-500 mb-4">Explore configuration options for sources, AI processors, and storage.</p>
            <Link to="/docs/intro" className="text-emerald-600 flex items-center gap-1 hover:underline font-medium">
              View Options
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="m9 18 6-6-6-6"></path>
              </svg>
            </Link>
          </div>
          
          <div className="bg-white rounded-lg p-6 shadow-sm border border-stone-200 hover:border-emerald-500/50 transition-all hover:-translate-y-1">
            <div className="w-12 h-12 bg-emerald-100 rounded-lg flex items-center justify-center mb-4">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-emerald-600">
                <path d="M12 9v6"></path>
                <path d="M15 12H9"></path>
                <rect width="18" height="18" x="3" y="3" rx="2"></rect>
              </svg>
            </div>
            <h3 className="text-xl font-semibold mb-2 text-stone-800">Extending</h3>
            <p className="text-stone-500 mb-4">Learn how to create custom plugins and extend functionality.</p>
            <Link to="/docs/intro" className="text-emerald-600 flex items-center gap-1 hover:underline font-medium">
              Explore APIs
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="m9 18 6-6-6-6"></path>
              </svg>
            </Link>
          </div>
        </div>
        
        <div className="text-center mt-12">
          <Link 
            to="/docs/intro" 
            className="inline-flex items-center justify-center whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 h-12 px-10 py-2 border border-emerald-600/30 bg-white text-emerald-700 hover:bg-emerald-50"
          >
            <span className="flex items-center gap-2">
              Browse Full Documentation
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                <path d="m9 18 6-6-6-6"></path>
              </svg>
            </span>
          </Link>
        </div>
      </div>
    </section>
  );
};

export default Documentation;
