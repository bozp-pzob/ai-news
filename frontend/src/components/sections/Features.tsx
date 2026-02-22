import React from 'react';

// Connect / link icon
const ConnectIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 mb-4">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
  </svg>
);

// Brain / AI icon
const Brain = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 mb-4">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"></path>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"></path>
  </svg>
);

// File / briefing icon
const FileText = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 mb-4">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" x2="8" y1="13" y2="13"></line>
    <line x1="16" x2="8" y1="17" y2="17"></line>
    <line x1="10" x2="8" y1="9" y2="9"></line>
  </svg>
);

// Monetize / currency icon
const DollarSign = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 mb-4">
    <line x1="12" x2="12" y1="2" y2="22"></line>
    <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"></path>
  </svg>
);

export const Features: React.FC = () => {
  const features = [
    {
      step: "01",
      title: "Connect Your Sources",
      description: "Link Discord servers, GitHub repos, Twitter feeds, Telegram groups, and market data in one place.",
      icon: ConnectIcon
    },
    {
      step: "02",
      title: "AI Processes & Enriches",
      description: "Automated pipelines fetch, structure, and enrich your content on a daily or custom schedule.",
      icon: Brain
    },
    {
      step: "03",
      title: "Get Daily Briefings",
      description: "Receive concise, actionable summaries your team, community, or stakeholders can act on immediately.",
      icon: FileText
    },
    {
      step: "04",
      title: "Monetize Your Data",
      description: "Sell structured summaries and insights to other teams, AI agents, or third parties through APIs and exports.",
      icon: DollarSign
    }
  ];

  return (
    <section className="py-20 relative">
      <div className="container mx-auto px-4 relative">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white" style={{ WebkitBackgroundClip: 'text' }}>
            How It Works
          </h2>
          <p className="text-stone-400 max-w-2xl mx-auto">
            From scattered channels to structured intelligence you can use — or sell
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
                  <div className="text-xs font-mono text-stone-600 mb-1">{feature.step}</div>
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
