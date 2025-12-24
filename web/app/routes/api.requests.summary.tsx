import type { LoaderFunction } from "@remix-run/node";
import { json } from "@remix-run/node";

export const loader: LoaderFunction = async ({ request }) => {
  try {
    const url = new URL(request.url);

    // Forward all query params to the Go backend
    const backendUrl = new URL("http://localhost:3001/api/requests/summary");
    url.searchParams.forEach((value, key) => {
      backendUrl.searchParams.append(key, value);
    });

    const response = await fetch(backendUrl.toString());

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return json(data);
  } catch (error) {
    console.error("Failed to fetch request summaries:", error);
    return json({ requests: [], total: 0 });
  }
};
