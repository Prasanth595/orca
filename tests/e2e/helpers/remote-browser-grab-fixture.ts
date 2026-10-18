import { createServer } from 'node:http'
import { build } from 'esbuild'

export async function startRemoteGrabFixture(): Promise<{
  url: string
  close: () => Promise<void>
}> {
  const bundle = await build({
    stdin: {
      contents: `
        import { createElement, useState } from 'react';
        import { createRoot } from 'react-dom/client';
        function RemoteGrabButton() {
          const [count, setCount] = useState(0);
          return createElement('button', {
            id: 'remote-grab-button',
            onClick: () => setCount(count + 1)
          }, 'Action count: ' + count);
        }
        function RemoteGrabApp() {
          return createElement('main', null,
            createElement('h1', null, 'Remote headless element remote-grab'),
            createElement('p', null, 'This React app runs on the headless host.'),
            createElement(RemoteGrabButton),
            createElement('input', {
              id: 'remote-grab-password', type: 'password', defaultValue: 'fixture-secret'
            })
          );
        }
        createRoot(document.getElementById('root')).render(createElement(RemoteGrabApp));
      `,
      resolveDir: process.cwd(),
      sourcefile: 'headless-grab-remote-grab-app.js'
    },
    bundle: true,
    write: false,
    platform: 'browser',
    format: 'iife',
    define: { 'process.env.NODE_ENV': '"development"' }
  })
  const script = bundle.outputFiles[0]?.text
  if (!script) {
    throw new Error('RemoteGrab React fixture did not build')
  }
  const server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store')
    if (request.url === '/app.js') {
      response.setHeader('Content-Type', 'text/javascript; charset=utf-8')
      response.end(script)
      return
    }
    response.setHeader('Content-Type', 'text/html; charset=utf-8')
    response.end(
      '<!doctype html><title>Headless grab remote-grab</title>' +
        '<style>body{margin:24px;font:16px sans-serif}button{padding:16px}input{display:block;margin-top:24px}</style><div id="root"></div><script src="/app.js"></script>'
    )
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('RemoteGrab page has no TCP port')
  }
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections()
        server.close((error) => (error ? reject(error) : resolve()))
      })
  }
}
