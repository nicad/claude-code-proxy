import type { MetaFunction } from "@remix-run/node";
import { Link, useSearchParams } from "@remix-run/react";
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { Loader2, Plus, BarChart2, X, ZoomIn, ZoomOut, Move } from "lucide-react";

import { Layout } from "../components/Layout";
import { escapeHtml } from "../utils/formatters";

export const meta: MetaFunction = () => {
  return [
    { title: "Turns - Claude Code Monitor" },
    { name: "description", content: "Claude Code Monitor - Request Turns" },
  ];
};

interface Turn {
  id: string;
  timestamp: string;
  model: string;
  context: string;
  contextDisplay: string;
  messageCount: number;
  lastMessageId: number;
  requestRole: string | null;
  requestSignature: string | null;
  requestBytes: number;
  responseRole: string | null;
  responseSignature: string | null;
  responseMessageId: number | null;
  responseBytes: number;
  streaming: boolean | null;
  stopReason: string | null;
  inputTokens: number;
  outputTokens: number;
  cacheReads: number;
  systemCount: number;
  toolsCount: number;
  reason: string;
  contextTokens: number;
  lastMsgTokens: number;
  responseTokens: number;
}

interface MessageContent {
  id: number;
  role: string;
  signature: string;
  content: unknown;
  createdAt: string;
}

interface PopupState {
  messageId: number;
  x: number;
  y: number;
}

function formatTimestamp(ts: string): string {
  const d = new Date(ts);
  return d.toLocaleString('sv-SE', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit'
  }).replace(' ', ' ');
}

function toDatetimeLocal(isoString: string): string {
  const d = new Date(isoString);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromDatetimeLocal(localString: string): string {
  return new Date(localString).toISOString();
}

function formatModel(model: string): string {
  if (model.includes('opus')) return 'Opus';
  if (model.includes('sonnet')) return 'Sonnet';
  if (model.includes('haiku')) return 'Haiku';
  return model.slice(0, 15);
}

function formatTokenCount(value: number): string {
  if (value >= 1000000) return `${(value / 1000000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(0)}K`;
  return value.toString();
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '-';
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

interface ContentBlock {
  type: string;
  text: string;
}

function extractContentBlocks(content: unknown): ContentBlock[] {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (typeof content === 'object' && content !== null) {
    const c = content as { content?: unknown; role?: string };
    if (Array.isArray(c.content)) {
      const blocks: ContentBlock[] = [];
      for (const block of c.content) {
        if (block.type === 'text' && block.text) {
          blocks.push({ type: 'text', text: block.text });
        } else if (block.type === 'tool_result') {
          const resultContent = block.content;
          if (typeof resultContent === 'string') {
            blocks.push({ type: 'tool_result', text: resultContent });
          } else if (Array.isArray(resultContent)) {
            for (const item of resultContent) {
              if (item.type === 'text' && item.text) {
                blocks.push({ type: 'tool_result', text: item.text });
              }
            }
          }
        } else if (block.type === 'tool_use') {
          const input = block.input ? JSON.stringify(block.input, null, 2) : '';
          blocks.push({ type: `tool_use:${block.name || 'unknown'}`, text: input });
        } else if (block.type === 'thinking' && block.thinking) {
          blocks.push({ type: 'thinking', text: block.thinking });
        }
      }
      return blocks;
    }
    if (typeof c.content === 'string') {
      return [{ type: 'text', text: c.content }];
    }
  }
  return [{ type: 'json', text: JSON.stringify(content, null, 2) }];
}

const PREVIEW_LIMIT = 1024; // 1KB limit for initial preview

function getBlockTypeColor(type: string): string {
  if (type === 'text') return 'bg-blue-100 text-blue-700';
  if (type === 'tool_result') return 'bg-green-100 text-green-700';
  if (type.startsWith('tool_use:')) return 'bg-purple-100 text-purple-700';
  if (type === 'thinking') return 'bg-amber-100 text-amber-700';
  return 'bg-gray-100 text-gray-700';
}

function MessagePopup({ messageId, position, onClose }: {
  messageId: number;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const [content, setContent] = useState<MessageContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [showFull, setShowFull] = useState(false);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/message-content/${messageId}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          setContent(data);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [messageId]);

  const blocks = content ? extractContentBlocks(content.content) : [];
  const totalLength = blocks.reduce((sum, b) => sum + b.text.length, 0);
  const blockCount = blocks.length;

  // For preview, we need to truncate across blocks
  const renderBlocks = (limit: number | null) => {
    let remaining = limit;
    const result: React.ReactNode[] = [];

    for (let i = 0; i < blocks.length; i++) {
      const block = blocks[i];
      const isLast = i === blocks.length - 1;

      if (limit !== null && remaining !== null && remaining <= 0) break;

      let text = block.text;
      let truncated = false;

      if (limit !== null && remaining !== null) {
        if (text.length > remaining) {
          text = text.slice(0, remaining);
          truncated = true;
        }
        remaining -= block.text.length;
      }

      result.push(
        <div key={i} className={`${i > 0 ? 'mt-3 pt-3 border-t border-gray-200' : ''}`}>
          <div className={`inline-block text-xs px-1.5 py-0.5 rounded mb-1 ${getBlockTypeColor(block.type)}`}>
            {block.type}
          </div>
          <div className="text-sm text-gray-700 whitespace-pre-wrap font-mono">
            <span dangerouslySetInnerHTML={{ __html: escapeHtml(text).replace(/\n/g, '<br>') }} />
            {truncated && <span className="text-gray-400">...</span>}
          </div>
        </div>
      );

      if (truncated) break;
    }

    return result;
  };

  return (
    <div
      className="fixed z-50 bg-white shadow-lg rounded-lg p-4 border border-gray-200"
      style={{
        left: Math.min(position.x - 20, window.innerWidth - 550),
        top: Math.min(position.y + 5, window.innerHeight - 400),
        maxWidth: showFull ? '80vw' : '32rem',
        maxHeight: showFull ? '80vh' : '24rem'
      }}
      onMouseLeave={() => { if (!showFull) onClose(); }}
    >
      {loading ? (
        <div className="flex items-center space-x-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm text-gray-500">Loading...</span>
        </div>
      ) : content ? (
        <>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center space-x-2">
              <span className="text-xs font-semibold text-gray-500 uppercase">{content.role}</span>
              <span className="text-xs text-gray-400">{content.signature}</span>
              <span className="text-xs text-gray-300">
                {blockCount > 1 ? `${blockCount} blocks` : '1 block'} · {formatBytes(totalLength)}
              </span>
            </div>
            {showFull && (
              <button
                onClick={onClose}
                className="text-xs text-gray-400 hover:text-gray-600 px-2"
              >
                close
              </button>
            )}
          </div>
          <div className={`overflow-auto ${showFull ? 'max-h-[70vh]' : 'max-h-44'}`}>
            {renderBlocks(showFull ? null : PREVIEW_LIMIT)}
          </div>
          {!showFull && totalLength > PREVIEW_LIMIT && (
            <button
              onClick={() => setShowFull(true)}
              className="mt-2 flex items-center space-x-1 text-xs text-blue-600 hover:text-blue-800"
            >
              <Plus className="w-3 h-3" />
              <span>Show all {blockCount} blocks ({formatBytes(totalLength)})</span>
            </button>
          )}
        </>
      ) : (
        <div className="text-sm text-gray-500">Failed to load content</div>
      )}
    </div>
  );
}

function MessageIdLink({ id, onHover }: {
  id: number;
  onHover: (id: number, e: React.MouseEvent) => void;
}) {
  return (
    <span
      className="text-blue-600 hover:text-blue-800 hover:underline cursor-pointer font-mono"
      onMouseEnter={(e) => onHover(id, e)}
    >
      {id}
    </span>
  );
}

function ContextDisplay({ contextDisplay, context, onHover }: {
  contextDisplay: string;
  context: string;
  onHover: (id: number, e: React.MouseEvent) => void;
}) {
  if (!contextDisplay) return <span className="text-gray-400">-</span>;

  // Parse the context display format: "1,2,..[N]..,5,6,7,8"
  const parts = contextDisplay.split(',');

  return (
    <span className="font-mono text-xs">
      {parts.map((part, i) => {
        const trimmed = part.trim();
        // Check if it's the truncation indicator like "..[128].."
        if (trimmed.startsWith('..[') && trimmed.endsWith(']..')) {
          return (
            <span key={i} className="text-gray-400">
              {i > 0 && ','}{trimmed}
            </span>
          );
        }

        const id = parseInt(trimmed, 10);
        if (isNaN(id)) return null;

        return (
          <span key={i}>
            {i > 0 && <span className="text-gray-300">,</span>}
            <MessageIdLink id={id} onHover={onHover} />
          </span>
        );
      })}
    </span>
  );
}

interface BodyPopupState {
  requestId: string;
  type: 'request' | 'response';
  x: number;
  y: number;
}

interface ToolCall {
  name: string;
  id: string;
  input: unknown;
}

function extractToolCalls(content: unknown[]): ToolCall[] {
  const tools: ToolCall[] = [];
  if (!Array.isArray(content)) return tools;

  for (const block of content) {
    if (block && typeof block === 'object' && 'type' in block && block.type === 'tool_use') {
      const tb = block as { name?: string; id?: string; input?: unknown };
      tools.push({
        name: tb.name || 'unknown',
        id: tb.id || '',
        input: tb.input
      });
    }
  }
  return tools;
}

function RequestBodyPopup({ requestId, position, onClose }: {
  requestId: string;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const [body, setBody] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/requests/${requestId}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          setBody(data.body);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [requestId]);

  const bodyText = body ? JSON.stringify(body, null, 2) : '';

  return (
    <div
      className="fixed z-50 bg-white shadow-xl rounded-lg p-4 border border-gray-300"
      style={{
        left: Math.min(position.x - 20, window.innerWidth - 750),
        top: Math.min(position.y - 10, window.innerHeight - 500),
        width: '700px',
        maxHeight: '480px'
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-amber-700 uppercase">Request Body</span>
          <span className="text-xs font-mono text-gray-500">{requestId}</span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-400">{formatBytes(bodyText.length)}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm px-1">✕</button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center space-x-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm text-gray-500">Loading...</span>
        </div>
      ) : (
        <div className="overflow-auto max-h-[420px] bg-gray-50 rounded p-2 select-text">
          <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap">{bodyText}</pre>
        </div>
      )}
    </div>
  );
}

function ResponseBodyPopup({ requestId, position, onClose }: {
  requestId: string;
  position: { x: number; y: number };
  onClose: () => void;
}) {
  const [response, setResponse] = useState<{ body?: unknown } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    fetch(`/api/requests/${requestId}`)
      .then(r => r.json())
      .then(data => {
        if (!cancelled) {
          setResponse(data.response);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    return () => { cancelled = true; };
  }, [requestId]);

  const responseBody = response?.body as { content?: unknown[] } | undefined;
  const toolCalls = responseBody?.content ? extractToolCalls(responseBody.content) : [];
  const bodyText = response ? JSON.stringify(response, null, 2) : '';

  return (
    <div
      className="fixed z-50 bg-white shadow-xl rounded-lg p-4 border border-gray-300"
      style={{
        left: Math.min(position.x - 20, window.innerWidth - 750),
        top: Math.min(position.y - 10, window.innerHeight - 550),
        width: '700px',
        maxHeight: '520px'
      }}
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center space-x-2">
          <span className="text-xs font-semibold text-green-700 uppercase">Response</span>
          <span className="text-xs font-mono text-gray-500">{requestId}</span>
        </div>
        <div className="flex items-center space-x-2">
          <span className="text-xs text-gray-400">{formatBytes(bodyText.length)}</span>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-sm px-1">✕</button>
        </div>
      </div>
      {loading ? (
        <div className="flex items-center space-x-2">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm text-gray-500">Loading...</span>
        </div>
      ) : (
        <>
          {toolCalls.length > 0 && (
            <div className="mb-3 p-2 bg-purple-50 rounded border border-purple-200 overflow-auto max-h-40 select-text">
              <div className="text-xs font-semibold text-purple-700 mb-2">Tool Calls ({toolCalls.length})</div>
              <div className="space-y-2">
                {toolCalls.map((tool, i) => (
                  <div key={i} className="border-l-2 border-purple-300 pl-2">
                    <div className="text-xs font-mono font-medium text-purple-600">{tool.name}</div>
                    {tool.input && (
                      <pre className="text-xs font-mono text-gray-600 whitespace-pre-wrap mt-1">
                        {JSON.stringify(tool.input, null, 2)}
                      </pre>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="overflow-auto max-h-72 bg-gray-50 rounded p-2 select-text">
            <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap">{bodyText}</pre>
          </div>
        </>
      )}
    </div>
  );
}

// Chart data types
interface ChartDataPoint {
  timestamp: string;
  estimated: number;
  actual: number;
}

// Comparison line chart component (small, clickable)
function ComparisonLineChart({
  data,
  title,
  estimatedLabel,
  actualLabel,
  onClick,
}: {
  data: ChartDataPoint[];
  title: string;
  estimatedLabel: string;
  actualLabel: string;
  onClick?: () => void;
}) {
  if (data.length === 0) return null;

  const estimatedValues = data.map(d => d.estimated);
  const actualValues = data.map(d => d.actual);
  const allValues = [...estimatedValues, ...actualValues];
  const maxValue = Math.max(...allValues, 1);

  // Y-axis ticks
  const yTicks = [
    { value: maxValue, pos: 5 },
    { value: Math.round(maxValue / 2), pos: 50 },
    { value: 0, pos: 95 },
  ];

  // Generate SVG path for line
  const generatePath = (values: number[]) => {
    if (values.length === 0) return '';
    return values.map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * 980 + 10;
      const y = 5 + (1 - v / maxValue) * 90;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
  };

  // Calculate accuracy stats
  const totalEstimated = estimatedValues.reduce((a, b) => a + b, 0);
  const totalActual = actualValues.reduce((a, b) => a + b, 0);
  const accuracy = totalActual > 0 ? (totalEstimated / totalActual) * 100 : 0;

  return (
    <div
      className={`bg-gray-50 rounded-lg p-3 ${onClick ? 'cursor-pointer hover:bg-gray-100 transition-colors' : ''}`}
      onClick={onClick}
    >
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-gray-700">{title}</h4>
        <div className="flex items-center gap-3 text-[10px]">
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-blue-500" />
            {estimatedLabel}
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 bg-green-500" />
            {actualLabel}
          </span>
        </div>
      </div>
      <div className="flex">
        {/* Y-axis labels */}
        <div className="w-10 flex-shrink-0 relative h-24">
          {yTicks.map((tick) => (
            <span
              key={tick.value}
              className="absolute right-1 text-[9px] text-gray-400 transform -translate-y-1/2"
              style={{ top: `${tick.pos}%` }}
            >
              {formatTokenCount(tick.value)}
            </span>
          ))}
        </div>
        {/* Chart area */}
        <div className="flex-1">
          <svg width="100%" height="96" viewBox="0 0 1000 100" preserveAspectRatio="none">
            {/* Grid lines */}
            <line x1="10" y1="5" x2="990" y2="5" stroke="#e5e7eb" strokeWidth="0.5" />
            <line x1="10" y1="50" x2="990" y2="50" stroke="#e5e7eb" strokeWidth="0.5" strokeDasharray="4" />
            <line x1="10" y1="95" x2="990" y2="95" stroke="#e5e7eb" strokeWidth="0.5" />
            {/* Estimated line (blue) */}
            <path
              d={generatePath(estimatedValues)}
              fill="none"
              stroke="#3b82f6"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
            {/* Actual line (green) */}
            <path
              d={generatePath(actualValues)}
              fill="none"
              stroke="#10b981"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      </div>
      {/* Stats */}
      <div className="mt-2 pt-2 border-t border-gray-200 flex justify-between text-[10px] text-gray-500">
        <span>Est: {formatTokenCount(totalEstimated)} | Act: {formatTokenCount(totalActual)}</span>
        <span className={accuracy > 110 ? 'text-red-500' : accuracy < 90 ? 'text-amber-500' : 'text-green-600'}>
          Accuracy: {accuracy.toFixed(1)}%
        </span>
      </div>
    </div>
  );
}

// Expanded chart modal with zoom, pan, and hover
function ExpandedChartModal({
  data,
  title,
  estimatedLabel,
  actualLabel,
  onClose,
}: {
  data: ChartDataPoint[];
  title: string;
  estimatedLabel: string;
  actualLabel: string;
  onClose: () => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  const estimatedValues = data.map(d => d.estimated);
  const actualValues = data.map(d => d.actual);
  const allValues = [...estimatedValues, ...actualValues];
  const maxValue = Math.max(...allValues, 1);

  // Chart dimensions
  const width = 1000;
  const height = 400;
  const padding = { top: 20, right: 20, bottom: 40, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Generate path
  const generatePath = (values: number[]) => {
    if (values.length === 0) return '';
    return values.map((v, i) => {
      const x = padding.left + (i / Math.max(values.length - 1, 1)) * chartWidth;
      const y = padding.top + (1 - v / maxValue) * chartHeight;
      return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
    }).join(' ');
  };

  // Y-axis ticks
  const yTickCount = 5;
  const yTicks = Array.from({ length: yTickCount + 1 }, (_, i) => {
    const value = (maxValue / yTickCount) * (yTickCount - i);
    const y = padding.top + (i / yTickCount) * chartHeight;
    return { value: Math.round(value), y };
  });

  // X-axis ticks (show ~10 timestamps)
  const xTickInterval = Math.max(1, Math.floor(data.length / 10));
  const xTicks = data.filter((_, i) => i % xTickInterval === 0).map((d, idx) => {
    const i = idx * xTickInterval;
    const x = padding.left + (i / Math.max(data.length - 1, 1)) * chartWidth;
    const date = new Date(d.timestamp);
    const label = `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')} ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
    return { x, label };
  });

  // Mouse handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    setZoom(z => Math.max(0.5, Math.min(10, z * delta)));
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({ x: e.clientX - pan.x, y: e.clientY - pan.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging) {
      setPan({ x: e.clientX - dragStart.x, y: e.clientY - dragStart.y });
    } else if (svgRef.current) {
      // Calculate hover index
      const rect = svgRef.current.getBoundingClientRect();
      const svgX = (e.clientX - rect.left) / rect.width * width;
      const relX = (svgX - padding.left) / chartWidth;
      const idx = Math.round(relX * (data.length - 1));
      if (idx >= 0 && idx < data.length) {
        setHoverIndex(idx);
      } else {
        setHoverIndex(null);
      }
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const handleMouseLeave = () => {
    setIsDragging(false);
    setHoverIndex(null);
  };

  // Get hover position
  const getHoverX = () => {
    if (hoverIndex === null) return 0;
    return padding.left + (hoverIndex / Math.max(data.length - 1, 1)) * chartWidth;
  };

  // Keyboard handler for escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg w-full h-full max-w-[95vw] max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
          <div className="flex items-center gap-4">
            <h2 className="text-lg font-semibold text-gray-800">{title}</h2>
            <div className="flex items-center gap-4 text-sm">
              <span className="flex items-center gap-1">
                <span className="w-4 h-1 bg-blue-500 rounded" />
                {estimatedLabel}
              </span>
              <span className="flex items-center gap-1">
                <span className="w-4 h-1 bg-green-500 rounded" />
                {actualLabel}
              </span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-500 mr-2">
              <Move className="w-3 h-3 inline mr-1" />
              Drag to pan, scroll to zoom
            </span>
            <button
              onClick={() => setZoom(z => Math.min(10, z * 1.2))}
              className="p-1.5 rounded hover:bg-gray-100"
              title="Zoom in"
            >
              <ZoomIn className="w-4 h-4" />
            </button>
            <button
              onClick={() => setZoom(z => Math.max(0.5, z / 1.2))}
              className="p-1.5 rounded hover:bg-gray-100"
              title="Zoom out"
            >
              <ZoomOut className="w-4 h-4" />
            </button>
            <button
              onClick={() => { setZoom(1); setPan({ x: 0, y: 0 }); }}
              className="px-2 py-1 text-xs rounded hover:bg-gray-100"
            >
              Reset
            </button>
            <button
              onClick={onClose}
              className="p-1.5 rounded hover:bg-gray-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Chart area */}
        <div className="flex-1 p-4 overflow-hidden">
          <div
            className="w-full h-full overflow-hidden"
            style={{ cursor: isDragging ? 'grabbing' : 'grab' }}
          >
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              viewBox={`0 0 ${width} ${height}`}
              preserveAspectRatio="xMidYMid meet"
              onWheel={handleWheel}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={handleMouseLeave}
              style={{
                transform: `scale(${zoom}) translate(${pan.x / zoom}px, ${pan.y / zoom}px)`,
                transformOrigin: 'center center',
              }}
            >
              {/* Background */}
              <rect x="0" y="0" width={width} height={height} fill="white" />

              {/* Grid lines */}
              {yTicks.map((tick, i) => (
                <line
                  key={i}
                  x1={padding.left}
                  y1={tick.y}
                  x2={width - padding.right}
                  y2={tick.y}
                  stroke="#e5e7eb"
                  strokeWidth="1"
                  strokeDasharray={i === yTicks.length - 1 ? undefined : '4'}
                />
              ))}

              {/* Y-axis labels */}
              {yTicks.map((tick, i) => (
                <text
                  key={i}
                  x={padding.left - 10}
                  y={tick.y + 4}
                  textAnchor="end"
                  className="text-xs fill-gray-500"
                  style={{ fontSize: '12px' }}
                >
                  {formatTokenCount(tick.value)}
                </text>
              ))}

              {/* X-axis labels */}
              {xTicks.map((tick, i) => (
                <text
                  key={i}
                  x={tick.x}
                  y={height - padding.bottom + 20}
                  textAnchor="middle"
                  className="text-xs fill-gray-500"
                  style={{ fontSize: '10px' }}
                >
                  {tick.label}
                </text>
              ))}

              {/* Estimated line (blue) */}
              <path
                d={generatePath(estimatedValues)}
                fill="none"
                stroke="#3b82f6"
                strokeWidth="1.5"
              />

              {/* Actual line (green) */}
              <path
                d={generatePath(actualValues)}
                fill="none"
                stroke="#10b981"
                strokeWidth="1.5"
              />

              {/* Hover crosshair and tooltip */}
              {hoverIndex !== null && (
                <>
                  {/* Vertical line */}
                  <line
                    x1={getHoverX()}
                    y1={padding.top}
                    x2={getHoverX()}
                    y2={height - padding.bottom}
                    stroke="#6b7280"
                    strokeWidth="1"
                    strokeDasharray="4"
                  />

                  {/* Dots on lines */}
                  <circle
                    cx={getHoverX()}
                    cy={padding.top + (1 - estimatedValues[hoverIndex] / maxValue) * chartHeight}
                    r="5"
                    fill="#3b82f6"
                    stroke="white"
                    strokeWidth="2"
                  />
                  <circle
                    cx={getHoverX()}
                    cy={padding.top + (1 - actualValues[hoverIndex] / maxValue) * chartHeight}
                    r="5"
                    fill="#10b981"
                    stroke="white"
                    strokeWidth="2"
                  />

                  {/* Tooltip */}
                  <g transform={`translate(${Math.min(getHoverX() + 10, width - 180)}, ${padding.top + 10})`}>
                    <rect
                      x="0"
                      y="0"
                      width="170"
                      height="80"
                      fill="white"
                      stroke="#e5e7eb"
                      strokeWidth="1"
                      rx="4"
                    />
                    <text x="10" y="20" className="text-xs fill-gray-600" style={{ fontSize: '11px' }}>
                      {new Date(data[hoverIndex].timestamp).toLocaleString()}
                    </text>
                    <text x="10" y="40" style={{ fontSize: '12px' }}>
                      <tspan fill="#3b82f6">{estimatedLabel}: </tspan>
                      <tspan fill="#1e40af" fontWeight="600">{estimatedValues[hoverIndex].toLocaleString()}</tspan>
                    </text>
                    <text x="10" y="60" style={{ fontSize: '12px' }}>
                      <tspan fill="#10b981">{actualLabel}: </tspan>
                      <tspan fill="#047857" fontWeight="600">{actualValues[hoverIndex].toLocaleString()}</tspan>
                    </text>
                  </g>
                </>
              )}
            </svg>
          </div>
        </div>

        {/* Footer with stats */}
        <div className="p-3 border-t border-gray-200 bg-gray-50 text-xs text-gray-600 flex gap-6">
          <span>Data points: {data.length}</span>
          <span>Zoom: {(zoom * 100).toFixed(0)}%</span>
          <span>
            {estimatedLabel}: {formatTokenCount(estimatedValues.reduce((a, b) => a + b, 0))}
          </span>
          <span>
            {actualLabel}: {formatTokenCount(actualValues.reduce((a, b) => a + b, 0))}
          </span>
          <span className={
            (() => {
              const totalEst = estimatedValues.reduce((a, b) => a + b, 0);
              const totalAct = actualValues.reduce((a, b) => a + b, 0);
              const acc = totalAct > 0 ? (totalEst / totalAct) * 100 : 0;
              return acc > 110 ? 'text-red-500 font-medium' : acc < 90 ? 'text-amber-500 font-medium' : 'text-green-600 font-medium';
            })()
          }>
            Accuracy: {(() => {
              const totalEst = estimatedValues.reduce((a, b) => a + b, 0);
              const totalAct = actualValues.reduce((a, b) => a + b, 0);
              return totalAct > 0 ? ((totalEst / totalAct) * 100).toFixed(1) : '0';
            })()}%
          </span>
        </div>
      </div>
    </div>
  );
}

export default function TurnsIndex() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [total, setTotal] = useState(0);
  const [latestDate, setLatestDate] = useState<string | null>(null);
  const [dateRange, setDateRange] = useState<{ start: string; end: string } | null>(null);
  const [sortBy, setSortBy] = useState("timestamp");
  const [sortOrder, setSortOrder] = useState<"ASC" | "DESC">("DESC");
  const [isFetching, setIsFetching] = useState(false);
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [bodyPopup, setBodyPopup] = useState<BodyPopupState | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [showCharts, setShowCharts] = useState(false);
  const [expandedChart, setExpandedChart] = useState<{
    data: ChartDataPoint[];
    title: string;
    estimatedLabel: string;
    actualLabel: string;
  } | null>(null);

  // Prepare chart data from turns
  const chartData = useMemo(() => {
    const sorted = [...turns].sort((a, b) =>
      new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
    return {
      contextVsCache: sorted.map(t => ({
        timestamp: t.timestamp,
        estimated: t.contextTokens,
        actual: t.cacheReads,
      })),
      inputComparison: sorted.map(t => ({
        timestamp: t.timestamp,
        estimated: t.lastMsgTokens,
        actual: t.inputTokens,
      })),
      outputComparison: sorted.map(t => ({
        timestamp: t.timestamp,
        estimated: t.responseTokens,
        actual: t.outputTokens,
      })),
      totalComparison: sorted.map(t => ({
        timestamp: t.timestamp,
        estimated: t.contextTokens + t.lastMsgTokens + t.responseTokens,
        actual: t.inputTokens + t.outputTokens + t.cacheReads,
      })),
    };
  }, [turns]);

  const applyRangeFromLatest = useCallback((latest: string, days: number | 'all') => {
    const end = new Date(latest);
    let start: Date;
    if (days === 'all') {
      start = new Date('2020-01-01');
    } else {
      start = new Date(end);
      start.setDate(start.getDate() - days);
    }
    return { start: start.toISOString(), end: end.toISOString() };
  }, []);

  const loadLatestDate = useCallback(async () => {
    try {
      const response = await fetch('/api/requests/latest-date');
      const data = await response.json();
      if (data.latestDate) {
        setLatestDate(data.latestDate);

        // Check URL params for initial state
        const urlStart = searchParams.get('start');
        const urlEnd = searchParams.get('end');
        const urlRange = searchParams.get('range');

        if (urlStart && urlEnd) {
          // Use explicit start/end from URL
          setDateRange({ start: urlStart, end: urlEnd });
        } else if (urlRange) {
          // Use range shortcut from URL
          const days = urlRange === 'all' ? 'all' : parseInt(urlRange, 10);
          if (days === 'all' || !isNaN(days as number)) {
            setDateRange(applyRangeFromLatest(data.latestDate, days));
          } else {
            setDateRange(applyRangeFromLatest(data.latestDate, 1));
          }
        } else {
          // Default to 1 day
          setDateRange(applyRangeFromLatest(data.latestDate, 1));
        }
        setInitialized(true);
      }
    } catch (error) {
      console.error('Failed to load latest date:', error);
    }
  }, [searchParams, applyRangeFromLatest]);

  const loadTurns = useCallback(async () => {
    if (!dateRange) return;

    setIsFetching(true);
    try {
      const url = new URL('/api/turns', window.location.origin);
      url.searchParams.append("start", dateRange.start);
      url.searchParams.append("end", dateRange.end);
      url.searchParams.append("sortBy", sortBy);
      url.searchParams.append("sortOrder", sortOrder);

      const response = await fetch(url.toString());
      const data = await response.json();

      setTurns(data.turns || []);
      setTotal(data.total || 0);
    } catch (error) {
      console.error('Failed to load turns:', error);
      setTurns([]);
    } finally {
      setIsFetching(false);
    }
  }, [dateRange, sortBy, sortOrder]);

  useEffect(() => {
    loadLatestDate();
  }, []);

  useEffect(() => {
    if (dateRange) {
      loadTurns();
    }
  }, [dateRange, loadTurns]);

  const handleSort = (column: string) => {
    if (column === sortBy) {
      setSortOrder(sortOrder === "DESC" ? "ASC" : "DESC");
    } else {
      setSortBy(column);
      setSortOrder("DESC");
    }
  };

  const expandRange = (days: number | 'all') => {
    if (!latestDate) return;
    const range = applyRangeFromLatest(latestDate, days);
    setDateRange(range);
    setSearchParams({ range: days.toString() });
  };

  const resetRange = () => {
    if (!latestDate) return;
    const range = applyRangeFromLatest(latestDate, 1);
    setDateRange(range);
    setSearchParams({});
  };

  const updateDateRange = (newRange: { start: string; end: string }) => {
    setDateRange(newRange);
    setSearchParams({ start: newRange.start, end: newRange.end });
  };

  const handleMessageHover = (id: number, e: React.MouseEvent) => {
    setPopup({ messageId: id, x: e.clientX, y: e.clientY });
  };

  const handleBodyHover = (requestId: string, type: 'request' | 'response', e: React.MouseEvent) => {
    setBodyPopup({ requestId, type, x: e.clientX, y: e.clientY });
  };

  const handleRefresh = () => {
    loadLatestDate();
  };

  const SortHeader = ({ column, label, align = 'left' }: { column: string; label: string; align?: 'left' | 'right' }) => (
    <th
      onClick={() => handleSort(column)}
      className={`px-3 py-2 font-medium text-gray-700 cursor-pointer hover:bg-gray-200 ${align === 'right' ? 'text-right' : 'text-left'}`}
    >
      <div className={`flex items-center ${align === 'right' ? 'justify-end' : ''} space-x-1`}>
        <span>{label}</span>
        {sortBy === column && <span className="text-blue-600">{sortOrder === "DESC" ? "↓" : "↑"}</span>}
      </div>
    </th>
  );

  return (
    <Layout onRefresh={handleRefresh}>
      <main className="px-6 py-4 space-y-4">
        {/* Date range controls */}
        <div className="flex items-center flex-wrap gap-3 bg-white border border-gray-200 rounded-lg p-3">
          <div className="flex items-center space-x-2">
            <span className="text-sm text-gray-600">Range:</span>
            <button
              onClick={() => expandRange(1)}
              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
            >
              1d
            </button>
            <button
              onClick={() => expandRange(7)}
              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
            >
              1w
            </button>
            <button
              onClick={() => expandRange(30)}
              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
            >
              1m
            </button>
            <button
              onClick={() => expandRange('all')}
              className="px-2 py-1 text-xs bg-gray-100 hover:bg-gray-200 rounded"
            >
              all
            </button>
            <button
              onClick={resetRange}
              className="px-2 py-1 text-xs bg-blue-100 hover:bg-blue-200 text-blue-700 rounded"
            >
              reset
            </button>
            <button
              onClick={() => setShowCharts(!showCharts)}
              className={`px-2 py-1 text-xs rounded flex items-center gap-1 ${
                showCharts
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
              }`}
            >
              <BarChart2 className="w-3 h-3" />
              {showCharts ? 'Hide charts' : 'Show charts'}
            </button>
          </div>
          {dateRange && (
            <div className="flex items-center space-x-2">
              <input
                type="datetime-local"
                value={toDatetimeLocal(dateRange.start)}
                onChange={(e) => updateDateRange({ ...dateRange, start: fromDatetimeLocal(e.target.value) })}
                className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
              <span className="text-gray-400">→</span>
              <input
                type="datetime-local"
                value={toDatetimeLocal(dateRange.end)}
                onChange={(e) => updateDateRange({ ...dateRange, end: fromDatetimeLocal(e.target.value) })}
                className="px-2 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-blue-500"
              />
            </div>
          )}
          <span className="text-sm font-medium text-gray-700">{total} turns</span>
        </div>

        {/* Token comparison charts */}
        {showCharts && turns.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-lg p-4 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-gray-700">
                Token Comparison ({turns.length} turns)
              </h3>
              <span className="text-xs text-gray-500">
                Estimated (blue) vs Actual (green)
              </span>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <ComparisonLineChart
                data={chartData.contextVsCache}
                title="Context vs Cache Reads"
                estimatedLabel="contextTokens"
                actualLabel="cacheReads"
                onClick={() => setExpandedChart({
                  data: chartData.contextVsCache,
                  title: "Context vs Cache Reads",
                  estimatedLabel: "contextTokens",
                  actualLabel: "cacheReads",
                })}
              />
              <ComparisonLineChart
                data={chartData.inputComparison}
                title="Estimated In vs Input"
                estimatedLabel="lastMsgTokens"
                actualLabel="inputTokens"
                onClick={() => setExpandedChart({
                  data: chartData.inputComparison,
                  title: "Estimated In vs Input",
                  estimatedLabel: "lastMsgTokens",
                  actualLabel: "inputTokens",
                })}
              />
              <ComparisonLineChart
                data={chartData.outputComparison}
                title="Estimated Out vs Output"
                estimatedLabel="responseTokens"
                actualLabel="outputTokens"
                onClick={() => setExpandedChart({
                  data: chartData.outputComparison,
                  title: "Estimated Out vs Output",
                  estimatedLabel: "responseTokens",
                  actualLabel: "outputTokens",
                })}
              />
              <ComparisonLineChart
                data={chartData.totalComparison}
                title="Total Estimated vs Total Tracked"
                estimatedLabel="est. total"
                actualLabel="actual total"
                onClick={() => setExpandedChart({
                  data: chartData.totalComparison,
                  title: "Total Estimated vs Total Tracked",
                  estimatedLabel: "est. total",
                  actualLabel: "actual total",
                })}
              />
            </div>
          </div>
        )}

        {/* Turns table */}
        <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
          <div className="overflow-auto max-h-[75vh]">
            {isFetching ? (
              <div className="p-8 text-center">
                <Loader2 className="w-6 h-6 mx-auto animate-spin text-gray-400" />
                <p className="mt-2 text-xs text-gray-500">Loading turns...</p>
              </div>
            ) : turns.length === 0 ? (
              <div className="p-8 text-center text-gray-500">
                <h3 className="text-sm font-medium text-gray-600 mb-1">No turns found</h3>
                <p className="text-xs text-gray-500">Run the reindex-messages command to populate turn data</p>
              </div>
            ) : (
              <table className="w-full text-xs">
                <thead className="sticky top-0 z-10 bg-gray-100">
                  <tr className="border-b border-gray-300">
                    <th colSpan={7} className="px-3 py-1"></th>
                    <th colSpan={5} className="px-3 py-1 text-center text-xs font-semibold text-amber-700 bg-amber-50 border-l border-gray-300">Request</th>
                    <th colSpan={5} className="px-3 py-1 text-center text-xs font-semibold text-green-700 bg-green-50 border-l border-gray-300">Response</th>
                    <th colSpan={3} className="px-3 py-1 text-center text-xs font-semibold text-blue-700 bg-blue-50 border-l border-gray-300">Est. Tokens</th>
                    <th colSpan={3} className="px-3 py-1 border-l border-gray-300"></th>
                  </tr>
                  <tr>
                    <SortHeader column="timestamp" label="Timestamp" />
                    <th className="px-3 py-2 text-left font-medium text-gray-700">Id</th>
                    <SortHeader column="model" label="Model" />
                    <th className="px-3 py-2 text-left font-medium text-gray-700">Context</th>
                    <SortHeader column="messageCount" label="Msgs" align="right" />
                    <SortHeader column="lastMessageId" label="Last Id" align="right" />
                    <th className="px-3 py-2 text-left font-medium text-gray-700">Reason</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-700 border-l border-gray-300">Role</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-700">Signature</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">Size</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">Sys</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">Tools</th>
                    <SortHeader column="responseRole" label="Role" />
                    <th className="px-3 py-2 text-left font-medium text-gray-700">Signature</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">Size</th>
                    <th className="px-3 py-2 text-left font-medium text-gray-700">Stop</th>
                    <SortHeader column="streaming" label="Stream" />
                    <th className="px-3 py-2 text-right font-medium text-gray-700 border-l border-gray-300">Context</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">Last Msg</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">Response</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">In</th>
                    <th className="px-3 py-2 text-right font-medium text-gray-700">Out</th>
                    <SortHeader column="cacheReads" label="Cache" align="right" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {turns.map((turn) => (
                    <tr key={turn.id} className={`${turn.reason === 'Prompt' ? 'bg-yellow-100 hover:bg-yellow-200 border-l-4 border-yellow-500' : 'hover:bg-gray-50'}`}>
                      <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                        {formatTimestamp(turn.timestamp)}
                      </td>
                      <td className="px-3 py-2">
                        <Link
                          to={`/requests/${turn.id}`}
                          className="text-blue-600 hover:text-blue-800 hover:underline font-mono"
                        >
                          {turn.id}
                        </Link>
                      </td>
                      <td className="px-3 py-2">
                        <span className={`font-medium ${
                          turn.model.includes('opus') ? 'text-purple-600' :
                          turn.model.includes('sonnet') ? 'text-indigo-600' :
                          turn.model.includes('haiku') ? 'text-teal-600' : 'text-gray-700'
                        }`}>
                          {formatModel(turn.model)}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-xs truncate">
                        <ContextDisplay
                          contextDisplay={turn.contextDisplay}
                          context={turn.context}
                          onHover={handleMessageHover}
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-700">
                        {turn.messageCount}
                      </td>
                      <td className="px-3 py-2 text-right text-xs">
                        <MessageIdLink id={turn.lastMessageId} onHover={handleMessageHover} />
                      </td>
                      <td className="px-3 py-2">
                        <span className={`px-1.5 py-0.5 rounded text-xs font-medium ${
                          turn.reason === 'Prompt' ? 'bg-yellow-500 text-white' :
                          turn.reason === 'Agent' ? 'bg-blue-100 text-blue-700' :
                          'bg-gray-100 text-gray-600'
                        }`}>
                          {turn.reason}
                        </span>
                      </td>
                      <td
                        className="px-3 py-2 text-amber-700 border-l border-gray-200 cursor-pointer hover:bg-amber-50 underline"
                        onMouseEnter={(e) => handleBodyHover(turn.id, 'request', e)}
                      >
                        {turn.requestRole || '-'}
                      </td>
                      <td className="px-3 py-2 text-amber-600 max-w-[120px] truncate" title={turn.requestSignature || undefined}>
                        {turn.requestSignature || '-'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-amber-600">
                        {formatBytes(turn.requestBytes)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-amber-600">
                        {turn.systemCount}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-amber-600">
                        {turn.toolsCount}
                      </td>
                      <td
                        className="px-3 py-2 text-green-600 border-l border-gray-200 cursor-pointer hover:bg-green-50 underline"
                        onMouseEnter={(e) => handleBodyHover(turn.id, 'response', e)}
                      >
                        {turn.responseRole || '-'}
                      </td>
                      <td
                        className={`px-3 py-2 text-green-500 max-w-[120px] truncate ${turn.responseMessageId ? 'cursor-pointer hover:bg-green-50 underline' : ''}`}
                        title={turn.responseSignature || undefined}
                        onMouseEnter={(e) => turn.responseMessageId && handleMessageHover(turn.responseMessageId, e)}
                      >
                        {turn.responseSignature || '-'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-green-600">
                        {formatBytes(turn.responseBytes)}
                      </td>
                      <td className="px-3 py-2 text-green-600">
                        {turn.stopReason || '-'}
                      </td>
                      <td className="px-3 py-2 text-green-600">
                        {turn.streaming === null ? '-' : turn.streaming ? 'yes' : 'no'}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-blue-600 border-l border-gray-200">
                        {formatTokenCount(turn.contextTokens)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-blue-600">
                        {formatTokenCount(turn.lastMsgTokens)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-blue-600">
                        {formatTokenCount(turn.responseTokens)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-700 border-l border-gray-200">
                        {formatTokenCount(turn.inputTokens)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-gray-700">
                        {formatTokenCount(turn.outputTokens)}
                      </td>
                      <td className="px-3 py-2 text-right font-mono text-green-600">
                        {formatTokenCount(turn.cacheReads)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Message popup */}
        {popup && (
          <MessagePopup
            messageId={popup.messageId}
            position={{ x: popup.x, y: popup.y }}
            onClose={() => setPopup(null)}
          />
        )}

        {/* Request/Response body popup with backdrop */}
        {bodyPopup && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setBodyPopup(null)}
            />
            {bodyPopup.type === 'request' ? (
              <RequestBodyPopup
                requestId={bodyPopup.requestId}
                position={{ x: bodyPopup.x, y: bodyPopup.y }}
                onClose={() => setBodyPopup(null)}
              />
            ) : (
              <ResponseBodyPopup
                requestId={bodyPopup.requestId}
                position={{ x: bodyPopup.x, y: bodyPopup.y }}
                onClose={() => setBodyPopup(null)}
              />
            )}
          </>
        )}

        {/* Expanded chart modal */}
        {expandedChart && (
          <ExpandedChartModal
            data={expandedChart.data}
            title={expandedChart.title}
            estimatedLabel={expandedChart.estimatedLabel}
            actualLabel={expandedChart.actualLabel}
            onClose={() => setExpandedChart(null)}
          />
        )}
      </main>
    </Layout>
  );
}
