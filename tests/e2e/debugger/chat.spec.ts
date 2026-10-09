import {test, expect, type Page} from '../ui/node_modules/@playwright/test';
import {readFile} from 'node:fs/promises';

// Exercise the packaged plugin with deterministic protocol responses, without
// requiring a running model provider, MCP server, or management backend.
test.beforeEach(async ({page}) => {
  await page.route('**/api/v1/**', route => {
    const path = new URL(route.request().url()).pathname;
    const data = path.includes('namespaces') ? [{name: 'default'}, {name: 'test-ns'}]
      : path.includes('audit') ? {events: []} : [];
    return route.fulfill({json: {data}});
  });
});

async function openChat(page: Page) {
  await page.goto('/');
  await page.getByRole('tab', {name: 'LLM Chat', exact: true}).click();
}

async function models(page: Page) {
  await page.route('**/v1/models', route => route.fulfill({json: {data: [{id: 'test-model'}]}}));
}

async function selectModel(page: Page) {
  await page.getByRole('button', {name: 'Load models and tools', exact: true}).click();
  await page.getByRole('combobox', {name: 'LLM model', exact: true}).click();
  await page.getByRole('option', {name: 'test-model', exact: true}).click();
  await expect(page.getByRole('combobox', {name: 'LLM model', exact: true})).toHaveValue('test-model');
}

test('chat discovers and invokes only selected namespaced tools with separate provider credentials', async ({page}) => {
  const completions: Record<string, any>[] = [];
  const tools: Record<string, any>[] = [];
  await page.route('**/v1/models', async route => {
    expect(route.request().headers().authorization).toBe('Bearer test-inference-key');
    await route.fulfill({json: {data: [{id: 'test-model'}]}});
  });
  await page.route('**/test-ns/mcp', async route => {
    expect(route.request().headers().authorization).toBe('Bearer test-mcp-key');
    const request = route.request().postDataJSON(); tools.push(request);
    await route.fulfill({json: {jsonrpc: '2.0', id: request.id, result: request.method === 'tools/list'
      ? {tools: [{name: 'echo', description: 'Echo text', inputSchema: {type: 'object', properties: {text: {type: 'string'}}}}, {name: 'unused'}]}
      : {content: [{type: 'text', text: `result ${tools.length}`}]} }});
  });
  await page.route('**/v1/chat/completions', async route => {
    expect(route.request().headers().authorization).toBe('Bearer test-inference-key');
    const body = route.request().postDataJSON(); completions.push(body);
    expect(body.tools.map((tool: any) => tool.function.name)).toEqual(['echo']);
    const round = completions.length;
    await route.fulfill({json: {choices: [{message: round < 3
      ? {role: 'assistant', content: null, tool_calls: [{id: `call-${round}`, type: 'function', function: {name: 'echo', arguments: JSON.stringify({text: `round ${round}`})}}]}
      : {role: 'assistant', content: round === 3 ? 'Finished using tools.' : 'Follow-up complete.'}}]}});
  });
  await openChat(page);
  await page.getByRole('button', {name: 'Connection settings', exact: false}).click();
  await page.getByLabel('Bearer token', {exact: true}).fill('test-mcp-key');
  await page.getByText('Remember redacted run history in this browser', {exact: true}).click();
  await page.getByRole('button', {name: 'LLM settings', exact: false}).click();
  await page.getByLabel('Inference API key', {exact: true}).fill('test-inference-key');
  await page.getByLabel('LLM Chat namespace', {exact: true}).selectOption('test-ns');
  await selectModel(page);
  await page.getByText('echo — Echo text', {exact: true}).click();
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('Use echo twice.');
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  const transcript = page.getByRole('log', {name: 'Chat messages'});
  await expect(transcript).toContainText('Finished using tools.');
  expect(tools.filter(request => request.method === 'tools/call').map(request => request.params)).toEqual([
    {name: 'echo', arguments: {text: 'round 1'}}, {name: 'echo', arguments: {text: 'round 2'}},
  ]);
  expect(completions[2].messages.map((message: any) => message.role)).toEqual(['system', 'user', 'assistant', 'tool', 'assistant', 'tool']);
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('Continue.');
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect(transcript).toContainText('Follow-up complete.');
  expect(completions[3].messages.at(-1)).toEqual({role: 'user', content: 'Continue.'});
  expect(completions[3].messages).toContainEqual({role: 'assistant', content: 'Finished using tools.'});
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const saved = await page.evaluate(() => JSON.stringify(localStorage));
  expect(saved).not.toContain('test-inference-key');
  expect(saved).not.toContain('test-mcp-key');
  expect(saved).toContain('[REDACTED]');
  await page.getByRole('button', {name: /POST .*\/v1\/chat\/completions/}).first().click();
  const dialog = page.getByRole('dialog', {name: 'Run inspector'});
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', {name: 'Request', exact: true}).click();
  await expect(page.getByLabel('Request metadata JSON')).toContainText('[REDACTED]');
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', {name: 'Export run JSON', exact: true}).click();
  const exported = await readFile((await (await downloadPromise).path())!, 'utf8');
  expect(exported).not.toContain('test-inference-key');
  expect(exported).not.toContain('test-mcp-key');
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name: 'Clear conversation', exact: true}).click();
  await expect(transcript).toContainText('No messages yet.');
  await page.getByLabel('LLM Chat namespace', {exact: true}).selectOption('default');
  await expect(page.getByLabel('echo — Echo text', {exact: true})).toHaveCount(0);
});

test('inference credentials persist only with both explicit browser storage choices', async ({page}) => {
  await openChat(page);
  await page.getByRole('button', {name: 'LLM settings', exact: false}).click();
  const key = page.getByLabel('Inference API key', {exact: true});
  await key.fill('test-opt-in-key');
  await page.getByText('Remember LLM settings in this browser', {exact: true}).click();
  await page.getByLabel('System prompt', {exact: true}).fill('Remember this instruction.');
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-opt-in-key');
  await page.reload();
  await page.getByRole('tab', {name: 'LLM Chat', exact: true}).click();
  await page.getByRole('button', {name: 'LLM settings', exact: false}).click();
  await expect(key).toHaveValue('');
  await expect(page.getByLabel('System prompt', {exact: true})).toHaveValue('Remember this instruction.');
  await key.fill('test-opt-in-key');
  await page.getByText('Also remember the inference API key', {exact: true}).click();
  await page.reload();
  await page.getByRole('tab', {name: 'LLM Chat', exact: true}).click();
  await page.getByRole('button', {name: 'LLM settings', exact: false}).click();
  await expect(key).toHaveValue('test-opt-in-key');
  await page.getByText('Also remember the inference API key', {exact: true}).click();
  expect(await page.evaluate(() => JSON.stringify(localStorage))).not.toContain('test-opt-in-key');
  await page.reload();
  await page.getByRole('tab', {name: 'LLM Chat', exact: true}).click();
  await page.getByRole('button', {name: 'LLM settings', exact: false}).click();
  await expect(key).toHaveValue('');
  await page.getByText('Remember LLM settings in this browser', {exact: true}).click();
  expect(await page.evaluate(() => localStorage.getItem('wanaku-debugger-chat-settings'))).toBeNull();
});

test('stop generation releases the composer and clear removes conversation', async ({page}) => {
  await models(page);
  await page.route('**/default/mcp', route => route.fulfill({json: {result: {tools: []}}}));
  let arrived = false;
  let release: () => void = () => {};
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/v1/chat/completions', async route => {
    arrived = true;
    await held;
    await route.fulfill({json: {choices: [{message: {content: 'Too late.'}}]}}).catch(() => {});
  });
  await openChat(page);
  await selectModel(page);
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('Wait for a response.');
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect.poll(() => arrived).toBe(true);
  await page.getByRole('button', {name: 'Stop generation', exact: true}).click();
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toBeEnabled();
  await expect(page.getByRole('button', {name: 'Stop generation', exact: true})).toBeDisabled();
  release();
  await page.getByRole('button', {name: 'Clear conversation', exact: true}).click();
  await expect(page.getByRole('log', {name: 'Chat messages'})).toContainText('No messages yet.');
  await expect(page.getByRole('log', {name: 'Chat messages'})).not.toContainText('Too late.');
});

test('chat refuses model calls to tools the user did not select', async ({page}) => {
  await models(page);
  const methods: string[] = [];
  await page.route('**/default/mcp', async route => {
    const request = route.request().postDataJSON(); methods.push(request.method);
    await route.fulfill({json: {result: {tools: [{name: 'restricted'}]}}});
  });
  await page.route('**/v1/chat/completions', route => route.fulfill({json: {choices: [{message: {
    tool_calls: [{id: 'unexpected', function: {name: 'restricted', arguments: '{}'}}],
  }}]}}));
  await openChat(page);
  await selectModel(page);
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('Do not use tools.');
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  await expect(page.getByText('Model requested unselected tool: restricted', {exact: false})).toBeVisible();
  expect(methods).toEqual(['tools/list']);
  await expect(page.getByRole('textbox', {name: 'Message', exact: true})).toBeEnabled();
});

test('chat formats Markdown replies while keeping provider HTML inert', async ({page}) => {
  await models(page);
  await page.route('**/default/mcp', route => route.fulfill({json: {result: {tools: []}}}));
  await page.route('**/v1/chat/completions', route => route.fulfill({json: {choices: [{message: {
    content: '**Answer**\n\n- First step\n- Second step\n\n[Documentation](https://example.com/docs)\n\n```json\n{"answer":42}\n```\n\n<script>window.chatInjected = true</script><img src="x" onerror="window.chatInjected = true">',
  }}]}}));
  await openChat(page);
  await selectModel(page);
  await page.getByRole('textbox', {name: 'Message', exact: true}).fill('Explain the answer.');
  await page.getByRole('button', {name: 'Send message', exact: true}).click();
  const transcript = page.getByRole('log', {name: 'Chat messages'});
  await expect(transcript.locator('strong')).toHaveText('Answer');
  await expect(transcript.getByRole('listitem')).toHaveText(['First step', 'Second step']);
  await expect(transcript.getByRole('link', {name: 'Documentation'})).toHaveAttribute('href', 'https://example.com/docs');
  await expect(transcript.locator('pre code')).toContainText('{"answer":42}');
  await expect(transcript.locator('script, img')).toHaveCount(0);
  expect(await page.evaluate(() => 'chatInjected' in window)).toBe(false);
});
