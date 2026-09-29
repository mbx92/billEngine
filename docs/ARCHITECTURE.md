# ARCHITECTURE --- Coolify Billing Platform

**Version:** 0.1\
**Status:** Initial Architecture / MVP\
**Related:** `PRD.md`, `DATABASE-SCHEMA.md`

## 1. Architecture Goals

Coolify Billing Platform adalah lapisan bisnis di atas Coolify.

Prinsip utama:

```text
Coolify = Infrastructure Source of Truth
Billing = Commercial Source of Truth
```

Coolify bertanggung jawab terhadap deployment, container, domain, status
aplikasi, CPU, RAM, dan konfigurasi infrastructure.

Billing Platform bertanggung jawab terhadap customer, ownership,
service, pricing, billing cycle, invoice, payment, dan audit trail.

MVP harus:

- sederhana untuk dioperasikan;
- berjalan sebagai satu aplikasi Nuxt;
- menggunakan PostgreSQL sebagai persistent storage;
- tidak membutuhkan Redis;
- tidak membutuhkan microservices;
- tetap berfungsi untuk billing ketika Coolify API sedang tidak
  tersedia;
- siap dikembangkan menjadi multi-Coolify tanpa mengimplementasikan
  kompleksitas tersebut sekarang.

## 2. Technology Stack

### Application

- Nuxt 4
- Vue 3
- TypeScript
- Nitro

### UI

- Tailwind CSS
- Custom Vue components
- Tidak menggunakan UI framework seperti Nuxt UI, Vuetify, PrimeVue,
  atau shadcn sebagai dependency utama.

### Data

- PostgreSQL
- Drizzle ORM
- Drizzle Kit migrations
- Zod validation

### Authentication

- Better Auth
- Email/password
- Session-based authentication
- Role-based authorization

### Integration

- Coolify REST API
- Server-side API client
- Cloudflare Tunnel untuk public ingress yang sudah digunakan pada
  infrastructure

### Testing

- Vitest untuk unit/integration tests
- Playwright untuk critical end-to-end flows

## 3. High-Level Architecture

```text
                         INTERNET
                            │
                            ▼
                       Cloudflare
                            │
                     Cloudflare Tunnel
                            │
                            ▼
                     Coolify Proxy
                            │
                            ▼
                ┌──────────────────────┐
                │ Billing Application  │
                │ Nuxt 4 / Nitro       │
                │                      │
Browser ───────►│ Pages + Server API   │
                │                      │
                └──────┬────────┬──────┘
                       │        │
                       │        └──────────────► Coolify REST API
                       │
                       ▼
                  PostgreSQL
```

Nuxt/Nitro menjadi satu-satunya backend yang boleh berkomunikasi dengan
Coolify API dan database.

Browser tidak pernah menerima Coolify API token atau database
credential.

## 4. Deployment Topology

### Production

```text
Ubuntu Server
│
├── Coolify
│
├── PostgreSQL native
│
├── cloudflared
│
└── Docker workloads
    ├── Billing Platform
    ├── Customer App A
    ├── Customer App B
    └── Customer App N
```

Billing Platform berjalan sebagai Coolify Application dari Git
repository.

Container Nuxt bersifat stateless. Persistent business data berada di
PostgreSQL.

### Development

```text
Developer Machine
│
├── Nuxt dev server
├── PostgreSQL Docker
└── Git
     │
     └──────── HTTPS ────────► Existing Coolify API
```

Development tidak boleh menggunakan database production.

### Staging

Disarankan menyediakan deployment terpisah:

```text
billing-staging.example.com
```

Staging menggunakan database terpisah dari production.

## 5. Application Layers

```text
app/
    UI + pages

server/api/
    HTTP boundary

server/services/
    Business logic

server/repositories/
    Database access

server/integrations/
    External systems

shared/
    Shared schemas/types/constants
```

### UI Layer

Bertanggung jawab terhadap:

- rendering;
- forms;
- navigation;
- infrastructure-themed dashboard;
- client-side interaction.

UI tidak boleh mengandung billing calculation sebagai source of truth.

### API Layer

`server/api` bertanggung jawab terhadap:

- authentication check;
- authorization check;
- input parsing;
- Zod validation;
- memanggil service;
- membentuk HTTP response.

API handler harus tipis.

### Service Layer

`server/services` menyimpan business rules seperti:

- customer lifecycle;
- service lifecycle;
- invoice calculation;
- billing cycle calculation;
- payment allocation;
- Coolify synchronization;
- resource assignment.

### Repository Layer

`server/repositories` menjadi boundary akses database.

Business logic tidak sebaiknya tersebar dengan query SQL langsung di
page/API handler.

### Integration Layer

Integrasi eksternal seperti Coolify ditempatkan pada:

```text
server/integrations/coolify/
```

Future provider seperti payment gateway atau email dapat mengikuti pola
yang sama.

## 6. Recommended Project Structure

```text
coolify-billing/
├── app/
│   ├── assets/
│   │   └── css/
│   ├── components/
│   │   ├── ui/
│   │   ├── billing/
│   │   └── infrastructure/
│   ├── layouts/
│   ├── middleware/
│   └── pages/
│
├── server/
│   ├── api/
│   │   ├── auth/
│   │   ├── customers/
│   │   ├── services/
│   │   ├── invoices/
│   │   ├── payments/
│   │   └── coolify/
│   ├── services/
│   │   ├── customers/
│   │   ├── billing/
│   │   ├── invoices/
│   │   ├── payments/
│   │   └── coolify/
│   ├── repositories/
│   ├── integrations/
│   │   └── coolify/
│   └── utils/
│
├── shared/
│   ├── constants/
│   ├── schemas/
│   └── types/
│
├── drizzle/
│   └── migrations/
│
├── docs/
│   ├── PRD.md
│   ├── ARCHITECTURE.md
│   └── DATABASE-SCHEMA.md
│
├── tests/
├── public/
├── .env.example
├── drizzle.config.ts
├── nuxt.config.ts
├── Dockerfile
└── package.json
```

## 7. UI Architecture

UI menggunakan Tailwind CSS tanpa component framework.

Tema visual diarahkan ke infrastructure/control-plane:

- dense tetapi tetap readable;
- border dan surface yang jelas;
- status indicator;
- resource meters;
- tables sebagai komponen utama;
- monospaced typography untuk identifier teknis bila sesuai;
- dark mode dapat menjadi first-class theme;
- konsistensi lebih penting daripada dekorasi.

Komponen dasar dibuat sendiri:

```text
UiButton
UiInput
UiSelect
UiTextarea
UiCheckbox
UiCard
UiBadge
UiAlert
UiModal
UiDropdown
UiTabs
UiTable
UiPagination
UiSkeleton
UiEmptyState
UiProgress
UiStat
```

Komponen domain dibuat di atas primitive tersebut, misalnya:

```text
ResourceStatusBadge
ResourceUsageBar
InvoiceStatusBadge
ServiceCard
ServerCapacityCard
MoneyDisplay
```

## 8. Authentication and Authorization

Role awal:

```text
super_admin
admin
customer
```

MVP dapat memulai dengan `super_admin` dan `customer`, tetapi schema
tidak boleh bergantung pada hanya dua role.

Authorization dilakukan server-side.

Contoh:

```text
Browser
  ↓
GET /api/admin/customers
  ↓
Session validation
  ↓
Role authorization
  ↓
CustomerService
  ↓
CustomerRepository
```

Menyembunyikan menu pada UI bukan authorization.

## 9. Coolify Integration

Coolify client hanya berjalan server-side.

```text
Browser
   │
   ▼
/api/coolify/resources
   │
   ▼
CoolifyService
   │
   ▼
CoolifyClient
   │
   │ Authorization: Bearer <token>
   ▼
Coolify REST API
```

Credential:

```text
COOLIFY_API_URL
COOLIFY_API_TOKEN
```

Tidak boleh menggunakan public runtime variable untuk token.

### Sync Strategy

MVP menggunakan pull/sync.

```text
Coolify API
    ↓
fetch resources
    ↓
normalize
    ↓
upsert coolify_resources
    ↓
update last_synced_at
```

Coolify tetap menjadi source of truth untuk infrastructure state.

Database billing menyimpan cached/snapshot metadata agar UI tetap
berguna ketika Coolify sementara offline.

### Failure Handling

Jika Coolify gagal dihubungi:

- jangan menghapus resource lokal;
- simpan error sync;
- pertahankan last known state;
- tampilkan `unknown`/stale state;
- billing, invoice, dan payment tetap berjalan.

## 10. Billing Architecture

Service adalah unit komersial.

```text
Customer
   │
   └── Service
         │
         ├── Price
         ├── Billing Cycle
         ├── Next Due Date
         │
         └── Coolify Resources [1..N]
```

Invoice dibuat dari service, bukan langsung dari Docker container.

Billing engine harus deterministik dan testable.

```text
Eligible Active Services
          ↓
Billing Engine
          ↓
Invoice Draft/Snapshot
          ↓
Invoice Items
          ↓
Advance next_due_date
```

Job harus idempotent agar scheduler yang ter-trigger dua kali tidak
membuat invoice duplikat.

## 11. Invoice Immutability

Invoice menyimpan snapshot data pada saat diterbitkan.

Perubahan berikut tidak boleh mengubah invoice historis:

- customer mengganti alamat;
- company profile berubah;
- harga service berubah;
- tax rate berubah;
- nama service berubah.

Setelah invoice diterbitkan, koreksi dilakukan melalui mekanisme
administratif/audit, bukan dengan menghitung ulang invoice lama secara
diam-diam.

## 12. Payment Architecture

MVP menggunakan manual payment recording.

```text
Invoice
   │
   └── Payments [0..N]
```

Status invoice dihitung dari total payment valid dibanding total
invoice.

Architecture tidak boleh mengikat invoice pada payment provider
tertentu.

Future:

```text
PaymentProvider
├── Manual
├── Midtrans
├── Xendit
└── Other
```

## 13. Background Jobs

MVP tidak membutuhkan Redis.

Job awal:

- Coolify resource synchronization;
- recurring invoice generation;
- overdue invoice update.

Job dapat dipanggil oleh scheduler/cron melalui protected internal
execution path.

Setiap job harus:

- idempotent;
- memiliki logging;
- menyimpan timestamp hasil eksekusi bila relevan;
- aman jika dijalankan ulang.

Redis/queue baru ditambahkan ketika workload background memang
membutuhkannya.

## 14. Security Boundaries

### Secrets

Tidak masuk Git:

```text
DATABASE_URL
BETTER_AUTH_SECRET
COOLIFY_API_TOKEN
```

Production secret disimpan melalui environment/secret management
Coolify.

### Database

- aplikasi memakai dedicated PostgreSQL user;
- jangan gunakan postgres superuser;
- port PostgreSQL tidak diekspos ke internet;
- batasi network access sesuai kebutuhan.

### HTTP

- HTTPS melalui Cloudflare/Tunnel;
- secure HTTP-only cookies;
- CSRF protection sesuai auth architecture;
- rate limit endpoint auth dan endpoint sensitif;
- validate semua input;
- authorization selalu server-side.

### Audit

Perubahan penting dicatat:

- actor;
- action;
- entity;
- timestamp;
- before/after atau metadata perubahan yang relevan.

## 15. Cloudflare Tunnel

Arsitektur existing Cloudflare Tunnel dipertahankan.

Contoh routing:

```text
billing.example.com
        │
        ▼
Cloudflare
        │
        ▼
Cloudflare Tunnel
        │
        ▼
Coolify Proxy
        │
        ▼
Billing container :3000
```

Port `3000` adalah port internal container dan tidak perlu dipublish
langsung ke internet.

Dashboard Coolify dapat dipisahkan dari endpoint publik dan diberikan
proteksi tambahan melalui Cloudflare Access/Zero Trust jika diinginkan.

## 16. Observability

MVP minimal memiliki structured application logging untuk:

- authentication failure;
- Coolify sync;
- invoice generation;
- payment recording;
- scheduler execution;
- unexpected server errors.

Jangan log:

- password;
- session token;
- Coolify API token;
- database credential.

Future observability dapat menambahkan metrics dan centralized logging.

## 17. Error Handling

API menggunakan error shape yang konsisten.

Contoh konseptual:

```json
{
  "error": {
    "code": "RESOURCE_NOT_FOUND",
    "message": "Resource tidak ditemukan."
  }
}
```

Internal exception tidak boleh diekspos mentah ke customer.

Domain error dipisahkan dari infrastructure error.

## 18. Money and Time Rules

Money tidak boleh menggunakan floating-point JavaScript sebagai
representasi utama.

Gunakan integer minor unit atau PostgreSQL numeric dengan aturan
konsisten. Untuk IDR, keputusan implementasi awal disarankan menggunakan
integer rupiah karena tidak memerlukan decimal minor unit dalam
penggunaan umum platform.

Semua timestamp disimpan secara timezone-aware di PostgreSQL.

Billing timezone harus configurable, dengan default sesuai operasi
bisnis.

## 19. Migration Strategy

Semua schema changes dilakukan melalui Drizzle migrations.

Workflow:

```text
Change schema
    ↓
Generate migration
    ↓
Review migration
    ↓
Test locally
    ↓
Backup production
    ↓
Run migration
    ↓
Deploy application
```

Jangan melakukan destructive migration otomatis tanpa review.

## 20. Testing Strategy

### Unit Tests

Prioritas:

- billing cycle calculation;
- next due date;
- invoice totals;
- tax calculation;
- payment allocation;
- invoice status;
- Coolify normalization.

### Integration Tests

Prioritas:

- repositories;
- invoice creation transaction;
- resource assignment;
- synchronization/upsert.

### E2E

Critical flows:

```text
Admin login
→ Create customer
→ Create service
→ Assign resource
→ Generate invoice
→ Record payment
→ Invoice becomes paid
```

## 21. Scalability Path

### V1

```text
Nuxt
PostgreSQL
Coolify API
```

### Growth

```text
Nuxt
  │
  ├── PostgreSQL
  ├── Redis
  └── Workers
```

### Multi-server

```text
Billing Control Plane
        │
        ├── Coolify Server A
        ├── Coolify Server B
        └── Coolify Server C
```

Database schema sejak awal memiliki `coolify_servers`, tetapi V1 tidak
perlu automatic placement.

## 22. Architectural Decisions for MVP

Keputusan awal:

1.  Satu Nuxt application, bukan microservices.
2.  Tailwind CSS + custom components, tanpa UI framework.
3.  PostgreSQL sebagai satu-satunya primary datastore.
4.  Drizzle ORM + migration.
5.  Better Auth.
6.  Coolify integration server-side.
7.  Existing apps tidak perlu redeploy.
8.  Service adalah unit billing, resource adalah unit infrastructure.
9.  Satu service dapat memiliki banyak Coolify resources.
10. Coolify outage tidak boleh menghentikan invoice/payment.
11. Tidak menggunakan Redis pada MVP.
12. Container aplikasi stateless.
13. Cloudflare Tunnel existing tetap digunakan.
14. Multi-Coolify dipersiapkan pada data model, tetapi belum
    diotomatisasi.

## 23. Scaffold Checklist

Sebelum feature development:

- [ ] Initialize Nuxt 4 + TypeScript
- [ ] Install/configure Tailwind CSS
- [ ] Enable TypeScript strict checks
- [ ] Configure ESLint/Prettier
- [ ] Create `.env.example`
- [ ] Setup PostgreSQL development database
- [ ] Setup Drizzle
- [ ] Create initial migrations
- [ ] Setup Better Auth
- [ ] Create base admin layout
- [ ] Create Tailwind design tokens
- [ ] Create core UI primitives
- [ ] Create Coolify API client abstraction
- [ ] Setup Vitest
- [ ] Setup Playwright
- [ ] Add Dockerfile
- [ ] Create staging deployment
