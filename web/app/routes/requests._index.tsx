import type { MetaFunction } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { useState, useEffect, useTransition } from "react";
import {
  Brain,
  Sparkles,
  Zap,
  Loader2,
  ArrowLeftRight
} from "lucide-react";

import { Layout } from "../components/Layout";
import { getChatCompletionsEndpoint } from "../utils/models";

export const meta: MetaFunction = () => {
  return [
    { title: "Requests - Claude Code Monitor" },
    { name: "description", content: "Claude Code Monitor - Request History" },
  ];
};

interface Request {
  id: number;
  requestId?: string;
  conversationId?: string;
  turnNumber?: number;
  isRoot?: boolean;
  timestamp: string;
  method: string;
  endpoint: string;
  headers: Record<string, string[]>;
  originalModel?: string;
  routedModel?: string;
  body?: {
    model?: string;
    messages?: Array<{
      role: string;
      content: any;
    }>;
    system?: Array<{
      text: string;
      type: string;
      cache_control?: { type: string };
    }>;
    tools?: Array<{
      name: string;
      description: string;
      input_schema?: {
        type: string;
        properties?: Record<string, any>;
        required?: string[];
      };
    }>;
    max_tokens?: number;
    temperature?: number;
    stream?: boolean;
  };
  response?: {
    statusCode: number;
    headers: Record<string, string[]>;
    body?: {
      usage?: {
        input_tokens?: number;
        output_tokens?: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
        service_tier?: string;
      };
      [key: string]: any;
    };
    bodyText?: string;
    responseTime: number;
    streamingChunks?: string[];
    isStreaming: boolean;
    completedAt: string;
  };
  cacheCreationTokens?: number;
  cacheReadTokens?: number;
}

export default function RequestsIndex() {
  const [requests, setRequests] = useState<Request[]>([]);
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [isFetching, setIsFetching] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [requestsCurrentPage, setRequestsCurrentPage] = useState(1);
  const [hasMoreRequests, setHasMoreRequests] = useState(true);
  const [totalRequestsCount, setTotalRequestsCount] = useState(0);
  const itemsPerPage = 50;

  const loadRequests = async (filter?: string, loadMore = false) => {
    setIsFetching(true);
    const pageToFetch = loadMore ? requestsCurrentPage + 1 : 1;
    try {
      const currentModelFilter = filter || modelFilter;
      const url = new URL('/api/requests', window.location.origin);
      url.searchParams.append("page", pageToFetch.toString());
      url.searchParams.append("limit", itemsPerPage.toString());
      if (currentModelFilter !== "all") {
        url.searchParams.append("model", currentModelFilter);
      }

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const fetchedRequests = data.requests || [];
      const total = data.total || 0;
      const mappedRequests = fetchedRequests.map((req: any, index: number) => ({
        ...req,
        id: req.requestId ? `${req.requestId}_${index}` : `request_${index}`
      }));

      startTransition(() => {
        if (loadMore) {
          setRequests(prev => [...prev, ...mappedRequests]);
        } else {
          setRequests(mappedRequests);
        }
        setRequestsCurrentPage(pageToFetch);
        setHasMoreRequests(mappedRequests.length === itemsPerPage);
        setTotalRequestsCount(total);
      });
    } catch (error) {
      console.error('Failed to load requests:', error);
      startTransition(() => {
        setRequests([]);
      });
    } finally {
      setIsFetching(false);
    }
  };

  const clearRequests = async () => {
    try {
      const response = await fetch('/api/requests', {
        method: 'DELETE'
      });

      if (response.ok) {
        setRequests([]);
        setRequestsCurrentPage(1);
        setHasMoreRequests(true);
      }
    } catch (error) {
      console.error('Failed to clear requests:', error);
      setRequests([]);
    }
  };

  const handleModelFilterChange = (newFilter: string) => {
    setModelFilter(newFilter);
    loadRequests(newFilter);
  };

  useEffect(() => {
    loadRequests(modelFilter);
  }, []);

  return (
    <Layout onRefresh={() => loadRequests()} onClear={clearRequests}>
      {/* Filter buttons */}
      <div className="mb-6 flex justify-center">
        <div className="inline-flex items-center bg-gray-100 rounded p-0.5 space-x-0.5">
          <button
            onClick={() => handleModelFilterChange("all")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all duration-200 ${
              modelFilter === "all"
                ? "bg-white text-gray-900 shadow-sm"
                : "bg-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            All Models
          </button>
          <button
            onClick={() => handleModelFilterChange("opus")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all duration-200 flex items-center space-x-1 ${
              modelFilter === "opus"
                ? "bg-white text-purple-600 shadow-sm"
                : "bg-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            <Brain className="w-3 h-3" />
            <span>Opus</span>
          </button>
          <button
            onClick={() => handleModelFilterChange("sonnet")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all duration-200 flex items-center space-x-1 ${
              modelFilter === "sonnet"
                ? "bg-white text-indigo-600 shadow-sm"
                : "bg-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            <Sparkles className="w-3 h-3" />
            <span>Sonnet</span>
          </button>
          <button
            onClick={() => handleModelFilterChange("haiku")}
            className={`px-3 py-1.5 rounded text-xs font-medium transition-all duration-200 flex items-center space-x-1 ${
              modelFilter === "haiku"
                ? "bg-white text-teal-600 shadow-sm"
                : "bg-transparent text-gray-600 hover:text-gray-900"
            }`}
          >
            <Zap className="w-3 h-3" />
            <span>Haiku</span>
          </button>
        </div>
      </div>

      {/* Main Content */}
      <main className="px-6 py-8 space-y-8">
        {/* Stats Grid */}
        <div className="mb-6">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total Requests
                </p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">
                  {totalRequestsCount}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Request History */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                Request History <span className="font-normal text-gray-500 normal-case">(most recent first)</span>
              </h2>
            </div>
          </div>
          <div className="divide-y divide-gray-200">
            {(isFetching && requestsCurrentPage === 1) || isPending ? (
              <div className="p-8 text-center">
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-gray-400" />
                <p className="mt-2 text-xs text-gray-500">Loading requests...</p>
              </div>
            ) : requests.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <h3 className="text-sm font-medium text-gray-600 mb-1">No requests found</h3>
                <p className="text-xs text-gray-500">Make sure you have set <code className="font-mono bg-gray-100 px-1 py-0.5 rounded">ANTHROPIC_BASE_URL</code> to point at the proxy</p>
              </div>
            ) : (
              <>
                {requests.map(request => (
                  <Link
                    key={request.id}
                    to={`/requests/${request.requestId}`}
                    className="block px-4 py-3 hover:bg-gray-50 transition-colors cursor-pointer border-b border-gray-100 last:border-b-0"
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1 min-w-0 mr-4">
                        {/* Model and Status */}
                        <div className="flex items-center space-x-3 mb-1">
                          <h3 className="text-sm font-medium">
                            {request.routedModel || request.body?.model ? (
                              (() => {
                                const model = request.routedModel || request.body?.model || '';
                                if (model.includes('opus')) return <span className="text-purple-600 font-semibold">Opus</span>;
                                if (model.includes('sonnet')) return <span className="text-indigo-600 font-semibold">Sonnet</span>;
                                if (model.includes('haiku')) return <span className="text-teal-600 font-semibold">Haiku</span>;
                                if (model.includes('gpt-4o')) return <span className="text-green-600 font-semibold">GPT-4o</span>;
                                if (model.includes('gpt')) return <span className="text-green-600 font-semibold">GPT</span>;
                                return <span className="text-gray-900">{model.split('-')[0]}</span>;
                              })()
                            ) : <span className="text-gray-900">API</span>}
                          </h3>
                          {request.routedModel && request.routedModel !== request.originalModel && (
                            <span className="text-xs px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded font-medium flex items-center space-x-1">
                              <ArrowLeftRight className="w-3 h-3" />
                              <span>routed</span>
                            </span>
                          )}
                          {request.response?.statusCode && (
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                              request.response.statusCode >= 200 && request.response.statusCode < 300
                                ? 'bg-green-100 text-green-700'
                                : request.response.statusCode >= 300 && request.response.statusCode < 400
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                            }`}>
                              {request.response.statusCode}
                            </span>
                          )}
                          {request.conversationId && (
                            <span className="text-xs px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">
                              Turn {request.turnNumber}
                            </span>
                          )}
                        </div>

                        {/* Endpoint */}
                        <div className="text-xs text-gray-600 font-mono mb-1">
                          {getChatCompletionsEndpoint(request.routedModel, request.endpoint)}
                        </div>

                        {/* Metrics Row */}
                        <div className="flex items-center space-x-3 text-xs">
                          {request.response?.body?.usage && (
                            <>
                              <span className="font-mono text-gray-600">
                                <span className="font-medium text-gray-900">{(request.response.body.usage.input_tokens || 0).toLocaleString()}</span> in
                              </span>
                              <span className="font-mono text-gray-600">
                                <span className="font-medium text-gray-900">{(request.response.body.usage.output_tokens || 0).toLocaleString()}</span> out
                              </span>
                            </>
                          )}
                          {/* Cache Read - Green */}
                          {request.cacheReadTokens && request.cacheReadTokens > 0 ? (
                            <span className="font-mono bg-green-50 text-green-700 px-1.5 py-0.5 rounded">
                              {request.cacheReadTokens.toLocaleString()} read
                            </span>
                          ) : null}
                          {/* Cache Creation - Red */}
                          {request.cacheCreationTokens && request.cacheCreationTokens > 0 ? (
                            <span className="font-mono bg-red-50 text-red-700 px-1.5 py-0.5 rounded">
                              {request.cacheCreationTokens.toLocaleString()} write
                            </span>
                          ) : null}

                          {request.response?.responseTime && (
                            <span className="font-mono text-gray-600">
                              <span className="font-medium text-gray-900">{(request.response.responseTime / 1000).toFixed(2)}</span>s
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="text-xs text-gray-500">
                          {new Date(request.timestamp).toLocaleDateString()}
                        </div>
                        <div className="text-xs text-gray-400">
                          {new Date(request.timestamp).toLocaleTimeString()}
                        </div>
                      </div>
                    </div>
                  </Link>
                ))}
                {hasMoreRequests && (
                  <div className="p-3 text-center border-t border-gray-100">
                    <button
                      onClick={() => loadRequests(modelFilter, true)}
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
