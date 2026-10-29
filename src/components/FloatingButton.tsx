/**
 * src/components/FloatingButton.tsx
 * Draggable circular floating action button pinned to the viewport margin.
 * Provides instant visual trigger, status indicator, and Alt+B shortcut cue.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Sparkles, AlertCircle, Loader2 } from 'lucide-react';
import { hotkeyLabel, useHotkey } from '@/services/ui/preferences';

export interface FloatingButtonProps {
  isOpen: boolean;
  onToggle: () => void;
  status?: 'ready' | 'loading' | 'error';
  initialPosition?: { x: number; y: number };
  disabled?: boolean;
}

const STORAGE_KEY_POS = 'brightspace_ai_button_pos';

export const FloatingButton: React.FC<FloatingButtonProps> = ({
  isOpen,
  onToggle,
  status = 'ready',
  initialPosition,
  disabled = false,
}) => {
  const hotkey = hotkeyLabel(useHotkey()).replace(/ /g, '');

  // Coordinate State (distance in px from top-left)
  const [position, setPosition] = useState<{ x: number; y: number }>(() => {
    if (initialPosition) return initialPosition;
    try {
      const saved = localStorage.getItem(STORAGE_KEY_POS);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed.x === 'number' && typeof parsed.y === 'number') {
          return parsed;
        }
      }
    } catch {
      // fallback
    }
    // Default: bottom right margin (80px from bottom, 80px from right)
    const defaultX = typeof window !== 'undefined' ? Math.max(12, window.innerWidth - 76) : 1000;
    const defaultY = typeof window !== 'undefined' ? Math.max(12, window.innerHeight - 76) : 800;
    return { x: defaultX, y: defaultY };
  });

  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{ startX: number; startY: number; buttonX: number; buttonY: number }>({
    startX: 0,
    startY: 0,
    buttonX: 0,
    buttonY: 0,
  });
  const hasMovedRef = useRef(false);

  // Boundary clamp on window resize
  const clampPosition = useCallback((x: number, y: number) => {
    const maxX = typeof window !== 'undefined' ? Math.max(12, window.innerWidth - 68) : 1200;
    const maxY = typeof window !== 'undefined' ? Math.max(12, window.innerHeight - 68) : 900;
    return {
      x: Math.max(12, Math.min(maxX, x)),
      y: Math.max(12, Math.min(maxY, y)),
    };
  }, []);

  useEffect(() => {
    const handleResize = () => {
      setPosition(prev => clampPosition(prev.x, prev.y));
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [clampPosition]);

  // Pointer drag handling
  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled) return;
    // Only respond to primary mouse button or touch
    if (e.button !== 0) return;

    setIsDragging(true);
    hasMovedRef.current = false;
    dragStartRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      buttonX: position.x,
      buttonY: position.y,
    };

    try {
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    } catch {
      // ignore in test environments
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDragging) return;

    const dx = e.clientX - dragStartRef.current.startX;
    const dy = e.clientY - dragStartRef.current.startY;

    // Detect if movement exceeds threshold to differentiate drag from click
    if (Math.hypot(dx, dy) > 5) {
      hasMovedRef.current = true;
    }

    const nextX = dragStartRef.current.buttonX + dx;
    const nextY = dragStartRef.current.buttonY + dy;
    setPosition(clampPosition(nextX, nextY));
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!isDragging) return;
    setIsDragging(false);

    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (hasMovedRef.current) {
      // Drag ended: persist position
      try {
        localStorage.setItem(STORAGE_KEY_POS, JSON.stringify(position));
      } catch {
        // ignore
      }
    }
  };

  // If drawer is open, hide button smoothly so it doesn't overlap drawer panel
  const isHidden = isOpen;

  return (
    <button
      type="button"
      id="brightspace-ai-floating-trigger"
      aria-label={`Toggle BS Helper${hotkey ? ` (${hotkey})` : ''}`}
      title={`BS Helper${hotkey ? ` (${hotkey})` : ''}`}
      disabled={disabled}
      onClick={() => {
        if (hasMovedRef.current) {
          hasMovedRef.current = false;
          return;
        }
        onToggle();
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
        touchAction: 'none',
      }}
      className={`fixed z-[2147483647] flex items-center justify-center w-11 h-11 rounded-full shadow-lg transition-transform duration-200 select-none group focus:outline-none focus:ring-2 focus:ring-sky-400/50 ${
        isHidden
          ? 'opacity-0 scale-50 pointer-events-none'
          : 'opacity-100 scale-100 pointer-events-auto hover:scale-105 active:scale-95'
      } ${
        status === 'error'
          ? 'bg-gradient-to-br from-rose-500 to-red-600 text-white'
          : 'bg-gradient-to-br from-[#006fbf] to-sky-500 text-white'
      }`}
    >
      {/* Icon based on status */}
      {status === 'loading' ? (
        <Loader2 className="w-5 h-5 animate-spin text-white" />
      ) : status === 'error' ? (
        <AlertCircle className="w-5 h-5 text-white" />
      ) : (
        <Sparkles className="w-5 h-5 text-white transition-transform group-hover:rotate-12" />
      )}

      {/* Status Dot / Ping Indicator */}
      {status === 'loading' ? (
        <span className="absolute -top-1 -right-1 flex h-3.5 w-3.5">
          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
          <span className="relative inline-flex rounded-full h-3.5 w-3.5 bg-amber-500" />
        </span>
      ) : status === 'ready' ? (
        <span className="absolute -top-0.5 -right-0.5 flex h-3 w-3">
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-400 ring-2 ring-white" />
        </span>
      ) : null}

      {/* Floating Tooltip Pill */}
      <span className="absolute right-14 top-1/2 -translate-y-1/2 px-2.5 py-1 bg-slate-900/90 text-white text-xs font-medium rounded-md shadow-lg opacity-0 pointer-events-none group-hover:opacity-100 transition-opacity whitespace-nowrap">
        BS Helper
        {hotkey && <kbd className="ml-1 px-1 bg-slate-800 rounded text-[10px] text-slate-300">{hotkey}</kbd>}
      </span>
    </button>
  );
};
