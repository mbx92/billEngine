# DATABASE-SCHEMA --- Coolify Billing Platform

**Version:** 0.1\
**Status:** Initial Schema / MVP\
**Database:** PostgreSQL\
**ORM:** Drizzle ORM\
**Related:** `PRD.md`, `ARCHITECTURE.md`

## 1. Schema Principles

Database menjadi source of truth untuk data komersial.

Coolify tetap menjadi source of truth untuk data infrastructure.

Prinsip:

- gunakan UUID/ULID-style application IDs atau PostgreSQL UUID untuk
  primary key;
- gunakan foreign key;
- gunakan timestamps;
- gunakan unique constraint untuk business identifier;
- hindari hard delete untuk data finansial;
- invoice menyimpan snapshot;
- money tidak menggunakan JavaScript floating point;
- resource Coolify diidentifikasi oleh kombinasi server + Coolify
  UUID;
- schema siap untuk lebih dari satu Coolify server.

## 2. Entity Relationship Overview

```text
users
  │
  └──────────── audit_logs

customers
  │
  ├──────────── services
  │                │
  │                └──── service_resources ──── coolify_resources
  │                                              │
  │                                              └── coolify_servers
  │
  └──────────── invoices
                    │
                    ├──── invoice_items
                    │
                    └──── payments
```

## 3. Enum / Controlled Values

Disarankan menggunakan PostgreSQL enum atau validated text constants
sesuai keputusan implementasi Drizzle.

### User Role

```text
super_admin
admin
customer
```

### Customer Status

```text
active
inactive
```

### Service Status

```text
active
suspended
cancelled
```

### Billing Cycle

```text
one_time
monthly
quarterly
semi_annually
annually
```

### Resource Classification

```text
billable
internal
ignored
```

### Resource Status

Cached normalized status:

```text
running
stopped
restarting
degraded
unknown
```

### Invoice Status

```text
draft
unpaid
paid
overdue
cancelled
```

### Payment Status

```text
pending
completed
failed
refunded
cancelled
```

MVP manual payment umumnya langsung `completed`.

## 4. `users`

Menyimpan user authentication/application identity.

```text
users
────────────────────────────────────
id                  uuid PK
name                varchar
email               varchar UNIQUE
email_verified      boolean
role                varchar/enum
customer_id         uuid NULL FK
created_at          timestamptz
updated_at          timestamptz
```

Catatan:

- tabel tambahan Better Auth seperti session/account/verification
  mengikuti adapter/schema resmi Better Auth;
- `customer_id` digunakan ketika user merupakan customer portal user;
- admin memiliki `customer_id = NULL`.

Index:

```text
UNIQUE(email)
INDEX(customer_id)
INDEX(role)
```

## 5. `customers`

```text
customers
────────────────────────────────────
id                  uuid PK
customer_number     varchar UNIQUE
name                varchar
company_name        varchar NULL
email               varchar
phone               varchar NULL

address_line_1      varchar NULL
address_line_2      varchar NULL
city                varchar NULL
province            varchar NULL
postal_code         varchar NULL
country_code        varchar

tax_id              varchar NULL

status              customer_status
notes               text NULL

created_at          timestamptz
updated_at          timestamptz
```

Contoh:

```text
customer_number = CUS-000001
country_code = ID
```

Customer number adalah business identifier dan tidak menggunakan
database ID sebagai nomor customer.

## 6. `services`

Service adalah unit komersial yang ditagihkan.

```text
services
────────────────────────────────────
id                  uuid PK
customer_id         uuid FK customers

service_number      varchar UNIQUE
name                varchar
description         text NULL

status              service_status

currency            char(3)
price_amount        bigint
billing_cycle       billing_cycle

billing_start_date  date
next_due_date       date NULL

invoice_lead_days   integer DEFAULT 0
payment_due_days    integer DEFAULT 7

tax_rate            numeric NULL

created_at          timestamptz
updated_at          timestamptz
cancelled_at        timestamptz NULL
```

Untuk IDR:

```text
currency = IDR
price_amount = 500000
```

`price_amount` disimpan sebagai integer rupiah.

Jika multi-currency dengan minor units diperlukan di masa depan, money
abstraction harus diperluas secara eksplisit.

Index:

```text
INDEX(customer_id)
INDEX(status)
INDEX(next_due_date)
INDEX(customer_id, status)
```

## 7. `coolify_servers`

Menyimpan server/control endpoint Coolify yang terhubung.

```text
coolify_servers
────────────────────────────────────
id                  uuid PK
name                varchar
base_url            varchar
status              varchar
is_active           boolean

token_encrypted     text NULL

last_synced_at      timestamptz NULL
last_sync_status    varchar NULL
last_sync_error     text NULL

created_at          timestamptz
updated_at          timestamptz
```

Catatan keamanan:

- token tidak boleh disimpan plaintext;
- untuk MVP satu server, token juga dapat berasal dari environment
  variable;
- jika token dipersist ke database, gunakan application-level
  encryption dengan key yang tidak disimpan di database yang sama.

## 8. `coolify_resources`

Cached representation dari resource Coolify.

```text
coolify_resources
────────────────────────────────────
id                      uuid PK
coolify_server_id       uuid FK coolify_servers

coolify_uuid            varchar
resource_type           varchar
name                    varchar

status                  resource_status
classification          resource_classification

fqdn                    text NULL
project_name            varchar NULL
environment_name        varchar NULL

limits_cpus             numeric NULL
limits_cpuset           varchar NULL
limits_cpu_shares       integer NULL

limits_memory_bytes     bigint NULL
memory_reservation_bytes bigint NULL
memory_swap_bytes       bigint NULL

raw_metadata            jsonb NULL

last_seen_at            timestamptz NULL
last_synced_at          timestamptz NULL
created_at              timestamptz
updated_at              timestamptz
```

Constraint penting:

```text
UNIQUE(coolify_server_id, coolify_uuid)
```

Index:

```text
INDEX(coolify_server_id)
INDEX(status)
INDEX(classification)
INDEX(last_seen_at)
```

`raw_metadata` dapat menyimpan subset/raw response yang berguna untuk
troubleshooting, tetapi business logic tidak boleh bergantung pada
struktur JSON mentah jika field sudah dinormalisasi.

## 9. `service_resources`

Many-to-many relation antara service dan Coolify resource.

```text
service_resources
────────────────────────────────────
id                  uuid PK
service_id          uuid FK services
resource_id         uuid FK coolify_resources

created_at          timestamptz
created_by          uuid NULL FK users
```

Constraint:

```text
UNIQUE(service_id, resource_id)
```

Untuk MVP disarankan satu billable resource hanya boleh aktif pada satu
service customer pada saat yang sama. Jika aturan ini dipilih, enforce
melalui business rule atau constraint tambahan yang sesuai.

## 10. `invoices`

Invoice header dan snapshot customer/company.

```text
invoices
────────────────────────────────────
id                      uuid PK
customer_id             uuid FK customers

invoice_number          varchar UNIQUE

status                  invoice_status
currency                char(3)

issue_date              date
due_date                date

subtotal_amount         bigint
tax_amount              bigint
total_amount            bigint

amount_paid             bigint DEFAULT 0
balance_due             bigint

customer_name           varchar
customer_company_name   varchar NULL
customer_email          varchar
customer_phone          varchar NULL
customer_address        text NULL
customer_tax_id         varchar NULL

seller_name             varchar
seller_address          text NULL
seller_email            varchar NULL
seller_tax_id           varchar NULL

notes                   text NULL

issued_at               timestamptz NULL
paid_at                 timestamptz NULL
cancelled_at            timestamptz NULL

created_at              timestamptz
updated_at              timestamptz
```

Snapshot fields sengaja diduplikasi dari customer/settings.

Invoice historis tidak boleh berubah ketika customer profile berubah.

Constraint:

```text
subtotal_amount >= 0
tax_amount >= 0
total_amount >= 0
amount_paid >= 0
balance_due >= 0
```

Index:

```text
UNIQUE(invoice_number)
INDEX(customer_id)
INDEX(status)
INDEX(due_date)
INDEX(customer_id, status)
```

## 11. `invoice_items`

```text
invoice_items
────────────────────────────────────
id                  uuid PK
invoice_id          uuid FK invoices

service_id          uuid NULL FK services

description         text
quantity            numeric
unit_price_amount   bigint
subtotal_amount     bigint
tax_rate            numeric NULL
tax_amount          bigint
total_amount        bigint

service_period_start date NULL
service_period_end   date NULL

metadata            jsonb NULL

created_at          timestamptz
```

`service_id` dapat disimpan untuk traceability, tetapi item tetap
merupakan snapshot. Perubahan service tidak menghitung ulang item
historis.

Index:

```text
INDEX(invoice_id)
INDEX(service_id)
```

## 12. `payments`

```text
payments
────────────────────────────────────
id                  uuid PK
invoice_id          uuid FK invoices

payment_number      varchar UNIQUE
status              payment_status

amount              bigint
currency            char(3)

method              varchar
reference           varchar NULL
notes               text NULL

paid_at             timestamptz
recorded_by         uuid NULL FK users

created_at          timestamptz
updated_at          timestamptz
```

Contoh method:

```text
bank_transfer
cash
manual
other
```

Payment tidak mengubah invoice total. Payment hanya mengurangi balance.

Index:

```text
UNIQUE(payment_number)
INDEX(invoice_id)
INDEX(status)
INDEX(paid_at)
```

## 13. `settings`

Global application settings.

```text
settings
────────────────────────────────────
id                  uuid PK
key                 varchar UNIQUE
value               jsonb
is_secret           boolean DEFAULT false

created_at          timestamptz
updated_at          timestamptz
```

Contoh non-secret:

```text
company.profile
billing.default_due_days
billing.default_currency
billing.timezone
invoice.numbering
```

Secret sebaiknya tetap menggunakan environment/secret store bila
memungkinkan.

## 14. `audit_logs`

Append-oriented audit trail.

```text
audit_logs
────────────────────────────────────
id                  uuid PK

actor_user_id       uuid NULL FK users

action              varchar
entity_type         varchar
entity_id           uuid NULL

before_data         jsonb NULL
after_data          jsonb NULL
metadata            jsonb NULL

ip_address          inet NULL
user_agent          text NULL

created_at          timestamptz
```

Audit log tidak boleh digunakan sebagai application event queue.

Index:

```text
INDEX(actor_user_id)
INDEX(entity_type, entity_id)
INDEX(action)
INDEX(created_at)
```

## 15. Optional `job_runs`

Disarankan jika scheduler mulai digunakan sejak MVP.

```text
job_runs
────────────────────────────────────
id                  uuid PK
job_name            varchar
status              varchar

started_at          timestamptz
finished_at         timestamptz NULL

processed_count     integer DEFAULT 0
error_message       text NULL
metadata            jsonb NULL
```

Berguna untuk:

- invoice scheduler;
- Coolify sync;
- overdue updater.

## 16. Invoice Numbering

Jangan menghasilkan nomor invoice dengan `COUNT(*) + 1`.

Gunakan sequence/counter transaction-safe.

Format contoh:

```text
INV-2026-000001
```

Implementasi dapat menggunakan PostgreSQL sequence atau tabel counter.

Jika menggunakan tabel counter:

```text
document_sequences
────────────────────────────────────
id                  uuid PK
document_type       varchar
period_key          varchar
last_number         bigint

UNIQUE(document_type, period_key)
```

Contoh:

```text
document_type = invoice
period_key = 2026
last_number = 154
```

Increment dilakukan dalam transaction/locking yang aman.

## 17. Recurring Invoice Idempotency

Scheduler tidak boleh membuat dua invoice untuk service dan periode yang
sama.

Tambahkan metadata billing period pada item/invoice atau tabel khusus
invoice generation.

Disarankan tabel:

```text
service_billing_runs
────────────────────────────────────
id                  uuid PK
service_id          uuid FK services
invoice_id          uuid FK invoices

period_start        date
period_end          date

created_at          timestamptz

UNIQUE(service_id, period_start, period_end)
```

Dengan constraint tersebut, retry scheduler tidak menghasilkan duplicate
invoice untuk periode yang sama.

## 18. Transactions

Gunakan database transaction untuk operasi finansial yang terdiri dari
beberapa write.

### Generate Invoice

```text
BEGIN

allocate invoice number
create invoice
create invoice items
create service_billing_run
update service.next_due_date

COMMIT
```

### Record Payment

```text
BEGIN

create payment
recalculate completed payments
update invoice.amount_paid
update invoice.balance_due
update invoice.status
set paid_at when fully paid

COMMIT
```

## 19. Delete Rules

### Customer

Jangan hard delete jika sudah memiliki invoice.

Gunakan `inactive`.

### Service

Gunakan `cancelled` + `cancelled_at`.

### Invoice

Jangan hard delete issued/paid invoice.

Gunakan `cancelled` bila memang diperbolehkan oleh business process dan
simpan audit trail.

### Payment

Untuk data finansial, prefer cancellation/refund/reversal semantics
daripada hard delete setelah digunakan.

### Coolify Resource

Resource yang hilang dari Coolify jangan langsung dihapus.

Gunakan `last_seen_at` dan status stale/unknown agar history relation
tetap ada.

## 20. Data Retention and Snapshots

Data historis yang harus tetap dapat dibaca walaupun source entity
berubah:

- invoice;
- invoice items;
- payment;
- audit logs;
- service billing runs.

Karena itu invoice memiliki customer/seller snapshot.

## 21. Initial Migration Order

Urutan migration awal yang disarankan:

```text
001_extensions_and_enums
002_auth_tables
003_customers
004_coolify_servers
005_coolify_resources
006_services
007_service_resources
008_document_sequences
009_invoices
010_invoice_items
011_payments
012_service_billing_runs
013_settings
014_audit_logs
015_job_runs
```

Nama migration dapat mengikuti output Drizzle, tetapi dependency order
harus dijaga.

## 22. Seed Data

Development seed boleh membuat:

```text
Admin:
admin@example.test

Customers:
PT Example A
PT Example B

Services:
Production Hosting
API Hosting

Coolify resources:
frontend-demo
backend-demo
worker-demo
```

Jangan menjalankan development seed di production.

## 23. Initial Drizzle Modules

Struktur schema yang disarankan:

```text
server/database/
├── schema/
│   ├── auth.ts
│   ├── customers.ts
│   ├── services.ts
│   ├── coolify.ts
│   ├── invoices.ts
│   ├── payments.ts
│   ├── settings.ts
│   ├── audit.ts
│   └── index.ts
│
├── client.ts
└── types.ts
```

Hindari satu file schema raksasa ketika domain mulai bertambah.

## 24. MVP Query Patterns

Schema harus efisien untuk query utama berikut:

### Dashboard

```text
count active customers
count active services
sum recurring service value
sum unpaid invoice balance
sum overdue invoice balance
count running resources
count unassigned billable resources
```

### Customer Detail

```text
customer
+ active services
+ linked resources
+ recent invoices
+ recent payments
```

### Not Billed

```text
coolify_resources
WHERE classification = billable
AND no active service_resources relation
```

### Billing Scheduler

```text
services
WHERE status = active
AND next_due_date <= billing cutoff
```

### Overdue

```text
invoices
WHERE status = unpaid
AND due_date < current billing date
```

## 25. Index Checklist

Minimum indexes:

- `users.email`
- `customers.customer_number`
- `customers.status`
- `services.customer_id`
- `services.status`
- `services.next_due_date`
- `coolify_resources(coolify_server_id, coolify_uuid)` unique
- `coolify_resources.classification`
- `service_resources.service_id`
- `service_resources.resource_id`
- `invoices.invoice_number`
- `invoices.customer_id`
- `invoices.status`
- `invoices.due_date`
- `invoice_items.invoice_id`
- `payments.invoice_id`
- `payments.payment_number`
- `audit_logs(entity_type, entity_id)`
- `service_billing_runs(service_id, period_start, period_end)` unique

## 26. Backup Requirement

Sebelum production:

- PostgreSQL harus memiliki backup terjadwal;
- backup harus disimpan di lokasi berbeda dari database utama;
- lakukan restore test secara berkala;
- migration production harus didahului backup sesuai tingkat
  risikonya.

Database billing mengandung data finansial sehingga backup bukan
optional feature.

## 27. Open Decisions Before Billing Implementation

Keputusan berikut tidak menghalangi scaffolding, tetapi harus diputuskan
sebelum billing engine final:

- format invoice number final;
- apakah invoice numbering reset per tahun;
- aturan pajak;
- apakah partial payment diperbolehkan;
- apakah overpayment diperbolehkan;
- aturan prorating;
- billing timezone;
- invoice generation lead time;
- grace period;
- aturan cancellation/refund;
- apakah customer dapat memiliki lebih dari satu portal user.

## 28. Scaffold Database Checklist

- [ ] Jalankan PostgreSQL development
- [ ] Buat `DATABASE_URL`
- [ ] Install Drizzle ORM/Kit
- [ ] Buat database client
- [ ] Buat schema modules
- [ ] Integrasikan Better Auth schema
- [ ] Generate initial migrations
- [ ] Review SQL migration
- [ ] Apply migration ke development DB
- [ ] Buat development seed
- [ ] Tambahkan repository layer
- [ ] Tambahkan transaction helpers
- [ ] Tambahkan database integration tests
