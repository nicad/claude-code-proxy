import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link, useRouteError } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";

import { Layout } from "../components/Layout";
import RequestDetailContent from "../components/RequestDetailContent";

export const meta: MetaFunction = () => {
  return [
    { title: "Request Details - Claude Code Monitor" },
    { name: "description", content: "Claude Code Monitor - Request Details" },
  ];
};

export const loader = async ({ params }: LoaderFunctionArgs) => {
  const { id } = params;

  if (!id) {
    throw new Response("Request ID is required", { status: 400 });
  }

  try {
    const response = await fetch(`http://localhost:3001/api/requests/${id}`);

    if (!response.ok) {
      console.error(`Failed to fetch request ${id}: ${response.status} ${response.statusText}`);
      throw new Response("Request not found", { status: 404 });
    }

    const request = await response.json();
    return json({ request });
  } catch (error) {
    console.error(`Error fetching request ${id}:`, error);
    if (error instanceof Response) {
      throw error;
    }
    throw new Response(`Failed to fetch request: ${error}`, { status: 500 });
  }
};

export default function RequestDetail() {
  const { request } = useLoaderData<typeof loader>();

  const handleGrade = async () => {
    // Grading functionality - could be implemented later
    console.log("Grade request:", request.requestId);
  };

  return (
    <Layout showActions={false}>
      <main className="px-6 py-8">
        {/* Back button */}
        <div className="mb-6">
          <Link
            to="/requests"
            className="inline-flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Requests</span>
          </Link>
        </div>

        {/* Request Details */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
          <RequestDetailContent request={request} onGrade={handleGrade} />
        </div>
      </main>
    </Layout>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  const isResponseError = error instanceof Response;

  return (
    <Layout showActions={false}>
      <main className="px-6 py-8">
        <div className="mb-6">
          <Link
            to="/requests"
            className="inline-flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Requests</span>
          </Link>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Request Not Found</h2>
          <p className="text-gray-600">The request you're looking for doesn't exist or has been deleted.</p>
          {!isResponseError && error instanceof Error && (
            <p className="text-xs text-red-500 mt-2 font-mono">{error.message}</p>
          )}
        </div>
      </main>
    </Layout>
  );
}
