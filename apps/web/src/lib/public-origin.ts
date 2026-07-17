/**
 * Parses the one public origin used for canonical URLs. Paths, credentials,
 * query parameters, and fragments are intentionally rejected: this value is
 * an origin, not a general URL.
 */
export function parsePublicOrigin(value: string): URL {
  const url = new URL(value);

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("PUBLIC_ORIGIN must use HTTP or HTTPS");
  }
  if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("PUBLIC_ORIGIN must contain only a scheme and host");
  }

  return new URL(url.origin);
}

export function optionalPublicOrigin(value?: string): URL | undefined {
  if (!value) return undefined;
  try {
    return parsePublicOrigin(value);
  } catch {
    return undefined;
  }
}
