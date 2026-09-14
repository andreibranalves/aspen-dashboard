export interface HttpError extends Error {
  statusCode: number;
  logMessage: string;
}

export function isPublicHttpError(error: unknown): error is HttpError {
  if (!(error instanceof Error)) return false;
  const value = error as Partial<HttpError> & { expose?: boolean };
  return value.expose !== false && typeof value.logMessage === 'string' &&
    Number.isInteger(value.statusCode) && value.statusCode! >= 400 && value.statusCode! <= 599;
}

export function createHttpError(
  statusCode: number,
  publicMessage: string,
  logMessage = publicMessage,
): HttpError {
  return Object.assign(new Error(publicMessage), { statusCode, logMessage });
}
