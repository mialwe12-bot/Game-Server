export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, code = 'bad_request', details?: unknown) =>
  new HttpError(400, code, message, details);
export const unauthorized = (message = 'Nicht angemeldet', code = 'unauthorized') => new HttpError(401, code, message);
export const forbidden = (message = 'Keine Berechtigung', code = 'forbidden') => new HttpError(403, code, message);
export const notFound = (message = 'Nicht gefunden', code = 'not_found') => new HttpError(404, code, message);
export const conflict = (message: string, code = 'conflict') => new HttpError(409, code, message);
