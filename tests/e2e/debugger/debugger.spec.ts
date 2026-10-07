import {test, expect, type Page} from '../ui/node_modules/@playwright/test';
import {readFile} from 'node:fs/promises';

async function management(page: Page) {
  await page.route('**/api/v1/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.includes('namespaces') ? [{name: 'default'}, {name: 'test-ns'}]
      : path.includes('agents') ? [{name: 'helper', namespace: 'test-ns', proxyUrl: 'http://127.0.0.1:8084/test-ns/a2a/helper'}]
      : path.includes('action-policies') ? {policy: {rules: [{id: 'allow-echo', effect: 'allow', selectors: {namespace: 'default', target_type: 'tool', target_name: {matcher: 'exact', value: 'echo'}}}, {id: 'other-tool', effect: 'deny', selectors: {target_name: {matcher: 'exact', value: 'other'}}}]}}
      : path.includes('tools') ? [{name: 'echo'}, {name: 'disabled', enabled: false}, {name: 'foreign', namespace: 'other'}]
      : path.includes('audit') ? {events: []} : [];
    await route.fulfill({json: {data}});
  });
}

test.beforeEach(async ({page}) => { await management(page); });

test('bundled plugin registers and renders without Barn services', async ({page}) => {
  await page.goto('/');
  await expect(page.getByRole('link', {name: 'Debugger'})).toBeVisible();
  for (const name of ['MCP', 'A2A', 'Inference']) await expect(page.getByRole('tab', {name, exact: true})).toBeVisible();
});

for (const denied of [false, true]) {
  test(`MCP schema invocation ${denied ? 'denied' : 'allowed'}`, async ({page}) => {
    const calls: Record<string, unknown>[] = [];
    await page.route('**/default/mcp', async (route) => {
      const request = route.request().postDataJSON(); calls.push(request);
      const response = request.method === 'tools/list'
        ? {result: {tools: [{name: 'echo', inputSchema: {type: 'object', required: ['text'], properties: {text: {type: 'string'}}}}]}}
        : denied ? {error: {code: -32003, message: 'Policy denied', data: {reason_code: 'no_match', safe_message: 'No matching policy'}}}
          : {result: {content: [{type: 'text', text: 'echo response'}]}};
      await route.fulfill({json: {jsonrpc: '2.0', id: request.id, ...response}});
    });
    await page.goto('/');
    await page.getByRole('button', {name: 'Discover tools', exact: true}).click();
    await page.getByLabel('MCP target').selectOption('echo');
    await page.getByRole('button', {name: 'Load registry', exact: true}).click();
    await expect(page.getByText('disabled: disabled', {exact: true})).toBeVisible();
    await expect(page.getByText('foreign: not advertised', {exact: true})).toHaveCount(0);
    await page.getByRole('button', {name: 'Inspect matching policies', exact: true}).click();
    await expect(page.getByLabel('Matching policy candidates')).toContainText('allow-echo');
    await expect(page.getByLabel('Matching policy candidates')).not.toContainText('other-tool');
    await page.getByLabel('text (string) required').fill('hello');
    await page.getByRole('button', {name: 'Run MCP operation', exact: true}).click();
    await expect(page.getByText(denied ? 'Policy denied' : 'echo response', {exact: false}).first()).toBeVisible();
    expect(calls.find((call) => call.method === 'tools/call')?.params).toEqual({name: 'echo', arguments: {text: 'hello'}});
    if (!denied) {
      await page.getByLabel('Edit request body for replay').fill(JSON.stringify({jsonrpc: '2.0', id: 'replay', method: 'tools/call', params: {name: 'echo', arguments: {text: 'edited'}}}));
      await page.getByRole('button', {name: 'Replay run', exact: true}).click();
      await expect.poll(() => calls.at(-1)?.params).toEqual({name: 'echo', arguments: {text: 'edited'}});
    }
  });
}

test('A2A sends a message and follows the returned task', async ({page}) => {
  const methods: string[] = [];
  await page.route('**/test-ns/a2a/helper**', async (route) => {
    if (route.request().method() === 'GET') return route.fulfill({json: {name: 'helper', capabilities: {streaming: false}}});
    const request = route.request().postDataJSON(); methods.push(request.method);
    expect(route.request().headers()['a2a-version']).toBeUndefined();
    expect(['SendMessage', 'GetTask', 'CancelTask']).toContain(request.method);
    if (request.method !== 'SendMessage') expect(request.params).toEqual({id: 'task-1'});
    const task = {id: 'task-1', contextId: 'context-1', status: {state: 'TASK_STATE_COMPLETED'}};
    await route.fulfill({json: {jsonrpc: '2.0', id: request.id, result: request.method === 'SendMessage' ? {task} : task}});
  });
  await page.goto('/');
  await page.getByRole('tab', {name: 'A2A', exact: true}).click();
  // The registered agent supplies the proxy URL; no backend service is used.
  await page.getByLabel('A2A namespace', {exact: true}).selectOption('test-ns');
  await page.getByLabel('Registered agent').selectOption('helper');
  await page.getByLabel('Message', {exact: true}).fill('hello agent');
  await page.getByRole('button', {name: 'SendMessage', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Run inspector'})).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export curl', exact: true}).click();
  const download = await downloadPromise;
  const curl = await readFile((await download.path())!, 'utf8');
  expect(curl).toContain('\"method\":\"SendMessage\"');
  expect(curl.toLowerCase()).not.toContain('a2a-version');
  expect(curl.toLowerCase()).toContain("-h 'content-type: application/json'");
  await page.keyboard.press('Escape');
  await expect(page.getByLabel('Task ID')).toHaveValue('task-1');
  await page.getByRole('button', {name: 'GetTask', exact: true}).click();
  await expect.poll(() => methods).toContain('GetTask');
  await expect(page.getByRole('dialog', {name: 'Run inspector'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByRole('button', {name: 'CancelTask', exact: true}).click();
  await expect.poll(() => methods).toContain('CancelTask');
  await expect(page.getByRole('dialog', {name: 'Run inspector'})).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('A2A namespace', {exact: true}).selectOption('default');
  await expect(page.getByText('No registered agents in namespace default.', {exact: false})).toBeVisible();
  await expect(page.getByLabel('Agent name', {exact: true})).toHaveValue('');
  await expect(page.getByLabel('Task ID')).toHaveValue('');
});

test('inference forwards a token and shows tool calls without executing them', async ({page}) => {
  await page.route('**/v1/chat/completions', async (route) => {
    expect(route.request().headers().authorization).toBe('Bearer test-provider-token');
    await route.fulfill({json: {choices: [{message: {tool_calls: [{id: 'wk-123', function: {name: 'echo', arguments: '{}'}}]}}], usage: {total_tokens: 12}}});
  });
  await page.goto('/');
  await page.getByRole('tab', {name: 'Inference', exact: true}).click();
  await page.getByRole('button', {name: 'Connection settings', exact: false}).click();
  await page.getByLabel('Bearer token', {exact: true}).fill('test-provider-token');
  await page.getByRole('button', {name: 'Create completion', exact: true}).click();
  await expect(page.getByRole('dialog', {name: 'Run inspector'})).toBeVisible();
  await expect(page.getByLabel('Response body JSON')).toContainText('wk-123');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-provider-token');
});


test('namespaced MCP request opens a centered inspector with formatted code', async ({page}) => {
  await page.route('**/test-ns/mcp', async (route) => {
    const request = route.request().postDataJSON();
    await route.fulfill({json: {jsonrpc: '2.0', id: request.id, result: {tools: [{name: 'echo'}]}}});
  });
  await page.goto('/');
  await page.getByLabel('MCP namespace', {exact: true}).selectOption('test-ns');
  await page.getByRole('button', {name: 'Discover tools', exact: true}).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.getByLabel('MCP target').selectOption('echo');
  await page.getByRole('button', {name: 'Run MCP operation', exact: true}).click();
  const dialog = page.getByRole('dialog', {name: 'Run inspector'});
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate((element) => element.closest('.wanaku-debugger'))).toBeNull();
  const bounds = await dialog.boundingBox();
  const viewport = page.viewportSize()!;
  expect(bounds!.y).toBeGreaterThanOrEqual(0);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  const code = page.getByLabel('Response body JSON', {exact: true});
  await expect(code).toContainText('"tools": [');
  expect(await code.textContent()).toContain('\n  "jsonrpc": "2.0"');
  await expect(code.locator('.debugger-json-key').first()).toBeVisible();
  await dialog.getByRole('button', {name: 'Request', exact: true}).click();
  await expect(page.getByLabel('Request body JSON', {exact: true})).toContainText('"method": "tools/call"');
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', {name: 'Run MCP operation', exact: true})).toBeFocused();
});

test('custom namespace remains selected when namespace discovery is unavailable', async ({page}) => {
  await page.route('**/api/v1/namespaces', route => route.fulfill({status: 503, json: {error: 'Unavailable'}}));
  let path = '';
  await page.route('**/custom-ns/mcp', async route => {
    path = new URL(route.request().url()).pathname;
    await route.fulfill({json: {result: {tools: []}}});
  });
  await page.goto('/');
  await expect(page.getByText('Namespace discovery unavailable', {exact: true})).toBeVisible();
  const panel = page.getByRole('region', {name: 'MCP debugger'});
  await panel.getByLabel('Custom namespace', {exact: true}).fill('custom-ns');
  await panel.getByRole('button', {name: 'Use namespace', exact: true}).click();
  await expect(page.getByLabel('MCP namespace', {exact: true})).toHaveValue('custom-ns');
  await page.getByRole('button', {name: 'Discover tools', exact: true}).click();
  await expect.poll(() => path).toBe('/custom-ns/mcp');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});
