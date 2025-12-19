import type { MetaFunction } from "@remix-run/node";
import { useState, useEffect, useTransition, useMemo } from "react";
import { Link } from "@remix-run/react";
import { Loader2 } from "lucide-react";

import { Layout } from "../components/Layout";

export const meta: MetaFunction = () => {
  return [
    { title: "Token Usage - Claude Code Monitor" },
    { name: "description", content: "Claude Code Monitor - Token Usage" },
  ];
};

interface UsageRecord {
  id: string;
  input_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_ephemeral_5m_input_tokens: number;
  cache_creation_ephemeral_1h_input_tokens: number;
  output_tokens: number;
  service_tier: string;
  timestamp: string;
  user_agent: string;
  model: string;
  input_cost: number;
  cache_creation_cost: number;
  cache_read_cost: number;
  cache_5m_cost: number;
  cache_1h_cost: number;
  output_cost: number;
  total_cost: number;
  input_pct: number;
  cache_creation_pct: number;
  cache_read_pct: number;
  cache_5m_pct: number;
  cache_1h_pct: number;
  output_pct: number;
}

interface PricingModel {
  model: string;
  display_name: string;
  family: string;
  pricing_date: string;
  pricing_tier: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_ephemeral_5m_input_tokens: number;
  cache_creation_ephemeral_1h_input_tokens: number;
}

export default function TokensIndex() {
  const [usageRecords, setUsageRecords] = useState<UsageRecord[]>([]);
  const [pricingModels, setPricingModels] = useState<PricingModel[]>([]);
  const [totalUsageCount, setTotalUsageCount] = useState(0);
  const [usageSortBy, setUsageSortBy] = useState("timestamp");
  const [usageSortOrder, setUsageSortOrder] = useState<"ASC" | "DESC">("DESC");
  const [isFetching, setIsFetching] = useState(false);
  const [isPending, startTransition] = useTransition();

  const loadUsage = async (sortBy: string = usageSortBy, sortOrder: "ASC" | "DESC" = usageSortOrder) => {
    setIsFetching(true);
    try {
      const url = new URL('/api/usage', window.location.origin);
      url.searchParams.append("sortBy", sortBy);
      url.searchParams.append("sortOrder", sortOrder);

      const response = await fetch(url.toString());
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      const records = data.records || [];
      const total = data.total || 0;

      startTransition(() => {
        setUsageRecords(records);
        setTotalUsageCount(total);
      });
    } catch (error) {
      console.error('Failed to load usage:', error);
      startTransition(() => {
        setUsageRecords([]);
      });
    } finally {
      setIsFetching(false);
    }
  };

  const loadPricing = async () => {
    try {
      const response = await fetch('/api/pricing');
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      setPricingModels(data.models || []);
    } catch (error) {
      console.error('Failed to load pricing:', error);
      setPricingModels([]);
    }
  };

  const handleUsageSort = (column: string) => {
    const newOrder = column === usageSortBy && usageSortOrder === "DESC" ? "ASC" : "DESC";
    setUsageSortBy(column);
    setUsageSortOrder(newOrder);
    loadUsage(column, newOrder);
  };

  useEffect(() => {
    loadUsage();
    loadPricing();
  }, []);

  const handleRefresh = () => {
    loadUsage();
    loadPricing();
  };

  const totals = useMemo(() => {
    if (usageRecords.length === 0) return null;

    const sum = {
      input_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_ephemeral_5m_input_tokens: 0,
      cache_creation_ephemeral_1h_input_tokens: 0,
      output_tokens: 0,
      input_cost: 0,
      cache_creation_cost: 0,
      cache_read_cost: 0,
      cache_5m_cost: 0,
      cache_1h_cost: 0,
      output_cost: 0,
      total_cost: 0,
    };

    for (const record of usageRecords) {
      sum.input_tokens += record.input_tokens || 0;
      sum.cache_creation_input_tokens += record.cache_creation_input_tokens || 0;
      sum.cache_read_input_tokens += record.cache_read_input_tokens || 0;
      sum.cache_creation_ephemeral_5m_input_tokens += record.cache_creation_ephemeral_5m_input_tokens || 0;
      sum.cache_creation_ephemeral_1h_input_tokens += record.cache_creation_ephemeral_1h_input_tokens || 0;
      sum.output_tokens += record.output_tokens || 0;
      sum.input_cost += record.input_cost || 0;
      sum.cache_creation_cost += record.cache_creation_cost || 0;
      sum.cache_read_cost += record.cache_read_cost || 0;
      sum.cache_5m_cost += record.cache_5m_cost || 0;
      sum.cache_1h_cost += record.cache_1h_cost || 0;
      sum.output_cost += record.output_cost || 0;
      sum.total_cost += record.total_cost || 0;
    }

    // Compute percentages based on total cost
    const pct = {
      input_pct: sum.total_cost > 0 ? (sum.input_cost / sum.total_cost) * 100 : 0,
      cache_creation_pct: sum.total_cost > 0 ? (sum.cache_creation_cost / sum.total_cost) * 100 : 0,
      cache_read_pct: sum.total_cost > 0 ? (sum.cache_read_cost / sum.total_cost) * 100 : 0,
      cache_5m_pct: sum.total_cost > 0 ? (sum.cache_5m_cost / sum.total_cost) * 100 : 0,
      cache_1h_pct: sum.total_cost > 0 ? (sum.cache_1h_cost / sum.total_cost) * 100 : 0,
      output_pct: sum.total_cost > 0 ? (sum.output_cost / sum.total_cost) * 100 : 0,
    };

    return { ...sum, ...pct };
  }, [usageRecords]);

  const averages = useMemo(() => {
    if (!totals || usageRecords.length === 0) return null;

    const count = usageRecords.length;
    const avg = {
      input_tokens: Math.round(totals.input_tokens / count),
      cache_creation_input_tokens: Math.round(totals.cache_creation_input_tokens / count),
      cache_read_input_tokens: Math.round(totals.cache_read_input_tokens / count),
      cache_creation_ephemeral_5m_input_tokens: Math.round(totals.cache_creation_ephemeral_5m_input_tokens / count),
      cache_creation_ephemeral_1h_input_tokens: Math.round(totals.cache_creation_ephemeral_1h_input_tokens / count),
      output_tokens: Math.round(totals.output_tokens / count),
      input_cost: totals.input_cost / count,
      cache_creation_cost: totals.cache_creation_cost / count,
      cache_read_cost: totals.cache_read_cost / count,
      cache_5m_cost: totals.cache_5m_cost / count,
      cache_1h_cost: totals.cache_1h_cost / count,
      output_cost: totals.output_cost / count,
      total_cost: totals.total_cost / count,
      // Percentages are the same as totals (they're ratios, not sums)
      input_pct: totals.input_pct,
      cache_creation_pct: totals.cache_creation_pct,
      cache_read_pct: totals.cache_read_pct,
      cache_5m_pct: totals.cache_5m_pct,
      cache_1h_pct: totals.cache_1h_pct,
      output_pct: totals.output_pct,
    };

    return avg;
  }, [totals, usageRecords.length]);

  return (
    <Layout onRefresh={handleRefresh}>
      <main className="px-6 py-8 space-y-8">
        {/* Stats Grid */}
        <div className="mb-6">
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total Usage Records
                </p>
                <p className="text-2xl font-semibold text-gray-900 mt-1">
                  {totalUsageCount}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Pricing Summary */}
        {pricingModels.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
              <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">Pricing Rates</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-100">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-gray-700">Model</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">Input</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">Output</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">Cache Read</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">Cache 5m</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">Cache 1h</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {pricingModels.map((pricing) => (
                    <tr key={pricing.model} className="hover:bg-gray-50">
                      <td className="px-3 py-2 font-medium text-gray-900">{pricing.display_name}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-700">${pricing.input_tokens.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-gray-700">${pricing.output_tokens.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-green-600">${pricing.cache_read_input_tokens.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-orange-600">${pricing.cache_creation_ephemeral_5m_input_tokens.toFixed(2)}</td>
                      <td className="px-3 py-2 text-right font-mono text-amber-600">${pricing.cache_creation_ephemeral_1h_input_tokens.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="px-3 py-2 text-xs text-gray-500 bg-gray-50 border-t border-gray-200">
                Prices per 1M tokens
              </div>
            </div>
          </div>
        )}

        {/* Token Usage Table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="bg-gray-50 px-4 py-3 border-b border-gray-200">
            <h2 className="text-sm font-semibold text-gray-900 uppercase tracking-wider">
              Token Usage <span className="font-normal text-gray-500 normal-case">(click column to sort)</span>
            </h2>
          </div>
          <div className="overflow-auto max-h-[70vh]">
            {isFetching || isPending ? (
              <div className="p-8 text-center">
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-gray-400" />
                <p className="mt-2 text-xs text-gray-500">Loading usage data...</p>
              </div>
            ) : usageRecords.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <h3 className="text-sm font-medium text-gray-600 mb-1">No usage data found</h3>
                <p className="text-xs text-gray-500">Usage data will appear here after API calls are made</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-20">
                  {/* Group headers */}
                  <tr className="bg-gray-200">
                    <th colSpan={4} className="px-3 py-1 text-left text-xs font-semibold text-gray-600 border-r border-gray-300"></th>
                    <th colSpan={6} className="px-3 py-1 text-center text-xs font-semibold text-gray-600 border-r border-gray-300">Tokens</th>
                    <th colSpan={6} className="px-3 py-1 text-center text-xs font-semibold text-blue-700 border-r border-gray-300">% of Total Cost</th>
                    <th colSpan={7} className="px-3 py-1 text-center text-xs font-semibold text-green-700">Cost (cents)</th>
                  </tr>
                  {/* Column headers */}
                  <tr className="bg-gray-100">
                    {/* Info columns */}
                    <th onClick={() => handleUsageSort("user_agent")} className="px-3 py-2 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-200">
                      <div className="flex items-center space-x-1">
                        <span>User Agent</span>
                        {usageSortBy === "user_agent" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                    <th onClick={() => handleUsageSort("id")} className="px-3 py-2 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-200">
                      <div className="flex items-center space-x-1">
                        <span>Request</span>
                        {usageSortBy === "id" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                    <th onClick={() => handleUsageSort("timestamp")} className="px-3 py-2 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-200">
                      <div className="flex items-center space-x-1">
                        <span>Timestamp</span>
                        {usageSortBy === "timestamp" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                    <th onClick={() => handleUsageSort("model")} className="px-3 py-2 text-left font-medium text-gray-700 cursor-pointer hover:bg-gray-200 border-r border-gray-300">
                      <div className="flex items-center space-x-1">
                        <span>Model</span>
                        {usageSortBy === "model" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                    {/* Token columns */}
                    <th onClick={() => handleUsageSort("input_tokens")} className="px-3 py-2 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-200">
                      <div className="flex items-center justify-end space-x-1">
                        <span>Input</span>
                        {usageSortBy === "input_tokens" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                    <th onClick={() => handleUsageSort("cache_creation_input_tokens")} className="px-3 py-2 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-200">
                      <div className="flex items-center justify-end space-x-1">
                        <span>Cache Create</span>
                        {usageSortBy === "cache_creation_input_tokens" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                    <th onClick={() => handleUsageSort("cache_read_input_tokens")} className="px-3 py-2 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-200">
                      <div className="flex items-center justify-end space-x-1">
                        <span>Cache Read</span>
                        {usageSortBy === "cache_read_input_tokens" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                    <th onClick={() => handleUsageSort("cache_creation_ephemeral_5m_input_tokens")} className="px-3 py-2 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-200">
                      <div className="flex items-center justify-end space-x-1">
                        <span>Cache 5m</span>
                        {usageSortBy === "cache_creation_ephemeral_5m_input_tokens" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                    <th onClick={() => handleUsageSort("cache_creation_ephemeral_1h_input_tokens")} className="px-3 py-2 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-200">
                      <div className="flex items-center justify-end space-x-1">
                        <span>Cache 1h</span>
                        {usageSortBy === "cache_creation_ephemeral_1h_input_tokens" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                    <th onClick={() => handleUsageSort("output_tokens")} className="px-3 py-2 text-right font-medium text-gray-700 cursor-pointer hover:bg-gray-200 border-r border-gray-300">
                      <div className="flex items-center justify-end space-x-1">
                        <span>Output</span>
                        {usageSortBy === "output_tokens" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                    {/* Percentage columns */}
                    <th className="px-3 py-2 text-right font-medium text-blue-700">Input</th>
                    <th className="px-3 py-2 text-right font-medium text-blue-700">Cache Create</th>
                    <th className="px-3 py-2 text-right font-medium text-blue-700">Cache Read</th>
                    <th className="px-3 py-2 text-right font-medium text-blue-700">Cache 5m</th>
                    <th className="px-3 py-2 text-right font-medium text-blue-700">Cache 1h</th>
                    <th className="px-3 py-2 text-right font-medium text-blue-700 border-r border-gray-300">Output</th>
                    {/* Cost columns */}
                    <th onClick={() => handleUsageSort("input_cost")} className="px-3 py-2 text-right font-medium text-green-700 cursor-pointer hover:bg-gray-200">
                      <div className="flex items-center justify-end space-x-1">
                        <span>Input</span>
                        {usageSortBy === "input_cost" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                    <th className="px-3 py-2 text-right font-medium text-green-700">Cache Create</th>
                    <th className="px-3 py-2 text-right font-medium text-green-700">Cache Read</th>
                    <th className="px-3 py-2 text-right font-medium text-green-700">Cache 5m</th>
                    <th className="px-3 py-2 text-right font-medium text-green-700">Cache 1h</th>
                    <th onClick={() => handleUsageSort("output_cost")} className="px-3 py-2 text-right font-medium text-green-700 cursor-pointer hover:bg-gray-200">
                      <div className="flex items-center justify-end space-x-1">
                        <span>Output</span>
                        {usageSortBy === "output_cost" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                    <th onClick={() => handleUsageSort("total_cost")} className="px-3 py-2 text-right font-medium text-green-700 cursor-pointer hover:bg-gray-200">
                      <div className="flex items-center justify-end space-x-1">
                        <span>Total</span>
                        {usageSortBy === "total_cost" && <span className="text-blue-600">{usageSortOrder === "DESC" ? "↓" : "↑"}</span>}
                      </div>
                    </th>
                  </tr>
                  {/* Summary row in thead for sticky behavior */}
                  {totals && (
                    <tr className="bg-amber-50 font-semibold border-t-2 border-amber-300">
                      {/* Info columns */}
                      <td colSpan={3} className="px-3 py-2 text-amber-800">
                        TOTALS ({usageRecords.length} records)
                      </td>
                      <td className="px-3 py-2 border-r border-amber-200 text-amber-800">-</td>
                      {/* Token columns */}
                      <td className="px-3 py-2 font-mono text-right text-gray-900">
                        {totals.input_tokens.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {totals.cache_creation_input_tokens > 0 ? (
                          <span className="text-blue-700">{totals.cache_creation_input_tokens.toLocaleString()}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {totals.cache_read_input_tokens > 0 ? (
                          <span className="text-green-700">{totals.cache_read_input_tokens.toLocaleString()}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {totals.cache_creation_ephemeral_5m_input_tokens > 0 ? (
                          <span className="text-orange-700">{totals.cache_creation_ephemeral_5m_input_tokens.toLocaleString()}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {totals.cache_creation_ephemeral_1h_input_tokens > 0 ? (
                          <span className="text-amber-700">{totals.cache_creation_ephemeral_1h_input_tokens.toLocaleString()}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-900 border-r border-amber-200">
                        {totals.output_tokens.toLocaleString()}
                      </td>
                      {/* Percentage columns */}
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {totals.input_pct > 0 ? `${totals.input_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {totals.cache_creation_pct > 0 ? `${totals.cache_creation_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {totals.cache_read_pct > 0 ? `${totals.cache_read_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {totals.cache_5m_pct > 0 ? `${totals.cache_5m_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {totals.cache_1h_pct > 0 ? `${totals.cache_1h_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-700 border-r border-amber-200">
                        {totals.output_pct > 0 ? `${totals.output_pct.toFixed(1)}%` : '-'}
                      </td>
                      {/* Cost columns (in cents) */}
                      <td className="px-3 py-2 font-mono text-right text-gray-900">
                        {(totals.input_cost / 10000).toFixed(1)}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {totals.cache_creation_cost > 0 ? (
                          <span className="text-blue-700">{(totals.cache_creation_cost / 10000).toFixed(1)}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {totals.cache_read_cost > 0 ? (
                          <span className="text-green-700">{(totals.cache_read_cost / 10000).toFixed(1)}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {totals.cache_5m_cost > 0 ? (
                          <span className="text-orange-700">{(totals.cache_5m_cost / 10000).toFixed(1)}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {totals.cache_1h_cost > 0 ? (
                          <span className="text-amber-700">{(totals.cache_1h_cost / 10000).toFixed(1)}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-900">
                        {(totals.output_cost / 10000).toFixed(1)}
                      </td>
                      <td className="px-3 py-2 font-mono text-right font-bold text-green-800">
                        {(totals.total_cost / 10000).toFixed(1)}
                      </td>
                    </tr>
                  )}
                  {/* Averages row */}
                  {averages && (
                    <tr className="bg-blue-50 font-semibold border-t border-blue-200">
                      {/* Info columns */}
                      <td colSpan={3} className="px-3 py-2 text-blue-800">
                        AVERAGES (per request)
                      </td>
                      <td className="px-3 py-2 border-r border-blue-200 text-blue-800">-</td>
                      {/* Token columns */}
                      <td className="px-3 py-2 font-mono text-right text-gray-900">
                        {averages.input_tokens.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {averages.cache_creation_input_tokens > 0 ? (
                          <span className="text-blue-700">{averages.cache_creation_input_tokens.toLocaleString()}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {averages.cache_read_input_tokens > 0 ? (
                          <span className="text-green-700">{averages.cache_read_input_tokens.toLocaleString()}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {averages.cache_creation_ephemeral_5m_input_tokens > 0 ? (
                          <span className="text-orange-700">{averages.cache_creation_ephemeral_5m_input_tokens.toLocaleString()}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {averages.cache_creation_ephemeral_1h_input_tokens > 0 ? (
                          <span className="text-amber-700">{averages.cache_creation_ephemeral_1h_input_tokens.toLocaleString()}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-900 border-r border-blue-200">
                        {averages.output_tokens.toLocaleString()}
                      </td>
                      {/* Percentage columns - same as totals since they're ratios */}
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {averages.input_pct > 0 ? `${averages.input_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {averages.cache_creation_pct > 0 ? `${averages.cache_creation_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {averages.cache_read_pct > 0 ? `${averages.cache_read_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {averages.cache_5m_pct > 0 ? `${averages.cache_5m_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {averages.cache_1h_pct > 0 ? `${averages.cache_1h_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-700 border-r border-blue-200">
                        {averages.output_pct > 0 ? `${averages.output_pct.toFixed(1)}%` : '-'}
                      </td>
                      {/* Cost columns (in cents) */}
                      <td className="px-3 py-2 font-mono text-right text-gray-900">
                        {(averages.input_cost / 10000).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {averages.cache_creation_cost > 0 ? (
                          <span className="text-blue-700">{(averages.cache_creation_cost / 10000).toFixed(2)}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {averages.cache_read_cost > 0 ? (
                          <span className="text-green-700">{(averages.cache_read_cost / 10000).toFixed(2)}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {averages.cache_5m_cost > 0 ? (
                          <span className="text-orange-700">{(averages.cache_5m_cost / 10000).toFixed(2)}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {averages.cache_1h_cost > 0 ? (
                          <span className="text-amber-700">{(averages.cache_1h_cost / 10000).toFixed(2)}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-900">
                        {(averages.output_cost / 10000).toFixed(2)}
                      </td>
                      <td className="px-3 py-2 font-mono text-right font-bold text-blue-800">
                        {(averages.total_cost / 10000).toFixed(2)}
                      </td>
                    </tr>
                  )}
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {usageRecords.map((record) => (
                    <tr key={record.id} className="hover:bg-gray-50">
                      {/* Info columns */}
                      <td className="px-3 py-2 text-gray-500 max-w-[150px] truncate" title={record.user_agent}>
                        {record.user_agent || '-'}
                      </td>
                      <td className="px-3 py-2 font-mono">
                        <Link
                          to={`/requests/${record.id.slice(-12)}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline"
                        >
                          {record.id.slice(-12)}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                        {record.timestamp ? (
                          <span title={record.timestamp}>
                            {new Date(record.timestamp).toLocaleDateString()} {new Date(record.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        ) : '-'}
                      </td>
                      <td className="px-3 py-2 border-r border-gray-200">
                        {record.model ? (
                          <span className={`font-medium ${
                            record.model.includes('opus') ? 'text-purple-600' :
                            record.model.includes('sonnet') ? 'text-indigo-600' :
                            record.model.includes('haiku') ? 'text-teal-600' : 'text-gray-700'
                          }`}>
                            {record.model.includes('opus') ? 'Opus' :
                             record.model.includes('sonnet') ? 'Sonnet' :
                             record.model.includes('haiku') ? 'Haiku' : record.model}
                          </span>
                        ) : '-'}
                      </td>
                      {/* Token columns */}
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {record.input_tokens.toLocaleString()}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {record.cache_creation_input_tokens > 0 ? (
                          <span className="text-blue-600">{record.cache_creation_input_tokens.toLocaleString()}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {record.cache_read_input_tokens > 0 ? (
                          <span className="text-green-600">{record.cache_read_input_tokens.toLocaleString()}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {record.cache_creation_ephemeral_5m_input_tokens > 0 ? (
                          <span className="text-orange-600">{record.cache_creation_ephemeral_5m_input_tokens.toLocaleString()}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {record.cache_creation_ephemeral_1h_input_tokens > 0 ? (
                          <span className="text-amber-600">{record.cache_creation_ephemeral_1h_input_tokens.toLocaleString()}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-700 border-r border-gray-200">
                        {record.output_tokens.toLocaleString()}
                      </td>
                      {/* Percentage columns */}
                      <td className="px-3 py-2 font-mono text-right text-gray-600">
                        {record.input_pct > 0 ? `${record.input_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-600">
                        {record.cache_creation_pct > 0 ? `${record.cache_creation_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-600">
                        {record.cache_read_pct > 0 ? `${record.cache_read_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-600">
                        {record.cache_5m_pct > 0 ? `${record.cache_5m_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-600">
                        {record.cache_1h_pct > 0 ? `${record.cache_1h_pct.toFixed(1)}%` : '-'}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-600 border-r border-gray-200">
                        {record.output_pct > 0 ? `${record.output_pct.toFixed(1)}%` : '-'}
                      </td>
                      {/* Cost columns (in cents) */}
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {(record.input_cost / 10000).toFixed(1)}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {record.cache_creation_cost > 0 ? (
                          <span className="text-blue-600">{(record.cache_creation_cost / 10000).toFixed(1)}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {record.cache_read_cost > 0 ? (
                          <span className="text-green-600">{(record.cache_read_cost / 10000).toFixed(1)}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {record.cache_5m_cost > 0 ? (
                          <span className="text-orange-600">{(record.cache_5m_cost / 10000).toFixed(1)}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right">
                        {record.cache_1h_cost > 0 ? (
                          <span className="text-amber-600">{(record.cache_1h_cost / 10000).toFixed(1)}</span>
                        ) : <span className="text-gray-400">0</span>}
                      </td>
                      <td className="px-3 py-2 font-mono text-right text-gray-700">
                        {(record.output_cost / 10000).toFixed(1)}
                      </td>
                      <td className="px-3 py-2 font-mono text-right font-medium text-green-700">
                        {(record.total_cost / 10000).toFixed(1)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </main>
    </Layout>
  );
}
