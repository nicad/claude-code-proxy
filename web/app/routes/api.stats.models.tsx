import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const url = new URL(request.url);
    const start = url.searchParams.get("start");
    const end = url.searchParams.get("end");

    if (!start || !end) {
      throw new Response("start and end are required", { status: 400 });
    }

    const params = new URLSearchParams({ start, end });
    const proxyUrl = `http://localhost:3001/api/stats/models?${params.toString()}`;
    const response = await fetch(proxyUrl);

    if (!response.ok) {
      throw new Error(`Failed to fetch model stats: ${response.statusText}`);
    }

    return json(await response.json());
  } catch (error) {
    console.error("Failed to fetch model stats:", error);
    return json({ modelStats: [] });
  }
}
