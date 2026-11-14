/**
 * Comment: a comment on a page starts one run of the agent command (Claude
 * Code) in the page's opened folder, which edits the file on disk.
 */

/** Whether a comment on a page can be sent now, and if not, why. */
export type AgentReadiness =
  | { state: 'ready' }
  /** The command was not found. */
  | { state: 'missing' }
  /** The command says it is not signed in. */
  | { state: 'signed-out' }
  /** The page's opened folder has not answered the first-use question yet. */
  | { state: 'ask'; folder: string };

/** What the renderer sends to start a run. Lines count from 1 in the page's body, as the editor holds it. */
export interface CommentRequest {
  /** The page's path. */
  path: string;
  /** The comment as typed. */
  comment: string;
  /** The selected body lines and text, or null when the comment is about the whole page. */
  selection: { from: number; to: number; text: string } | null;
}

export type CommentRunStatus = 'running' | 'done' | 'failed' | 'stopped';

/** A run's state, sent when it starts and when it ends. */
export interface CommentRun {
  id: string;
  path: string;
  status: CommentRunStatus;
  /** The run's last message, or why it failed. Empty while it runs. */
  reply: string;
  /** The session id the command reported, for a reply in the same thread later. */
  sessionId: string | null;
}

/** Narrows on `success`, as UpdateResult does. */
export type AgentResult<T = undefined> =
  | { success: true; data: T; error?: undefined }
  | { success: false; error: string; data?: undefined };

export interface AgentAPI {
  /** Whether a comment on the page at `path` can run now. */
  readiness: (path: string) => Promise<AgentResult<AgentReadiness>>;
  /** Records the yes to the first-use question for the opened folder that holds `path`. */
  allowFolder: (path: string) => Promise<AgentResult>;
  /** Starts a run. The page must be saved first. */
  start: (request: CommentRequest) => Promise<AgentResult<CommentRun>>;
  /** Ends a run's turn, as Ctrl+C does. */
  stop: (id: string) => Promise<AgentResult>;
  onRunChanged: (callback: (run: CommentRun) => void) => () => void;
}

declare global {
  interface Window {
    agentAPI: AgentAPI;
  }
}
