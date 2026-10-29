/**
 * src/components/SettingsModal.tsx
 * Settings modal. Production: account (sign out / delete) and local cache management.
 * Development builds (VITE_DEV_DIRECT_GEMINI=1) also show the Gemini key, model and proxy settings.
 */

import React, { useState, useEffect } from 'react';
import { X, Eye, EyeOff, Save, Trash2, Key, Sliders, Server, ExternalLink, CheckCircle, AlertCircle } from 'lucide-react';
import {
  getLLMSettings,
  saveLLMSettings,
  resetLLMSettings,
} from '@/services/llm/llmStorage';
import { storage } from '@/services/brightspace/storage';
import { DEV_DIRECT_GEMINI, PRODUCT_NAME } from '@/services/backend/env';
import { deleteAccount, logout, useSession } from '@/services/backend/session';
import { OwnKeyForm } from '@/components/OwnKeyForm';
import { GEMINI_MODEL_OPTIONS } from '@/services/llm/geminiModels';
import { HOTKEY_OPTIONS, HotkeyId, setHotkey, useHotkey } from '@/services/ui/preferences';
import { LLMSettings } from '@/types/llm';

export interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  activeCourseId?: string | null;
  onSettingsSaved?: (newSettings: LLMSettings) => void;
  onCacheCleared?: () => void;
}

export const SettingsModal: React.FC<SettingsModalProps> = ({
  isOpen,
  onClose,
  activeCourseId,
  onSettingsSaved,
  onCacheCleared,
}) => {
  const session = useSession();
  const hotkey = useHotkey();
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [model, setModel] = useState('gemini-3.8-flash');
  const [proxyUrl, setProxyUrl] = useState('');
  const [proxyToken, setProxyToken] = useState('');
  const [showProxyToken, setShowProxyToken] = useState(false);
  const [temperature, setTemperature] = useState(0.15);
  const [maxTokens, setMaxTokens] = useState(4096);

  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' } | { text: string; type: 'error' } | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Load existing settings when modal opens
  useEffect(() => {
    if (!isOpen) return;
    async function load() {
      try {
        const settings = await getLLMSettings();
        setApiKey(settings.geminiApiKey || '');
        setModel(settings.model || 'gemini-3.8-flash');
        setProxyUrl(settings.proxyUrl || '');
        setProxyToken(settings.proxyToken || '');
        setTemperature(settings.temperature ?? 0.15);
        setMaxTokens(settings.maxOutputTokens ?? 4096);
        setStatusMessage(null);
      } catch (err) {
        console.warn('Failed to load settings:', err);
      }
    }
    load();
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!DEV_DIRECT_GEMINI) return; // production: only the own-key form saves, by itself
    setIsSaving(true);
    setStatusMessage(null);

    try {
      const updated = await saveLLMSettings({
        geminiApiKey: apiKey.trim(),
        model: model.trim(),
        proxyUrl: proxyUrl.trim(),
        proxyToken: proxyToken.trim(),
        temperature,
        maxOutputTokens: maxTokens,
      });

      setStatusMessage({ text: 'Instellingen succesvol opgeslagen! ✨', type: 'success' });
      if (onSettingsSaved) onSettingsSaved(updated);

      setTimeout(() => {
        setStatusMessage(null);
        onClose();
      }, 700);
    } catch (err: any) {
      setStatusMessage({ text: err?.message || 'Fout bij opslaan van instellingen', type: 'error' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = async () => {
    if (typeof window !== 'undefined' && window.confirm) {
      if (!window.confirm('Weet je zeker dat je de instellingen wilt herstellen naar standaard?')) return;
    }
    await resetLLMSettings();
    const defaults = await getLLMSettings();
    setApiKey(defaults.geminiApiKey);
    setModel(defaults.model);
    setProxyUrl(defaults.proxyUrl);
    setProxyToken(defaults.proxyToken);
    setTemperature(defaults.temperature);
    setMaxTokens(defaults.maxOutputTokens);
    setStatusMessage({ text: 'Standaardinstellingen hersteld', type: 'success' });
  };

  const handleClearCourseCache = async () => {
    if (!activeCourseId) return;
    if (typeof window !== 'undefined' && window.confirm) {
      if (!window.confirm(`Lokale cache wissen voor cursus #${activeCourseId}?`)) return;
    }
    await storage.clearCourseCache(activeCourseId);
    setStatusMessage({ text: `Cache voor cursus #${activeCourseId} gewist`, type: 'success' });
    if (onCacheCleared) onCacheCleared();
  };

  const handleDeleteAccount = async () => {
    if (typeof window !== 'undefined' && window.confirm) {
      if (!window.confirm('Your account and all associated data on the server will be deleted. Continue?')) return;
    }
    try {
      await deleteAccount();
      setStatusMessage({ text: 'Account deleted', type: 'success' });
    } catch {
      setStatusMessage({ text: 'Deleting failed. Please try again later.', type: 'error' });
    }
  };

  const handleClearAllData = async () => {
    if (typeof window !== 'undefined' && window.confirm) {
      if (!window.confirm('LET OP: Dit wist alle gecachte cursusdata en documenten. Doorgaan?')) return;
    }
    await storage.clearAllData();
    setStatusMessage({ text: 'Alle lokale cache succesvol gewist', type: 'success' });
    if (onCacheCleared) onCacheCleared();
  };

  return (
    <div className="fixed inset-0 z-[2147483647] flex items-center justify-center p-4 bg-slate-900/50 backdrop-blur-sm pointer-events-auto">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        className="w-full max-w-lg bg-white rounded-xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Modal Header */}
        <div className="px-5 py-3.5 border-b border-slate-100 flex items-center justify-between bg-slate-50/80">
          <div className="flex items-center gap-2">
            <Sliders className="w-4 h-4 text-[#006fbf]" />
            <h3 id="settings-title" className="text-sm font-bold text-slate-800">
              {DEV_DIRECT_GEMINI ? 'Instellingen & API Configuratie' : 'Settings'}
            </h3>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Sluiten"
            className="p-1 text-slate-400 hover:text-slate-600 rounded-md"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <form onSubmit={handleSave} className="p-5 space-y-4 overflow-y-auto text-xs text-slate-700">
          {/* Status Message */}
          {statusMessage && (
            <div
              className={`p-2.5 rounded-lg flex items-center gap-2 text-xs font-medium ${
                statusMessage.type === 'success'
                  ? 'bg-emerald-50 text-emerald-800 border border-emerald-200'
                  : 'bg-rose-50 text-rose-800 border border-rose-200'
              }`}
            >
              {statusMessage.type === 'success' ? (
                <CheckCircle className="w-4 h-4 text-emerald-600 flex-shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 flex-shrink-0" />
              )}
              <span>{statusMessage.text}</span>
            </div>
          )}

          {/* Account (production): who is signed in, sign out, delete account */}
          {!DEV_DIRECT_GEMINI && (
            <div className="space-y-2" data-testid="account-section">
              <span className="font-semibold text-slate-800">Account</span>
              {session.user ? (
                <div className="space-y-2">
                  <p className="text-slate-600">
                    Signed in as <strong>{session.user.email}</strong>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => void logout()}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition-colors"
                    >
                      Sign out
                    </button>
                    <button
                      type="button"
                      onClick={handleDeleteAccount}
                      className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-md text-xs font-medium transition-colors"
                    >
                      Delete account and data
                    </button>
                  </div>
                  <OwnKeyForm />
                  <p className="text-[11px] text-slate-400">
                    {PRODUCT_NAME} does not store your questions, course content or answers on the server. Only your email address and
                    usage data (token counts, costs) are kept; they are deleted or anonymized when you delete your account.
                  </p>
                </div>
              ) : (
                <p className="text-slate-500">You are not signed in.</p>
              )}
            </div>
          )}

          {DEV_DIRECT_GEMINI && (
          <>
          {/* Section 1: Gemini API Key */}
          <div className="space-y-1.5">
            <label className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Key className="w-3.5 h-3.5 text-sky-600" />
              <span>Google Gemini API-sleutel</span>
            </label>
            <div className="relative">
              <input
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="AIzaSy..."
                className="w-full px-3 py-2 pr-9 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
              />
              <button
                type="button"
                onClick={() => setShowApiKey(!showApiKey)}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                aria-label={showApiKey ? 'Verberg API-sleutel' : 'Toon API-sleutel'}
              >
                {showApiKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <p className="text-[11px] text-slate-400 flex items-center gap-1">
              Gratis API-sleutel nodig?{' '}
              <a
                href="https://aistudio.google.com/app/apikey"
                target="_blank"
                rel="noreferrer"
                className="text-sky-600 underline inline-flex items-center gap-0.5 hover:text-sky-700"
              >
                Google AI Studio <ExternalLink className="w-2.5 h-2.5" />
              </a>
            </p>
          </div>

          {/* Section 2: Model Selection */}
          <div className="space-y-1.5">
            <label className="block font-semibold text-slate-800">Doelmodel</label>
            <select
              value={model}
              onChange={e => setModel(e.target.value)}
              className="w-full px-3 py-2 border border-slate-200 rounded-lg text-xs bg-white text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            >
              {GEMINI_MODEL_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>

          {/* Section 3: Future Proxy Settings */}
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <label className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Server className="w-3.5 h-3.5 text-slate-500" />
              <span>Aangepaste Proxy Endpoint (Optioneel)</span>
            </label>
            <div className="space-y-1.5">
              <input
                type="url"
                value={proxyUrl}
                onChange={e => setProxyUrl(e.target.value)}
                placeholder="https://jouw-proxy.internal/generate"
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
              />
              <div className="relative">
                <input
                  type={showProxyToken ? 'text' : 'password'}
                  value={proxyToken}
                  onChange={e => setProxyToken(e.target.value)}
                  placeholder="Bearer Token (indien vereist door proxy)"
                  className="w-full px-3 py-1.5 pr-9 border border-slate-200 rounded-lg text-xs font-mono text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
                />
                <button
                  type="button"
                  onClick={() => setShowProxyToken(!showProxyToken)}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                  aria-label={showProxyToken ? 'Verberg Proxy Token' : 'Toon Proxy Token'}
                >
                  {showProxyToken ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
            </div>
          </div>

          {/* Section 4: Generation Parameters */}
          <div className="pt-2 border-t border-slate-100 grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-800 mb-1">
                Temperatuur: <span className="font-mono text-sky-600">{temperature}</span>
              </label>
              <input
                type="range"
                min="0.0"
                max="1.0"
                step="0.05"
                value={temperature}
                onChange={e => setTemperature(parseFloat(e.target.value))}
                className="w-full accent-sky-600"
              />
              <div className="flex justify-between text-[10px] text-slate-400">
                <span>Feitelijk</span>
                <span>Creatief</span>
              </div>
            </div>

            <div>
              <label className="block font-semibold text-slate-800 mb-1">Max Output Tokens</label>
              <input
                type="number"
                min="512"
                max="8192"
                step="256"
                value={maxTokens}
                onChange={e => setMaxTokens(parseInt(e.target.value, 10))}
                className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs font-mono text-slate-800"
              />
            </div>
          </div>

          </>
          )}

          {/* Keyboard shortcut (saved immediately, no Save button needed) */}
          <div className="space-y-1.5" data-testid="hotkey-section">
            <label htmlFor="hotkey-select" className="font-semibold text-slate-800">
              Keyboard shortcut
            </label>
            <select
              id="hotkey-select"
              value={hotkey}
              onChange={(e) => void setHotkey(e.target.value as HotkeyId)}
              className="w-full px-2.5 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-800 bg-white focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500"
            >
              {HOTKEY_OPTIONS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-[11px] text-slate-400">
              Opens and closes the assistant on any Brightspace page. Esc closes it. The shortcut for the toolbar button is
              set separately at <span className="font-mono">chrome://extensions/shortcuts</span>.
            </p>
          </div>

          {/* Section 5: Cache Management */}
          <div className="pt-2 border-t border-slate-100 space-y-2">
            <span className="font-semibold text-slate-800 flex items-center gap-1.5">
              <Trash2 className="w-3.5 h-3.5 text-slate-500" />
              <span>Lokale Opslag & Cache Beheer</span>
            </span>
            <div className="flex flex-wrap gap-2">
              {activeCourseId && (
                <button
                  type="button"
                  onClick={handleClearCourseCache}
                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-md text-xs font-medium transition-colors"
                >
                  Wis cache voor #{activeCourseId}
                </button>
              )}
              <button
                type="button"
                onClick={handleClearAllData}
                className="px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 rounded-md text-xs font-medium transition-colors"
              >
                Volledige cache legen
              </button>
            </div>
          </div>

          {/* Modal Footer Buttons (development builds) */}
          {DEV_DIRECT_GEMINI && (
          <div className="pt-3 border-t border-slate-100 flex items-center justify-between">
            <button
              type="button"
              onClick={handleReset}
              className="text-slate-400 hover:text-slate-600 text-xs font-medium"
            >
              Standaard herstellen
            </button>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={onClose}
                className="px-3 py-1.5 border border-slate-200 hover:bg-slate-50 text-slate-700 rounded-lg text-xs font-medium"
              >
                Annuleren
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-1.5 bg-[#006fbf] hover:bg-sky-600 text-white rounded-lg text-xs font-semibold shadow-sm flex items-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSaving ? 'Opslaan...' : 'Opslaan'}</span>
              </button>
            </div>
          </div>
          )}
        </form>
      </div>
    </div>
  );
};
