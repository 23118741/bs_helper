/**
 * src/components/LoginView.tsx
 * Sign in with email + password. A first-time user creates an account instead: we email a sign-up code
 * (which proves the address) and they choose the password they sign in with from then on. "Forgot password?"
 * works the same way with a reset code.
 */

import React, { useState } from 'react';
import { Loader2, Mail, KeyRound, UserPlus } from 'lucide-react';
import { BackendError } from '@/services/backend/client';
import { PRODUCT_NAME } from '@/services/backend/env';
import { completePasswordReset, completeSignup, passwordLogin, startPasswordReset, startSignup } from '@/services/backend/session';

type Mode = 'signin' | 'signup' | 'reset';

function describe(err: unknown, mode: Mode): string {
  if (!(err instanceof BackendError)) return 'Something went wrong. Please try again.';
  switch (err.code) {
    case 'INVALID_CODE':
      return mode === 'signin' ? 'Email or password is incorrect.' : 'This code is incorrect or has expired. Request a new one if needed.';
    case 'ACCOUNT_EXISTS':
      return 'You already have an account with this email address. Sign in instead.';
    case 'INSTITUTION_BLOCKED':
      return 'This service is not available for this email address or institution.';
    case 'RATE_LIMITED':
      return 'Too many attempts. Please try again in a while.';
    case 'INVALID_REQUEST':
      return mode === 'signin' ? 'Check your email address and password.' : 'Check your email address, code and password (at least 8 characters).';
    case 'UPGRADE_REQUIRED':
      return 'This version of the extension is out of date. Please update it.';
    default:
      return err.message;
  }
}

const MIN_PASSWORD = 8;

export const LoginView: React.FC = () => {
  const [mode, setMode] = useState<Mode>('signin');
  const [codeSent, setCodeSent] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      if (err instanceof BackendError && err.code === 'ACCOUNT_EXISTS') {
        // the address is already known: go to sign in with the email filled in
        setMode('signin');
        setCodeSent(false);
        setCode('');
        setPassword('');
        setConfirm('');
      }
      setError(describe(err, mode));
    } finally {
      setBusy(false);
    }
  };

  const switchMode = (next: Mode) => {
    setMode(next);
    setCodeSent(false);
    setCode('');
    setPassword('');
    setConfirm('');
    setError(null);
  };

  const submitSignin = (e: React.FormEvent) => {
    e.preventDefault();
    void run(() => passwordLogin(email.trim(), password));
  };

  const sendCode = (e: React.FormEvent) => {
    e.preventDefault();
    void run(async () => {
      await (mode === 'reset' ? startPasswordReset : startSignup)(email.trim());
      setCodeSent(true);
    });
  };

  const submitCode = (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirm) {
      setError('The passwords do not match.');
      return;
    }
    void run(() => (mode === 'reset' ? completePasswordReset : completeSignup)(email.trim(), code.trim(), password));
  };

  const codeName = mode === 'reset' ? 'reset code' : 'sign-up code';

  const input =
    'w-full text-sm px-3 py-2 border border-slate-300 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50';
  const button =
    'w-full inline-flex items-center justify-center gap-2 px-3 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-50 transition-colors';
  const link = 'w-full text-xs text-slate-500 hover:text-slate-800 underline';

  const emailField = (
    <label className="block text-xs font-medium text-slate-700">
      Email address
      <input
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        disabled={busy}
        placeholder="naam@student.nl"
        className={`${input} mt-1`}
      />
    </label>
  );

  return (
    <div className="bg-white border border-slate-200 rounded-lg p-4 space-y-3" data-testid="login-view">
      <div>
        <h3 className="text-sm font-semibold text-slate-900">
          {mode === 'signin'
            ? `Sign in to ${PRODUCT_NAME}`
            : mode === 'signup'
              ? `Create your ${PRODUCT_NAME} account`
              : 'Reset your password'}
        </h3>
        <p className="text-xs text-slate-500 mt-1">
          {mode === 'signin'
            ? 'Sign in with your email address and password.'
            : mode === 'signup'
              ? 'First time here? We email you a sign-up code to confirm your address, then you choose a password.'
              : 'We email you a reset code, then you choose a new password. You are signed out on every other device.'}
        </p>
      </div>

      {mode === 'signin' ? (
        <form onSubmit={submitSignin} className="space-y-2.5">
          {emailField}
          <label className="block text-xs font-medium text-slate-700">
            Password
            <input
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              className={`${input} mt-1`}
            />
          </label>
          <button type="submit" disabled={busy || !email.trim() || !password} className={button}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
            Sign in
          </button>
          <button type="button" onClick={() => switchMode('reset')} className={link}>
            Forgot password?
          </button>
          <button type="button" onClick={() => switchMode('signup')} className={link}>
            New here? Create an account
          </button>
        </form>
      ) : !codeSent ? (
        <form onSubmit={sendCode} className="space-y-2.5">
          {emailField}
          <button type="submit" disabled={busy || !email.trim()} className={button}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Send {codeName}
          </button>
          <button type="button" onClick={() => switchMode('signin')} className={link}>
            {mode === 'reset' ? 'Back to sign in' : 'Already have an account? Sign in'}
          </button>
        </form>
      ) : (
        <form onSubmit={submitCode} className="space-y-2.5">
          <p className="text-xs text-slate-600">
            {mode === 'reset' ? (
              <>
                If <strong>{email.trim()}</strong> has an account, we sent it a 6-digit reset code. It is valid for 10 minutes.
              </>
            ) : (
              <>
                We sent a 6-digit sign-up code to <strong>{email.trim()}</strong>. It is valid for 10 minutes. Already have an
                account? Then the email says so: sign in instead.
              </>
            )}
          </p>
          <label className="block text-xs font-medium text-slate-700">
            {mode === 'reset' ? 'Reset code' : 'Sign-up code'}
            <input
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="\d{6}"
              maxLength={6}
              required
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
              disabled={busy}
              placeholder="123456"
              className={`${input} mt-1 font-mono tracking-widest text-center`}
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            {mode === 'reset' ? 'New password' : 'Choose a password'}
            <input
              type="password"
              required
              minLength={MIN_PASSWORD}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={busy}
              placeholder={`At least ${MIN_PASSWORD} characters`}
              className={`${input} mt-1`}
            />
          </label>
          <label className="block text-xs font-medium text-slate-700">
            Repeat password
            <input
              type="password"
              required
              autoComplete="new-password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              disabled={busy}
              className={`${input} mt-1`}
            />
          </label>
          <button
            type="submit"
            disabled={busy || code.length !== 6 || password.length < MIN_PASSWORD || !confirm}
            className={button}
          >
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : mode === 'reset' ? <KeyRound className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
            {mode === 'reset' ? 'Set new password' : 'Create account'}
          </button>
          <button
            type="button"
            onClick={() => {
              setCodeSent(false);
              setCode('');
              setError(null);
            }}
            className={link}
          >
            Use a different email or send a new code
          </button>
        </form>
      )}

      {error && (
        <p role="alert" className="text-xs text-rose-700 bg-rose-50 border border-rose-200 rounded-md px-2.5 py-1.5">
          {error}
        </p>
      )}
    </div>
  );
};
