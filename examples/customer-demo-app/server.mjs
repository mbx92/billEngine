import { createServer } from 'node:http'

const port = Number(process.env.PORT || 3000)
const customerName = process.env.CUSTOMER_NAME || 'Demo Customer'
const serviceNumber = process.env.SERVICE_NUMBER || 'SVC-DEMO'
const serviceState = process.env.SERVICE_STATE || 'normal'

const stateContent = {
  normal: {
    label: 'Running',
    message: 'Layanan aktif dan pembayaran dalam kondisi baik.',
    color: '#16803c',
  },
  grace: {
    label: 'Grace period',
    message: 'Invoice melewati jatuh tempo, tetapi aplikasi masih dapat digunakan.',
    color: '#b45309',
  },
  suspended: {
    label: 'Suspended',
    message: 'Layanan dihentikan karena melewati batas grace period.',
    color: '#b42318',
  },
}

const currentState = stateContent[serviceState] || stateContent.normal

const server = createServer((request, response) => {
  if (request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
    response.end(JSON.stringify({ ok: true, customer: customerName, state: serviceState }))
    return
  }

  if (request.url !== '/') {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    response.end('Not found')
    return
  }

  response.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(`<!doctype html>
<html lang="id">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(customerName)} · Customer Status Demo</title>
    <style>
      :root { color-scheme: light; font-family: Inter, ui-sans-serif, system-ui, sans-serif; }
      * { box-sizing: border-box; }
      body { margin: 0; min-height: 100vh; display: grid; place-items: center; color: #17202a; background: #f5f7fa; }
      main { width: min(92vw, 620px); padding: 36px; border: 1px solid #dfe3e8; border-radius: 18px; background: white; box-shadow: 0 18px 55px rgb(20 32 50 / 8%); }
      .eyebrow { margin: 0 0 12px; color: #667085; font: 700 12px/1.4 ui-monospace, monospace; letter-spacing: .09em; text-transform: uppercase; }
      h1 { margin: 0; font-size: clamp(28px, 6vw, 44px); letter-spacing: -.04em; }
      .status { display: inline-flex; align-items: center; gap: 8px; margin-top: 28px; padding: 8px 12px; border-radius: 999px; color: ${currentState.color}; background: color-mix(in srgb, ${currentState.color} 10%, white); font-weight: 700; }
      .dot { width: 9px; height: 9px; border-radius: 50%; background: currentColor; }
      .message { margin: 18px 0 0; color: #475467; font-size: 17px; line-height: 1.65; }
      dl { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin: 30px 0 0; padding-top: 24px; border-top: 1px solid #e4e7ec; }
      dt { color: #667085; font-size: 12px; text-transform: uppercase; letter-spacing: .06em; }
      dd { margin: 6px 0 0; font-family: ui-monospace, monospace; font-size: 14px; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">OC Infrastructure · Shared demo image</p>
      <h1>${escapeHtml(customerName)}</h1>
      <div class="status"><span class="dot"></span>${escapeHtml(currentState.label)}</div>
      <p class="message">${escapeHtml(currentState.message)}</p>
      <dl>
        <div><dt>Service</dt><dd>${escapeHtml(serviceNumber)}</dd></div>
        <div><dt>Runtime</dt><dd>Node.js ${escapeHtml(process.version)}</dd></div>
      </dl>
    </main>
  </body>
</html>`)
})

server.listen(port, '0.0.0.0', () => {
  console.info(`Customer Status Demo listening on :${port}`)
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)))
}

function escapeHtml(value) {
  return String(value).replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[character],
  )
}
