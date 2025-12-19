import { useState } from 'react';
import { ChevronDown, ChevronRight, CheckCircle, AlertCircle, FileText, Database, Clock, Info } from 'lucide-react';
import { formatValue, formatJSON, isComplexObject, truncateText, hasSystemReminderTags } from '../utils/formatters';

// Count system reminders in content
function countSystemReminders(content: string): number {
  if (typeof content !== 'string') return 0;
  const rawMatches = content.match(/<system-reminder>[\s\S]*?<\/system-reminder>/g) || [];
  const escapedMatches = content.match(/&lt;system-reminder&gt;[\s\S]*?&lt;\/system-reminder&gt;/g) || [];
  return rawMatches.length + escapedMatches.length;
}

interface ToolResultProps {
  content: any;
  toolId?: string;
  isError?: boolean;
}

export function ToolResult({ content, toolId, isError = false }: ToolResultProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showRawContent, setShowRawContent] = useState(false);

  // Handle different content structures - always returns a string
  const getDisplayContent = (): string => {
    // If content is a string, return it directly
    if (typeof content === 'string') {
      return content;
    }

    // If content has a 'text' property that's a string, use that
    if (content && typeof content === 'object' && 'text' in content && typeof content.text === 'string') {
      return content.text;
    }

    // If content has a 'content' property, handle it recursively
    if (content && typeof content === 'object' && 'content' in content) {
      const inner = content.content;
      if (typeof inner === 'string') {
        return inner;
      }
      if (Array.isArray(inner)) {
        const textParts = inner
          .filter((item: any) => item && typeof item === 'object' && item.type === 'text' && item.text)
          .map((item: any) => item.text);
        if (textParts.length > 0) {
          return textParts.join('\n\n');
        }
        return inner.map((item: any) => formatValue(item)).join('\n');
      }
      return formatValue(inner);
    }

    // If it's an array of text blocks, extract and join the text
    if (Array.isArray(content)) {
      const textParts = content
        .filter(item => item && typeof item === 'object' && item.type === 'text' && item.text)
        .map(item => item.text);
      if (textParts.length > 0) {
        return textParts.join('\n\n');
      }
      // Fallback for other array content
      return content.map(item => formatValue(item)).join('\n');
    }

    // For complex objects, show JSON
    if (isComplexObject(content)) {
      return formatJSON(content);
    }

    // Fallback to string conversion
    return formatValue(content);
  };

  const rawDisplayContent = getDisplayContent();

  // Check if content has system reminders - if so, just show a collapsible indicator
  const containsSystemReminders = hasSystemReminderTags(rawDisplayContent);
  const reminderCount = countSystemReminders(rawDisplayContent);

  // For content without system reminders, show normally
  const displayContent = containsSystemReminders ? '' : rawDisplayContent;
  const isLargeContent = displayContent.length > 500;
  const shouldTruncate = isLargeContent && !isExpanded;
  const truncatedContent = shouldTruncate ? truncateText(displayContent, 500) : displayContent;

  const getResultConfig = () => {
    if (isError) {
      return {
        bgColor: 'bg-gradient-to-r from-red-50 to-pink-50',
        borderColor: 'border-red-200',
        accentColor: 'border-l-red-500',
        iconBg: 'bg-red-100',
        iconColor: 'text-red-600',
        titleColor: 'text-red-900',
        icon: <AlertCircle className="w-5 h-5" />,
        title: 'Tool Error'
      };
    }
    
    return {
      bgColor: 'bg-gradient-to-r from-emerald-50 to-green-50',
      borderColor: 'border-emerald-200',
      accentColor: 'border-l-emerald-500',
      iconBg: 'bg-emerald-100',
      iconColor: 'text-emerald-600',
      titleColor: 'text-emerald-900',
      icon: <CheckCircle className="w-5 h-5" />,
      title: 'Tool Result'
    };
  };

  const config = getResultConfig();

  return (
    <div className={`${config.bgColor} ${config.borderColor} ${config.accentColor} border border-l-4 rounded-xl p-5 shadow-sm hover:shadow-md transition-all duration-200`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center space-x-3">
          <div className={`w-10 h-10 ${config.iconBg} rounded-xl flex items-center justify-center shadow-sm`}>
            <div className={config.iconColor}>
              {config.icon}
            </div>
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className={`font-semibold text-base ${config.titleColor}`}>
                {config.title}
              </span>
              <Database className="w-4 h-4 text-gray-500" />
            </div>
            {toolId && (
              <div className="flex items-center space-x-2 mt-1">
                <FileText className="w-3 h-3 text-gray-500" />
                <span className="text-xs text-gray-500 font-mono bg-white px-2 py-1 rounded-md border border-gray-200">
                  {toolId}
                </span>
              </div>
            )}
          </div>
        </div>
        
        {isLargeContent && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center space-x-2 text-xs text-gray-600 hover:text-gray-800 bg-white hover:bg-gray-50 px-3 py-2 rounded-lg border border-gray-200 transition-all duration-200"
          >
            {isExpanded ? (
              <ChevronDown className="w-3 h-3" />
            ) : (
              <ChevronRight className="w-3 h-3" />
            )}
            <span>{isExpanded ? 'Collapse' : 'Expand'}</span>
          </button>
        )}
      </div>

      {/* Content - only show if there's actual content and no system reminders */}
      {displayContent.length > 0 && (
        <div className="bg-white rounded-lg border border-gray-200 shadow-sm">
          <div className="p-4">
            {/* Content type indicator */}
            <div className="flex items-center justify-between mb-3 pb-2 border-b border-gray-100">
              <div className="flex items-center space-x-2 text-xs text-gray-600">
                <Clock className="w-3 h-3" />
                <span>Result received</span>
              </div>
              <div className="flex items-center space-x-2">
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                  Text
                </span>
                <span className="text-xs text-gray-500 bg-gray-100 px-2 py-1 rounded-full">
                  {displayContent.length.toLocaleString()} chars
                </span>
              </div>
            </div>

            {/* Main content */}
            <pre className="text-sm text-gray-700 whitespace-pre-wrap break-words font-sans leading-relaxed overflow-x-auto bg-gray-50 rounded-lg p-3 border border-gray-200">
              {truncatedContent}
            </pre>

            {/* Expand/collapse controls */}
            {shouldTruncate && (
              <div className="mt-3 pt-3 border-t border-gray-200">
                <button
                  onClick={() => setIsExpanded(true)}
                  className="text-xs text-blue-600 hover:text-blue-800 underline transition-colors"
                >
                  Show full content ({displayContent.length.toLocaleString()} characters)
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* System Reminders - collapsible */}
      {containsSystemReminders && (
        <details className="bg-gray-100 border border-gray-200 rounded-lg">
          <summary className="px-3 py-2 text-xs text-gray-500 font-mono cursor-pointer hover:bg-gray-200 transition-colors">
            system-reminder
          </summary>
          <pre className="px-3 py-2 text-xs text-gray-600 font-mono whitespace-pre-wrap break-words border-t border-gray-200 max-h-96 overflow-y-auto">
            {rawDisplayContent}
          </pre>
        </details>
      )}

      {/* Result indicator */}
      <div className="mt-4 pt-3 border-t border-gray-200">
        <div className={`flex items-center space-x-2 text-xs ${config.titleColor}`}>
          <div className={`w-2 h-2 rounded-full ${isError ? 'bg-red-500' : 'bg-emerald-500'}`}></div>
          <span>{isError ? 'Execution failed' : 'Execution completed'}</span>
        </div>
      </div>
    </div>
  );
}