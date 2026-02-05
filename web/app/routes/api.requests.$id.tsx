import type { LoaderFunctionArgs } from "@remix-run/node";
import { getApiUrl } from "../utils/api";

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const { id } = params;

  if (!id) {
    return new Response(JSON.stringify({ error: "Request ID is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const response = await fetch(getApiUrl(`/api/requests/${id}`));
    const data = await response.json();

    return new Response(JSON.stringify(data), {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: "Failed to fetch request" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
