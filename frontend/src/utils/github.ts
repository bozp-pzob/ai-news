export interface GitHubStats {
  stars: number;
  forks: number;
  contributors: number;
}

export async function fetchGitHubStats(owner: string, repo: string): Promise<GitHubStats> {
  try {
    // Optional: Add a GitHub token for higher rate limits
    // const token = 'your_github_token';
    // const headers = token ? { Authorization: `token ${token}` } : {};
    
    const repoResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}`);
    
    if (!repoResponse.ok) {
      throw new Error(`GitHub API error: ${repoResponse.status}`);
    }
    
    const repoData = await repoResponse.json();
    
    // For contributors count, we need to use a different approach
    const contributorsResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=1`);
    
    if (!contributorsResponse.ok) {
      throw new Error(`GitHub API error: ${contributorsResponse.status}`);
    }
    
    let contributorsCount = 0;
    // Get the last page from the Link header to determine total count
    const linkHeader = contributorsResponse.headers.get('Link');
    if (linkHeader) {
      const match = linkHeader.match(/&page=(\d+)>; rel="last"/);
      contributorsCount = match ? parseInt(match[1], 10) : 0;
    } else {
      // If no Link header, count manually (for repos with few contributors)
      const allContributors = await fetch(`https://api.github.com/repos/${owner}/${repo}/contributors?per_page=100`)
        .then(res => res.json());
      contributorsCount = Array.isArray(allContributors) ? allContributors.length : 0;
    }

    return {
      stars: repoData.stargazers_count || 0,
      forks: repoData.forks_count || 0,
      contributors: contributorsCount
    };
  } catch (error) {
    console.error("Error fetching GitHub stats:", error);
    return {
      stars: 0,
      forks: 0,
      contributors: 0
    };
  }
} 