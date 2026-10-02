import type { ApiError } from "../src/types";

export const BACKEND_PROTOCOL_VERSION = 1;

export interface BackendRequest {
  id: string;
  operation: string;
  arguments: Record<string, unknown>;
  protocolVersion: typeof BACKEND_PROTOCOL_VERSION;
}

export interface BackendResponse {
  id: string;
  result?: unknown;
  error?: ApiError;
}

export interface BackendEvent {
  event: string;
  payload: unknown;
}
