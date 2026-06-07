const LOCALHOST_ORIGIN_PATTERN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function resolveAllowedOrigin(request: Request, corsOrigin: string | undefined): string | null {
  const requestOrigin = request.headers.get("origin");
  if (!requestOrigin) {
    return corsOrigin?.trim() || null;
  }

  const configuredOrigin = corsOrigin?.trim();
  if (configuredOrigin && requestOrigin === configuredOrigin) {
    return requestOrigin;
  }

  if (LOCALHOST_ORIGIN_PATTERN.test(requestOrigin)) {
    return requestOrigin;
  }

  return configuredOrigin || null;
}

export function buildCorsHeaders(request: Request, corsOrigin: string | undefined): Record<string, string> {
  const allowedOrigin = resolveAllowedOrigin(request, corsOrigin);
  const headers: Record<string, string> = {
    "access-control-allow-methods": "GET,POST,DELETE,OPTIONS",
    "access-control-allow-headers": "content-type, authorization"
  };

  if (allowedOrigin) {
    headers["access-control-allow-origin"] = allowedOrigin;
    headers["vary"] = "Origin";
  }

  return headers;
}

export function withCors(request: Request, response: Response, corsOrigin: string | undefined): Response {
  const headers = new Headers(response.headers);
  Object.entries(buildCorsHeaders(request, corsOrigin)).forEach(([key, value]) => headers.set(key, value));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}
