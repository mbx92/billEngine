import pg from 'pg'

const databaseUrl = process.env.NUXT_DATABASE_URL || process.env.DATABASE_URL
const state = process.env.BILLING_GATE_TEST_STATE || 'grace'

if (!databaseUrl) throw new Error('NUXT_DATABASE_URL is required.')
if (!['normal', 'grace', 'blocked', 'paid'].includes(state)) {
  throw new Error('BILLING_GATE_TEST_STATE must be normal, grace, blocked, or paid.')
}

const ids = {
  customer: '10000000-0000-4000-8000-000000000001',
  server: '10000000-0000-4000-8000-000000000002',
  resource: '10000000-0000-4000-8000-000000000003',
  service: '10000000-0000-4000-8000-000000000004',
  serviceResource: '10000000-0000-4000-8000-000000000005',
  invoice: '10000000-0000-4000-8000-000000000006',
  invoiceItem: '10000000-0000-4000-8000-000000000007',
}

const invoiceStatus = state === 'paid' || state === 'normal' ? 'paid' : 'overdue'
const balanceDue = invoiceStatus === 'paid' ? 0 : 500000
const amountPaid = invoiceStatus === 'paid' ? 500000 : 0
const daysPastDue = state === 'blocked' ? 10 : 1

const pool = new pg.Pool({ connectionString: databaseUrl })
const client = await pool.connect()

try {
  await client.query('begin')
  await client.query(
    `insert into settings (key, value)
     values ('billing.configuration', $1::jsonb)
     on conflict (key) do update set value = excluded.value, updated_at = now()`,
    [
      JSON.stringify({
        companyName: 'OC Networks Billing Test',
        companyEmail: null,
        companyAddress: null,
        companyTaxId: null,
        billingTimezone: 'Asia/Makassar',
        billingCurrency: 'IDR',
        defaultTaxRate: null,
        billingAutomationEnabled: false,
        billingAccessControlEnabled: true,
        overdueGraceDays: 7,
        graceNoticeIntervalHours: 24,
      }),
    ],
  )
  await client.query(
    `insert into customers (id, customer_number, name, company_name, email)
     values ($1, 'CUS-GATE-TEST', 'OpsWiki Test Customer', 'OC Networks', 'billing-test@ocnetworks.web.id')
     on conflict (customer_number) do update set updated_at = now()`,
    [ids.customer],
  )
  await client.query(
    `insert into coolify_servers (id, name, base_url, status)
     values ($1, 'Coolify 2', 'https://coolify2.ocnetworks.web.id', 'connected')
     on conflict (id) do update set status = excluded.status, updated_at = now()`,
    [ids.server],
  )
  await client.query(
    `insert into coolify_resources
       (id, coolify_server_id, coolify_uuid, resource_type, name, status, fqdn, last_seen_at)
     values ($1, $2, 'a5o7tnpfzdu87sxx1aapnew2', 'application', 'ops-wiki:main', 'running',
       'https://opswiki.ocnetworks.web.id', now())
     on conflict (coolify_server_id, coolify_uuid) do update
       set name = excluded.name, status = excluded.status, fqdn = excluded.fqdn,
           last_seen_at = now(), updated_at = now()`,
    [ids.resource, ids.server],
  )
  await client.query(
    `insert into services
       (id, customer_id, service_number, name, status, currency, price_amount, billing_cycle,
        billing_start_date, next_due_date)
     values ($1, $2, 'SVC-GATE-TEST', 'OpsWiki Hosting', 'active', 'IDR', 500000, 'monthly',
       current_date - interval '2 months', current_date + interval '1 month')
     on conflict (service_number) do update set status = 'active', updated_at = now()`,
    [ids.service, ids.customer],
  )
  await client.query(
    `insert into service_resources (id, service_id, resource_id)
     values ($1, $2, $3)
     on conflict (service_id, resource_id) do nothing`,
    [ids.serviceResource, ids.service, ids.resource],
  )
  await client.query(
    `insert into invoices
       (id, customer_id, invoice_number, status, currency, issue_date, due_date,
        subtotal_amount, tax_amount, total_amount, amount_paid, credited_amount, balance_due,
        customer_name, customer_company_name, customer_email, seller_name, issued_at, paid_at)
     values ($1, $2, 'INV-GATE-TEST', $3, 'IDR', current_date - interval '12 days',
       current_date - $4::integer, 500000, 0, 500000, $5, 0, $6,
       'OpsWiki Test Customer', 'OC Networks', 'billing-test@ocnetworks.web.id',
       'OC Networks Billing Test', now(), case when $3 = 'paid' then now() else null end)
     on conflict (invoice_number) do update set
       status = excluded.status, due_date = excluded.due_date, amount_paid = excluded.amount_paid,
       balance_due = excluded.balance_due, paid_at = excluded.paid_at, updated_at = now()`,
    [ids.invoice, ids.customer, invoiceStatus, daysPastDue, amountPaid, balanceDue],
  )
  await client.query(
    `insert into invoice_items
       (id, invoice_id, service_id, description, quantity, unit_price_amount,
        subtotal_amount, tax_amount, total_amount)
     values ($1, $2, $3, 'OpsWiki hosting test', 1, 500000, 500000, 0, 500000)
     on conflict (id) do update set service_id = excluded.service_id`,
    [ids.invoiceItem, ids.invoice, ids.service],
  )
  await client.query('commit')
  console.log(`Billing gate test fixture is ready in ${state} state.`)
} catch (error) {
  await client.query('rollback')
  throw error
} finally {
  client.release()
  await pool.end()
}
