export type IPCResponse<T = undefined> = {
  success: boolean;
  error?: string;
  data?: T;
}