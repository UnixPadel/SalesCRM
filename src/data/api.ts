// Thin fetch wrapper for the Node server. The session is an httpOnly cookie set at login,
// so nothing secret ever lives in JavaScript. A 401 anywhere logs the user out.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    /** Makine kodu (ör. "stage.backward"); yeni pipeline uç noktaları gönderir, eski uç noktalar göndermez. */
    public code?: string,
    public details?: Record<string, unknown>,
  ) {
    super(message);
  }
}

export const UNAUTHORIZED_EVENT = "crm:unauthorized";

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      headers: body !== undefined ? { "content-type": "application/json" } : undefined,
      body: body !== undefined ? JSON.stringify(body) : undefined,
      credentials: "same-origin",
    });
  } catch {
    throw new ApiError(0, "Sunucuya ulaşılamadı. Uygulama sunucusu çalışıyor mu?");
  }
  if (res.status === 401 && !path.startsWith("/api/auth/")) {
    window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
  }
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let data: unknown = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { error: text };
  }
  if (!res.ok) {
    const body = data as { error?: string; code?: string; details?: Record<string, unknown> } | null;
    const msg = body?.error || `${res.status} ${res.statusText}`;
    throw new ApiError(res.status, msg, body?.code, body?.details);
  }
  return data as T;
}
