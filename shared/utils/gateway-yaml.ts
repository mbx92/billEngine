export function gatewayMiddlewareYaml(checkUrl: string, sharedKey: string) {
  return `http:
  middlewares:
    billing-gate-key:
      headers:
        customRequestHeaders:
          X-Billing-Gate-Key: ${JSON.stringify(sharedKey)}
    billing-gate-forward:
      forwardAuth:
        address: ${JSON.stringify(checkUrl)}
    billing-gate-key-clear:
      headers:
        customRequestHeaders:
          X-Billing-Gate-Key: ''
    billing-gate:
      chain:
        middlewares:
          - billing-gate-key
          - billing-gate-forward
          - billing-gate-key-clear`
}
