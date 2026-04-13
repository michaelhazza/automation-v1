import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs/promises';
import crypto from 'crypto';
import dns from 'dns/promises';
import { isIP } from 'net';
import yauzl from 'yauzl';
import { withBackoff } from '../lib/withBackoff.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const UPLOAD_DIR = path.resolve(__dirname, '../../data/uploads');
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

// Timeout constants for GitHub fetch operations
const GITHUB_API_TIMEOUT_MS = 15_000;    // 15s per GitHub API call (metadata, tree)
const GITHUB_FILE_TIMEOUT_MS = 10_000;   // 10s per raw file fetch
const GITHUB_PARSE_TIMEOUT_MS = 120_000; // 2min overall cap for parseFromGitHub

/** Wraps fetch with an AbortController timeout. Cleans up the timer on completion. */
function fetchWithTimeout(url: string, options: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

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

/** Parse GitHub URL to extract owner/repo/branch/path components.
 *  `specifiedBranch` is null when the URL didn't explicitly include
 *  `/tree/{branch}/...` — in that case the caller resolves the repo's
 *  default branch via the API rather than guessing. */
function parseGithubUrl(url: string): {
  owner: string;
  repo: string;
  specifiedBranch: string | null;
  repoPath: string;
} | null {
  // Supports:
  //   https://github.com/{owner}/{repo}
  //   https://github.com/{owner}/{repo}.git
  //   https://github.com/{owner}/{repo}/tree/{branch}
  //   https://github.com/{owner}/{repo}/tree/{branch}/{path}
  const match = url.match(
    /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?\/?(?:\/tree\/([^/]+)(?:\/(.+))?)?$/
  );
  if (!match) return null;

  return {
    owner: match[1],
    repo: match[2],
    specifiedBranch: match[3] || null,
    repoPath: (match[4] || '').replace(/\/$/, ''),
  };
}

const GITHUB_HEADERS = {
  Accept: 'application/vnd.github.v3+json',
  'User-Agent': 'automation-v1/skill-analyzer',
};

const GITHUB_IS_RETRYABLE = (err: Error) =>
  err.message.includes('429') || err.message.includes('503');

const MAX_SKILL_FILES_PER_REPO = 500;

/** Fetch JSON from a GitHub API endpoint with retry. */
async function githubApiJson<T>(url: string, label: string, correlationId: string): Promise<T> {
  const response = await withBackoff(
    () =>
      fetchWithTimeout(url, { headers: GITHUB_HEADERS }, GITHUB_API_TIMEOUT_MS).then(async (res) => {
        if (!res.ok) {
          const body = await res.text();
          const statusCode = res.status === 403 || res.status === 429 ? 429 : 502;
          throw Object.assign(
            new Error(`GitHub fetch failed (${res.status}): ${body.slice(0, 200)}`),
            { statusCode }
          );
        }
        return res;
      }),
    {
      label,
      maxAttempts: 3,
      correlationId,
      runId: correlationId,
      isRetryable: GITHUB_IS_RETRYABLE,
    }
  );
  return response.json() as Promise<T>;
}

/** Fetch and parse skills from a GitHub repo URL.
 *
 *  Walks the entire repository tree (recursively) via the Git Trees API
 *  in a single call, then fetches matching .md/.json blobs from
 *  raw.githubusercontent.com (CDN-served, not subject to the 60/hr
 *  api.github.com rate limit).
 *
 *  When the URL specifies a subdirectory (`/tree/{branch}/{path}`), only
 *  files under that prefix are considered.
 *
 *  Bounded by GITHUB_PARSE_TIMEOUT_MS overall — any individual hung fetch
 *  will be aborted by its own per-request timeout; the overall deadline
 *  catches pathological cases (many files × slow network). */
async function parseFromGitHub(url: string): Promise<ParsedSkill[]> {
  const deadline = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`GitHub import timed out after ${GITHUB_PARSE_TIMEOUT_MS / 1000}s — the repository may be too large or GitHub is unresponsive.`)),
      GITHUB_PARSE_TIMEOUT_MS
    )
  );
  return Promise.race([_parseFromGitHub(url), deadline]);
}

async function _parseFromGitHub(url: string): Promise<ParsedSkill[]> {
  const parsed = parseGithubUrl(url);
  if (!parsed) throw { statusCode: 400, message: `Invalid GitHub URL: ${url}` };

  const { owner, repo, specifiedBranch, repoPath } = parsed;

  // Resolve the ref to use for the tree fetch. If the URL didn't include
  // /tree/{branch}, look up the repo's default_branch — don't assume 'main'.
  let branch = specifiedBranch;
  if (!branch) {
    const repoInfo = await githubApiJson<{ default_branch?: string }>(
      `${GITHUB_API_BASE}/repos/${owner}/${repo}`,
      'github-repo-metadata',
      url
    );
    branch = repoInfo.default_branch || 'main';
  }

  // Fetch the full recursive tree in a single call.
  const treeData = await githubApiJson<{
    tree: Array<{ path: string; type: string; size?: number }>;
    truncated: boolean;
  }>(
    `${GITHUB_API_BASE}/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    'github-tree',
    url
  );

  if (treeData.truncated) {
    console.warn(
      `[skillParser] GitHub tree truncated for ${owner}/${repo} (>100k entries or >7MB). Some files may be missed.`
    );
  }

  // Filter to .md / .json blobs, optionally restricted to the requested subpath.
  const pathPrefix = repoPath ? `${repoPath}/` : '';
  const skillFiles = treeData.tree
    .filter((e) => e.type === 'blob')
    .filter((e) => e.path.endsWith('.md') || e.path.endsWith('.json'))
    .filter((e) => !pathPrefix || e.path === repoPath || e.path.startsWith(pathPrefix))
    .slice(0, MAX_SKILL_FILES_PER_REPO);

  if (skillFiles.length === 0) {
    // Surface a clearer error than the generic "no valid skill definitions found"
    // — most common cause is the URL pointing at a subdirectory that doesn't exist
    // or a repo with no .md/.json files.
    const scope = repoPath ? `under '${repoPath}'` : 'in the repository tree';
    throw {
      statusCode: 400,
      message: `No .md or .json files found ${scope} for ${owner}/${repo}@${branch}.`,
    };
  }

  const skills: ParsedSkill[] = [];

  for (const file of skillFiles) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${file.path}`;
    let content: string;
    try {
      content = await withBackoff(
        () =>
          fetchWithTimeout(rawUrl, {}, GITHUB_FILE_TIMEOUT_MS).then(async (res) => {
            if (!res.ok) throw new Error(`Failed to fetch ${file.path}: ${res.status}`);
            return res.text();
          }),
        {
          label: `github-file-${file.path}`,
          maxAttempts: 3,
          correlationId: url,
          runId: url,
          isRetryable: GITHUB_IS_RETRYABLE,
        }
      );
    } catch (err) {
      console.warn(
        `[skillParser] Failed to fetch ${file.path}:`,
        err instanceof Error ? err.message : err
      );
      continue;
    }

    const filename = path.basename(file.path);
    const ext = path.extname(filename).toLowerCase();
    const skill =
      ext === '.md' ? parseMarkdownFile(filename, content) : parseJsonFile(filename, content);

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
    try {
      const u = new URL(url);
      u.searchParams.set('dl', '1');
      return u.toString();
    } catch { return url; }
  }

  // OneDrive/SharePoint: append download=1
  if (url.includes('1drv.ms') || url.includes('sharepoint.com') || url.includes('onedrive.live.com')) {
    try {
      const u = new URL(url);
      u.searchParams.set('download', '1');
      return u.toString();
    } catch { return url; }
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

// ---------------------------------------------------------------------------
// SSRF protection — block requests to private/loopback/metadata IPs
// ---------------------------------------------------------------------------

/** Check if an IP address is in a private, loopback, or link-local range. */
function isPrivateIp(ip: string): boolean {
  // Handle IPv4-mapped IPv6 addresses (::ffff:x.x.x.x)
  const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  const normalizedIp = mapped ? mapped[1] : ip;

  // IPv4
  const v4Parts = normalizedIp.split('.').map(Number);
  if (v4Parts.length === 4 && v4Parts.every((n) => n >= 0 && n <= 255)) {
    if (v4Parts[0] === 127) return true;                                    // 127.0.0.0/8
    if (v4Parts[0] === 10) return true;                                     // 10.0.0.0/8
    if (v4Parts[0] === 172 && v4Parts[1] >= 16 && v4Parts[1] <= 31) return true; // 172.16.0.0/12
    if (v4Parts[0] === 192 && v4Parts[1] === 168) return true;              // 192.168.0.0/16
    if (v4Parts[0] === 169 && v4Parts[1] === 254) return true;              // 169.254.0.0/16 (link-local / IMDS)
    if (v4Parts[0] === 0) return true;                                      // 0.0.0.0/8
  }

  // IPv6
  const lower = normalizedIp.toLowerCase();
  if (lower === '::1') return true;                                         // loopback
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;        // fc00::/7 (unique local)
  if (lower.startsWith('fe80')) return true;                                // fe80::/10 (link-local)

  return false;
}

/** Resolve hostname and verify it does not point to a private IP. Throws on violation. */
async function assertPublicUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  const hostname = parsed.hostname;

  // If hostname is already an IP literal, check directly
  if (isIP(hostname)) {
    if (isPrivateIp(hostname)) {
      throw { statusCode: 400, message: 'Download URL resolves to a private or reserved IP address.' };
    }
    return;
  }

  // Resolve DNS and check all returned addresses
  try {
    const addresses = await dns.resolve4(hostname).catch(() => [] as string[]);
    const addresses6 = await dns.resolve6(hostname).catch(() => [] as string[]);
    const all = [...addresses, ...addresses6];

    if (all.length === 0) {
      throw { statusCode: 400, message: `Cannot resolve hostname: ${hostname}` };
    }

    for (const addr of all) {
      if (isPrivateIp(addr)) {
        throw { statusCode: 400, message: 'Download URL resolves to a private or reserved IP address.' };
      }
    }
  } catch (err) {
    if (typeof err === 'object' && err !== null && 'statusCode' in err) throw err;
    throw { statusCode: 400, message: `DNS resolution failed for ${hostname}` };
  }
}

/** Detect file type from URL path, Content-Type header, or content inspection. */
function detectFileType(
  url: string,
  contentType: string | null,
  buffer: Buffer
): 'zip' | 'md' | 'json' {
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

const MAX_REDIRECTS = 5;

/** Fetch a URL following redirects manually, validating each hop against SSRF. */
async function safeFetch(url: string): Promise<Response> {
  let currentUrl = url;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(currentUrl);

    const response = await fetch(currentUrl, {
      headers: { 'User-Agent': 'automation-v1/skill-analyzer' },
      redirect: 'manual',
    });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw { statusCode: 502, message: `Redirect with no Location header at hop ${hop + 1}.` };
      }
      // Resolve relative redirect URLs
      currentUrl = new URL(location, currentUrl).toString();

      // Require HTTPS on redirect targets
      if (!currentUrl.startsWith('https://')) {
        throw { statusCode: 400, message: 'Redirect target must use HTTPS.' };
      }
      continue;
    }

    if (!response.ok) {
      throw Object.assign(
        new Error(`Download failed (${response.status}): ${(await response.text()).slice(0, 200)}`),
        { statusCode: response.status >= 500 ? 502 : 400 }
      );
    }

    return response;
  }

  throw { statusCode: 400, message: `Too many redirects (>${MAX_REDIRECTS}).` };
}

/** Read a response body with a streaming size limit to prevent memory exhaustion. */
async function readBodyWithLimit(response: Response, maxBytes: number): Promise<Buffer> {
  // Fast pre-check via Content-Length (not trusted for enforcement, but avoids wasted work)
  const contentLength = parseInt(response.headers.get('content-length') || '', 10);
  if (contentLength > maxBytes) {
    throw { statusCode: 400, message: `File too large (${Math.round(contentLength / (1024 * 1024))} MB). Maximum is ${maxBytes / (1024 * 1024)} MB.` };
  }

  const reader = response.body?.getReader();
  if (!reader) {
    throw { statusCode: 502, message: 'Response has no readable body.' };
  }

  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw { statusCode: 400, message: `Downloaded file exceeds ${maxBytes / (1024 * 1024)} MB limit.` };
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  return Buffer.concat(chunks);
}

/** Download and parse skills from an arbitrary HTTP(S) URL. */
async function parseFromDownloadUrl(url: string): Promise<ParsedSkill[]> {
  const directUrl = toDirectDownloadUrl(url);

  // Require HTTPS
  if (!directUrl.startsWith('https://')) {
    throw { statusCode: 400, message: 'Download URL must use HTTPS.' };
  }

  const response = await withBackoff(
    () => safeFetch(directUrl),
    {
      label: 'download-url-fetch',
      maxAttempts: 3,
      correlationId: url,
      runId: url,
      isRetryable: (err: unknown) => {
        const e = err as { statusCode?: number };
        return e?.statusCode === 502 || e?.statusCode === 503;
      },
    }
  );

  const buffer = await readBodyWithLimit(response, MAX_DOWNLOAD_BYTES);

  const contentType = response.headers.get('content-type');
  const fileType = detectFileType(directUrl, contentType, buffer);

  if (fileType === 'zip') {
    // Write to temp file and use existing zip parser
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const tmpPath = path.join(UPLOAD_DIR, `download-${crypto.randomUUID()}.zip`);
    await fs.writeFile(tmpPath, buffer);
    try {
      return await parseZipFile(tmpPath);
    } finally {
      // guard-ignore-next-line: no-silent-failures reason="fire-and-forget temp file cleanup; stale temp files are harmless and the request must not fail on cleanup error"
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
