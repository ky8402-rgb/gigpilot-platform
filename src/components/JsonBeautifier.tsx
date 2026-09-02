import React, { useState, useMemo } from 'react';
import {
  Copy,
  Check,
  Download,
  Search,
  Maximize2,
  Minimize2,
  ChevronRight,
  ChevronDown,
  Code2,
  Layers,
  Sparkles,
  FileCode,
  Sliders
} from 'lucide-react';

interface JsonBeautifierProps {
  data: any;
  title?: string;
  maxHeight?: string;
  allowEdit?: boolean;
  onPayloadChange?: (newData: any) => void;
  showToolbar?: boolean;
}

export const JsonBeautifier: React.FC<JsonBeautifierProps> = ({
  data,
  title = 'JSON Payload Beautifier',
  maxHeight = '520px',
  allowEdit = false,
  onPayloadChange,
  showToolbar = true
}) => {
  const [viewMode, setViewMode] = useState<'formatted' | 'tree' | 'raw'>('formatted');
  const [indentSize, setIndentSize] = useState<2 | 4 | 'tab'>(2);
  const [copied, setCopied] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [isExpandedAll, setIsExpandedAll] = useState<boolean>(true);
  const [collapsedPaths, setCollapsedPaths] = useState<Record<string, boolean>>({});
  const [isFullScreen, setIsFullScreen] = useState<boolean>(false);

  // Beautified formatted string
  const beautifiedString = useMemo(() => {
    try {
      if (typeof data === 'string') {
        const parsed = JSON.parse(data);
        const spaces = indentSize === 'tab' ? '\t' : indentSize;
        return JSON.stringify(parsed, null, spaces);
      }
      const spaces = indentSize === 'tab' ? '\t' : indentSize;
      return JSON.stringify(data, null, spaces);
    } catch {
      return typeof data === 'string' ? data : JSON.stringify(data);
    }
  }, [data, indentSize]);

  // Payload stats (keys count, byte size, depth)
  const payloadStats = useMemo(() => {
    try {
      const obj = typeof data === 'string' ? JSON.parse(data) : data;
      const str = JSON.stringify(obj);
      const bytes = new Blob([str]).size;
      const keyCount = (str.match(/"([^"]+)":/g) || []).length;
      return {
        bytes: bytes < 1024 ? `${bytes} B` : `${(bytes / 1024).toFixed(2)} KB`,
        keys: keyCount,
        valid: true
      };
    } catch {
      return { bytes: '0 B', keys: 0, valid: false };
    }
  }, [data]);

  const handleCopy = () => {
    navigator.clipboard.writeText(beautifiedString);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(beautifiedString);
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute('href', dataStr);
    downloadAnchor.setAttribute('download', `payload-${Date.now()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
  };

  const toggleNode = (path: string) => {
    setCollapsedPaths(prev => ({
      ...prev,
      [path]: !prev[path]
    }));
  };

  // Syntax highlighting renderer
  const renderHighlightedJson = (jsonStr: string, query: string) => {
    if (!jsonStr) return <span className="text-slate-500">// Empty payload</span>;

    // Token regex for syntax coloring
    const regex = /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false|null)\b|-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?|[{}[\],:])/g;

    const lines = jsonStr.split('\n');

    return (
      <pre className="font-mono text-xs leading-relaxed select-text">
        {lines.map((line, lineIdx) => {
          const isMatched = query && line.toLowerCase().includes(query.toLowerCase());
          return (
            <div
              key={lineIdx}
              className={`flex items-start hover:bg-slate-800/40 px-2 py-0.5 rounded transition-colors ${
                isMatched ? 'bg-amber-500/15 border-l-2 border-amber-400' : ''
              }`}
            >
              <span className="w-8 text-right pr-3 select-none text-slate-600 text-[11px] font-mono shrink-0">
                {lineIdx + 1}
              </span>
              <span className="flex-1 whitespace-pre-wrap break-all">
                {line.replace(regex, (match) => {
                  let cls = 'text-slate-300';
                  if (/^"/.test(match)) {
                    if (/:$/.test(match)) {
                      cls = 'text-sky-400 font-semibold'; // Key
                    } else {
                      cls = 'text-emerald-300'; // String value
                    }
                  } else if (/true|false/.test(match)) {
                    cls = 'text-violet-400 font-bold'; // Boolean
                  } else if (/null/.test(match)) {
                    cls = 'text-rose-400 italic'; // Null
                  } else if (/^-?\d+(?:\.\d*)?(?:[eE][+\-]?\d+)?$/.test(match)) {
                    cls = 'text-amber-300 font-medium'; // Number
                  } else if (/[{}[\],:]/.test(match)) {
                    cls = 'text-slate-500'; // Punctuation
                  }
                  return `<span class="${cls}">${match}</span>`;
                }).split(/(<span class="[^"]+">.*?<\/span>)/g).map((chunk, chunkIdx) => {
                  if (chunk.startsWith('<span')) {
                    const match = chunk.match(/<span class="([^"]+)">(.*?)<\/span>/);
                    if (match) {
                      const [, className, content] = match;
                      return (
                        <span key={chunkIdx} className={className}>
                          {content}
                        </span>
                      );
                    }
                  }
                  return chunk;
                })}
              </span>
            </div>
          );
        })}
      </pre>
    );
  };

  // Interactive Tree View Node Component
  const renderTreeNode = (nodeData: any, path: string = 'root', depth: number = 0): React.ReactNode => {
    const isCollapsed = collapsedPaths[path] ?? !isExpandedAll;

    if (nodeData === null) {
      return <span className="text-rose-400 italic font-mono text-xs">null</span>;
    }

    if (typeof nodeData === 'boolean') {
      return <span className="text-violet-400 font-bold font-mono text-xs">{String(nodeData)}</span>;
    }

    if (typeof nodeData === 'number') {
      return <span className="text-amber-300 font-mono text-xs">{nodeData}</span>;
    }

    if (typeof nodeData === 'string') {
      return <span className="text-emerald-300 font-mono text-xs">"{nodeData}"</span>;
    }

    const isArray = Array.isArray(nodeData);
    const keys = Object.keys(nodeData);
    const itemCount = isArray ? nodeData.length : keys.length;

    return (
      <div className="font-mono text-xs pl-2.5 my-0.5 border-l border-slate-800/80">
        <div
          onClick={() => toggleNode(path)}
          className="inline-flex items-center gap-1.5 cursor-pointer py-0.5 px-1.5 rounded hover:bg-slate-800/60 text-slate-300 transition-colors"
        >
          {isCollapsed ? (
            <ChevronRight className="w-3 h-3 text-slate-500 shrink-0" />
          ) : (
            <ChevronDown className="w-3 h-3 text-indigo-400 shrink-0" />
          )}
          <span className="text-slate-400 font-semibold">
            {isArray ? `Array[${itemCount}]` : `Object {${itemCount}}`}
          </span>
          {isCollapsed && (
            <span className="text-[10px] text-slate-500 bg-slate-800 px-1 rounded">...</span>
          )}
        </div>

        {!isCollapsed && (
          <div className="space-y-0.5 mt-0.5">
            {keys.map((key) => {
              const childVal = nodeData[key];
              const childPath = `${path}.${key}`;
              const isMatch = searchQuery && key.toLowerCase().includes(searchQuery.toLowerCase());

              return (
                <div
                  key={key}
                  className={`flex items-start gap-1.5 py-0.5 px-1 rounded hover:bg-slate-800/30 ${
                    isMatch ? 'bg-amber-500/15' : ''
                  }`}
                >
                  <span className="text-sky-400 font-semibold shrink-0">
                    {isArray ? `[${key}]` : `"${key}":`}
                  </span>
                  <div className="flex-1 overflow-x-auto">
                    {renderTreeNode(childVal, childPath, depth + 1)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  const parsedDataObject = useMemo(() => {
    try {
      return typeof data === 'string' ? JSON.parse(data) : data;
    } catch {
      return { raw: data };
    }
  }, [data]);

  return (
    <div
      className={`bg-slate-950 border border-slate-800 rounded-xl overflow-hidden shadow-xl transition-all ${
        isFullScreen ? 'fixed inset-4 z-50 flex flex-col' : ''
      }`}
    >
      {/* Top Header & Toolbar */}
      {showToolbar && (
        <div className="bg-slate-900/90 border-b border-slate-800 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="p-1.5 bg-indigo-500/10 border border-indigo-500/30 rounded-lg text-indigo-400">
              <Code2 className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-200">{title}</span>
                <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 border border-slate-700">
                  {payloadStats.bytes} • {payloadStats.keys} keys
                </span>
                {payloadStats.valid ? (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-emerald-950/60 text-emerald-400 border border-emerald-800/40">
                    VALID JSON
                  </span>
                ) : (
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-rose-950/60 text-rose-400 border border-rose-800/40">
                    RAW STRING
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* View Modes & Action Tools */}
          <div className="flex items-center flex-wrap gap-2 text-xs">
            {/* Search within JSON */}
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Find key/val..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-28 sm:w-36 pl-7 pr-2 py-1 text-[11px] bg-slate-950 border border-slate-800 rounded-md text-slate-300 placeholder-slate-600 focus:outline-none focus:border-indigo-500"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-slate-500 hover:text-slate-300"
                >
                  ✕
                </button>
              )}
            </div>

            {/* View Mode Switcher */}
            <div className="bg-slate-950 p-0.5 rounded-lg border border-slate-800 flex items-center">
              <button
                onClick={() => setViewMode('formatted')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'formatted'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Formatted
              </button>
              <button
                onClick={() => setViewMode('tree')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'tree'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Tree View
              </button>
              <button
                onClick={() => setViewMode('raw')}
                className={`px-2 py-0.5 rounded text-[11px] font-medium transition-colors ${
                  viewMode === 'raw'
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Compact
              </button>
            </div>

            {/* Indent Selector (for formatted) */}
            {viewMode === 'formatted' && (
              <div className="hidden sm:flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg px-2 py-0.5 text-[11px] text-slate-400">
                <span>Indent:</span>
                <button
                  onClick={() => setIndentSize(2)}
                  className={`px-1 rounded ${indentSize === 2 ? 'text-indigo-400 font-bold' : 'hover:text-white'}`}
                >
                  2sp
                </button>
                <span>|</span>
                <button
                  onClick={() => setIndentSize(4)}
                  className={`px-1 rounded ${indentSize === 4 ? 'text-indigo-400 font-bold' : 'hover:text-white'}`}
                >
                  4sp
                </button>
              </div>
            )}

            {/* Tree View Controls */}
            {viewMode === 'tree' && (
              <button
                onClick={() => {
                  setIsExpandedAll(!isExpandedAll);
                  setCollapsedPaths({});
                }}
                className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] border border-slate-700 transition-colors"
              >
                {isExpandedAll ? 'Collapse All' : 'Expand All'}
              </button>
            )}

            {/* Copy Button */}
            <button
              onClick={handleCopy}
              className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                copied
                  ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600'
                  : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700 hover:text-white'
              }`}
            >
              {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
              {copied ? 'Copied' : 'Copy'}
            </button>

            {/* Download Button */}
            <button
              onClick={handleDownload}
              className="p-1 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
              title="Download JSON file"
            >
              <Download className="w-3.5 h-3.5" />
            </button>

            {/* Fullscreen Toggle */}
            <button
              onClick={() => setIsFullScreen(!isFullScreen)}
              className="p-1 text-slate-400 hover:text-white bg-slate-800 hover:bg-slate-700 rounded-lg border border-slate-700 transition-colors"
              title={isFullScreen ? 'Exit Full Screen' : 'Full Screen View'}
            >
              {isFullScreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
            </button>
          </div>
        </div>
      )}

      {/* Main Payload Display Area */}
      <div
        className={`p-4 overflow-auto bg-slate-950 font-mono text-xs ${
          isFullScreen ? 'flex-1 max-h-none' : ''
        }`}
        style={{ maxHeight: isFullScreen ? 'calc(100vh - 120px)' : maxHeight }}
      >
        {viewMode === 'formatted' && renderHighlightedJson(beautifiedString, searchQuery)}

        {viewMode === 'tree' && (
          <div className="p-2 space-y-1">
            <div className="text-[11px] text-slate-500 mb-2 flex items-center gap-2">
              <span>Interactive JSON Tree Explorer</span>
              <span className="text-[10px] text-indigo-400">• Click nodes to expand/collapse</span>
            </div>
            {renderTreeNode(parsedDataObject)}
          </div>
        )}

        {viewMode === 'raw' && (
          <pre className="font-mono text-xs text-slate-300 whitespace-pre-wrap break-all select-text">
            {typeof data === 'string' ? data : JSON.stringify(data)}
          </pre>
        )}
      </div>

      {/* Footer Info */}
      <div className="bg-slate-900/60 border-t border-slate-800/80 px-4 py-2 text-[11px] text-slate-500 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="flex items-center gap-1">
            <span className="w-2 h-2 rounded-full bg-emerald-400" />
            Format: UTF-8 Application/JSON
          </span>
          <span>Indentation: {indentSize === 'tab' ? 'Tab' : `${indentSize} spaces`}</span>
        </div>
        <div className="text-slate-400 font-mono">
          Ready for downstream pipeline ingestion
        </div>
      </div>
    </div>
  );
};
