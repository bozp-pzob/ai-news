import { motion } from "framer-motion";
import { fadeIn } from "@/lib/animations";
import { Card, CardContent } from "@/components/ui/card";
import { Star, GitFork, Users, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchGitHubStats, type GitHubStats } from "@/lib/github";

const REPO_OWNER = "bozp-pzob";
const REPO_NAME = "ai-news";

export function GithubStats() {
  const { data: stats, isLoading, error } = useQuery<GitHubStats>({
    queryKey: ['github-stats', REPO_OWNER, REPO_NAME],
    queryFn: () => fetchGitHubStats(REPO_OWNER, REPO_NAME),
  });

  return (
    <section className="py-20 bg-background">
      <div className="container px-4 mx-auto">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true }}
          variants={fadeIn}
          className="text-center"
        >
          <h2 className="text-3xl font-bold mb-12">Project Stats</h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {isLoading ? (
              <div className="col-span-3 flex justify-center py-12">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
              </div>
            ) : error ? (
              <div className="col-span-3 text-destructive">
                Failed to load GitHub stats
              </div>
            ) : (
              <>
                <Card>
                  <CardContent className="pt-6">
                    <Star className="w-8 h-8 text-yellow-500 mx-auto mb-4" />
                    <div className="text-3xl font-bold">{stats?.stars || 0}</div>
                    <div className="text-muted-foreground">GitHub Stars</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <GitFork className="w-8 h-8 text-primary mx-auto mb-4" />
                    <div className="text-3xl font-bold">{stats?.forks || 0}</div>
                    <div className="text-muted-foreground">Forks</div>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="pt-6">
                    <Users className="w-8 h-8 text-green-500 mx-auto mb-4" />
                    <div className="text-3xl font-bold">{stats?.contributors || 0}+</div>
                    <div className="text-muted-foreground">Contributors</div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </motion.div>
      </div>
    </section>
  );
}