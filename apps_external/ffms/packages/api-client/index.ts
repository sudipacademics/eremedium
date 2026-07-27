export const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8080/api/v1';
export async function apiFetch<T>(path: string): Promise<T> { const response = await fetch(`${apiBaseUrl}${path}`); if (!response.ok) throw new Error('RFMS API request failed'); return response.json() as Promise<T>; }
