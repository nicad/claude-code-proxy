import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  const response = await fetch(`http://localhost:3001/api/turns?${params}`);
  return json(await response.json());
}
