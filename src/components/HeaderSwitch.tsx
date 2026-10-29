/**
 * src/components/HeaderSwitch.tsx
 * Header notice shown only when something needs attention (Gemini API key missing in development builds).
 * There is no mode switch or "AI" badge any more: the app has a single way of talking to the AI.
 */

import React, { useState, useEffect } from 'react';
import { AlertCircle } from 'lucide-react';
import { LLMMode } from '@/types/llm';
import { hasValidCredentials } from '@/services/llm/llmStorage';

export interface HeaderSwitchProps {
  activeMode: LLMMode;
  /** Kept for API compatibility; there is only one selectable mode at the moment. */
  onChange?: (mode: LLMMode) => void;
  onOpenSettings?: () => void;
  className?: string;
}

export const HeaderSwitch: React.FC<HeaderSwitchProps> = ({
  activeMode,
  onOpenSettings,
  className = '',
}) => {
  const [hasKey, setHasKey] = useState(true);

  useEffect(() => {
    async function checkCredentials() {
      try {
        setHasKey(await hasValidCredentials(activeMode));
      } catch {
        setHasKey(true);
      }
    }
    checkCredentials();
  }, [activeMode]);

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      {activeMode === 'gemini' && !hasKey && (
        <div className="flex items-center justify-between px-2 py-0.5 bg-amber-50 border border-amber-200 rounded text-[10px] text-amber-800 whitespace-nowrap">
          <div className="flex items-center gap-1">
            <AlertCircle className="w-3 h-3 text-amber-600 flex-shrink-0" />
            <span>API key missing</span>
          </div>
          {onOpenSettings && (
            <button
              type="button"
              onClick={onOpenSettings}
              className="text-amber-900 font-semibold underline hover:text-amber-700 ml-1.5"
            >
              Set up →
            </button>
          )}
        </div>
      )}
    </div>
  );
};
