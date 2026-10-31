/**
 * Appends the token correctly for paths that already carry query parameters.
 * The naive `path + '?token='` concatenation breaks `/api/memory?q=x&token=...`
 * (the server sees no endpoint named `memory?q=x`).
 */
export function buildApiUrl(path: string, token: string): string {
  const [base, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  if (token !== '') params.set('token', token);
  const search = params.toString();
  return search === '' ? (base ?? '') : `${base}?${search}`;
}
