import { Link, useLocation } from "@remix-run/react";
import { RefreshCw, Trash2 } from "lucide-react";

interface LayoutProps {
  children: React.ReactNode;
  onRefresh?: () => void;
  onClear?: () => void;
  showActions?: boolean;
}

export function Layout({ children, onRefresh, onClear, showActions = true }: LayoutProps) {
  const location = useLocation();

  const getActiveTab = () => {
    if (location.pathname.startsWith("/conversations")) return "conversations";
    if (location.pathname.startsWith("/tokens")) return "tokens";
    return "requests";
  };

  const activeTab = getActiveTab();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="sticky top-0 z-40 bg-white border-b border-gray-200">
        <div className="px-6 py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <h1 className="text-lg font-semibold text-gray-900">Claude Code Monitor</h1>
            </div>
            {showActions && (
              <div className="flex items-center space-x-2">
                {onRefresh && (
                  <button
                    onClick={onRefresh}
                    className="p-1.5 text-gray-600 hover:bg-gray-100 rounded transition-colors"
                    title="Refresh"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                )}
                {onClear && (
                  <button
                    onClick={onClear}
                    className="p-1.5 text-red-600 hover:bg-red-50 rounded transition-colors"
                    title="Clear all requests"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </header>

      {/* View mode toggle */}
      <div className="mb-4 flex justify-center pt-4">
        <div className="inline-flex items-center bg-gray-100 rounded p-0.5">
          <Link
            to="/requests"
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              activeTab === "requests"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Requests
          </Link>
          <Link
            to="/conversations"
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              activeTab === "conversations"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Conversations
          </Link>
          <Link
            to="/tokens"
            className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
              activeTab === "tokens"
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
          >
            Tokens
          </Link>
        </div>
      </div>

      {children}
    </div>
  );
}
