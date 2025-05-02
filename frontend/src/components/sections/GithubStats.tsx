import React, { useState, useEffect } from 'react';
import { fetchGitHubStats, GitHubStats as GitHubStatsType } from '../../lib/github';

// Simplified Star icon
const StarIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-yellow-500 mx-auto mb-4">
    <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"></polygon>
  </svg>
);

// Simplified GitFork icon
const GitForkIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-indigo-500 mx-auto mb-4">
    <circle cx="12" cy="18" r="3"></circle>
    <circle cx="6" cy="6" r="3"></circle>
    <circle cx="18" cy="6" r="3"></circle>
    <path d="M18 9v1a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V9"></path>
    <path d="M12 12v3"></path>
  </svg>
);

// Simplified Users icon
const UsersIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-8 h-8 text-green-500 mx-auto mb-4">
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"></path>
    <circle cx="9" cy="7" r="4"></circle>
    <path d="M22 21v-2a4 4 0 0 0-3-3.87"></path>
    <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
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

// GitHub repo information - Make sure these are correct!
const REPO_OWNER = "bozp-pzob";
const REPO_NAME = "ai-news";

export const GithubStats: React.FC = () => {
  const [stats, setStats] = useState<GitHubStatsType>({
    stars: 0,
    forks: 0,
    contributors: 0
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const loadGitHubStats = async () => {
      try {
        setLoading(true);
        console.log(`Fetching GitHub stats for ${REPO_OWNER}/${REPO_NAME}...`);
        const data = await fetchGitHubStats(REPO_OWNER, REPO_NAME);
        console.log('GitHub stats received:', data);
        setStats(data);
        setError(null);
      } catch (err) {
        console.error('Error fetching GitHub stats:', err);
        setError('Failed to load GitHub stats');
      } finally {
        setLoading(false);
      }
    };

    loadGitHubStats();
  }, []);

  return (
    <section className="py-20 relative overflow-hidden">
      {/* Removed background gradient */}
      
      {/* Removed background glow */}

      <div className="container px-4 mx-auto relative">
        <div className="text-center">
          <h2 className="text-3xl md:text-4xl font-bold mb-4 text-white inline-block" style={{ WebkitBackgroundClip: 'text' }}>
            Project Stats
          </h2>
          <p className="text-stone-400 max-w-2xl mx-auto mb-12">
            Join our growing community of developers and contributors
          </p>

          {loading ? (
            <div className="flex justify-center items-center h-40">
              <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-300"></div>
            </div>
          ) : error ? (
            <div className="text-red-400 max-w-2xl mx-auto mb-12">
              {error}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-4xl mx-auto">
              <Card delay={0.2}>
                <StarIcon />
                <div className="text-3xl font-bold text-white">{stats.stars}</div>
                <div className="text-stone-400">GitHub Stars</div>
              </Card>

              <Card delay={0.3}>
                <GitForkIcon />
                <div className="text-3xl font-bold text-white">{stats.forks}</div>
                <div className="text-stone-400">Forks</div>
              </Card>

              <Card delay={0.4}>
                <UsersIcon />
                <div className="text-3xl font-bold text-white">{stats.contributors}+</div>
                <div className="text-stone-400">Contributors</div>
              </Card>
            </div>
          )}
        </div>
      </div>
    </section>
  );
};

export default GithubStats; 