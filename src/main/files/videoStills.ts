import { createHash } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';

/*
 * Stills for YouTube and Loom cards. The page never fetches the web; when
 * Load preview is clicked, main fetches the video's still once, from the
 * service's own image host, and keeps it in Opal's app data, so the card
 * shows it from then on without the network. Only these hosts are asked,
 * with a timeout and a size cap, and only an image is kept.
 */

const TIMEOUT_MS = 8000;
const MAX_BYTES = 2 * 1024 * 1024;

export type Fetch = (url: string, init?: { signal?: AbortSignal; redirect?: 'follow' | 'error' }) => Promise<Response>;

export interface VideoStillsDependencies {
  /** Where stills are kept, under Opal's app data. */
  dir: string;
  fetch: Fetch;
}

/** The video a page address names: a YouTube id or a Loom share. Null for any other address. */
export function videoOf(address: string): { service: 'youtube' | 'loom'; id: string } | null {
  let url: URL;
  try { url = new URL(address); } catch { return null; }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  const host = url.hostname.toLowerCase().replace(/^(www|m)\./, '');
  const parts = url.pathname.split('/').filter(Boolean);
  let id: string | null = null;
  if (host === 'youtu.be') id = parts[0] ?? null;
  else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    id = url.searchParams.get('v') ?? (['shorts', 'embed', 'live', 'v'].includes(parts[0]) ? parts[1] ?? null : null);
  } else if (host === 'loom.com' && (parts[0] === 'share' || parts[0] === 'embed') && parts[1]) {
    return /^[0-9a-f]{20,40}$/i.test(parts[1]) ? { service: 'loom', id: parts[1] } : null;
  }
  return id && /^[A-Za-z0-9_-]{6,20}$/.test(id) ? { service: 'youtube', id } : null;
}

export class VideoStills {
  constructor(private deps: VideoStillsDependencies) {}

  /**
   * The still for `address` as a data: URL: from the cache, or with `fetch`
   * from the service once. Null for an address that is no known video, or
   * when only the cache was asked and holds nothing.
   */
  async still(address: string, { cached = false }: { cached?: boolean } = {}): Promise<string | null> {
    const video = videoOf(address);
    if (!video) return null;
    const file = path.join(this.deps.dir, `${createHash('sha256').update(`${video.service}:${video.id}`).digest('hex')}.jpg`);
    const kept = await readFile(file).catch(() => null);
    if (kept) return `data:image/jpeg;base64,${kept.toString('base64')}`;
    if (cached) return null;
    const source = video.service === 'youtube' ? `https://i.ytimg.com/vi/${video.id}/hqdefault.jpg` : await this.loomStill(video.id);
    if (!source) throw new Error('This video has no preview.');
    const bytes = await this.get(source, /^image\/(jpeg|png|webp|gif)/);
    await mkdir(this.deps.dir, { recursive: true });
    await writeFile(file, bytes);
    return `data:image/jpeg;base64,${bytes.toString('base64')}`;
  }

  /** Loom names its still in its oEmbed answer; only an https address on Loom's own hosts is used. */
  private async loomStill(id: string): Promise<string | null> {
    const answer = await this.get(`https://www.loom.com/v1/oembed?url=${encodeURIComponent(`https://www.loom.com/share/${id}`)}`, /^application\/json/);
    const still = (JSON.parse(answer.toString('utf8')) as { thumbnail_url?: unknown }).thumbnail_url;
    if (typeof still !== 'string') return null;
    const url = new URL(still);
    return url.protocol === 'https:' && /(^|\.)loom\.com$|(^|\.)loomcdn\.com$/.test(url.hostname) ? url.href : null;
  }

  private async get(url: string, type: RegExp): Promise<Buffer> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await this.deps.fetch(url, { signal: controller.signal, redirect: 'error' });
      if (!response.ok) throw new Error(`The video service answered ${response.status}.`);
      if (!type.test(response.headers.get('content-type') ?? '')) throw new Error('The video service sent something other than a picture.');
      const length = Number(response.headers.get('content-length') ?? 0);
      if (length > MAX_BYTES) throw new Error('The preview is too large.');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_BYTES) throw new Error('The preview is too large.');
      return bytes;
    } finally {
      clearTimeout(timer);
    }
  }
}
