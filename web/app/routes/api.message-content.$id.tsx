import type { LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";

export async function loader({ params }: LoaderFunctionArgs) {
  const response = await fetch(`http://localhost:3001/api/message-content/${params.id}`);
  return json(await response.json());
}
