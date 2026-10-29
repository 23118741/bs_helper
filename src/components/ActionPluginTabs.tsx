/**
 * src/components/ActionPluginTabs.tsx
 * Tab navigation bar rendering registered active plugins and roadmap preview tabs.
 */

import React, { useEffect, useState } from 'react';
import {
  Sparkles,
  AlertTriangle,
  RefreshCw,
} from 'lucide-react';
import { CourseData } from '@/types/brightspace';
import { ContextSelection, ParsedDocument } from '@/types/parser';
import { LLMMode } from '@/types/llm';
import { ActionRegistry } from './actions/ActionRegistry';
import { useDrawerLayout } from './LayoutContext';

export interface PluginErrorBoundaryProps {
  children: React.ReactNode;
  onReset?: () => void;
}

export interface PluginErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class PluginErrorBoundary extends React.Component<
  PluginErrorBoundaryProps,
  PluginErrorBoundaryState
> {
  constructor(props: PluginErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): PluginErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('PluginErrorBoundary caught an error in active plugin:', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false, error: null });
    if (this.props.onReset) {
      this.props.onReset();
    }
  };

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-6 m-4 bg-rose-50 border border-rose-200 rounded-lg text-center space-y-3">
          <div className="flex items-center justify-center gap-2 text-rose-700 font-semibold text-sm">
            <AlertTriangle className="h-5 w-5 text-rose-600 shrink-0" />
            <span>Er is een fout opgetreden in deze plugin. Klik om opnieuw te laden.</span>
          </div>
          {this.state.error?.message && (
            <p className="text-xs text-rose-600 font-mono bg-rose-100/50 p-2 rounded max-h-32 overflow-y-auto">
              {this.state.error.message}
            </p>
          )}
          <button
            type="button"
            onClick={this.handleRetry}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-rose-600 hover:bg-rose-700 text-white text-xs font-medium rounded-md shadow-sm transition-colors"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Opnieuw proberen</span>
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

export interface ActionPluginTabsProps {
  courseData: CourseData;
  selection: ContextSelection;
  parsedDocs?: ParsedDocument[] | Record<string, ParsedDocument> | Map<string, ParsedDocument>;
  currentMode: LLMMode;
  onOpenSettings?: () => void;
  defaultPluginId?: string;
  className?: string;
}

export const ActionPluginTabs: React.FC<ActionPluginTabsProps> = ({
  courseData,
  selection,
  parsedDocs,
  currentMode,
  onOpenSettings,
  defaultPluginId = 'chat',
  className = '',
}) => {
  const { expanded } = useDrawerLayout();
  const [activeTabId, setActiveTabId] = useState<string>(defaultPluginId);

  const plugins = ActionRegistry.getAll();
  const activePlugin = ActionRegistry.getById(activeTabId) || plugins[0];

  // Tabs stay mounted once opened (just hidden), so a tool keeps its state when you switch tabs:
  // chat history, the text you were typing, running requests. A different course resets them
  // because the plugin key includes the course id.
  const [visited, setVisited] = useState<Set<string>>(() => new Set([defaultPluginId]));
  useEffect(() => {
    if (!activePlugin) return;
    setVisited((prev) => (prev.has(activePlugin.id) ? prev : new Set(prev).add(activePlugin.id)));
  }, [activePlugin]);

  const getTabIcon = (iconName: string, className = 'h-3.5 w-3.5 shrink-0') => {
    switch (iconName) {
      case 'Sparkles':
        return <Sparkles className={className} />;
      default:
        return <Sparkles className={className} />;
    }
  };

  return (
    <div className={`flex flex-col bg-white border border-slate-200 rounded-lg overflow-hidden ${className}`}>
      {/* Tab Navigation Bar: only needed when there is more than one tool (there is just the chat now) */}
      {plugins.length > 1 && (
      <>
      <div
        className={`border-b border-slate-200 bg-slate-100/80 p-1.5 ${
          expanded ? 'flex items-center gap-1.5' : 'flex flex-wrap gap-1'
        }`}
      >
        {plugins.map((plugin) => {
          const isSelected = plugin.id === activeTabId;
          const isRoadmap = plugin.status === 'roadmap';

          return (
            <button
              key={plugin.id}
              type="button"
              onClick={() => setActiveTabId(plugin.id)}
              className={`flex items-center justify-center gap-1.5 px-2.5 py-1.5 text-xs font-medium rounded-md whitespace-nowrap transition-all ${
                expanded ? '' : 'flex-1 basis-[calc(33.333%-4px)]'
              } ${
                isSelected
                  ? 'bg-white text-[#006fbf] font-semibold shadow-sm ring-1 ring-slate-200/90'
                  : 'text-slate-600 hover:text-slate-900 hover:bg-white/60'
              }`}
            >
              {getTabIcon(
                plugin.icon,
                `h-3.5 w-3.5 shrink-0 ${isSelected ? 'text-[#006fbf]' : 'text-slate-400'}`
              )}
              <span className="truncate">{plugin.name}</span>

              {isRoadmap && (
                <span className="text-[9px] font-bold px-1 py-0.2 rounded bg-indigo-100 text-indigo-700 uppercase tracking-tighter">
                  {plugin.badge || 'SOON'}
                </span>
              )}
            </button>
          );
        })}
      </div>

      </>
      )}

      {/* Active Tab View Body: the plugin gets the full height (chat tools pin their input to the bottom) */}
      <div className={`flex-1 min-h-0 overflow-hidden ${expanded ? 'bg-slate-50/50' : ''}`}>
        <div className="h-full w-full">
        {activePlugin ? (
          plugins
            .filter((p) => p.id === activePlugin.id || visited.has(p.id))
            .map((p) => {
              const isActive = p.id === activePlugin.id;
              return (
                <div
                  key={`${p.id}-${courseData.orgUnitId}`}
                  data-plugin-id={p.id}
                  aria-hidden={!isActive}
                  style={isActive ? undefined : { display: 'none' }}
                  className={isActive ? 'h-full' : undefined}
                >
                  <PluginErrorBoundary>
                    <p.component
                      courseData={courseData}
                      selection={selection}
                      parsedDocs={parsedDocs}
                      currentMode={currentMode}
                      onOpenSettings={onOpenSettings}
                    />
                  </PluginErrorBoundary>
                </div>
              );
            })
        ) : (
          <div className="p-6 text-center text-slate-400 text-xs">No active plugin selected.</div>
        )}
        </div>
      </div>
    </div>
  );
};
