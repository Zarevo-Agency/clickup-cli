import { isRecord } from './util/guards.js'

/** A failed ClickUp API call with its HTTP status, ClickUp error code (ECODE) and API message. */
export class ClickUpApiError extends Error {
  readonly status: number
  readonly ecode: string | null
  readonly apiMessage: string

  constructor(status: number, apiMessage: string, ecode: string | null = null) {
    const detail = ecode ? `${apiMessage} [${ecode}]`.trimStart() : apiMessage
    super(`ClickUp API error ${status}: ${detail}`)
    this.name = 'ClickUpApiError'
    this.status = status
    this.ecode = ecode
    this.apiMessage = apiMessage
  }

  /**
   * Reads the message (v2 `err`, v3 `message`, then the generic `error` label) and `ECODE`
   * from an error response body; `fallback` is used when the body has no message.
   */
  static fromBody(status: number, body: unknown, fallback: string): ClickUpApiError {
    const data = isRecord(body) ? body : {}
    const raw = data.err ?? data.message ?? data.error
    const message = typeof raw === 'string' ? raw : raw == null ? '' : JSON.stringify(raw)
    const ecode = typeof data.ECODE === 'string' && data.ECODE ? data.ECODE : null
    return new ClickUpApiError(status, message || fallback, ecode)
  }
}

export interface ErrorJson {
  error: { message: string; status: number | null; ecode: string | null }
}

function findApiError(err: unknown): ClickUpApiError | null {
  if (err instanceof ClickUpApiError) return err
  return err instanceof Error ? findApiError(err.cause) : null
}

/** Machine-readable form of a thrown value; status and ecode come from the first ClickUpApiError in its cause chain. */
export function toErrorJson(err: unknown): ErrorJson {
  const apiError = findApiError(err)
  return {
    error: {
      message: err instanceof Error ? err.message : String(err),
      status: apiError?.status ?? null,
      ecode: apiError?.ecode ?? null,
    },
  }
}
