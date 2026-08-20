export interface HttpError extends Error {
  statusCode: number;
  logMessage: string;
}

export function createHttpError(
  statusCode: number,
  publicMessage: string,
  logMessage = publicMessage,
): HttpError {
  return Object.assign(new Error(publicMessage), { statusCode, logMessage });
}
