export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function api<T = any>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    cache: 'no-store',
    headers: {
      ...(options.body && !(options.body instanceof Uint8Array)
        ? { 'Content-Type': 'application/json' }
        : {}),
      ...options.headers,
    },
  });
  if (!response.ok) {
    const error = (await response.json().catch(() => ({ error: '网络请求失败' }))) as {
      error: string;
    };
    throw new ApiError(error.error || '请求失败', response.status);
  }
  return response.json();
}
export function post<T = any>(path: string, value: unknown = {}) {
  return api<T>(path, { method: 'POST', body: JSON.stringify(value) });
}
