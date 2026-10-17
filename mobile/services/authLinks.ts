/** Reads `code`, tokens, type or an error from an auth redirect URL (query and fragment). */
export function parseAuthUrl(url: string) {
  const params = new URLSearchParams();
  const hashAt = url.indexOf('#');
  const beforeHash = hashAt >= 0 ? url.slice(0, hashAt) : url;
  const hash = hashAt >= 0 ? url.slice(hashAt + 1) : '';
  const queryAt = beforeHash.indexOf('?');
  const query = queryAt >= 0 ? beforeHash.slice(queryAt + 1) : '';
  for (const part of [query, hash]) {
    new URLSearchParams(part).forEach((v, k) => params.set(k, v));
  }
  return {
    code: params.get('code'),
    accessToken: params.get('access_token'),
    refreshToken: params.get('refresh_token'),
    type: params.get('type'),
    error: params.get('error_description') || params.get('error'),
  };
}
