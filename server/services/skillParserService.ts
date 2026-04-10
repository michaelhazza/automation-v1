import path from 'path';
import fs from 'fs/promises';
import yauzl from 'yauzl';
import { withBackoff } from '../lib/withBackoff.js';
import {
  parseMarkdownFile,
  parseJsonFile,
  parseFromText,
  ParsedSkill,
} from './skillParserServicePure.js';

// ---------------------------------------------------------------------------
// Skill Parser Service — Impure wrappers (file I/O, GitHub fetch)
// ---------------------------------------------------------------------------

const GITHUB_API_BASE = 'https://api.github.com';
const MAX_UPLOAD_SIZE_BYTES = 50 * 1024 * 1024; // 50 MB

/** Parse uploaded files (handles .md, .json, .zip). */
async function parseUploadedFiles(files: Express.Multer.File[]): Promise<ParsedSkill[]> {
  const skills: ParsedSkill[] = [];

  for (const file of files) {
    const ext = path.extname(file.originalname).toLowerCase();

    if (ext === '.zip') {
      const zipSkills = await parseZipFile(file.path);
      skills.push(...zipSkills);
    } else if (ext === '.md') {
      const content = await fs.readFile(file.path, 'utf8');
      const skill = parseMarkdownFile(file.originalname, content);
      if (skill) skills.push(skill);
    } else if (ext === '.json') {
      const content = await fs.readFile(file.path, 'utf8');
      const skill = parseJsonFile(file.originalname, content);
      if (skill) skills.push(skill);
    }

    // Clean up temp file
    await fs.unlink(file.path).catch(() => { /* ignore cleanup errors */ });
  }

  return skills;
}

/** Extract and parse skills from a zip file. */
async function parseZipFile(filePath: string): Promise<ParsedSkill[]> {
  return new Promise((resolve, reject) => {
    const skills: ParsedSkill[] = [];

    yauzl.open(filePath, { lazyEntries: true }, (err, zipfile) => {
      if (err) return reject(err);

      zipfile.readEntry();

      zipfile.on('entry', (entry) => {
        const ext = path.extname(entry.fileName).toLowerCase();

        if (entry.fileName.endsWith('/') || (ext !== '.md' && ext !== '.json')) {
          zipfile.readEntry();
          return;
        }

        zipfile.openReadStream(entry, (streamErr, readStream) => {
          if (streamErr) {
            zipfile.readEntry();
            return;
          }

          const chunks: Buffer[] = [];
          readStream.on('data', (chunk) => chunks.push(chunk as Buffer));
          readStream.on('end', () => {
            const content = Buffer.concat(chunks).toString('utf8');
            const filename = path.basename(entry.fileName);

            const skill =
              ext === '.md'
                ? parseMarkdownFile(filename, content)
                : parseJsonFile(filename, content);

            if (skill) skills.push(skill);
            zipfile.readEntry();
          });
          readStream.on('error', () => zipfile.readEntry());
        });
      });

      zipfile.on('end', () => resolve(skills));
      zipfile.on('error', reject);
    });
  });
}

/** Parse GitHub URL to extract owner/repo/branch/path components. */
function parseGithubUrl(url: string): {
  owner: string;
  repo: string;
  branch: string;
  repoPath: string;
} | null {
  // Supports:
  //   https://github.com/{owner}/{repo}
  //   https://github.com/{owner}/{repo}/tree/{branch}/{path}
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+)(?:\/tree\/([^/]+)(?:\/(.+))?)?/
  );
  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2],
    branch: match[3] || 'main',
    repoPath: match[4] || '',
  };
}

/** Fetch and parse skills from a GitHub repo URL.
 *  Uses GitHub REST API (unauthenticated, 60 req/hr per IP). */
async function parseFromGitHub(url: string): Promise<ParsedSkill[]> {
  const parsed = parseGithubUrl(url);
  if (!parsed) throw new Error(`Invalid GitHub URL: ${url}`);

  const { owner, repo, branch, repoPath } = parsed;
  const contentsUrl = `${GITHUB_API_BASE}/repos/${owner}/${repo}/contents/${repoPath}?ref=${branch}`;

  // Fetch directory listing
  const dirResponse = await withBackoff(
    () =>
      fetch(contentsUrl, {
        headers: { Accept: 'application/vnd.github.v3+json', 'User-Agent': 'automation-v1/skill-analyzer' },
      }).then(async (res) => {
        if (!res.ok) {
          const body = await res.text();
          throw new Error(`GitHub API error ${res.status}: ${body.slice(0, 200)}`);
        }
        return res;
      }),
    {
      label: 'github-dir-listing',
      maxAttempts: 3,
      correlationId: url,
      runId: url,
      isRetryable: (err: Error) => err.message.includes('429') || err.message.includes('503'),
    }
  );

  const entries = await dirResponse.json() as Array<{
    name: string;
    type: string;
    download_url: string | null;
  }>;

  if (!Array.isArray(entries)) {
    throw new Error('GitHub API returned non-array response — URL may point to a file, not a directory.');
  }

  const skillFiles = entries.filter(
    (e) => e.type === 'file' && (e.name.endsWith('.md') || e.name.endsWith('.json')) && e.download_url
  );

  const skills: ParsedSkill[] = [];

  for (const file of skillFiles) {
    const content = await withBackoff(
      () =>
        fetch(file.download_url!).then(async (res) => {
          if (!res.ok) throw new Error(`Failed to fetch ${file.name}: ${res.status}`);
          return res.text();
        }),
      {
        label: `github-file-${file.name}`,
        maxAttempts: 3,
        correlationId: url,
        runId: url,
        isRetryable: (err: Error) => err.message.includes('429') || err.message.includes('503'),
      }
    );

    const ext = path.extname(file.name).toLowerCase();
    const skill =
      ext === '.md'
        ? parseMarkdownFile(file.name, content)
        : parseJsonFile(file.name, content);

    if (skill) skills.push(skill);
  }

  return skills;
}

export const skillParserService = {
  parseUploadedFiles,
  parseFromGitHub,
  parseFromPaste: parseFromText,
};
