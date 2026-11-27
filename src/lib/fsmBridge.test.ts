import { describe, expect, it } from 'vitest';
import { FsmBridge, bridgeClient, rowToActivity, rowToEffort } from './fsmBridge';

/** Simulierte FSM-App: beantwortet Bridge-Anfragen wie window.fsmHost */
function fakeFsm(apiKey?: string) {
  const events = new EventTarget();
  const sent: Record<string, unknown>[] = [];
  const host = {
    postMessage(m: string) {
      const req = JSON.parse(m);
      sent.push(req);
      const reply = (payload: unknown, success = true) => queueMicrotask(() => events.dispatchEvent(new CustomEvent('fsmHostResponse', { detail: { success, requestId: req.requestId, command: req.command + '_RESPONSE', payload, error: success ? undefined : { code: 'X', message: 'abgelehnt' } } })));
      if (apiKey && req.apiKey !== apiKey) return reply(null, false);
      if (req.command === 'CONTEXT_REQUEST') reply({ user: 'sredenius', account: 'multivac', account_id: '11', selected_company_name: 'MV_DE', selected_company_id: '22', cluster_url: 'https://eu.fsm.example/', access_token: 'tok-' + sent.length });
      else if (req.command === 'GET_LOGGED_IN_PERSON') reply({ id: 'P1' });
      else reply(null, false);
    },
  };
  return { host, events, sent };
}

describe('FSM JavaScript Bridge (ohne Server)', () => {
  it('Anfrage/Antwort inkl. Authentication Key', async () => {
    const f = fakeFsm('key-1');
    const ok = new FsmBridge(f.host, f.events, 'key-1');
    expect((await ok.context()).account).toBe('multivac');
    const bad = new FsmBridge(f.host, f.events);
    await expect(bad.context()).rejects.toThrow('abgelehnt');
    expect(f.sent[0]).toMatchObject({ apiVersion: 1, command: 'CONTEXT_REQUEST', apiKey: 'key-1' });
  });

  it('liest Einsätze mit dem Token des Technikers direkt aus der Query API', async () => {
    const f = fakeFsm();
    const calls: { url: string; init: RequestInit }[] = [];
    const fetchFn = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ data: [{ a: { id: 'A1', code: '4711', subject: 'Wartung', status: 'OPEN', startDateTime: '2026-11-30T07:00:00Z', endDateTime: '2026-11-30T16:00:00Z' }, sc: { code: 'SC9' }, bp: { name: "O'Brien Food" }, e: { serialNumber: '150300' }, ad: { street: 'Weg 1', zipCode: '87787', city: 'Wolfertschwenden' } }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const c = bridgeClient(new FsmBridge(f.host, f.events), fetchFn);
    const acts = await c.activities('2026-11-27', '2026-12-31');
    expect(acts[0]).toMatchObject({ id: 'A1', customer: "O'Brien Food", address: 'Weg 1, 87787 Wolfertschwenden', start: '2026-11-30T07:00' });
    const { url, init } = calls[0];
    expect(url.startsWith('https://eu.fsm.example/api/query/v1?dtos=')).toBe(true);
    expect(url).toContain('account=multivac&company=MV_DE');
    const h = init.headers as Record<string, string>;
    expect(h.authorization).toMatch(/^bearer tok-/);
    expect(h['X-Account-ID']).toBe('11');
    expect(JSON.parse(String(init.body)).query).toContain("'P1' IN a.responsibles");
    // zweiter Abruf: neues Token, Person wird nicht erneut angefragt
    await c.timeEfforts('2026-11-27', '2026-12-31');
    expect(f.sent.filter((s) => s.command === 'GET_LOGGED_IN_PERSON')).toHaveLength(1);
    expect(f.sent.filter((s) => s.command === 'CONTEXT_REQUEST')).toHaveLength(2);
  });

  it('verständliche Meldung bei fehlenden Rechten; Senden erst in Phase 2', async () => {
    const f = fakeFsm();
    const c = bridgeClient(new FsmBridge(f.host, f.events), (async () => new Response('', { status: 403 })) as unknown as typeof fetch);
    await expect(c.activities('2026-11-01', '2026-11-30')).rejects.toThrow('Berechtigung');
    await expect(c.sendReport({ activityId: 'A1', text: 'x' })).rejects.toThrow('Phase 2');
  });

  it('Zeilen-Abbildung', () => {
    expect(rowToActivity({ a: { id: '1', status: 'CLOSED' } })).toMatchObject({ status: 'CLOSED', customer: '', address: '' });
    expect(rowToEffort({ te: { id: 't', object: { objectId: 'A1' }, startDateTime: '2026-11-02T06:30:00Z' }, tt: { name: 'Travel time' } })).toEqual({ id: 't', activityId: 'A1', task: 'Reisezeit', start: '2026-11-02T06:30', end: '' });
  });
});
