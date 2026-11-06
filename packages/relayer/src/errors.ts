export type RelayerErrorCode =
  | "paused"
  | "not_allowed"
  | "simulation_reverted"
  | "budget_exceeded"
  | "rate_limited"
  | "uneconomic"
  | "send_failed"
  | "receipt_timeout"
  | "circuit_open";

/** HTTP status the facilitator should map each code to. */
export const HTTP_STATUS: Record<RelayerErrorCode, number> = {
  paused: 503,
  not_allowed: 403,
  simulation_reverted: 422,
  budget_exceeded: 429,
  rate_limited: 429,
  uneconomic: 422,
  send_failed: 502,
  receipt_timeout: 504,
  circuit_open: 423,
};

export class RelayerError extends Error {
  constructor(
    readonly code: RelayerErrorCode,
    message: string,
    readonly details?: unknown,
  ) {
    super(`${code}: ${message}`);
    this.name = "RelayerError";
  }
  get status() {
    return HTTP_STATUS[this.code];
  }
}
