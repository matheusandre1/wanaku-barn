import {createServer} from 'node:http';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';

const bundle = resolve(import.meta.dirname, '../../../apps/ui/debugger/plugin-dist');
const html = `<!doctype html><html><head><link rel="stylesheet" href="/plugin.css"></head>
<body><nav id="navigation"></nav><main id="page"></main><script type="module">
import {activate} from '/plugin.js';
await activate({version:'1.0', navigation:{add(entry) {
  const link = document.createElement('a'); link.textContent = entry.label;
  link.href = entry.route; document.querySelector('#navigation').append(link);
  return {dispose(){link.remove()}};
}}, pages:{register(page) {return page.mount(document.querySelector('#page'))}}});
</script></body></html>`;

createServer(async (request, response) => {
  if (request.url === '/plugin.js' || request.url === '/plugin.css') {
    try {
      const data = await readFile(resolve(bundle, request.url.slice(1)));
      response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css');
      response.end(data);
    } catch { response.writeHead(404).end('Build the debugger plugin first'); }
  } else {
    response.setHeader('Content-Type', 'text/html'); response.end(html);
  }
}).listen(4177, '127.0.0.1');
