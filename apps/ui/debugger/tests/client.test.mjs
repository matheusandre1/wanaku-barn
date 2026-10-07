import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { executeRun, redact, toCurl, exportRun, defaultEndpoints, validateSchema, managementFetch } from '../src/client.ts';
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

test('redacts nested and embedded credentials and shell quotes curl', () => {
  const spec = { method: 'POST', url: 'https://user:pwd@host/path?api_key=key', headers: { Authorization: 'Bearer token', 'X-Cookie': 'session=abc' }, body: JSON.stringify({ nested: { password: 'pwd' }, text: "don't" }) };
  const curl = toCurl(spec);
  for (const secret of ['pwd', '=key', 'Bearer token', 'session=abc']) assert.ok(!curl.includes(secret), curl);
  assert.ok(curl.includes(`'"'"'`));
  assert.equal(redact({ secret: 'abc' }).secret, '[REDACTED]');
  assert.deepEqual(redact({ usage: { total_tokens: 42, prompt_tokens: 30, completion_tokens: 12 }, access_token: 'secret' }), { usage: { total_tokens: 42, prompt_tokens: 30, completion_tokens: 12 }, access_token: '[REDACTED]' });
});

test('run sends original credentials but stores and exports scrubbed exchanges and audit', async () => {
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, options });
    if (url.startsWith('/api/')) return Response.json({ data: { events: [{ event_id: 'audit1', attributes: { token: 'private' } }] } });
    assert.equal(options.headers.get('Authorization'), 'Bearer private');
    assert.equal(options.body, '{"password":"bodysecret"}');
    return Response.json({ result: { reflected: 'private bodysecret' } }, { headers: { 'x-debug': 'private' } });
  };
  const run = await executeRun({ method: 'POST', url: 'http://localhost:8081/default/mcp', namespace: 'default', target: 'tool', body: '{"password":"bodysecret"}' }, 'private');
  assert.equal(run.outcome, 'success');
  assert.ok(!exportRun(run).includes('private'));
  assert.ok(!exportRun(run).includes('bodysecret'));
  assert.equal(run.audit.length, 1);
  const query = new URL(calls[1].url, 'http://localhost').searchParams;
  assert.equal(query.get('namespace'), 'default');
  assert.equal(query.get('target'), 'tool');
  assert.ok(query.has('from') && query.has('to'));
});

test('audit uses the configured management origin and Basic echoes are scrubbed', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    calls.push(url);
    return url.includes('/audit/events') ? Response.json({data: {events: []}})
      : Response.json({echo: 'dXNlcjpwYXNz'});
  };
  const run = await executeRun({method: 'GET', url: 'https://listener.example/v1/models', headers: {Authorization: 'Basic dXNlcjpwYXNz'}}, undefined, 'https://management.example/');
  assert.ok(calls[1].startsWith('https://management.example/api/v1/audit/events?'));
  assert.ok(!exportRun(run).includes('dXNlcjpwYXNz'));
});

test('governance denial and transport failures are explained even without audit', async () => {
  globalThis.fetch = async (url) => {
    if (url.startsWith('/api/')) throw new Error('Audit offline');
    return Response.json({ error: { code: -32000, message: 'Denied', data: { reason_code: 'policy_denied' } } }, { status: 403 });
  };
  const run = await executeRun({ method: 'POST', url: 'http://localhost/mcp' });
  assert.match(run.summary, /^Governance: policy_denied/);
  assert.equal(run.outcome, 'error');
  assert.equal(run.auditError, 'Audit offline');
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const failed = await executeRun({ method: 'GET', url: 'http://localhost/models' });
  assert.equal(failed.status, null);
  assert.match(failed.summary, /CORS/);
});

test('management envelope, IPv6 defaults, and complete schema constraints', async () => {
  globalThis.fetch = async () => Response.json({ data: [{ name: 'default' }] });
  assert.deepEqual(await managementFetch('/api/v1/namespaces'), [{ name: 'default' }]);
  assert.equal(defaultEndpoints('https://[::1]:8443/ui').mcp, 'https://[::1]:8081');
  const schema = { type: 'object', required: ['count'], properties: { count: { type: 'integer', minimum: 1 }, mode: { enum: ['safe'] } }, additionalProperties: false };
  assert.equal(validateSchema(schema, { count: 1, mode: 'safe' }).length, 0);
  assert.ok(validateSchema(schema, { count: 0, mode: 'unsafe', extra: true }).length >= 3);
});
