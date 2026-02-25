import React from 'react';

// Source types icon (seedling/sprout)
const SourcesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-emerald-600 mx-auto mb-4">
    <path d="M7 20h10"></path>
    <path d="M12 20v-8"></path>
    <path d="M12 12c-3.5 0-6-2.5-6-6 3.5 0 6 2.5 6 6Z"></path>
    <path d="M12 12c3.5 0 6-2.5 6-6-3.5 0-6 2.5-6 6Z"></path>
  </svg>
);

// Platforms icon (grid)
const PlatformsIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-emerald-600 mx-auto mb-4">
    <rect width="7" height="7" x="3" y="3" rx="1"></rect>
    <rect width="7" height="7" x="14" y="3" rx="1"></rect>
    <rect width="7" height="7" x="14" y="14" rx="1"></rect>
    <rect width="7" height="7" x="3" y="14" rx="1"></rect>
  </svg>
);

// Summaries icon (file-text)
const SummariesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-emerald-600 mx-auto mb-4">
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
    className="bg-white border border-stone-200 rounded-lg shadow-sm hover:border-emerald-500/50 hover:shadow-md transition-all duration-300 animate-fadeIn"
    style={{ animationDelay: `${delay}s`, opacity: 0 }}
  >
    <div className="pt-6 p-6 text-center">
      {children}
    </div>
  </div>
);

export const GithubStats: React.FC = () => {
  return (
    <section className="py-20 relative overflow-hidden bg-stone-50">
      <div className="container px-4 mx-auto relative">
        <div className="text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-stone-800 inline-block">
            Garden Vitals
          </h2>
          <p className="text-stone-500 max-w-2xl mx-auto mb-12">
            A thriving ecosystem that grows with your organization
          </p>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
            <Card delay={0.2}>
              <SourcesIcon />
              <div className="text-3xl font-bold text-stone-800">13+</div>
              <div className="text-stone-500">Source Types</div>
            </Card>

            <Card delay={0.3}>
              <PlatformsIcon />
              <div className="text-3xl font-bold text-stone-800">5</div>
              <div className="text-stone-500">Platforms Integrated</div>
            </Card>

            <Card delay={0.4}>
              <SummariesIcon />
              <div className="text-3xl font-bold text-stone-800">1,000s</div>
              <div className="text-stone-500">Summaries Generated</div>
            </Card>
          </div>
        </div>
      </div>
    </section>
  );
};

export default GithubStats;
