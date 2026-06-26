export interface ApiError extends Error {
  status: number;
  data?: unknown;
}

export function createApiError(error: unknown): ApiError {
  if (error instanceof Error) {
    const apiErr = error as ApiError;
    apiErr.status = (error as ApiError).status ?? 500;
    apiErr.data = (error as ApiError).data;
    return apiErr;
  }
  const apiErr = new Error(String(error || 'Erro desconhecido.')) as ApiError;
  apiErr.status = 500;
  return apiErr;
}
