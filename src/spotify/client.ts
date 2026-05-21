export type RequestOptions = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  token: string;
  body?: unknown;
  maxRetries?: number;
  retryDelayMs?: number;
};

const MAX_5XX_ATTEMPTS = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export async function spotifyRequest<T = unknown>(
  url: string,
  opts: RequestOptions,
): Promise<T> {
  const maxRetries = opts.maxRetries ?? 5;
  const retryDelayMs = opts.retryDelayMs ?? 5000;

  let attempt429 = 0;
  let attempt5xx = 0;

  while (true) {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${opts.token}`,
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";

    const res = await fetch(url, {
      method: opts.method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });

    if (res.status === 429) {
      if (attempt429 >= maxRetries) {
        throw new Error(`Rate limited ${maxRetries} times for ${opts.method} ${url}`);
      }
      const retryAfter = Number(res.headers.get("Retry-After") ?? 1);
      await sleep(retryAfter * 1000);
      attempt429++;
      continue;
    }

    if (res.status >= 500 && res.status < 600) {
      if (attempt5xx >= MAX_5XX_ATTEMPTS - 1) {
        throw new Error(`Spotify API ${res.status} after ${MAX_5XX_ATTEMPTS} attempts: ${opts.method} ${url}`);
      }
      await sleep(retryDelayMs);
      attempt5xx++;
      continue;
    }

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Spotify API ${res.status} on ${opts.method} ${url}: ${text}`);
    }

    if (res.status === 204) return undefined as T;
    const text = await res.text();
    if (text === "") return undefined as T;
    return JSON.parse(text) as T;
  }
}
