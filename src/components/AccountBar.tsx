/**
 * src/components/AccountBar.tsx
 * Compact account line: who is signed in, how much of today's budget is left, sign out.
 */

import React from 'react';
import { LogOut } from 'lucide-react';
import { logout, useSession } from '@/services/backend/session';
import { useOwnKeyActive } from '@/services/llm/ownKey';
import { useDrawerLayout } from '@/components/LayoutContext';

export const AccountBar: React.FC = () => {
  const { user, limits } = useSession();
  const ownKey = useOwnKeyActive();
  const { expanded } = useDrawerLayout();
  if (!user) return null;

  // with the user's own key the shared budget and the approval do not apply
  const waitingForApproval = !ownKey && limits?.approved === false;
  const left =
    !ownKey && limits && limits.approved !== false && limits.day_cost_cap_eur > 0
      ? Math.max(0, Math.min(1, limits.day_cost_remaining_eur / limits.day_cost_cap_eur))
      : null;

  return (
    <div
      className={`flex items-center gap-3 px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-md text-[11px] text-slate-600 flex-shrink-0 ${
        expanded ? 'mx-4 mt-4 -mb-1' : 'mb-3'
      }`}
      data-testid="account-bar"
    >
      <span className="truncate flex-1 min-w-0" title={user.email}>
        {user.email}
      </span>
      {ownKey && (
        <span
          className="flex-shrink-0 text-sky-700"
          title="Your questions go straight to Google with your own API key. Change this in Settings."
          data-testid="own-key-active"
        >
          Using your own API key
        </span>
      )}
      {waitingForApproval && (
        <span
          className="flex-shrink-0 text-amber-700"
          title="You are signed in, but the owner has not approved your email address for AI answers yet."
          data-testid="awaiting-approval"
        >
          Waiting for approval
        </span>
      )}
      {left !== null && (
        <span
          className="flex items-center gap-1.5 flex-shrink-0"
          title="How much of your daily budget is left. It resets every day at midnight."
        >
          <span className="w-16 h-1.5 bg-slate-200 rounded-full overflow-hidden">
            <span
              className={`block h-full ${left > 0.2 ? 'bg-emerald-500' : 'bg-amber-500'}`}
              style={{ width: `${Math.round(left * 100)}%` }}
            />
          </span>
          <span>{Math.round(left * 100)}% left today</span>
        </span>
      )}
      <button
        type="button"
        onClick={() => void logout()}
        className="inline-flex items-center gap-1 text-slate-500 hover:text-rose-600 flex-shrink-0"
        title="Sign out"
      >
        <LogOut className="w-3 h-3" />
        <span>Sign out</span>
      </button>
    </div>
  );
};
