import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { getApiUrl } from "../utils/api";

export async function loader({ params }: LoaderFunctionArgs) {
  const response = await fetch(getApiUrl(`/api/message-content/${params.id}`));
  return json(await response.json());
}
