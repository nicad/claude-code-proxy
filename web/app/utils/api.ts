// Get the proxy API URL from environment or default to localhost:3001
export function getApiUrl(path: string): string {
  const baseUrl = process.env.VITE_API_URL || "http://localhost:3001";
  return `${baseUrl}${path}`;
}
