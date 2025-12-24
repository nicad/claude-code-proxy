import type { MetaFunction } from "@remix-run/node";
import { Link } from "@remix-run/react";
import { useState, useEffect, useTransition, useRef } from "react";
import {
  Brain,
  Sparkles,
  Zap,
  Loader2,
  ArrowLeftRight,
  ChevronLeft,
  ChevronRight
} from "lucide-react";

import { Layout } from "../components/Layout";
import { UsageDashboard } from "../components/UsageDashboard";
import { getChatCompletionsEndpoint } from "../utils/models";

export const meta: MetaFunction = () => {
  return [
    { title: "Requests - Claude Code Monitor" },
    { name: "description", content: "Claude Code Monitor - Request History" },
  ];
};

// Summary structure from /api/requests/summary endpoint
interface RequestSummary {
  id: string;
  requestId: string;
  timestamp: string;
  method: string;
  endpoint: string;
  model?: string;
  originalModel?: string;
  routedModel?: string;
  statusCode?: number;
  responseTime?: number;
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
}

interface ModelStats {
  tokens: number;
  requests: number;
}

interface DashboardStats {
  dailyStats: { date: string; tokens: number; requests: number; models?: Record<string, ModelStats>; }[];
  hourlyStats: { hour: number; tokens: number; requests: number; models?: Record<string, ModelStats>; }[];
  modelStats: { model: string; tokens: number; requests: number; }[];
  todayTokens: number;
  todayRequests: number;
  avgResponseTime: number;
}

export default function RequestsIndex() {
  const [requests, setRequests] = useState<RequestSummary[]>([]);
  const [modelFilter, setModelFilter] = useState<string>("all");
  const [isFetching, setIsFetching] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [totalRequestsCount, setTotalRequestsCount] = useState(0);

  // Date navigation state
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [currentWeekStart, setCurrentWeekStart] = useState<Date | null>(null);
  const [isNavigating, setIsNavigating] = useState(false);
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [isLoadingStats, setIsLoadingStats] = useState(false);

  // Virtualization ref for requests list
  const requestsParentRef = useRef<HTMLDivElement>(null);

  // Helper to get Sunday-Saturday week boundaries for a given date
  const getWeekBoundaries = (date: Date) => {
    const weekStart = new Date(date);
    weekStart.setHours(0, 0, 0, 0);
    const dayOfWeek = weekStart.getDay(); // 0 = Sunday
    weekStart.setDate(weekStart.getDate() - dayOfWeek); // Go back to Sunday

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6); // Saturday
    weekEnd.setHours(23, 59, 59, 999);

    return { weekStart, weekEnd };
  };

  // Get timestamps for start and end of local day
  const getLocalDayBoundaries = (date: Date) => {
    const startOfDay = new Date(date);
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date(date);
    endOfDay.setHours(23, 59, 59, 999);

    return {
      start: startOfDay.toISOString(),
      end: endOfDay.toISOString()
    };
  };

  // Load weekly stats only (for week navigation)
  const loadWeeklyStats = async (date?: Date) => {
    const targetDate = date || selectedDate;
    const { weekStart, weekEnd } = getWeekBoundaries(targetDate);

    const weeklyUrl = new URL('/api/stats', window.location.origin);
    weeklyUrl.searchParams.append('start', weekStart.toISOString());
    weeklyUrl.searchParams.append('end', weekEnd.toISOString());

    const response = await fetch(weeklyUrl.toString());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    return response.json();
  };

  // Load hourly stats only
  const loadHourlyStats = async (date?: Date) => {
    const targetDate = date || selectedDate;
    const { start, end } = getLocalDayBoundaries(targetDate);

    const hourlyUrl = new URL('/api/stats/hourly', window.location.origin);
    hourlyUrl.searchParams.append('start', start);
    hourlyUrl.searchParams.append('end', end);

    const response = await fetch(hourlyUrl.toString());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    return response.json();
  };

  // Load model stats only
  const loadModelStats = async (date?: Date) => {
    const targetDate = date || selectedDate;
    const { start, end } = getLocalDayBoundaries(targetDate);

    const modelUrl = new URL('/api/stats/models', window.location.origin);
    modelUrl.searchParams.append('start', start);
    modelUrl.searchParams.append('end', end);

    const response = await fetch(modelUrl.toString());
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    return response.json();
  };

  // Load all stats (weekly + hourly + models)
  const loadStats = async (date?: Date) => {
    setIsLoadingStats(true);
    try {
      const targetDate = date || selectedDate;
      const { weekStart } = getWeekBoundaries(targetDate);

      const [weeklyData, hourlyData, modelData] = await Promise.all([
        loadWeeklyStats(targetDate),
        loadHourlyStats(targetDate),
        loadModelStats(targetDate)
      ]);

      setStats({
        ...weeklyData,
        ...hourlyData,
        ...modelData
      });
      setCurrentWeekStart(weekStart);
    } catch (error) {
      console.error('Failed to load stats:', error);
    } finally {
      setIsLoadingStats(false);
    }
  };

  // Load requests for a specific date using summary endpoint
  const loadRequests = async (filter?: string, date?: Date) => {
    setIsFetching(true);
    try {
      const currentModelFilter = filter || modelFilter;
      const targetDate = date || selectedDate;
      const { start, end } = getLocalDayBoundaries(targetDate);

      const url = new URL('/api/requests/summary', window.location.origin);
      if (currentModelFilter !== "all") {
        url.searchParams.append("model", currentModelFilter);
      }
      url.searchParams.append("start", start);
      url.searchParams.append("end", end);

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const fetchedRequests = data.requests || [];
      const total = data.total || fetchedRequests.length;
      const mappedRequests = fetchedRequests.map((req: any, index: number) => ({
        ...req,
        id: req.requestId ? `${req.requestId}_${index}` : `request_${index}`
      }));

      startTransition(() => {
        setRequests(mappedRequests);
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
        loadStats(selectedDate);
      }
    } catch (error) {
      console.error('Failed to clear requests:', error);
      setRequests([]);
    }
  };

  const handleModelFilterChange = (newFilter: string) => {
    setModelFilter(newFilter);
    loadRequests(newFilter, selectedDate);
  };

  const handleDateChange = async (newDate: Date) => {
    if (isNavigating) return;

    setIsNavigating(true);
    try {
      const { weekStart: newWeekStart } = getWeekBoundaries(newDate);
      const needsNewWeek = !currentWeekStart ||
        newWeekStart.getTime() !== currentWeekStart.getTime();

      setSelectedDate(newDate);

      if (needsNewWeek) {
        setCurrentWeekStart(newWeekStart);
        await loadStats(newDate);
      } else {
        const [hourlyData, modelData] = await Promise.all([
          loadHourlyStats(newDate),
          loadModelStats(newDate)
        ]);

        if (hourlyData && modelData) {
          setStats(prev => {
            if (!prev) return { dailyStats: [], hourlyStats: [], modelStats: [], todayTokens: 0, todayRequests: 0, avgResponseTime: 0, ...hourlyData, ...modelData };
            return {
              ...prev,
              ...hourlyData,
              ...modelData
            };
          });
        }
      }

      loadRequests(modelFilter, newDate);
    } catch (error) {
      console.error('Error in handleDateChange:', error);
    } finally {
      setIsNavigating(false);
    }
  };

  useEffect(() => {
    const initializeData = async () => {
      await loadStats();
      await loadRequests(modelFilter);
    };
    initializeData();
  }, []);

  return (
    <Layout onRefresh={() => { loadStats(selectedDate); loadRequests(modelFilter, selectedDate); }} onClear={clearRequests}>
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
      <main className="px-6 py-8 space-y-6">
        {/* Date Navigation */}
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-semibold text-gray-900">Request History</h2>
          <div className="flex items-center space-x-3">
            <button
              onClick={() => {
                const newDate = new Date(selectedDate);
                newDate.setDate(newDate.getDate() - 1);
                handleDateChange(newDate);
              }}
              disabled={isNavigating}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4 text-gray-600" />
            </button>
            <span className={`text-sm font-medium min-w-[80px] text-center ${
              selectedDate.toDateString() === new Date().toDateString()
                ? 'text-gray-900 font-semibold'
                : 'text-gray-700'
            }`}>
              {selectedDate.toDateString() === new Date().toDateString()
                ? 'Today'
                : selectedDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </span>
            <button
              onClick={() => {
                const newDate = new Date(selectedDate);
                newDate.setDate(newDate.getDate() + 1);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                newDate.setHours(0, 0, 0, 0);
                if (newDate <= today) {
                  handleDateChange(newDate);
                }
              }}
              disabled={isNavigating || (() => {
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const selected = new Date(selectedDate);
                selected.setHours(0, 0, 0, 0);
                return selected.getTime() >= today.getTime();
              })()}
              className="p-2 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4 text-gray-600" />
            </button>
          </div>
        </div>

        {/* Usage Dashboard */}
        {isLoadingStats ? (
          <div className="bg-white border border-gray-200 rounded-lg p-12 flex items-center justify-center">
            <div className="text-center">
              <Loader2 className="w-8 h-8 mx-auto animate-spin text-gray-400" />
              <p className="mt-3 text-sm text-gray-500">Loading stats...</p>
            </div>
          </div>
        ) : stats && (
          <UsageDashboard stats={stats} selectedDate={selectedDate} />
        )}

        {/* Request History */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
                Requests <span className="font-normal text-gray-500 normal-case">({totalRequestsCount} total)</span>
              </h3>
            </div>
          </div>
          <div>
            {isFetching || isPending ? (
              <div className="p-8 text-center">
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-gray-400" />
                <p className="mt-2 text-xs text-gray-500">Loading requests...</p>
              </div>
            ) : requests.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <h3 className="text-sm font-medium text-gray-600 mb-1">No requests found</h3>
                <p className="text-xs text-gray-500">No requests for this date</p>
              </div>
            ) : (
              <div
                ref={requestsParentRef}
                className="overflow-auto"
                style={{ maxHeight: '600px' }}
              >
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
                            {request.routedModel || request.model ? (
                              (() => {
                                const model = request.routedModel || request.model || '';
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
                          {request.statusCode && (
                            <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                              request.statusCode >= 200 && request.statusCode < 300
                                ? 'bg-green-100 text-green-700'
                                : request.statusCode >= 300 && request.statusCode < 400
                                ? 'bg-yellow-100 text-yellow-700'
                                : 'bg-red-100 text-red-700'
                            }`}>
                              {request.statusCode}
                            </span>
                          )}
                        </div>

                        {/* Endpoint */}
                        <div className="text-xs text-gray-600 font-mono mb-1">
                          {getChatCompletionsEndpoint(request.routedModel, request.endpoint)}
                        </div>

                        {/* Metrics Row */}
                        <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs font-mono text-gray-600">
                          {request.usage && (() => {
                            const inputTokens = request.usage.input_tokens || 0;
                            const cacheCreation = request.usage.cache_creation_input_tokens || 0;
                            const outputTokens = request.usage.output_tokens || 0;
                            const cacheRead = request.usage.cache_read_input_tokens || 0;
                            const totalInput = inputTokens + cacheCreation;
                            const cacheWritePercent = totalInput > 0 ? (cacheCreation / totalInput * 100).toFixed(0) : 0;
                            const cacheReadPercent = (cacheRead + totalInput) > 0 ? (cacheRead / (cacheRead + totalInput) * 100).toFixed(0) : 0;

                            return (
                              <>
                                <span>
                                  input: <span className="font-medium text-gray-900">{totalInput.toLocaleString()}</span>
                                  {cacheCreation > 0 && (
                                    <span className="text-red-600"> (cache write: {cacheCreation.toLocaleString()} | {cacheWritePercent}%)</span>
                                  )}
                                </span>
                                <span>
                                  output: <span className="font-medium text-gray-900">{outputTokens.toLocaleString()}</span>
                                </span>
                                {cacheRead > 0 && (
                                  <span className="text-green-600">
                                    cache read: {cacheRead.toLocaleString()} ({cacheReadPercent}%)
                                  </span>
                                )}
                              </>
                            );
                          })()}
                          {request.responseTime && (
                            <span>
                              in <span className="font-medium text-gray-900">{(request.responseTime / 1000).toFixed(2)}</span>s
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
              </div>
            )}
          </div>
        </div>
      </main>
    </Layout>
  );
}
