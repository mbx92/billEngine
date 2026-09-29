import type { ApiErrorBody } from '#shared/types/api'

/**
 * Extracts the human-readable message from the documented error envelope
 * (docs §17). `$fetch` throws a FetchError whose `data` holds the parsed body,
 * so this accepts either the thrown error or the raw body.
 */
export function apiErrorMessage(error: unknown, fallback: string): string {
  const body = extractErrorBody(error)
  return body?.error?.message?.trim() || fallback
}

/** Machine-readable code, e.g. for branching on STATE_INVALID. */
export function apiErrorCode(error: unknown): string | null {
  return extractErrorBody(error)?.error?.code ?? null
}

function extractErrorBody(error: unknown): ApiErrorBody | null {
  if (typeof error !== 'object' || error === null) return null

  // `$fetch` throws FetchError with the parsed body on `data`; a plain object
  // response body is also accepted.
  const candidate =
    'data' in error && isErrorBody((error as { data: unknown }).data)
      ? (error as { data: ApiErrorBody }).data
      : isErrorBody(error)
        ? (error as ApiErrorBody)
        : null

  return candidate ?? null
}

function isErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false
  const error = (value as { error?: unknown }).error
  return typeof error === 'object' && error !== null && 'message' in error
}
