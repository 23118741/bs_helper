import { afterEach, describe, expect, it } from 'vitest';
import { createCtx, TEST_PASSWORD, type TestCtx } from './helpers.js';

let ctx: TestCtx;
afterEach(async () => {
  await ctx?.app.close();
});

describe('auth', () => {
  it('anyone can request a sign-up code: no invitation, no allow list', async () => {
    ctx = await createCtx();
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup/start', payload: { email: 'new@student.nl' } });
    expect(res.statusCode).toBe(204);
    expect(ctx.mailer.outbox).toHaveLength(1);
  });

  it('refuses an invite_code field: there are no invitations anymore', async () => {
    ctx = await createCtx();
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup/start', payload: { email: 'a@x.nl', invite_code: 'ABCD1234' } });
    expect(res.statusCode).toBe(400);
  });

  it('full flow: sign-up code + password → token → me → logout → rejected', async () => {
    ctx = await createCtx();
    const { token } = await ctx.signIn('Student@Example.NL');
    const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('student@example.nl');
    expect(me.json().limits).toEqual({ approved: true, day_cost_cap_eur: 0.25, day_cost_remaining_eur: 0.25 });

    const out = await ctx.app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { authorization: `Bearer ${token}` } });
    expect(out.statusCode).toBe(204);
    const after = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(after.statusCode).toBe(401);
    expect(after.json().code).toBe('AUTH_REQUIRED');
  });

  it('an existing user signs in with the password; signing up again does not reveal or replace it', async () => {
    ctx = await createCtx();
    await ctx.signIn('again@example.nl');
    const login = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'again@example.nl', password: TEST_PASSWORD } });
    expect(login.statusCode).toBe(200);

    // asking for a sign-up code answers the same as for a new address, but the mail says the account exists
    const start = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup/start', payload: { email: 'again@example.nl' } });
    expect(start.statusCode).toBe(204);
    expect(ctx.mailer.lastMailFor('again@example.nl')).toMatchObject({ code: '', kind: 'exists' });
    // the password is unchanged
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'again@example.nl', password: TEST_PASSWORD } })).statusCode).toBe(200);
  });

  describe('forgot password', () => {
    const resetStart = (email: string) => ctx.app.inject({ method: 'POST', url: '/v1/auth/reset/start', payload: { email } });
    const reset = (email: string, code: string, password: string) =>
      ctx.app.inject({ method: 'POST', url: '/v1/auth/reset', payload: { email, code, password } });
    const login = (email: string, password: string) => ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email, password } });

    it('resets the password with the emailed code, signs in and signs out every other device', async () => {
      ctx = await createCtx();
      const { token: oldToken } = await ctx.signIn('forgot@example.nl');
      expect((await resetStart('forgot@example.nl')).statusCode).toBe(204);
      const mail = ctx.mailer.lastMailFor('forgot@example.nl')!;
      expect(mail.kind).toBe('reset');

      const res = await reset('forgot@example.nl', mail.code, 'brand-new-pass-4');
      expect(res.statusCode).toBe(200);
      const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${res.json().token}` } });
      expect(me.statusCode).toBe(200);
      expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${oldToken}` } })).statusCode).toBe(401);
      expect((await login('forgot@example.nl', TEST_PASSWORD)).statusCode).toBe(401);
      expect((await login('forgot@example.nl', 'brand-new-pass-4')).statusCode).toBe(200);
    });

    it('answers the same for unknown addresses and sends them nothing', async () => {
      ctx = await createCtx();
      expect((await resetStart('nobody@example.nl')).statusCode).toBe(204);
      expect(ctx.mailer.lastMailFor('nobody@example.nl')).toBeUndefined();
      const r = await reset('nobody@example.nl', '123456', 'brand-new-pass-4');
      expect(r.statusCode).toBe(401);
      expect(r.json().code).toBe('INVALID_CODE');
    });

    it('rejects a wrong code, and a too-short password does not use up the code', async () => {
      ctx = await createCtx();
      await ctx.signIn('codes@example.nl');
      await resetStart('codes@example.nl');
      const real = ctx.mailer.lastCodeFor('codes@example.nl')!;
      expect((await reset('codes@example.nl', real === '000000' ? '111111' : '000000', 'brand-new-pass-4')).statusCode).toBe(401);
      // a too-short password does not use up the code
      expect((await reset('codes@example.nl', real, 'short')).statusCode).toBe(400);
      expect((await reset('codes@example.nl', real, 'brand-new-pass-4')).statusCode).toBe(200);
    });

    it('ends the lock from wrong passwords', async () => {
      ctx = await createCtx();
      await ctx.signIn('locked@example.nl');
      for (let i = 0; i < 8; i++) await login('locked@example.nl', 'wrong-password');
      expect((await login('locked@example.nl', TEST_PASSWORD)).statusCode).toBe(429);
      await resetStart('locked@example.nl');
      expect((await reset('locked@example.nl', ctx.mailer.lastCodeFor('locked@example.nl')!, 'brand-new-pass-4')).statusCode).toBe(200);
      expect((await login('locked@example.nl', 'brand-new-pass-4')).statusCode).toBe(200);
    });
  });

  it('a password that is too short is refused before the code is used up', async () => {
    ctx = await createCtx();
    await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup/start', payload: { email: 'short@example.nl' } });
    const code = ctx.mailer.lastCodeFor('short@example.nl')!;
    const short = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'short@example.nl', code, password: 'short' } });
    expect(short.statusCode).toBe(400);
    const ok = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'short@example.nl', code, password: 'long-enough-1' } });
    expect(ok.statusCode).toBe(200);
  });

  it('a user without a password (made with the old email-code login) can set one by signing up', async () => {
    ctx = await createCtx();
    const { createAuth } = await import('../src/auth.js');
    const { MemoryMailer } = await import('../src/mailer.js');
    const mailer = new MemoryMailer();
    const auth = await createAuth(ctx.config, ctx.db, mailer);
    await auth.api.sendVerificationOTP({ body: { email: 'old@example.nl', type: 'sign-in' } });
    await auth.api.signInEmailOTP({ body: { email: 'old@example.nl', otp: mailer.lastCodeFor('old@example.nl')! } });

    await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup/start', payload: { email: 'old@example.nl' } });
    const code = ctx.mailer.lastCodeFor('old@example.nl')!;
    const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'old@example.nl', code, password: 'new-password-3' } });
    expect(res.statusCode).toBe(200);
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'old@example.nl', password: 'new-password-3' } })).statusCode).toBe(200);
  });

  it('the email-code login and the password setting route are gone', async () => {
    ctx = await createCtx();
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/auth/verify', payload: { email: 'a@b.nl', code: '123456' } })).statusCode).toBe(404);
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/auth/password', payload: { password: 'long-enough-1' } })).statusCode).toBe(404);
  });

  it('rejects wrong codes and stops after too many attempts', async () => {
    ctx = await createCtx();
    await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup/start', payload: { email: 'x@example.nl' } });
    const real = ctx.mailer.lastCodeFor('x@example.nl')!;
    const wrong = real === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++) {
      const r = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'x@example.nl', code: wrong, password: 'long-enough-1' } });
      expect(r.statusCode).toBe(401);
      expect(r.json().code).toBe('INVALID_CODE');
    }
    // the correct code no longer works after 5 failed attempts
    const late = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup', payload: { email: 'x@example.nl', code: real, password: 'long-enough-1' } });
    expect(late.statusCode).toBe(401);
  });

  it('limits sign-up codes per email address', async () => {
    ctx = await createCtx({ AUTH_START_IP_RPM: '1000' });
    await ctx.signIn('limit@example.nl');
    let last = 0;
    for (let i = 0; i < 6; i++) {
      const r = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup/start', payload: { email: 'limit@example.nl' } });
      last = r.statusCode;
    }
    expect(last).toBe(429);
  });

  it('one attacker cannot use up the login codes of an address for everyone else', async () => {
    ctx = await createCtx({ AUTH_START_IP_RPM: '1000' });
    const start = (remoteAddress: string) =>
      ctx.app.inject({ method: 'POST', url: '/v1/auth/signup/start', remoteAddress, payload: { email: 'victim@example.nl' } });
    for (let i = 0; i < 3; i++) expect((await start('10.0.0.1')).statusCode).toBe(204);
    expect((await start('10.0.0.1')).statusCode).toBe(429); // the attacker is out of quota
    expect((await start('10.0.0.2')).statusCode).toBe(204); // the owner still gets a code
  });

  it('blocks institutions by email domain and by Brightspace host', async () => {
    ctx = await createCtx();
    ctx.db.prepare("INSERT INTO blocked_hosts (pattern, created_at) VALUES ('blocked.nl', 0)").run();
    const blocked = await ctx.app.inject({ method: 'POST', url: '/v1/auth/signup/start', payload: { email: 'a@student.blocked.nl' } });
    expect(blocked.statusCode).toBe(403);
    expect(blocked.json().code).toBe('INSTITUTION_BLOCKED');

    const { token } = await ctx.signIn('ok@example.nl');
    const res = await ctx.generate(token, { client: { version: '1.0.0', brightspace_host: 'brightspace.blocked.nl' } });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe('INSTITUTION_BLOCKED');
    const fine = await ctx.generate(token, { client: { version: '1.0.0', brightspace_host: 'brightspace.other.nl' } });
    expect(fine.statusCode).toBe(200);
  });

  it('deletes the account and anonymizes the ledger', async () => {
    ctx = await createCtx();
    const { token, id } = await ctx.signIn('gone@example.nl');
    await ctx.generate(token);
    const del = await ctx.app.inject({ method: 'DELETE', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(del.statusCode).toBe(204);
    expect(ctx.db.prepare('SELECT COUNT(*) n FROM user').get()).toEqual({ n: 0 });
    expect(ctx.db.prepare('SELECT COUNT(*) n FROM usage_events WHERE user_id = ?').get(id)).toEqual({ n: 0 });
    expect(ctx.db.prepare("SELECT COUNT(*) n FROM usage_events WHERE user_id = 'deleted'").get()).toEqual({ n: 1 });
    const after = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${token}` } });
    expect(after.statusCode).toBe(401);
  });

  it('requires a token and rejects garbage tokens', async () => {
    ctx = await createCtx();
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me' })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: 'Bearer nonsense' } })).statusCode).toBe(401);
    expect((await ctx.app.inject({ method: 'POST', url: '/v1/generate', payload: {} })).statusCode).toBe(401);
  });

  describe('password login', () => {
    const seed = async (email: string, password: string) => {
      // same path the admin CLI uses
      const { createAuth } = await import('../src/auth.js');
      const { MemoryMailer } = await import('../src/mailer.js');
      const auth = await createAuth(ctx.config, ctx.db, new MemoryMailer());
      await auth.api.signUpEmail({ body: { email, password, name: 'owner' } });
    };

    it('signs in with the right password and the token works', async () => {
      ctx = await createCtx();
      await seed('owner@example.nl', 'correct-horse-9');
      const res = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'Owner@example.nl', password: 'correct-horse-9' } });
      expect(res.statusCode).toBe(200);
      const me = await ctx.app.inject({ method: 'GET', url: '/v1/me', headers: { authorization: `Bearer ${res.json().token}` } });
      expect(me.statusCode).toBe(200);
      expect(me.json().user.email).toBe('owner@example.nl');
    });

    it('rejects a wrong password and unknown accounts with the same error', async () => {
      ctx = await createCtx();
      await seed('owner@example.nl', 'correct-horse-9');
      const bad = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'owner@example.nl', password: 'wrong-password' } });
      const unknown = await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'nobody@example.nl', password: 'wrong-password' } });
      expect(bad.statusCode).toBe(401);
      expect(unknown.statusCode).toBe(401);
      expect(bad.json().code).toBe('INVALID_CODE');
      expect(unknown.json().message).toBe(bad.json().message);
    });

    it('locks the password login of one account after repeated wrong passwords, even for the right password', async () => {
      ctx = await createCtx();
      await seed('owner@example.nl', 'correct-horse-9');
      const login = (password: string) => ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'owner@example.nl', password } });
      for (let i = 0; i < 8; i++) expect((await login('wrong-password')).statusCode).toBe(401);
      const locked = await login('correct-horse-9');
      expect(locked.statusCode).toBe(429);
      expect(locked.json().code).toBe('RATE_LIMITED');
    });

    it('is rate limited per IP and offers no public sign-up', async () => {
      ctx = await createCtx();
      let last = 0;
      const seen: number[] = [];
      for (let i = 0; i < 12; i++) {
        last = (await ctx.app.inject({ method: 'POST', url: '/v1/auth/login', payload: { email: 'a@example.nl', password: 'wrong-password' } })).statusCode; seen.push(last);
      }
      expect(seen).toContain(429);
      const signUp = await ctx.app.inject({ method: 'POST', url: '/api/auth/sign-up/email', payload: { email: 'x@example.nl', password: 'abcdefgh1', name: 'x' } });
      expect(signUp.statusCode).toBe(404);
    });
  });
});
