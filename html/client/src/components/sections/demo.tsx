import { motion } from "framer-motion";
import { fadeIn } from "@/lib/animations";
import { CodeBlock } from "@/components/code-block";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { Play, Check, Loader2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";

const aggregatorCode = `// Content Aggregator Setup
const aggregator = new ContentAggregator();

// Configure Data Sources
const sources = [
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
const items = await aggregator.fetchSource("github_data");
await storage.save(items);

// Generate Daily Summary
const summary = await summaryGenerator.generateAndStoreSummary(dateStr);`;

const sources = [
  { name: "GitHub", delay: 2000 },
  { name: "Discord", delay: 3000 },
  { name: "Market Data", delay: 2500 }
];

// Example summary data based on the provided JSON
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

export function Demo() {
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
      {/* Iridescent background effect */}
      <div 
        className="absolute inset-0 opacity-10"
        style={{
          background: `
            radial-gradient(circle at 50% 50%, 
              rgba(138, 43, 226, 0.2), 
              rgba(0, 255, 255, 0.2),
              rgba(255, 0, 255, 0.2)
            )
          `,
          filter: "blur(100px)",
          transform: "scale(1.2)"
        }}
      />

      {/* Holographic grid pattern */}
      <div 
        className="absolute inset-0 opacity-5"
        style={{
          backgroundImage: `
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(0deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '20px 20px'
        }}
      />

      <div className="container px-4 mx-auto relative">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeIn}
          className="max-w-4xl mx-auto"
        >
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-violet-400 via-cyan-400 to-purple-400">
              How It Works
            </h2>
            <p className="text-muted-foreground mt-2">
              Our intelligent aggregator collects and processes data from multiple sources in real-time
            </p>
          </div>

          <div className="space-y-8">
            <Card className="backdrop-blur-sm bg-background/80 border-t border-b border-violet-500/20">
              <CardContent className="p-0">
                <CodeBlock code={aggregatorCode} language="typescript" />
              </CardContent>
            </Card>

            <div className="flex flex-col items-center gap-6">
              <Button 
                onClick={startDemo} 
                disabled={isAnimating}
                size="lg"
                className="relative group overflow-hidden"
              >
                {/* <div className="absolute inset-0 bg-gradient-to-r from-violet-500 via-cyan-500 to-purple-500 group-hover:animate-shimmer" /> */}
                <span className="relative flex items-center gap-2 font-medium">
                  <Play className="w-4 h-4" />
                  Run Demo
                </span>
              </Button>

              <div className="w-full max-w-md space-y-4">
                {sources.map((source, index) => (
                  <motion.div 
                    key={source.name}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ 
                      opacity: currentSource >= index || completedSources.includes(index) ? 1 : 0.5,
                      y: 0 
                    }}
                    className={`
                      flex items-center justify-between p-4 rounded-lg
                      ${currentSource === index ? 'bg-violet-500/10 border border-violet-500/20' : 'bg-accent/10'}
                      transition-colors duration-300
                    `}
                  >
                    <span className="text-sm font-medium">{source.name}</span>
                    <div className="flex items-center gap-2">
                      {currentSource === index && (
                        <Loader2 className="w-4 h-4 animate-spin text-primary" />
                      )}
                      {completedSources.includes(index) && (
                        <Check className="w-4 h-4 text-green-500" />
                      )}
                    </div>
                  </motion.div>
                ))}
              </div>

              <div className="w-full h-2 bg-accent/10 rounded-full overflow-hidden">
                <motion.div 
                  className="h-full bg-gradient-to-r from-violet-500 via-cyan-500 to-purple-500"
                  initial={{ width: "0%" }}
                  animate={{ 
                    width: isAnimating 
                      ? `${((completedSources.length) / sources.length) * 100}%` 
                      : "0%" 
                  }}
                  transition={{ duration: 0.3 }}
                />
              </div>

              <p className="text-sm text-muted-foreground">
                {isAnimating 
                  ? currentSource >= 0 
                    ? `Aggregating data from ${sources[currentSource].name}...` 
                    : "Processing complete!"
                  : "Click to see the aggregation process"}
              </p>

              {showSummary && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full mt-8"
                >
                  <Card className="backdrop-blur-sm bg-background/80 border-t border-b border-violet-500/20">
                    <CardContent className="p-6">
                      <h3 className="text-xl font-semibold mb-6 bg-clip-text text-transparent bg-gradient-to-r from-violet-400 to-cyan-400">
                        {exampleSummary.title}
                      </h3>
                      <div className="space-y-6">
                        {exampleSummary.highlights.map((highlight, index) => (
                          <motion.div 
                            key={index}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: index * 0.2 }}
                            className="space-y-2"
                          >
                            <h4 className="font-medium text-primary">{highlight.title}</h4>
                            <p className="text-sm text-muted-foreground leading-relaxed">{highlight.content}</p>
                          </motion.div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                </motion.div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </section>
  );
}