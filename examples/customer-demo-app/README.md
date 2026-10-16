# Customer Status Demo

A tiny dependency-free Node.js application used to exercise BillEngine's
one-image-to-many-customers deployment model.

The same image is configured per deployment with:

- `CUSTOMER_NAME`
- `SERVICE_NUMBER`
- `SERVICE_STATE` (`normal`, `grace`, or `suspended`)

Build and run it manually when you are ready to publish the first real image:

```bash
docker build -t customer-status-demo ./examples/customer-demo-app
docker run --rm -p 3000:3000 \
  -e CUSTOMER_NAME="Toko Langit Demo" \
  -e SERVICE_NUMBER="SVC-000001" \
  -e SERVICE_STATE="normal" \
  customer-status-demo
```

Open `http://localhost:3000`; the health endpoint is `http://localhost:3000/health`.

The development seed records a placeholder registry and image digest for UI simulation only.
Before a real deployment, configure an active registry under **Infrastructure → Applications**,
publish this image, and register the immutable digest as a release.

While developing BillEngine, the three browser previews are available without Docker:

- `http://localhost:3000/demo/demo-customer-1` — running normally
- `http://localhost:3000/demo/demo-customer-2` — grace-period notice, then running
- `http://localhost:3000/demo/demo-customer-3` — access blocked and resource stopped
