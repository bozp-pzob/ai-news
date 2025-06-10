import { Hero } from "@/components/sections/hero";
import { Features } from "@/components/sections/features";
import { Demo } from "@/components/sections/demo";
import { GithubStats } from "@/components/sections/github-stats";
import { Newsletter } from "@/components/sections/newsletter";

export default function Home() {
  return (
    <div className="min-h-screen bg-background">
      <Hero />
      <Features />
      <Demo />
      <GithubStats />
      {/* <Newsletter /> */}
    </div>
  );
}
