import type { MetaFunction } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { useState, useEffect, useTransition } from "react";
import { Loader2 } from "lucide-react";

import { Layout } from "../components/Layout";

export const meta: MetaFunction = () => {
  return [
    { title: "Conversations - Claude Code Monitor" },
    { name: "description", content: "Claude Code Monitor - Conversations" },
  ];
};

interface ConversationSummary {
  id: string;
  requestCount: number;
  startTime: string;
  lastActivity: string;
  duration: number;
  firstMessage: string;
  lastMessage: string;
  projectName: string;
}

export default function ConversationsIndex() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [isFetching, setIsFetching] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [conversationsCurrentPage, setConversationsCurrentPage] = useState(1);
  const [hasMoreConversations, setHasMoreConversations] = useState(true);
  const itemsPerPage = 50;

  const formatDuration = (milliseconds: number) => {
    if (milliseconds < 60000) {
      return `${Math.round(milliseconds / 1000)}s`;
    } else if (milliseconds < 3600000) {
      return `${Math.round(milliseconds / 60000)}m`;
    } else {
      return `${Math.round(milliseconds / 3600000)}h`;
    }
  };

  const loadConversations = async (loadMore = false) => {
    setIsFetching(true);
    const pageToFetch = loadMore ? conversationsCurrentPage + 1 : 1;
    try {
      const url = new URL('/api/conversations', window.location.origin);
      url.searchParams.append("page", pageToFetch.toString());
      url.searchParams.append("limit", itemsPerPage.toString());

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      startTransition(() => {
        if (loadMore) {
          setConversations(prev => [...prev, ...data.conversations]);
        } else {
          setConversations(data.conversations);
        }
        setConversationsCurrentPage(pageToFetch);
        setHasMoreConversations(data.conversations.length === itemsPerPage);
      });
    } catch (error) {
      console.error('Failed to load conversations:', error);
      startTransition(() => {
        setConversations([]);
      });
    } finally {
      setIsFetching(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  return (
    <Layout onRefresh={() => loadConversations()}>
      {/* Main Content */}
      <main className="px-6 py-8 space-y-8">
        {/* Stats Grid */}
        <div className="mb-6">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total Conversations
                </p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">
                  {conversations.length}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Conversations View */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Conversations</h2>
          </div>
          <div className="divide-y divide-gray-200">
            {(isFetching && conversationsCurrentPage === 1) || isPending ? (
              <div className="p-8 text-center">
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-gray-400" />
                <p className="mt-2 text-xs text-gray-500">Loading conversations...</p>
              </div>
            ) : conversations.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <h3 className="text-sm font-medium text-gray-600 mb-1">No conversations found</h3>
                <p className="text-xs text-gray-500">Start a conversation to see it appear here</p>
              </div>
            ) : (
              <>
                {conversations.map(conversation => (
                  <Link
                    key={conversation.id}
                    to={`/conversations/${conversation.id}?project=${encodeURIComponent(conversation.projectName)}`}
                    className="block px-4 py-4 hover:bg-gray-50 transition-colors cursor-pointer border-b border-gray-100 last:border-b-0"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 mr-4">
                        <div className="flex items-center space-x-2 mb-2">
                          <span className="text-sm font-semibold text-gray-900 font-mono">
                            #{conversation.id.slice(-8)}
                          </span>
                          <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full font-medium">
                            {conversation.requestCount} turns
                          </span>
                          <span className="text-xs px-2 py-0.5 bg-gray-100 text-gray-700 rounded-full">
                            {formatDuration(conversation.duration)}
                          </span>
                          {conversation.projectName && (
                            <span className="text-xs px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full font-medium">
                              {conversation.projectName}
                            </span>
                          )}
                        </div>
                        <div className="space-y-2">
                          <div className="bg-gray-50 rounded p-2 border border-gray-200">
                            <div className="text-xs font-medium text-gray-600 mb-0.5">First Message</div>
                            <div className="text-xs text-gray-700 line-clamp-2">
                              {conversation.firstMessage || "No content"}
                            </div>
                          </div>
                          {conversation.lastMessage && conversation.lastMessage !== conversation.firstMessage && (
                            <div className="bg-blue-50 rounded p-2 border border-blue-200">
                              <div className="text-xs font-medium text-blue-600 mb-0.5">Latest Message</div>
                              <div className="text-xs text-gray-700 line-clamp-2">
                                {conversation.lastMessage}
                              </div>
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="text-xs text-gray-500">
                          {new Date(conversation.startTime).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-gray-400">
                          {new Date(conversation.startTime).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
                {hasMoreConversations && (
                  <div className="p-3 text-center border-t border-gray-100">
                    <button
                      onClick={() => loadConversations(true)}
                      disabled={isFetching}
                      className="px-3 py-1.5 text-xs font-medium text-gray-700 bg-gray-100 rounded hover:bg-gray-200 disabled:opacity-50 transition-colors"
                    >
                      {isFetching ? "Loading..." : "Load More"}
                    </button>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </main>
    </Layout>
  );
}
