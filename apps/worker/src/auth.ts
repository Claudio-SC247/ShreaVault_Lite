export function isAdminAuthorized(request: Request, adminApiKey: string | undefined): boolean {
  if (!adminApiKey) {
    return false;
  }

  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) {
    return authorization.slice("Bearer ".length).trim() === adminApiKey;
  }

  return false;
}

export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "No autorizado." }), {
    status: 401,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    }
  });
}
