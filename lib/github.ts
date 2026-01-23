/**
 * GitHub API helper for committing files directly to the repository.
 * Used on Vercel where the filesystem is read-only.
 * Commits trigger auto-deploy via Vercel's GitHub integration.
 */

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO_OWNER = 'ChadFarrow';
const REPO_NAME = 'ITDV-Lightning';
const BRANCH = 'main';

const API_BASE = `https://api.github.com/repos/${REPO_OWNER}/${REPO_NAME}`;

interface FileUpdate {
  path: string;
  content: string;
}

interface GitHubCommitResult {
  success: boolean;
  commitSha?: string;
  error?: string;
}

async function githubFetch(endpoint: string, options: RequestInit = {}): Promise<Response> {
  if (!GITHUB_TOKEN) {
    throw new Error('GITHUB_TOKEN environment variable is not set');
  }

  const url = endpoint.startsWith('http') ? endpoint : `${API_BASE}${endpoint}`;

  return fetch(url, {
    ...options,
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
      'X-GitHub-Api-Version': '2022-11-28',
      ...options.headers,
    },
  });
}

/**
 * Get the SHA of the latest commit on the branch
 */
async function getLatestCommitSha(): Promise<string> {
  const response = await githubFetch(`/git/ref/heads/${BRANCH}`);
  if (!response.ok) {
    throw new Error(`Failed to get branch ref: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.object.sha;
}

/**
 * Get the tree SHA from a commit
 */
async function getTreeSha(commitSha: string): Promise<string> {
  const response = await githubFetch(`/git/commits/${commitSha}`);
  if (!response.ok) {
    throw new Error(`Failed to get commit: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.tree.sha;
}

/**
 * Create a blob for file content
 */
async function createBlob(content: string): Promise<string> {
  const response = await githubFetch('/git/blobs', {
    method: 'POST',
    body: JSON.stringify({
      content: Buffer.from(content).toString('base64'),
      encoding: 'base64',
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create blob: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.sha;
}

/**
 * Create a new tree with updated files
 */
async function createTree(baseTreeSha: string, files: { path: string; blobSha: string }[]): Promise<string> {
  const tree = files.map(f => ({
    path: f.path,
    mode: '100644' as const,
    type: 'blob' as const,
    sha: f.blobSha,
  }));

  const response = await githubFetch('/git/trees', {
    method: 'POST',
    body: JSON.stringify({
      base_tree: baseTreeSha,
      tree,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create tree: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.sha;
}

/**
 * Create a commit
 */
async function createCommit(message: string, treeSha: string, parentSha: string): Promise<string> {
  const response = await githubFetch('/git/commits', {
    method: 'POST',
    body: JSON.stringify({
      message,
      tree: treeSha,
      parents: [parentSha],
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to create commit: ${response.status} ${await response.text()}`);
  }
  const data = await response.json();
  return data.sha;
}

/**
 * Update branch reference to point to new commit
 */
async function updateBranchRef(commitSha: string): Promise<void> {
  const response = await githubFetch(`/git/refs/heads/${BRANCH}`, {
    method: 'PATCH',
    body: JSON.stringify({
      sha: commitSha,
      force: false,
    }),
  });
  if (!response.ok) {
    throw new Error(`Failed to update branch ref: ${response.status} ${await response.text()}`);
  }
}

/**
 * Commit multiple files to the repository in a single commit.
 * This is the main function to use for updating static data files.
 */
export async function commitFiles(files: FileUpdate[], message: string): Promise<GitHubCommitResult> {
  if (!GITHUB_TOKEN) {
    return { success: false, error: 'GITHUB_TOKEN not configured' };
  }

  if (files.length === 0) {
    return { success: false, error: 'No files to commit' };
  }

  try {
    // 1. Get current commit SHA
    const latestCommitSha = await getLatestCommitSha();

    // 2. Get tree SHA from that commit
    const baseTreeSha = await getTreeSha(latestCommitSha);

    // 3. Create blobs for each file
    const blobPromises = files.map(async (file) => ({
      path: file.path,
      blobSha: await createBlob(file.content),
    }));
    const blobs = await Promise.all(blobPromises);

    // 4. Create new tree with updated files
    const newTreeSha = await createTree(baseTreeSha, blobs);

    // 5. Create commit
    const newCommitSha = await createCommit(message, newTreeSha, latestCommitSha);

    // 6. Update branch reference
    await updateBranchRef(newCommitSha);

    return { success: true, commitSha: newCommitSha };
  } catch (error) {
    console.error('GitHub commit failed:', error);
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

/**
 * Check if GitHub integration is available (token is configured)
 */
export function isGitHubConfigured(): boolean {
  return !!GITHUB_TOKEN;
}
