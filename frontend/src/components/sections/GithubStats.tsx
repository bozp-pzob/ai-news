import React from 'react';

// Source types icon (link/chain)
const SourcesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-amber-400 mx-auto mb-4">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
  </svg>
);

// Platforms icon (grid)
const PlatformsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-amber-400 mx-auto mb-4">
    <rect width="7" height="7" x="3" y="3" rx="1"></rect>
    <rect width="7" height="7" x="14" y="3" rx="1"></rect>
    <rect width="7" height="7" x="14" y="14" rx="1"></rect>
    <rect width="7" height="7" x="3" y="14" rx="1"></rect>
  </svg>
);

// Summaries icon (file-text)
const SummariesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-amber-400 mx-auto mb-4">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" x2="8" y1="13" y2="13"></line>
    <line x1="16" x2="8" y1="17" y2="17"></line>
    <line x1="10" x2="8" y1="9" y2="9"></line>
  </svg>
);

// Simplified Card component
const Card = ({ children, delay }: { children: React.ReactNode, delay: number }) => (
  <div 
    className="bg-stone-900/70 border border-stone-800 rounded-lg shadow-lg backdrop-blur-sm hover:border-amber-300/50 transition-all duration-300 animate-fadeIn"
    style={{ animationDelay: `${delay}s`, opacity: 0 }}
  >
    <div className="pt-6 p-6 text-center">
      {children}
    </div>
  </div>
);

export const GithubStats: React.FC = () => {
  return (
    <section className="py-20 relative overflow-hidden">
      <div className="container px-4 mx-auto relative">
        <div className="text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white inline-block" style={{ WebkitBackgroundClip: 'text' }}>
            By the Numbers
          </h2>
          <p className="text-stone-400 max-w-2xl mx-auto mb-12">
            Built to scale with your organization
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <Card delay={0.2}>
              <SourcesIcon />
              <div className="text-3xl font-bold text-white">13+</div>
              <div className="text-stone-400">Source Types</div>
            </Card>

            <Card delay={0.3}>
              <PlatformsIcon />
              <div className="text-3xl font-bold text-white">5</div>
              <div className="text-stone-400">Platforms Integrated</div>
            </Card>

            <Card delay={0.4}>
              <SummariesIcon />
              <div className="text-3xl font-bold text-white">1,000s</div>
              <div className="text-stone-400">Summaries Generated</div>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
};

export default GithubStats;
