import { apiRequest } from "./queryClient";

export interface GitHubStats {
  stars: number;
  forks: number;
  contributors: number;
}

export async function fetchGitHubStats(owner: string, repo: string): Promise<GitHubStats> {
  const [repoData, contributors] = await Promise.all([
    fetch(`https://api.github.com/repos/${owner}/${repo}`).then(res => res.json()),
    fetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1&anon=true`).then(res => {
      const linkHeader = res.headers.get('Link');
      if (!linkHeader) return 0;
      
      const match = linkHeader.match(/&page=(\d+)>; rel="last"/);
      return match ? parseInt(match[1]) : 0;
    })
  ]);

  return {
    stars: repoData.stargazers_count || 0,
    forks: repoData.forks_count || 0,
    contributors: contributors || 0
  };
}
