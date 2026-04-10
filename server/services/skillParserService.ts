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

          const MAX_ENTRY_BYTES = 10 * 1024 * 1024; // 10 MB per entry
          let entryBytes = 0;
          const chunks: Buffer[] = [];
          readStream.on('data', (chunk) => {
            entryBytes += (chunk as Buffer).length;
            if (entryBytes > MAX_ENTRY_BYTES) {
              readStream.destroy();
              zipfile.readEntry();
              return;
            }
            chunks.push(chunk as Buffer);
          });
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
  if (!parsed) throw { statusCode: 400, message: `Invalid GitHub URL: ${url}` };

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
          const statusCode = res.status === 403 || res.status === 429 ? 429 : 502;
          throw Object.assign(new Error(`GitHub fetch failed (${res.status}): ${body.slice(0, 200)}`), { statusCode });
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
    throw { statusCode: 400, message: 'GitHub API returned non-array response — URL may point to a file, not a directory.' };
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

// ---------------------------------------------------------------------------
// Download URL support — fetch a file from any HTTP(S) URL
// Handles Google Drive, Dropbox, OneDrive sharing links, plus plain URLs.
// ---------------------------------------------------------------------------

const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024; // 50 MB

/** Convert common cloud-sharing URLs to direct download links. */
function toDirectDownloadUrl(url: string): string {
  // Google Drive: https://drive.google.com/file/d/{id}/view  →  export download
  const gdriveMatch = url.match(/drive\.google\.com\/file\/d\/([^/]+)/);
  if (gdriveMatch) {
    return `https://drive.google.com/uc?export=download&id=${gdriveMatch[1]}`;
  }

  // Dropbox: change dl=0 → dl=1, or append dl=1
  if (url.includes('dropbox.com')) {
    const u = new URL(url);
    u.searchParams.set('dl', '1');
    return u.toString();
  }

  // OneDrive/SharePoint: append download=1
  if (url.includes('1drv.ms') || url.includes('sharepoint.com') || url.includes('onedrive.live.com')) {
    const u = new URL(url);
    u.searchParams.set('download', '1');
    return u.toString();
  }

  // Box: https://app.box.com/s/{id} → https://app.box.com/shared/static/{id}
  const boxMatch = url.match(/app\.box\.com\/s\/([a-zA-Z0-9]+)/);
  if (boxMatch) {
    return `https://app.box.com/shared/static/${boxMatch[1]}`;
  }

  // GitHub blob URLs → raw.githubusercontent.com
  const ghBlobMatch = url.match(/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)/);
  if (ghBlobMatch) {
    return `https://raw.githubusercontent.com/${ghBlobMatch[1]}/${ghBlobMatch[2]}/${ghBlobMatch[3]}`;
  }

  return url;
}

/** Detect file type from URL path, Content-Type header, or content inspection. */
function detectFileType(
  url: string,
  contentType: string | null,
  buffer: Buffer
): 'zip' | 'md' | 'json' | 'unknown' {
  // Check URL extension first
  const urlPath = new URL(url).pathname.toLowerCase();
  if (urlPath.endsWith('.zip')) return 'zip';
  if (urlPath.endsWith('.md')) return 'md';
  if (urlPath.endsWith('.json')) return 'json';

  // Check Content-Type header
  if (contentType) {
    const ct = contentType.toLowerCase();
    if (ct.includes('zip') || ct.includes('octet-stream')) {
      // Check ZIP magic bytes: PK\x03\x04
      if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
        return 'zip';
      }
      if (ct.includes('zip')) return 'zip';
    }
    if (ct.includes('json')) return 'json';
    if (ct.includes('markdown') || ct.includes('text/plain') || ct.includes('text/x-markdown')) {
      // Heuristic: check if content looks like JSON
      const text = buffer.toString('utf8', 0, Math.min(100, buffer.length)).trim();
      if (text.startsWith('{') || text.startsWith('[')) return 'json';
      return 'md';
    }
  }

  // Magic bytes for ZIP
  if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4B && buffer[2] === 0x03 && buffer[3] === 0x04) {
    return 'zip';
  }

  // Content-based heuristic
  const text = buffer.toString('utf8', 0, Math.min(200, buffer.length)).trim();
  if (text.startsWith('{') || text.startsWith('[')) return 'json';
  return 'md'; // default to markdown
}

/** Download and parse skills from an arbitrary HTTP(S) URL. */
async function parseFromDownloadUrl(url: string): Promise<ParsedSkill[]> {
  const directUrl = toDirectDownloadUrl(url);

  const response = await withBackoff(
    () =>
      fetch(directUrl, {
        headers: { 'User-Agent': 'automation-v1/skill-analyzer' },
        redirect: 'follow',
      }).then(async (res) => {
        if (!res.ok) {
          throw Object.assign(
            new Error(`Download failed (${res.status}): ${(await res.text()).slice(0, 200)}`),
            { statusCode: res.status >= 500 ? 502 : 400 }
          );
        }
        return res;
      }),
    {
      label: 'download-url-fetch',
      maxAttempts: 3,
      correlationId: url,
      runId: url,
      isRetryable: (err: Error) => err.message.includes('502') || err.message.includes('503'),
    }
  );

  const arrayBuffer = await response.arrayBuffer();
  const buffer = Buffer.from(arrayBuffer);

  if (buffer.length > MAX_DOWNLOAD_BYTES) {
    throw { statusCode: 400, message: `Downloaded file exceeds ${MAX_DOWNLOAD_BYTES / (1024 * 1024)} MB limit.` };
  }

  const contentType = response.headers.get('content-type');
  const fileType = detectFileType(directUrl, contentType, buffer);

  if (fileType === 'zip') {
    // Write to temp file and use existing zip parser
    const tmpPath = path.join('data/uploads', `download-${Date.now()}.zip`);
    await fs.mkdir(path.dirname(tmpPath), { recursive: true });
    await fs.writeFile(tmpPath, buffer);
    try {
      return await parseZipFile(tmpPath);
    } finally {
      await fs.unlink(tmpPath).catch(() => {});
    }
  }

  // Single file — derive a filename from the URL
  const urlFilename = path.basename(new URL(directUrl).pathname) || 'downloaded-skill';
  const content = buffer.toString('utf8');

  if (fileType === 'json') {
    const skill = parseJsonFile(urlFilename.endsWith('.json') ? urlFilename : `${urlFilename}.json`, content);
    return skill ? [skill] : [];
  }

  // Markdown or unknown — try markdown parse, fall back to paste parse
  const skill = parseMarkdownFile(urlFilename.endsWith('.md') ? urlFilename : `${urlFilename}.md`, content);
  if (skill) return [skill];

  // If single-file markdown parse didn't find a skill, try paste parse (handles multi-skill separator)
  const pasteResults = parseFromText(content);
  return pasteResults;
}

export const skillParserService = {
  parseUploadedFiles,
  parseFromGitHub,
  parseFromDownloadUrl,
  parseFromPaste: parseFromText,
};
