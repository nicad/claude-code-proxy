import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getApiUrl } from "../utils/api";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const params = new URLSearchParams(url.search);
  const response = await fetch(getApiUrl(`/api/turns?${params}`));
  return json(await response.json());
}
