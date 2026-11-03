import { OPAL_FILE_SCHEME } from '@/common/opalFileUrl';

/**
 * The app document's policy. Nothing on a page fetches the network: no
 * `https:` in connect-src, so only <img> loads web pictures a note embeds.
 * opal-file: is not in connect-src, since the page reads file bytes only
 * through <img>, <video> and the PDF viewer's <embed>. It stays in
 * object-src and frame-src because Chromium checks the <embed>'s inner
 * frame against frame-src ("Refused to frame" without it). HTML and SVG
 * served there carry their own sandbox policy, so a framed one runs nothing
 * and loads nothing.
 */
export const APP_CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: https: ${OPAL_FILE_SCHEME}:`,
  "font-src 'self' data:",
  "connect-src 'self' ws: http://localhost:11434", // Vite's reload socket and Ollama
  `media-src 'self' https: ${OPAL_FILE_SCHEME}:`,
  `object-src 'self' ${OPAL_FILE_SCHEME}:`,
  `frame-src 'self' ${OPAL_FILE_SCHEME}:`,
].join('; ');

/** The part of Electron's onHeadersReceived details the hook reads. */
export interface HeadersDetails {
  url: string;
  responseHeaders?: Record<string, string[] | string>;
}

/**
 * What the onHeadersReceived hook answers. Chromium's PDF viewer is an
 * extension page with its own policy; the app's policy would block its
 * scripts and leave an embedded PDF blank. opal-file: responses keep their
 * own headers (nosniff, and a sandbox policy for HTML and SVG), so the
 * protocol owns its policy and a vault file never gets the app's.
 */
export function applyAppPolicy(details: HeadersDetails): { responseHeaders?: Record<string, string[] | string> } {
  if (/^chrome(-extension)?:/.test(details.url) || details.url.startsWith(`${OPAL_FILE_SCHEME}:`)) return {};
  return { responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [APP_CSP] } };
}
