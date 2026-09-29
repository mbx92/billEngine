# PRD --- Coolify Billing Platform

**Versi:** 0.1\
**Status:** Draft / MVP\
**Stack:** Nuxt 4 + Tailwind CSS + Nitro + PostgreSQL + Drizzle ORM\
**Deployment:** Docker Application di Coolify

## 1. Product Overview

Coolify Billing Platform adalah aplikasi billing mandiri untuk mengelola
**customer, layanan hosting, resource Coolify, recurring billing,
invoice, dan pembayaran**.

Sistem tidak menggantikan Coolify.

**Pembagian tanggung jawab:**

- **Coolify** = deployment & infrastructure management
- **Billing Platform** = customer & commercial management

Aplikasi yang sudah berjalan di Coolify dapat di-import ke Billing
Platform dan dihubungkan ke customer tanpa harus melakukan deployment
ulang.

```text
Existing Coolify
      │
      │ REST API
      ▼
Billing Platform
      │
      ├── Customer
      ├── Service
      ├── Coolify Resource
      ├── Billing
      ├── Invoice
      └── Payment
```

## 2. Problem Statement

Saat ini aplikasi customer sudah di-deploy secara manual melalui
Coolify.

Namun belum ada sistem terpusat untuk menentukan:

- App ini milik siapa?
- Berapa harga hostingnya?
- Berapa resource yang dialokasikan?
- Kapan harus ditagih?
- Invoice mana yang belum dibayar?
- Aplikasi Coolify mana yang belum masuk billing?

Deployment tidak perlu diubah.

Masalah utama yang ingin diselesaikan adalah **mengubah resource Coolify
yang sudah berjalan menjadi layanan hosting yang mempunyai customer dan
siklus billing yang jelas.**

## 3. Product Goals

### Primary Goal

Menghasilkan sistem billing resmi untuk aplikasi customer yang sudah
berjalan di Coolify.

```text
Existing Coolify App
        ↓
Sync
        ↓
Assign Customer
        ↓
Create Service
        ↓
Set Pricing
        ↓
Recurring Billing
        ↓
Invoice
        ↓
Payment
```

### Secondary Goals

Platform nantinya dapat berkembang untuk:

- Resource management CPU/RAM limits
- Suspend / Unsuspend
- Customer portal
- Payment gateway
- Automatic provisioning
- Multi-Coolify server
- Usage-based billing

Fitur tersebut bukan blocker MVP.

## 4. Non-Goals MVP

Versi pertama tidak perlu:

- Membuat aplikasi Coolify otomatis
- Menyediakan Git deployment kepada customer
- Menjadi pengganti dashboard Coolify
- Membuat Docker container sendiri
- Payment gateway otomatis
- Multi-server load balancing
- Usage-based billing
- Kubernetes
- Reseller system

Deployment aplikasi tetap dilakukan manual oleh administrator melalui
Coolify.

## 5. User Roles

### Super Admin

Pemilik platform dengan akses penuh terhadap Dashboard, Customers,
Services, Invoices, Payments, Coolify Resources, Settings, dan Users.

### Staff/Admin

Opsional pada MVP awal. Dapat mengelola customer, service, invoice, dan
payment sesuai permission.

### Customer

Pada MVP pertama customer portal dapat dibuat minimal. Customer dapat
melihat Services, Invoices, dan Payments.

Customer **tidak mendapatkan akun Coolify**.

## 6. System Architecture

```text
                    INTERNET
                       │
                       ▼
              billing.domain.com
                       │
                       ▼
┌──────────────── COOLIFY ────────────────┐
│                                        │
│ Billing Application                    │
│                                        │
│ ┌────────────────────────────────────┐ │
│ │ Nuxt 4                             │ │
│ │                                    │ │
│ │ Vue UI                             │ │
│ │       │                            │ │
│ │       ▼                            │ │
│ │ Nitro                              │ │
│ │ ├── Auth                           │ │
│ │ ├── Customer                       │ │
│ │ ├── Billing                        │ │
│ │ ├── Invoice                        │ │
│ │ └── Coolify Client                 │ │
│ └─────────┬──────────────────┬───────┘ │
│           │                  │         │
│           ▼                  ▼         │
│      PostgreSQL         Coolify API    │
│                                        │
│ Other Applications                     │
│ ├── Customer App A                     │
│ ├── Customer App B                     │
│ └── Customer App C                     │
└────────────────────────────────────────┘
```

PostgreSQL dapat menggunakan instance PostgreSQL native yang sudah
berjalan di Ubuntu.

## 7. Technology Stack

### Application

- Nuxt 4
- TypeScript
- Vue 3
- Nitro

### UI

- Tailwind CSS
- Custom Vue components
- Tidak menggunakan UI component framework seperti Nuxt UI
- Design system dibangun langsung di atas Tailwind CSS

### UI / Visual Direction — Infrastructure Theme

UI menggunakan pendekatan **infrastructure control panel**, bukan tampilan SaaS generik. Inspirasi visual berasal dari dashboard server, cloud infrastructure, deployment platform, dan observability tools.

Karakter utama:

- Information-dense tetapi tetap mudah dipindai
- Desktop-first untuk admin dashboard, tetap responsive
- Dark mode sebagai pengalaman utama, dengan light mode opsional
- Sidebar navigation permanen pada desktop
- Status resource menggunakan badge/dot yang konsisten
- Tabel menjadi komponen utama untuk resource, service, invoice, dan payment
- Monospace digunakan secara selektif untuk UUID, hostname, IP, deployment ID, log, dan technical metadata
- Card digunakan untuk metrics dan summary, bukan untuk setiap data
- Hindari gradient/dekorasi berlebihan; prioritaskan hierarchy, status, dan operational clarity

Contoh arah dashboard:

```text
┌──────────────────────────────────────────────────────────────┐
│ Billing Infra                                    Admin ▾     │
├──────────────┬───────────────────────────────────────────────┤
│ Dashboard    │ Infrastructure Overview                       │
│ Customers    │                                               │
│ Services     │ MRR        Apps       RAM        CPU          │
│ Invoices     │ Rp8.7M     34         21/32GB    5.2/8        │
│ Payments     │                                               │
│              │ Resources                                     │
│ INFRA        │ ┌───────────────────────────────────────────┐ │
│ Resources    │ │ app          status   customer   cpu ram │ │
│ Servers      │ │ api-prod     running  PT ABC     1   2G  │ │
│ Activity     │ │ web-prod     running  PT ABC    .5   1G  │ │
│              │ │ xyz-prod     running  -          1   1G  │ │
│ Settings     │ └───────────────────────────────────────────┘ │
└──────────────┴───────────────────────────────────────────────┘
```

### UI Component Strategy

Komponen UI dibuat sendiri menggunakan Vue + Tailwind CSS agar visual language dapat dikontrol penuh dan tidak bergantung pada framework UI pihak ketiga.

Komponen dasar yang perlu tersedia:

- Button
- Input / Textarea / Select
- Checkbox / Radio / Switch
- Badge / Status Indicator
- Alert
- Modal / Dialog
- Dropdown / Context Menu
- Tabs
- Tooltip
- Table / Data Table
- Pagination
- Empty State
- Skeleton / Loading State
- Metric Card
- Resource Usage Bar
- Command/Search palette bila diperlukan

Komponen harus menggunakan shared design tokens untuk spacing, typography, border, radius, surface, dan semantic status sehingga tampilan tetap konsisten walaupun tidak memakai UI framework.

### Database

- PostgreSQL
- Drizzle ORM
- Drizzle Kit

### Authentication

- Better Auth
- Email + Password
- Session
- Role
- Password Reset

### Validation

- Zod

### Infrastructure Integration

- Coolify REST API
- API token hanya boleh digunakan server-side.

## 8. Core Domain Model

```text
Customer
    │
    ├── Service
    │      │
    │      └── Coolify Resource
    │
    └── Invoice
            │
            ├── Invoice Item
            └── Payment
```

Satu customer dapat mempunyai banyak service.

Satu service dapat memiliki **satu atau beberapa Coolify resources**.

Contoh:

```text
PT ABC
│
└── Production Hosting
    Rp500.000/month
       │
       ├── abc-frontend
       ├── abc-backend
       └── abc-worker
```

Billing dilakukan berdasarkan **layanan bisnis**, bukan berdasarkan
jumlah container.

## 9. Customer Management

Data customer:

- ID
- Customer Number
- Name
- Company Name
- Email
- Phone
- Address
- City
- Province
- Postal Code
- Country
- Tax ID / NPWP
- Status
- Created At
- Updated At

Status: `active`, `inactive`.

Customer number otomatis, contoh `CUS-000001`.

## 10. Coolify Integration

Settings koneksi:

```text
Coolify URL
https://coolify.example.com

API Token
••••••••••••••••

[Test Connection]
```

API token harus disimpan terenkripsi dan tidak pernah dikirim ke
browser.

## 11. Resource Synchronization

Admin dapat menjalankan **Coolify → Sync Resources**.

Data relevan yang disinkronkan:

- UUID
- Name
- Status
- Domain
- CPU limit
- Memory limit
- Project
- Environment
- Server
- Created at
- Updated at

Billing menyimpan snapshot/cache metadata resource, tetapi Coolify tetap
menjadi **source of truth untuk status infrastructure**.

## 12. Coolify Resource Dashboard

```text
Coolify Resources
──────────────────────────────────────────────────
Resource          Status      Customer       Billing

abc-frontend      ● Running   PT ABC         ✓
abc-backend       ● Running   PT ABC         ✓
xyz-web           ● Running   -              ⚠ NOT BILLED
internal-api      ● Running   Internal       -
```

Filter: All, Running, Stopped, Assigned, Unassigned, Not Billed.

`NOT BILLED` membantu administrator menemukan resource yang mengonsumsi
server tetapi belum mempunyai layanan billing.

## 13. Service Management

Service merupakan **produk/layanan yang ditagihkan kepada customer**.

Field utama:

- Customer
- Service name
- Price
- Billing cycle
- Billing start date
- Next due date
- Status

Billing cycle MVP:

- monthly
- quarterly
- semi-annually
- annually
- one-time

## 14. Service ↔ Coolify Resources

Satu service boleh mempunyai banyak resource.

```text
Website Production Hosting
PT ABC
Rp500.000/month

Linked Resources

✓ abc-frontend
  CPU: 1
  RAM: 1 GB

✓ abc-backend
  CPU: 2
  RAM: 2 GB

✓ abc-worker
  CPU: 0.5
  RAM: 512 MB
```

## 15. Resource Allocation

Billing membaca konfigurasi CPU/RAM dari Coolify.

Untuk MVP, konfigurasi resource bersifat **read-only**. Admin tetap
mengubah resource limit melalui Coolify.

Versi berikutnya dapat menyediakan pengubahan resource limit langsung
dari Billing Platform.

## 16. Billing Engine

Billing Engine menentukan kapan invoice harus dibuat berdasarkan:

- price
- billing_cycle
- billing_start_date
- next_due_date

Scheduler mendeteksi service yang jatuh pada jadwal billing dan membuat
invoice.

## 17. Invoice

Nomor invoice unik, contoh:

`INV-2026-000001`

Invoice menyimpan snapshot customer dan harga ketika invoice dibuat.
Jika alamat customer atau harga service berubah di kemudian hari,
invoice lama tidak ikut berubah.

## 18. Invoice Structure

Invoice mencakup:

- Company identity
- Customer snapshot
- Invoice number
- Invoice date
- Due date
- Service period
- Invoice items
- Subtotal
- Tax
- Total
- Payment status

Tax harus configurable dan tidak di-hardcode.

## 19. Invoice Status

Status:

- draft
- unpaid
- paid
- overdue
- cancelled

Invoice yang sudah paid tidak boleh diedit sembarangan. Perubahan
administratif harus masuk audit log.

## 20. PDF Invoice

Invoice dapat di-download sebagai PDF dan memuat:

- Company Logo
- Company Name
- Company Address
- Tax Information
- Invoice Number
- Invoice Date
- Due Date
- Customer Information
- Invoice Items
- Subtotal
- Tax
- Total
- Payment Status

PDF dibuat berdasarkan snapshot invoice.

## 21. Payment Management

MVP menggunakan **manual payment recording**.

Data payment:

- Amount
- Payment Date
- Payment Method
- Reference Number
- Notes

Jika total payment \>= invoice total, status invoice menjadi `paid`.

## 22. Payment Gateway

Bukan requirement MVP.

Architecture harus memungkinkan provider seperti Midtrans, Xendit,
Tripay, DOKU, dan Manual Transfer ditambahkan kemudian.

Logic invoice tidak boleh bergantung pada payment provider tertentu.

## 23. Dashboard

Admin dashboard menampilkan:

- Monthly Recurring Revenue
- Customers
- Active Services
- Coolify Resources
- Unpaid invoices
- Overdue invoices
- Running Apps
- Stopped Apps
- Not Billed resources

## 24. Customer Detail

Customer detail memiliki tab:

- Services
- Invoices
- Payments

Service customer menampilkan linked Coolify resources dan recurring
price.

## 25. Customer Portal

Customer dapat login ke `billing.domain.com`.

Customer dapat melihat:

- My Services
- Invoices
- Payments
- Account

Customer tidak mendapatkan akses ke Coolify API, Coolify Dashboard,
server configuration, Docker, atau data customer lain.

## 26. Customer Service View

Customer dapat melihat informasi aman seperti:

- Service status
- Domain
- Total CPU allocation
- Total memory allocation
- Billing amount
- Billing cycle
- Next billing date

UUID/internal infrastructure identifier tidak perlu ditampilkan.

## 27. Internal Services

Tidak semua Coolify resource ditagihkan.

Resource dapat diklasifikasikan:

- Billable
- Internal
- Ignored

Dengan demikian resource infrastructure milik sendiri tidak terus muncul
sebagai warning `NOT BILLED`.

## 28. Audit Log

Aktivitas penting harus dicatat, antara lain:

- customer.created
- service.created
- service.updated
- resource.assigned
- resource.unassigned
- invoice.created
- invoice.updated
- invoice.cancelled
- payment.created
- payment.deleted
- settings.updated

Audit log menyimpan actor, timestamp, action, entity, dan perubahan
relevan.

## 29. Security Requirements

Coolify API token hanya tersedia server-side.

Tidak boleh menggunakan variable public seperti
`NUXT_PUBLIC_COOLIFY_TOKEN`.

Secret server-side:

```text
COOLIFY_API_URL
COOLIFY_API_TOKEN
```

Alur:

```text
Browser
   │
   ▼
Nitro API
   │
   │ Bearer token
   ▼
Coolify
```

Requirement tambahan:

- Password hashing
- Secure HTTP-only session cookies
- CSRF protection
- Rate limiting untuk auth
- Role-based authorization
- Input validation
- Audit logging

## 30. Database Schema --- Initial

Core tables:

```text
users
sessions

customers

services

coolify_servers
coolify_resources
service_resources

invoices
invoice_items

payments

settings

audit_logs
```

Walaupun awalnya hanya satu Coolify server, tetap gunakan tabel
`coolify_servers` agar arsitektur siap multi-server.

## 31. Multi-Coolify Ready

MVP:

```text
Billing
   │
   └── Coolify Server #1
```

Future:

```text
Billing
   │
   ├── Coolify Indonesia
   ├── Coolify Singapore
   └── Coolify US
```

Resource menyimpan `coolify_server_id` dan `coolify_uuid`.

## 32. Background Scheduler

Scheduler menangani:

- Sync Coolify status
- Generate recurring invoices
- Mark overdue invoices
- Update next billing date

MVP tidak memerlukan Redis.

Contoh jadwal:

```text
Every 5 minutes
→ Sync Coolify status

Every day 00:05
→ Billing scheduler
```

Jika volume meningkat, jobs dapat dipindahkan ke Redis queue.

## 33. Coolify Failure Handling

Billing tidak boleh gagal total hanya karena Coolify offline.

Saat Coolify tidak dapat dihubungi, sistem tetap harus dapat:

- View Customers
- View Services
- View Invoices
- Record Payment
- Generate PDF

Resource ditampilkan sebagai `Unknown` beserta waktu sinkronisasi
terakhir.

## 34. Deployment

Billing berjalan di Coolify sebagai application:

```text
Git Repository
       │
       ▼
Coolify
       │
       ▼
Docker Build
       │
       ▼
Nuxt Nitro
:3000
       │
       ▼
billing.domain.com
```

Container bersifat stateless. Persistent business data berada di
PostgreSQL.

## 35. Environment Variables

Contoh:

```text
DATABASE_URL=

BETTER_AUTH_SECRET=
BETTER_AUTH_URL=

APP_URL=

COOLIFY_API_URL=
COOLIFY_API_TOKEN=

COMPANY_NAME=
COMPANY_EMAIL=
```

Secret tidak boleh disimpan dalam Git repository.

## 36. MVP Acceptance Criteria

MVP dianggap berhasil apabila administrator dapat:

1.  Login ke billing system.
2.  Membuat customer.
3.  Menghubungkan billing system ke Coolify.
4.  Sync existing Coolify applications.
5.  Melihat resource yang belum ditagihkan.
6.  Assign satu atau beberapa Coolify resource ke customer/service.
7.  Menentukan harga dan billing cycle.
8.  Membuat invoice manual.
9.  Membuat recurring invoice otomatis.
10. Download invoice PDF.
11. Mencatat pembayaran.
12. Melihat invoice Paid/Unpaid/Overdue.
13. Melihat CPU/RAM resource dari Coolify.
14. Menandai resource sebagai internal/ignored.
15. Melihat audit log perubahan penting.

**Tidak ada requirement bahwa aplikasi customer harus di-deploy ulang.**

Existing deployment tetap menjadi resource Coolify yang sama.

## 37. Development Phases

### Milestone 1 --- Foundation

- Nuxt 4
- Tailwind CSS + custom infrastructure-themed UI
- Shared design tokens dan reusable Vue components
- PostgreSQL/Drizzle
- Authentication
- Roles
- Application settings
- Admin layout

### Milestone 2 --- Coolify + Customer

- Customer CRUD
- Coolify connection
- Sync resources
- Resource inventory
- Internal/billable classification
- Assign resource → service → customer

### Milestone 3 --- Billing

- Service pricing
- Billing cycles
- Invoice engine
- Invoice numbering
- PDF invoice
- Manual payments
- Recurring invoice scheduler
- Overdue handling

### Milestone 4 --- Customer Portal

- Customer login
- Services
- Invoices
- Payment history
- Account/profile

### V2

- Payment gateway
- Suspend/unsuspend melalui Coolify API
- Pengaturan CPU/RAM dari billing panel
- Email invoice/reminder
- Automatic provisioning
- Custom domain management
- Usage/metrics
- Multi-server placement

## 38. Product Principles

Prinsip utama:

```text
Coolify = Infrastructure Source of Truth

Billing = Commercial Source of Truth
```

Coolify menentukan:

- application
- deployment
- container
- status
- CPU
- RAM
- domain

Billing Platform menentukan:

- customer
- ownership
- service
- price
- billing cycle
- invoice
- payment

Keduanya dihubungkan menggunakan:

```text
coolify_server_id
+
coolify_resource_uuid
```

Dengan boundary ini, Billing Platform tidak menjadi "Coolify kedua",
tetapi menjadi **lapisan bisnis di atas Coolify**.
