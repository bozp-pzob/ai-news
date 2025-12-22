import React from 'react';

// Simplified version of the icon components
const Brain = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 mb-4">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"></path>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"></path>
  </svg>
);

const RefreshCw = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 mb-4">
    <path d="M3 12a9 9 0 0 1 9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"></path>
    <path d="M21 3v5h-5"></path>
    <path d="M21 12a9 9 0 0 1-9 9 9.75 9.75 0 0 1-6.74-2.74L3 16"></path>
    <path d="M3 21v-5h5"></path>
  </svg>
);

const FileText = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 mb-4">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" x2="8" y1="13" y2="13"></line>
    <line x1="16" x2="8" y1="17" y2="17"></line>
    <line x1="10" x2="8" y1="9" y2="9"></line>
  </svg>
);

const Database = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 mb-4">
    <ellipse cx="12" cy="5" rx="9" ry="3"></ellipse>
    <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path>
    <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path>
  </svg>
);

export const Features: React.FC = () => {
  const features = [
    {
      title: "Smart Aggregation",
      description: "Automatically collect and organize news from multiple sources using advanced AI algorithms.",
      icon: Brain
    },
    {
      title: "Real-time Updates",
      description: "Stay up-to-date with continuous data synchronization and instant updates.",
      icon: RefreshCw
    },
    {
      title: "Intelligent Summaries",
      description: "Get AI-generated daily summaries of the most important updates and developments.",
      icon: FileText
    },
    {
      title: "Structured Data",
      description: "Access well-organized data perfect for both human readers and AI agents.",
      icon: Database
    }
  ];

  return (
    <section className="py-20 relative">
      {/* Removed background gradient */}
      
      {/* Removed grid overlay */}
      
      <div className="container mx-auto px-4 relative">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white" style={{ WebkitBackgroundClip: 'text' }}>
            Key Features
          </h2>
          <p className="text-stone-400 max-w-2xl mx-auto">
            Our platform combines state-of-the-art AI with powerful data aggregation tools
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {features.map((feature, index) => (
            <div 
              key={index}
              className="animate-fadeIn"
              style={{ 
                animationDelay: `${index * 0.1 + 0.2}s`,
                opacity: 0
              }}
            >
              <div className="h-full rounded-lg border border-stone-800 bg-stone-900/70 shadow-lg backdrop-blur-sm p-6 hover:border-amber-300/50 transition-all duration-300 group">
                <div className="flex flex-col space-y-1.5">
                  <div className="text-amber-300">
                    <feature.icon />
                  </div>
                  <h3 className="text-2xl font-semibold leading-none tracking-tight text-white group-hover:text-amber-300 transition-colors">
                    {feature.title}
                  </h3>
                </div>
                <div className="p-6 pt-4">
                  <p className="text-stone-400">
                    {feature.description}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
};

export default Features; 