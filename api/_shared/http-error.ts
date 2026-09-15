export interface HttpError extends Error {
  statusCode: number;
  logMessage: string;
}

export function isPublicHttpError(error: unknown): error is HttpError {
  if (!(error instanceof Error)) return false;
  const value = error as Partial<HttpError> & { expose?: boolean };
  if (value.expose === false) return false;
  if (!Number.isInteger(value.statusCode) || value.statusCode! < 400 || value.statusCode! > 599) {
    return false;
  }
  // Opt-in: createHttpError (logMessage) ou expose=true explícito.
  return value.expose === true || typeof value.logMessage === 'string';
}

export function createHttpError(
  statusCode: number,
  publicMessage: string,
  logMessage = publicMessage,
): HttpError {
  return Object.assign(new Error(publicMessage), { statusCode, logMessage });
}
