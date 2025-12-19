import type { MetaFunction, LoaderFunctionArgs } from "@remix-run/node";
import { json } from "@remix-run/node";
import { useLoaderData, Link } from "@remix-run/react";
import { ArrowLeft } from "lucide-react";

import { Layout } from "../components/Layout";
import { ConversationThread } from "../components/ConversationThread";

export const meta: MetaFunction = () => {
  return [
    { title: "Conversation Details - Claude Code Monitor" },
    { name: "description", content: "Claude Code Monitor - Conversation Details" },
  ];
};

export const loader = async ({ params, request }: LoaderFunctionArgs) => {
  const { id } = params;
  const url = new URL(request.url);
  const project = url.searchParams.get("project");

  if (!id) {
    throw new Response("Conversation ID is required", { status: 400 });
  }

  if (!project) {
    throw new Response("Project is required", { status: 400 });
  }

  try {
    const apiUrl = new URL(`http://localhost:3001/api/conversations/${id}`);
    apiUrl.searchParams.append("project", project);

    const response = await fetch(apiUrl.toString());

    if (!response.ok) {
      throw new Response("Conversation not found", { status: 404 });
    }

    const conversation = await response.json();
    return json({ conversation, project });
  } catch (error) {
    throw new Response("Failed to fetch conversation", { status: 500 });
  }
};

export default function ConversationDetail() {
  const { conversation, project } = useLoaderData<typeof loader>();

  return (
    <Layout showActions={false}>
      <main className="px-6 py-8">
        {/* Back button */}
        <div className="mb-6">
          <Link
            to="/conversations"
            className="inline-flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Conversations</span>
          </Link>
        </div>

        {/* Conversation Header */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-semibold text-gray-900">
                Conversation #{conversation.sessionId?.slice(-8)}
              </h1>
              <p className="text-sm text-gray-500 mt-1">
                {conversation.projectName || project}
              </p>
            </div>
            <div className="text-right text-sm text-gray-500">
              <div>{conversation.messageCount} messages</div>
              {conversation.startTime && (
                <div>{new Date(conversation.startTime).toLocaleString()}</div>
              )}
            </div>
          </div>
        </div>

        {/* Conversation Content */}
        <ConversationThread conversation={conversation} />
      </main>
    </Layout>
  );
}

export function ErrorBoundary() {
  return (
    <Layout showActions={false}>
      <main className="px-6 py-8">
        <div className="mb-6">
          <Link
            to="/conversations"
            className="inline-flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900 transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Back to Conversations</span>
          </Link>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6 text-center">
          <h2 className="text-lg font-semibold text-gray-900 mb-2">Conversation Not Found</h2>
          <p className="text-gray-600">The conversation you're looking for doesn't exist or has been deleted.</p>
        </div>
      </main>
    </Layout>
  );
}
