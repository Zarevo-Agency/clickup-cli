import { describe, expect, it } from 'vitest'
import { ClickUpApiError, toErrorJson } from '../../src/errors.js'

describe('ClickUpApiError.fromBody', () => {
  it('appends the ECODE to the err message', () => {
    const err = ClickUpApiError.fromBody(401, { err: 'Token invalid', ECODE: 'OAUTH_025' }, 'x')
    expect(err.message).toBe('ClickUp API error 401: Token invalid [OAUTH_025]')
    expect(err).toMatchObject({ status: 401, ecode: 'OAUTH_025', apiMessage: 'Token invalid' })
  })

  it('reads the error field used by some endpoints', () => {
    const err = ClickUpApiError.fromBody(400, { error: 'Name is required', ECODE: 'X_001' }, 'x')
    expect(err.message).toBe('ClickUp API error 400: Name is required [X_001]')
  })

  it('prefers a v3 message over the generic error label', () => {
    const err = ClickUpApiError.fromBody(
      400,
      { error: 'Bad Request', message: 'name missing' },
      'x',
    )
    expect(err.apiMessage).toBe('name missing')
  })

  it('falls back to the given message when the body only has an ECODE', () => {
    const err = ClickUpApiError.fromBody(401, { ECODE: 'OAUTH_025' }, 'Unauthorized')
    expect(err.message).toBe('ClickUp API error 401: Unauthorized [OAUTH_025]')
  })

  it('keeps the plain format without an ECODE', () => {
    const err = ClickUpApiError.fromBody(404, null, 'Not Found')
    expect(err.message).toBe('ClickUp API error 404: Not Found')
    expect(err.ecode).toBeNull()
  })

  it('serializes non-string error payloads', () => {
    const err = ClickUpApiError.fromBody(422, { err: { field: 'name' } }, 'x')
    expect(err.apiMessage).toBe('{"field":"name"}')
  })
})

describe('toErrorJson', () => {
  it('uses null status and ecode for non-API errors', () => {
    expect(toErrorJson(new Error('boom'))).toEqual({
      error: { message: 'boom', status: null, ecode: null },
    })
    expect(toErrorJson('raw')).toEqual({ error: { message: 'raw', status: null, ecode: null } })
  })

  it('takes status and ecode from an API error in the cause chain', () => {
    const cause = new ClickUpApiError(403, 'Team not authorized', 'OAUTH_027')
    const wrapped = new Error('Created list L1 but status copy failed', { cause })
    expect(toErrorJson(wrapped)).toEqual({
      error: { message: 'Created list L1 but status copy failed', status: 403, ecode: 'OAUTH_027' },
    })
  })
})
