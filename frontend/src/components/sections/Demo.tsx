import React, { useState, useEffect } from 'react';
import { cn } from '../../lib/utils';
import Prism from 'prismjs';
import 'prismjs/components/prism-javascript';
import 'prismjs/components/prism-typescript';
import 'prismjs/components/prism-jsx';
import 'prismjs/components/prism-tsx';
import 'prismjs/themes/prism-tomorrow.css';

const aggregatorCode = `// Content Aggregator Setup
const aggregator = new ContentAggregator();

// Configure Data Sources
const sources = [
  new RSSSource({
    name: "rss",
  }),
  new GitHubDataSource({
    name: "github_data",
    githubCompany: "organization",
    githubRepo: "project"
  }),
  new DiscordChannelSource({
    name: "discord",
    channelIds: ["channel_id"]
  }),
  new CoinGeckoMarketAnalyticsSource({
    name: "market_data",
    tokenSymbols: ['bitcoin', 'ethereum', 'solana']
  })
];

// Register Sources and Enrichers
sources.forEach((source) => aggregator.registerSource(source));

aggregator.registerEnricher(
  new AiTopicsEnricher({
    provider: openAiProvider,
    thresholdLength: 30
  })
);

// Fetch and Process Data
const items = await aggregator.fetchSource("rss");
await storage.save(items);

// Generate Daily Summary
const summary = await summaryGenerator.generateAndStoreSummary(dateStr);`;

const sources = [
  { name: "RSSSource", delay: 1000 },
  { name: "GitHub", delay: 2000 },
  { name: "Discord", delay: 3000 },
  { name: "Market Data", delay: 2500 }
];

// Example summary data
const exampleSummary = {
  title: "Daily Summary for 2025-02-01",
  highlights: [
    {
      title: "Crypto Market Overview",
      content: "Bitcoin at $101,327 with 24h volume of $25.4B. Ethereum at $3,155 with volume of $18.6B. Solana trading at $218.05."
    },
    {
      title: "Development Updates",
      content: "Multiple pull requests including trading signals plugin and Google Vertex AI integration. Enhanced Starknet plugin with improved token provider implementation."
    },
    {
      title: "Community Activity",
      content: "Active participation in AI hackathons with prize pools totaling $500k across Safe Agentathon, Sozu Hack, and other events."
    }
  ]
};

// Enhanced CodeBlock component with syntax highlighting
const CodeBlock = ({ code }: { code: string }) => {
  useEffect(() => {
    Prism.highlightAll();
  }, [code]);

  return (
    <div className="overflow-x-auto bg-stone-900 rounded-lg">
      <pre className="p-4 !m-0 bg-transparent text-sm font-mono whitespace-pre-wrap code-block">
        <code className="language-javascript">{code}</code>
      </pre>
    </div>
  );
};

// Custom styles for code highlighting
const codeBlockStyles = `
  .code-block .token.comment,
  .code-block .token.prolog,
  .code-block .token.doctype,
  .code-block .token.cdata {
    color: #6c7086;
  }
  
  .code-block .token.punctuation {
    color: #cdd6f4;
  }
  
  .code-block .token.namespace {
    opacity: 0.7;
  }
  
  .code-block .token.property,
  .code-block .token.tag,
  .code-block .token.constant,
  .code-block .token.symbol,
  .code-block .token.deleted {
    color: #f38ba8;
  }
  
  .code-block .token.boolean,
  .code-block .token.number {
    color: #fab387;
  }
  
  .code-block .token.selector,
  .code-block .token.attr-name,
  .code-block .token.string,
  .code-block .token.char,
  .code-block .token.builtin,
  .code-block .token.inserted {
    color: #a6e3a1;
  }
  
  .code-block .token.operator,
  .code-block .token.entity,
  .code-block .token.url,
  .code-block .language-css .token.string,
  .code-block .style .token.string {
    color: #f5c2e7;
  }
  
  .code-block .token.atrule,
  .code-block .token.attr-value,
  .code-block .token.keyword {
    color: #89b4fa;
  }
  
  .code-block .token.function,
  .code-block .token.class-name {
    color: #94e2d5;
  }
  
  .code-block .token.regex,
  .code-block .token.important,
  .code-block .token.variable {
    color: #f9e2af;
  }
`;

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
      {/* Custom styles for code highlighting */}
      <style>{codeBlockStyles}</style>
      
      <div className="container mx-auto px-4">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-white bg-clip-text" style={{ WebkitBackgroundClip: 'text' }}>
              How It Works
            </h2>
            <p className="text-gray-400 mt-2">
              Our intelligent aggregator collects and processes data from multiple sources in real-time
            </p>
          </div>

          <div className="space-y-8">
            <div className="backdrop-blur-sm bg-stone-900/80 rounded-lg">
              <CodeBlock code={aggregatorCode} />
            </div>

            <div className="flex flex-col items-center gap-6">
              <button 
                onClick={startDemo} 
                disabled={isAnimating}
                className="inline-flex items-center justify-center h-11 px-8 py-2 bg-amber-300 hover:bg-amber-300 text-gray-900 font-medium rounded-md transition-colors"
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
                  : "Click to see the aggregation process"}
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