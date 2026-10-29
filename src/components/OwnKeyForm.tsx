/**
 * src/components/OwnKeyForm.tsx
 * Lets a signed-in user answer with their own Google Gemini API key instead of the shared one.
 * The key stays in this browser; questions go straight to Google and not through our server.
 */

import React, { useEffect, useState } from 'react';
import { Eye, EyeOff, ExternalLink } from 'lucide-react';
import { GEMINI_MODEL_OPTIONS } from '@/services/llm/geminiModels';
import { getLLMSettings, saveLLMSettings } from '@/services/llm/llmStorage';
import { refreshOwnKey } from '@/services/llm/ownKey';

export const OwnKeyForm: React.FC = () => {
  const [enabled, setEnabled] = useState(false);
  const [key, setKey] = useState('');
  const [model, setModel] = useState(GEMINI_MODEL_OPTIONS[0].id);
  const [showKey, setShowKey] = useState(false);
  const [ready, setReady] = useState(false); // saved values are loaded: do not overwrite what the user types
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; ok: boolean } | null>(null);

  useEffect(() => {
    let alive = true;
    void getLLMSettings().then((s) => {
      if (!alive) return;
      setEnabled(s.useOwnKey === true);
      setKey(s.geminiApiKey || '');
      setModel(s.model || GEMINI_MODEL_OPTIONS[0].id);
      setReady(true);
    });
    return () => {
      alive = false;
    };
  }, []);

  const locked = busy || !ready;
  const trimmed = key.trim();
  const canEnable = trimmed.length > 0;

  const save = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const useOwnKey = enabled && canEnable;
      await saveLLMSettings({ geminiApiKey: trimmed, model, useOwnKey });
      await refreshOwnKey();
      setEnabled(useOwnKey);
      setMessage({
        ok: true,
        text: useOwnKey ? 'Saved. Your questions now use your own API key.' : 'Saved. Your questions use the shared service.',
      });
    } catch {
      setMessage({ ok: false, text: 'Saving failed. Please try again.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    // Not a <form>: it sits inside the Settings form, and a nested submit would also run that form's save, which
    // wrote the old (empty) key back over the new one.
    <div className="space-y-1.5 pt-2 border-t border-slate-100" data-testid="own-key-form">
      <span className="font-semibold text-slate-800">Your own API key (optional)</span>
      <label className="flex items-center gap-2 text-xs text-slate-700">
        <input type="checkbox" checked={enabled && canEnable} disabled={!canEnable || locked} onChange={(e) => setEnabled(e.target.checked)} />
        <span>Use my own Google Gemini key instead of the shared service</span>
      </label>
      <div className="relative">
        <input
          type={showKey ? 'text' : 'password'}
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault(); // Enter saves this key, never the surrounding Settings form
              void save();
            }
          }}
          disabled={locked}
          placeholder="AIzaSy..."
          aria-label="Google Gemini API key"
          autoComplete="off"
          spellCheck={false}
          className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
        />
        <button
          type="button"
          onClick={() => setShowKey((v) => !v)}
          className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
          aria-label={showKey ? 'Hide API key' : 'Show API key'}
        >
          {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
        </button>
      </div>
      <select
        value={model}
        onChange={(e) => setModel(e.target.value)}
        disabled={locked}
        aria-label="Gemini model"
        className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
      >
        {GEMINI_MODEL_OPTIONS.map((o) => (
          <option key={o.id} value={o.id}>
            {o.label}
          </option>
        ))}
      </select>
      <button
        type="button"
        onClick={() => void save()}
        disabled={locked}
        className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition-colors disabled:opacity-50"
      >
        {busy ? 'Saving…' : 'Save'}
      </button>
      {message && (
        <p role="status" className={`text-[11px] ${message.ok ? 'text-emerald-700' : 'text-rose-700'}`}>
          {message.text}
        </p>
      )}
      <p className="text-[11px] text-slate-400">
        The key stays in this browser. With your own key, your questions and the course material they need go straight to Google,
        under your own Google account and its costs and terms; they do not pass our server and do not use the shared budget.{' '}
        <a
          href="https://aistudio.google.com/app/apikey"
          target="_blank"
          rel="noreferrer"
          className="text-sky-600 underline inline-flex items-center gap-0.5 hover:text-sky-700"
        >
          Get a free key <ExternalLink className="w-2.5 h-2.5" />
        </a>
      </p>
    </div>
  );
};
