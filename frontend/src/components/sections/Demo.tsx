import React, { useState } from 'react';
import { cn } from '../../utils/cn';

const sources = [
  { name: "Discord", delay: 1000 },
  { name: "GitHub", delay: 2000 },
  { name: "Twitter", delay: 3000 },
  { name: "Market Data", delay: 2500 }
];

// Example summary data
const exampleSummary = {
  title: "Daily Briefing — Feb 1, 2025",
  highlights: [
    {
      title: "Market Overview",
      content: "Bitcoin at $101,327 with 24h volume of $25.4B. Ethereum at $3,155 with volume of $18.6B. Solana trading at $218.05."
    },
    {
      title: "Development Updates",
      content: "12 pull requests merged including trading signals plugin and Google Vertex AI integration. Enhanced Starknet plugin with improved token provider."
    },
    {
      title: "Community Highlights",
      content: "Active participation in AI hackathons with prize pools totaling $500k. 3 new partnership announcements across Discord channels."
    }
  ]
};

// Step icons
const ConnectIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
  </svg>
);

const ProcessIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
    <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z"></path>
    <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96.44 2.5 2.5 0 0 0 2.96-3.08 3 3 0 0 0 .34-5.58 2.5 2.5 0 0 0-1.32-4.24 2.5 2.5 0 0 0-1.98-3A2.5 2.5 0 0 0 14.5 2Z"></path>
  </svg>
);

const DeliverIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8">
    <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="16" x2="8" y1="13" y2="13"></line>
    <line x1="16" x2="8" y1="17" y2="17"></line>
    <line x1="10" x2="8" y1="9" y2="9"></line>
  </svg>
);

// Simplified Check icon
const CheckIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 text-green-500">
    <polyline points="20 6 9 17 4 12"></polyline>
  </svg>
);

// Simplified Play icon
const PlayIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
    <polygon points="5 3 19 12 5 21 5 3"></polygon>
  </svg>
);

// Simplified Loader icon
const LoaderIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4 animate-spin text-amber-300">
    <path d="M21 12a9 9 0 1 1-6.219-8.56"></path>
  </svg>
);

const steps = [
  {
    number: "01",
    title: "Connect Your Sources",
    description: "Link your Discord servers, GitHub repositories, Twitter accounts, Telegram groups, and market data feeds.",
    icon: ConnectIcon
  },
  {
    number: "02",
    title: "AI Processes & Enriches",
    description: "Our pipeline aggregates content across all your channels, identifies key topics, and structures the data.",
    icon: ProcessIcon
  },
  {
    number: "03",
    title: "Get Daily Briefings",
    description: "Receive comprehensive summaries — ready to share with your team, community, or stakeholders.",
    icon: DeliverIcon
  }
];

export const Demo: React.FC = () => {
  const [isAnimating, setIsAnimating] = useState(false);
  const [currentSource, setCurrentSource] = useState<number>(-1);
  const [completedSources, setCompletedSources] = useState<number[]>([]);
  const [showSummary, setShowSummary] = useState(false);

  const startDemo = async () => {
    setIsAnimating(true);
    setCurrentSource(0);
    setCompletedSources([]);
    setShowSummary(false);

    // Simulate fetching from each source
    for (let i = 0; i < sources.length; i++) {
      setCurrentSource(i);
      await new Promise(resolve => setTimeout(resolve, sources[i].delay));
      setCompletedSources(prev => [...prev, i]);
    }

    // Complete the demo and show summary
    setTimeout(() => {
      setCurrentSource(-1);
      setShowSummary(true);
      setIsAnimating(false);
    }, 1000);
  };

  return (
    <section className="py-20 relative overflow-hidden">
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white bg-clip-text" style={{ WebkitBackgroundClip: 'text' }}>
              How It Works
            </h2>
            <p className="text-gray-400 mt-2">
              Three steps from scattered channels to actionable intelligence
            </p>
          </div>

          {/* 3-Step Walkthrough */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-16">
            {steps.map((step, index) => (
              <div
                key={step.number}
                className="animate-fadeIn"
                style={{
                  animationDelay: `${index * 0.15 + 0.2}s`,
                  opacity: 0
                }}
              >
                <div className="h-full rounded-lg border border-stone-800 bg-stone-900/70 backdrop-blur-sm p-6 hover:border-amber-300/50 transition-all duration-300 group text-center">
                  <div className="text-amber-300 flex justify-center mb-4">
                    <step.icon />
                  </div>
                  <div className="text-xs font-mono text-stone-600 mb-2">{step.number}</div>
                  <h3 className="text-lg font-semibold text-white mb-2 group-hover:text-amber-300 transition-colors">
                    {step.title}
                  </h3>
                  <p className="text-sm text-stone-400">
                    {step.description}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Interactive Demo */}
          <div className="space-y-8">
            <div className="text-center">
              <h3 className="text-xl font-semibold text-white mb-2">See it in action</h3>
              <p className="text-sm text-stone-400 mb-6">Watch the aggregation pipeline process sources in real time</p>
            </div>

            <div className="flex flex-col items-center gap-6">
              <button 
                onClick={startDemo} 
                disabled={isAnimating}
                className="inline-flex items-center justify-center h-11 px-8 py-2 bg-amber-300 hover:bg-amber-400 text-gray-900 font-medium rounded-md transition-colors disabled:opacity-50"
              >
                <span className="flex items-center gap-2">
                  <PlayIcon />
                  Run Demo
                </span>
              </button>

              <div className="w-full max-w-md space-y-4">
                {sources.map((source, index) => (
                  <div 
                    key={source.name}
                    className={cn(
                      'flex items-center justify-between p-4 rounded-lg transition-colors duration-300',
                      currentSource === index 
                        ? 'bg-amber-300/10 border border-amber-300/20' 
                        : 'bg-stone-600/90'
                    )}
                    style={{ 
                      opacity: currentSource >= index || completedSources.includes(index) ? 1 : 0.5
                    }}
                  >
                    <span className="text-sm font-medium text-white">{source.name}</span>
                    <div className="flex items-center gap-2">
                      {currentSource === index && <LoaderIcon />}
                      {completedSources.includes(index) && <CheckIcon />}
                    </div>
                  </div>
                ))}
              </div>

              <div className="w-full h-2 bg-stone-600/30 rounded-full overflow-hidden">
                <div 
                  className="h-full bg-gradient-to-r from-amber-300 via-yellow-300 to-orange-300"
                  style={{ 
                    width: isAnimating 
                      ? `${((completedSources.length) / sources.length) * 100}%` 
                      : "0%",
                    transition: "width 0.3s ease-out"
                  }}
                />
              </div>

              <p className="text-sm text-gray-400">
                {isAnimating 
                  ? currentSource >= 0 
                    ? `Aggregating data from ${sources[currentSource].name}...` 
                    : "Processing complete!"
                  : "Click to see the aggregation pipeline in action"}
              </p>

              {showSummary && (
                <div 
                  className="w-full mt-8 animate-fadeIn"
                  style={{ 
                    opacity: 0,
                    animation: "fadeIn 0.5s forwards",
                    animationDelay: "0.2s"
                  }}
                >
                  <div className="backdrop-blur-sm bg-stone-900/80 rounded-lg">
                    <div className="p-6">
                      <h3 className="text-xl font-semibold mb-6 text-amber-300" style={{ WebkitBackgroundClip: 'text' }}>
                        {exampleSummary.title}
                      </h3>
                      <div className="space-y-6">
                        {exampleSummary.highlights.map((highlight, index) => (
                          <div 
                            key={index}
                            className="space-y-2"
                          >
                            <h4 className="font-medium text-amber-300">{highlight.title}</h4>
                            <p className="text-sm text-gray-400 leading-relaxed">{highlight.content}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Demo;
