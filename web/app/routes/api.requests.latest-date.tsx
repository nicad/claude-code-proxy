import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getApiUrl } from "../utils/api";

export async function loader({ request }: LoaderFunctionArgs) {
  try {
    const response = await fetch(getApiUrl("/api/requests/latest-date"));

    if (!response.ok) {
      return json({ latestDate: null });
    }

    const data = await response.json();
    return json(data);
  } catch (error) {
    console.error("Failed to fetch latest request date:", error);
    return json({ latestDate: null });
  }
}
