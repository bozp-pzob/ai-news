import { Button } from "@/components/ui/button";
import { motion } from "framer-motion";
import { fadeIn } from "@/lib/animations";
import { Github } from "lucide-react";

export function Hero() {
  const openGithub = () => {
    window.open('https://github.com/bozp-pzob/ai-news', '_blank')?.focus();
  }

  return (
    <section className="relative h-[calc(100vh-74px)] flex items-center justify-center overflow-hidden">
      {/* Iridescent background with dynamic gradient */}
      <div className="absolute inset-0 bg-iridescent opacity-30" />

      {/* Floating orbs */}
      <div className="absolute inset-0 overflow-hidden">
        {[...Array(3)].map((_, i) => (
          <motion.div
            key={i}
            className="absolute rounded-full bg-gradient-to-r from-violet-500/20 to-cyan-500/20 animate-float"
            style={{
              width: `${Math.random() * 300 + 100}px`,
              height: `${Math.random() * 300 + 100}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${i * 2}s`,
              filter: 'blur(60px)',
            }}
          />
        ))}
      </div>

      {/* Content */}
      <div className="container relative z-10 px-4 mx-auto">
        <motion.div
          initial="hidden"
          animate="visible"
          variants={fadeIn}
          className="text-center space-y-8"
        >
          <motion.h1 
            className="text-5xl md:text-7xl font-bold text-gradient leading-tight"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
          >
            AI-News
            <br />
            <span className="bg-clip-text text-transparent bg-gradient-to-r from-cyan-400 to-purple-400">
              Aggregation Platform
            </span>
          </motion.h1>

          <motion.p 
            className="text-xl md:text-2xl text-gray-300 max-w-3xl mx-auto leading-relaxed"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            Streamline your organization's communication with our advanced AI-powered news aggregation platform. Collect, analyze, and summarize information from multiple sources in real-time.
          </motion.p>

          <motion.div 
            className="flex flex-wrap justify-center gap-4 mt-8"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6 }}
          >
            <Button onClick={openGithub} size="lg" className="glass-card hover:bg-white/10 border-violet-500/20 group transition-all duration-300">
              <Github className="w-5 h-5 mr-2 group-hover:rotate-12 transition-transform" />
              <span className="text-gradient">View on GitHub</span>
            </Button>
          </motion.div>

          {/* Scroll indicator */}
          <motion.div 
            className="absolute -bottom-100 left-1/2 -translate-x-1/2"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 1 }}
          >
            <div className="w-6 h-10 rounded-full border-2 border-white/20 flex items-start justify-center p-2">
              <motion.div
                className="w-1 h-2 bg-white rounded-full"
                animate={{
                  y: [0, 12, 0],
                }}
                transition={{
                  duration: 1.5,
                  repeat: Infinity,
                  ease: "easeInOut",
                }}
              />
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  );
}