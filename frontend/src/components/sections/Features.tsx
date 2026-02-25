import React from 'react';

// Seedling / sprout icon
const SproutIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 mb-4">
    <path d="M7 20h10"></path>
    <path d="M12 20v-8"></path>
    <path d="M12 12c-3.5 0-6-2.5-6-6 3.5 0 6 2.5 6 6Z"></path>
    <path d="M12 12c3.5 0 6-2.5 6-6-3.5 0-6 2.5-6 6Z"></path>
  </svg>
);

// Sparkles icon (AI cultivating)
const SparklesIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 mb-4">
    <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"></path>
    <path d="M5 3v4"></path>
    <path d="M19 17v4"></path>
    <path d="M3 5h4"></path>
    <path d="M17 19h4"></path>
  </svg>
);

// Bar chart icon (harvest insights)
const ChartIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 mb-4">
    <line x1="12" x2="12" y1="20" y2="10"></line>
    <line x1="18" x2="18" y1="20" y2="4"></line>
    <line x1="6" x2="6" y1="20" y2="14"></line>
  </svg>
);

// Share network icon (share the bounty)
const ShareIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-10 h-10 mb-4">
    <circle cx="18" cy="5" r="3"></circle>
    <circle cx="6" cy="12" r="3"></circle>
    <circle cx="18" cy="19" r="3"></circle>
    <line x1="8.59" x2="15.42" y1="13.51" y2="17.49"></line>
    <line x1="15.41" x2="8.59" y1="6.51" y2="10.49"></line>
  </svg>
);

export const Features: React.FC = () => {
  const features = [
    {
      step: "01",
      title: "Plant Your Seeds",
      description: "Sow data from Discord, GitHub, Twitter, Telegram, and market feeds into your garden beds.",
      icon: SproutIcon
    },
    {
      step: "02",
      title: "Tend & Cultivate",
      description: "AI-powered pipelines water, weed, and fertilize your content on a daily or custom schedule.",
      icon: SparklesIcon
    },
    {
      step: "03",
      title: "Harvest Your Insights",
      description: "Gather ripe, actionable summaries your team, community, or stakeholders can act on immediately.",
      icon: ChartIcon
    },
    {
      step: "04",
      title: "Share the Bounty",
      description: "Sell structured insights and curated data to other teams, AI agents, or third parties through APIs and exports.",
      icon: ShareIcon
    }
  ];

  return (
    <section className="py-20 relative bg-stone-50">
      <div className="container mx-auto px-4 relative">
        {/* Section header */}
        <div className="text-center mb-16">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-stone-800">
            Tend Your Garden
          </h2>
          <p className="text-stone-500 max-w-2xl mx-auto">
            From scattered seeds to a flourishing harvest of intelligence
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
              <div className="h-full rounded-lg border border-stone-200 bg-white shadow-sm p-6 hover:border-emerald-500/50 hover:shadow-md transition-all duration-300 group">
                <div className="flex flex-col space-y-1.5">
                  <div className="text-xs font-mono text-stone-300 mb-1">{feature.step}</div>
                  <div className="text-emerald-600">
                    <feature.icon />
                  </div>
                  <h3 className="text-2xl font-semibold leading-none tracking-tight text-stone-800 group-hover:text-emerald-600 transition-colors">
                    {feature.title}
                  </h3>
                </div>
                <div className="p-6 pt-4">
                  <p className="text-stone-500">
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
