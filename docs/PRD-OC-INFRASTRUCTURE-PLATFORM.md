# PRD — OC Infrastructure Platform

- Versi: 0.1
- Status: Draft untuk review
- Target: Local development dan staging
- Repository: `mbx92/billEngine`
- Branch pengembangan: `feature/oc-infrastructure-platform`

## 1. Ringkasan

OC Infrastructure Platform adalah evolusi BillEngine dari platform billing yang
terintegrasi erat dengan Coolify menjadi control plane modular untuk mengelola
aplikasi Docker, server database, domain, storage, monitoring, dan billing.

Perubahan dilakukan secara bertahap. Coolify tetap menjadi provider legacy yang
didukung selama migrasi, sedangkan provider Docker native dikelola melalui Go
Agent pada host Debian. Billing, invoice, payment, customer portal, dan overdue
gate yang sudah berjalan harus tetap kompatibel.

Pengembangan awal dilakukan secara lokal dan di staging. Tidak ada migrasi,
deployment, atau perubahan konfigurasi production tanpa persetujuan terpisah.

## 2. Latar Belakang

BillEngine saat ini menggunakan Nuxt 4, TypeScript, PostgreSQL, dan Drizzle ORM.
Platform telah memiliki:

- customer, plan, service, invoice, payment, refund, dan credit note;
- billing automation dan recurring invoice;
- Coolify API integration;
- deployment blueprint dan provisioning job;
- Cloudflare Tunnel dan domain management;
- Traefik ForwardAuth sebagai billing gate untuk service overdue; dan
- shared PostgreSQL provisioning.

Integrasi infrastructure saat ini masih memakai konsep dan tabel yang spesifik
ke Coolify. Akibatnya, penambahan runtime Docker native akan berisiko menyebarkan
percabangan provider ke seluruh business logic apabila tidak didahului kontrak
provider dan model data yang netral.

## 3. Problem Statement

Platform membutuhkan cara untuk mengoperasikan infrastructure dari satu control
plane tanpa menjadikan lifecycle customer dan billing bergantung pada satu
vendor. Sistem baru harus dapat:

1. menjalankan Coolify dan Docker native secara berdampingan;
2. menjaga satu sumber kepemilikan untuk setiap resource agar tidak terjadi
   dual control;
3. mempertahankan seluruh invariant finansial dan billing yang sudah ada;
4. mengelola host remote dengan aman tanpa memberikan akses Docker socket atau
   shell kepada dashboard/customer; dan
5. dimigrasikan dari data existing secara additive dan dapat dihentikan tanpa
   mengganggu workload production.

## 4. Tujuan Produk

### 4.1 Tujuan utama

- Menyediakan abstraction `InfrastructureProvider` untuk Coolify dan Docker
  native.
- Menyediakan Go Agent untuk inventory dan operasi terstruktur pada server
  Debian dengan Docker Engine, Compose, dan BuildKit.
- Menyatukan lifecycle aplikasi, domain, database, storage, monitoring, dan
  billing melalui model resource yang provider-neutral.
- Mempertahankan Coolify sebagai jalur legacy sampai parity dan migrasi telah
  terbukti aman.
- Menyediakan workflow local development yang dapat direproduksi sebelum
  integrasi staging.
- Memastikan semua operasi mutasi bersifat idempotent, dapat diaudit, dan dapat
  dipulihkan dari kegagalan parsial.

### 4.2 Sasaran keberhasilan awal

- Satu koneksi Coolify dan satu Docker Agent dapat aktif bersamaan di staging.
- Aplikasi dari kedua provider dapat ditampilkan melalui API dan UI yang sama.
- Satu aplikasi Docker native dapat diprovision, diberi domain, dipantau, dan
  dikendalikan lifecycle-nya secara idempotent di staging.
- Relasi service dan billing tetap bekerja tanpa mengetahui provider runtime.
- Overdue gate tetap berlaku untuk resource Coolify maupun Docker native.
- Tidak ada perubahan pada production sebelum release gate tersendiri disetujui.

## 5. Non-Goals

Rilis awal tidak mencakup:

- penggantian Coolify di production;
- Kubernetes atau orchestrator multi-cluster;
- high availability untuk control plane atau agent;
- akses shell umum atau akses Docker socket untuk customer;
- migrasi otomatis seluruh workload production;
- hard multi-tenant isolation setara virtual machine pada satu Docker host;
- redesign payment gateway atau accounting core; dan
- marketplace aplikasi atau public plugin system.

## 6. Pengguna dan Peran

### 6.1 Administrator platform

Mendaftarkan provider/node, memilih target deployment, menjalankan operasi,
melihat health dan audit log, serta menangani kegagalan provisioning.

### 6.2 Staf billing/operasional

Mengelola customer, service, invoice, payment, dan status billing tanpa perlu
memahami detail provider infrastructure.

### 6.3 Customer

Melihat service, status, invoice, domain, dan tindakan lifecycle yang diizinkan
melalui portal dengan isolasi data per customer.

### 6.4 Machine identity

Go Agent memiliki identitas dan credential sendiri. Identitas agent bukan akun
administrator dan hanya memiliki akses pada endpoint serta operasi yang
diperlukan.

## 7. Prinsip Desain

1. **Billing tetap menjadi domain terpisah.** Status service bisnis tidak boleh
   diturunkan langsung dari status container.
2. **Satu resource, satu owner.** Sebuah resource hanya boleh dikendalikan oleh
   satu provider pada satu waktu.
3. **Capability-driven.** Fitur ditentukan dari capability provider, bukan
   rangkaian `if provider === ...` pada business logic.
4. **Asynchronous by default.** Operasi infrastructure direpresentasikan sebagai
   job/operation dengan status yang dapat dipoll atau direkonsiliasi.
5. **Idempotent mutation.** Retry tidak boleh membuat resource duplikat.
6. **Control plane tetap hidup saat provider offline.** Billing, invoice, dan
   akses metadata tidak boleh gagal hanya karena agent/provider tidak tersedia.
7. **Least privilege.** Dashboard tidak mengakses Docker socket; agent tidak
   mengeksekusi arbitrary shell command.
8. **Additive migration.** Tidak ada drop/rename tabel legacy pada fase awal.
9. **Local-first, staging-gated.** Integrasi host divalidasi lokal, lalu staging,
   sebelum ada pembahasan production.

## 8. Baseline dan Temuan Audit Awal

Audit awal menunjukkan coupling Coolify tersebar pada server API/service,
komponen UI, shared contract, test, tabel database, provisioning, domain, dan
reconciliation. Model existing yang paling terdampak adalah:

- `coolify_servers`;
- `coolify_nodes`;
- `coolify_resources`;
- `service_resources` yang memiliki foreign key langsung ke Coolify resource;
- deployment blueprint dan provisioning job;
- resource domain dan lifecycle; serta
- database cluster/shared PostgreSQL provisioning.

Belum terdapat kontrak `InfrastructureProvider`, implementasi Docker/BuildKit,
Go module, atau agent. Karena itu, fase pertama harus membangun seam arsitektur
dan Coolify adapter dengan perilaku identik sebelum Docker native menerima
operasi tulis.

Baseline test existing harus dicatat dan distabilkan sebelum feature work.
Kegagalan test atau lint yang sudah ada tidak boleh disamarkan sebagai regresi
provider baru, dan setiap perubahan baseline harus terdokumentasi.

## 9. Kapabilitas yang Harus Dipertahankan

Komponen berikut dianggap sebagai core dan tidak boleh diregresikan:

- snapshot customer, plan, harga, pajak, dan service pada dokumen finansial;
- recurring invoice dengan unique guard per billing period;
- alokasi payment, refund, dan credit note yang transaksional;
- nomor dokumen yang dialokasikan secara atomik;
- audit event yang tersimpan dalam transaksi yang relevan;
- isolasi customer pada portal dan API;
- authentication, authorization, settings, email, dan report;
- service lifecycle bisnis;
- domain routing dan Cloudflare Tunnel yang sudah ada;
- Traefik ForwardAuth overdue gate; dan
- shared PostgreSQL provisioning selama masih digunakan.

## 10. Ruang Lingkup Fungsional

### 10.1 Provider dan node management

- Administrator dapat membuat, menguji, menonaktifkan, dan melihat health
  koneksi provider.
- Provider mengekspos capability yang didukung, misalnya application lifecycle,
  build, domain routing, metrics, database, storage, atau backup.
- Node memiliki provider owner, environment, label, capacity, dan status
  heartbeat terakhir.
- Provider yang tidak sehat tidak menghambat operasi billing dan metadata.
- Resource tidak dapat dipindahkan provider hanya dengan mengubah foreign key;
  perpindahan harus melalui workflow migrasi eksplisit.

### 10.2 Inventory dan reconciliation

- Platform menyimpan inventory ternormalisasi untuk resource yang diketahui.
- External identifier provider tetap disimpan untuk reconciliation.
- Drift antara desired state dan observed state ditampilkan tanpa langsung
  menimpa konfigurasi.
- Data observasi memiliki timestamp sehingga status stale dapat dibedakan dari
  status healthy.
- Reconciliation bersifat idempotent dan memiliki bounded retry.

### 10.3 Application lifecycle

- Membuat aplikasi dari image atau build context yang diizinkan.
- Mengelola environment variable dan secret reference.
- Menetapkan CPU/memory limit dan restart policy.
- Deploy, start, stop, restart, redeploy, dan delete sesuai authorization.
- Menyimpan desired version dan observed version.
- Menampilkan log operasi tanpa membocorkan secret.
- Delete workload merupakan operasi terpisah dari penghapusan metadata dan
  membutuhkan guard yang jelas.

### 10.4 Database server dan database service

- Inventory database server/cluster dan status koneksinya.
- Provisioning database mengikuti capability provider dan policy platform.
- Credential database disimpan terenkripsi dan tidak dikirim ulang ke log.
- Shared PostgreSQL existing tetap didukung selama transisi.
- Backup/restore database masuk fase lanjutan setelah lifecycle aplikasi stabil.

### 10.5 Domain, Cloudflare, dan Traefik

- Domain dapat dihubungkan ke resource provider-neutral.
- DNS/tunnel dan route Traefik memiliki status operasi yang dapat diaudit.
- TLS dan route hanya dinyatakan aktif setelah health check berhasil.
- Overdue gate tetap membaca status service/billing, bukan status provider.
- Penghapusan aplikasi tidak otomatis menghapus DNS tanpa policy eksplisit.

### 10.6 Storage dan backup

- Volume memiliki owner resource, mount policy, dan retention metadata.
- Platform membedakan volume ephemeral dan persistent.
- Backup memiliki status, checksum/reference, retention, dan hasil verifikasi.
- Backend backup dipilih pada fase lanjutan; MVP tidak menjanjikan restore
  lintas provider.

### 10.7 Monitoring

- Agent mengirim heartbeat, versi, capacity, utilization ringkas, dan inventory.
- Metrics high-cardinality tidak disimpan langsung di database metadata.
- Dashboard menampilkan healthy, degraded, offline, dan stale secara berbeda.
- Alerting dan retention metrics rinci masuk setelah protokol agent stabil.

### 10.8 Billing integration

- `service_resources` menghubungkan service ke generic infrastructure resource.
- Harga dan invoice tidak dihitung langsung dari live provider response.
- Suspension/unsuspension menggunakan workflow yang sama untuk semua provider.
- Kegagalan provider menghasilkan operasi retryable dan audit event; tidak
  mengubah invoice atau payment secara implisit.
- Satu service dapat memiliki beberapa resource, tetapi ownership setiap
  resource tetap tunggal.

### 10.9 Audit dan keamanan

- Setiap perubahan credential, provider, resource, lifecycle, domain, dan
  privilege dicatat dalam audit log.
- Secret tidak boleh muncul pada response API, UI, application log, atau audit
  payload.
- Operasi sensitif memerlukan role yang sesuai dan idempotency key.
- Agent menolak action yang tidak dikenal, expired, replayed, atau berada di
  luar capability/policy node.

## 11. Arsitektur Target

### 11.1 Komponen

- **Nuxt control plane:** dashboard, API, authorization, orchestration, billing,
  dan desired state.
- **PostgreSQL metadata:** provider, node, resource, operation, relasi service,
  dan audit.
- **Infrastructure provider adapters:** menerjemahkan kontrak internal ke
  Coolify API atau protokol Go Agent.
- **Go Agent:** menjalankan operasi tervalidasi pada Docker Engine, Compose, dan
  BuildKit di host Debian.
- **Traefik:** reverse proxy dan enforcement overdue gate.
- **Cloudflare:** DNS dan tunnel.
- **Coolify:** provider legacy selama masa coexistence dan migrasi.

### 11.2 Batas tanggung jawab

Control plane memiliki desired state dan authorization. Provider memiliki
mekanisme eksekusi. Agent memiliki akses lokal ke Docker tetapi tidak memiliki
akses ke domain billing. Traefik melakukan routing/enforcement, sedangkan
Cloudflare menangani DNS/tunnel. PostgreSQL metadata bukan tempat menyimpan
metrics mentah atau Docker secret plaintext.

## 12. Kontrak `InfrastructureProvider`

Kontrak final ditetapkan melalui Architecture Decision Record, tetapi bentuk
awalnya harus memisahkan discovery, application operations, dan observability:

```ts
type ProviderKind = 'coolify' | 'docker-agent'

interface InfrastructureProvider {
  readonly kind: ProviderKind

  getCapabilities(): Promise<ProviderCapabilities>
  testConnection(): Promise<ConnectionStatus>
  listNodes(): Promise<ProviderNode[]>
  listResources(input?: InventoryFilter): Promise<ProviderResource[]>

  applications: ApplicationProvider
  observations: ObservationProvider
}

interface ApplicationProvider {
  ensureApplication(
    spec: ApplicationSpec,
    context: OperationContext,
  ): Promise<ProviderOperation>

  configureEnvironment(
    resource: ResourceReference,
    spec: EnvironmentSpec,
    context: OperationContext,
  ): Promise<ProviderOperation>

  configureRoutes(
    resource: ResourceReference,
    routes: RouteSpec[],
    context: OperationContext,
  ): Promise<ProviderOperation>

  deploy(
    resource: ResourceReference,
    context: OperationContext,
  ): Promise<ProviderOperation>

  setLifecycle(
    resource: ResourceReference,
    state: 'running' | 'stopped' | 'deleted',
    context: OperationContext,
  ): Promise<ProviderOperation>

  setLimits(
    resource: ResourceReference,
    limits: ResourceLimits,
    context: OperationContext,
  ): Promise<ProviderOperation>
}
```

Ketentuan kontrak:

- setiap mutasi menerima idempotency key melalui `OperationContext`;
- hasil mutasi berupa operation, bukan asumsi bahwa pekerjaan selesai sinkron;
- error provider dinormalisasi menjadi retryable, terminal, unauthorized,
  unsupported, conflict, atau unavailable;
- capability yang tidak tersedia menghasilkan `unsupported`, bukan silent
  fallback;
- business service tidak mengimpor SDK Coolify atau client Agent secara
  langsung; dan
- adapter dipilih melalui provider registry berdasarkan resource owner.

Port tambahan seperti database, storage, backup, dan advanced metrics ditambah
setelah kontrak application tervalidasi. Kontrak tidak boleh menjadi satu
interface besar yang memaksa semua provider mendukung seluruh fitur.

## 13. Desain Go Agent

### 13.1 Tanggung jawab

- enrollment dan rotasi identity;
- heartbeat, version, capacity, dan inventory;
- operasi Docker/Compose/BuildKit yang terstruktur;
- health check dan status operation;
- redaction secret dan local audit correlation; serta
- enforcement allowlist/policy dari control plane.

### 13.2 Model koneksi

Default yang direkomendasikan untuk host kantor/rumah adalah koneksi outbound
dari agent ke control plane agar tidak membutuhkan inbound public port. Protokol
final dapat berupa long polling atau stream terautentikasi dan harus mendukung:

- one-time enrollment token;
- machine identity berbasis mTLS atau credential berumur pendek;
- rotation dan revocation;
- request signing/correlation;
- expiry dan replay protection; dan
- reconnect dengan exponential backoff.

### 13.3 Batas keamanan

- Agent tidak menyediakan endpoint arbitrary command execution.
- Input Compose/build divalidasi terhadap schema dan policy.
- Host path mount, privileged container, host network, device mount, dan
  capability Linux ditolak secara default.
- Secret disampaikan sebagai reference/encrypted payload dan dihapus dari
  output operasi.
- Build concurrency pada server development dibatasi agar control plane dan
  database tetap responsif.

## 14. Perubahan Database dan Strategi Migrasi

### 14.1 Model additive awal

Tabel berikut direncanakan sebagai model generic:

- `provider_connections`: jenis provider, nama, environment, encrypted config,
  status, dan capability snapshot;
- `provider_nodes`: koneksi provider, external ID, label, capacity, heartbeat,
  dan observed status;
- `infrastructure_resources`: provider owner, node, jenis resource, external ID,
  desired/observed state, dan metadata terbatas;
- `provider_operations`: idempotency key, action, target, status, attempts,
  correlation, error teredaksi, dan timestamp; serta
- `resource_observations`: snapshot status ringkas dengan observed timestamp.

Kolom/tabel lanjutan untuk storage, backup, dan metrics hanya ditambahkan saat
fitur terkait masuk milestone aktif.

### 14.2 Relasi existing

- `service_resources` ditambah referensi ke `infrastructure_resources`.
- Resource domain mengarah ke generic resource, dengan relasi legacy tetap ada
  selama dual-read.
- Provisioning job menyimpan provider connection, target node, generic resource,
  dan provider operation.
- Deployment blueprint menyimpan requirement/capability dan provider config yang
  tervalidasi, bukan field Coolify di core model.
- Database cluster dapat direlasikan ke generic resource tanpa menghapus model
  shared PostgreSQL existing.

### 14.3 Tahapan migrasi

1. **Expand:** tambah tabel, index, constraint, dan nullable foreign key baru.
2. **Backfill:** salin koneksi/node/resource Coolify sambil mempertahankan UUID,
   external ID, dan hubungan existing.
3. **Validate:** bandingkan jumlah record, orphan, uniqueness, dan relasi service,
   domain, serta provisioning.
4. **Dual-read/shadow:** baca model generic dan bandingkan dengan model legacy
   tanpa mengubah jalur operasi.
5. **Dual-write terbatas:** tulis kedua model melalui satu transaction boundary
   jika memungkinkan dan pantau divergence.
6. **Cutover per capability:** pindahkan satu jalur pada satu waktu ke provider
   registry, dimulai dari read-only inventory.
7. **Contract:** drop/rename legacy hanya setelah production migration memiliki
   rencana dan persetujuan tersendiri.

### 14.4 Ketentuan migrasi

- Migration harus dapat dijalankan pada salinan database production-like.
- Tidak ada destructive schema migration pada milestone awal.
- Backfill harus idempotent dan dapat dilanjutkan setelah gagal.
- Foreign key baru tidak dibuat `NOT NULL` sebelum semua validasi lulus.
- Credential existing memiliki fallback reader selama re-encryption berlangsung.
- Rollback aplikasi tidak boleh memerlukan rollback data yang destruktif.

## 15. Workflow Local Development

### 15.1 Topologi yang direkomendasikan

- Nuxt control plane dan PostgreSQL metadata berjalan lokal.
- Traefik dan workload uji berjalan di network Docker terisolasi.
- Go Agent berjalan pada Debian Stable lokal, VM Debian, atau server development
  khusus; validasi final agent harus dilakukan pada Debian Stable.
- Cloudflare dan provider external menggunakan credential khusus development atau
  staging, bukan credential production.

Cloud environment tetap dapat dipakai untuk CI atau review, tetapi integrasi
Docker host dan agent dikembangkan local-first agar developer memiliki kontrol
penuh atas daemon, network, volume, dan log.

### 15.2 Prasyarat

- Node.js dan npm sesuai versi repository;
- PostgreSQL versi yang didukung repository;
- Docker Engine, Docker Compose v2, dan BuildKit;
- Go versi stabil yang dipin di `go.mod` saat agent dibuat; dan
- domain lokal atau hostname staging untuk pengujian routing.

### 15.3 Isolasi dan secret

- Gunakan database lokal yang disposable atau snapshot tersanitasi.
- `.env` lokal tidak di-commit.
- Token Coolify, Cloudflare, SMTP, payment, dan production database tidak boleh
  dipakai dalam test lokal.
- Container/volume uji diberi label project agar cleanup tidak menyentuh workload
  lain.
- Agent development hanya menerima workload pada namespace/network yang telah
  ditentukan.

### 15.4 Developer experience yang ditargetkan

Repository pada akhirnya menyediakan command terdokumentasi untuk:

- bootstrap dependency dan database;
- menjalankan migration dan seed;
- menjalankan Nuxt dan Go Agent;
- menjalankan contract, integration, dan end-to-end test; serta
- membersihkan hanya resource uji yang dimiliki project.

Bootstrap bersih pada workstation/VM baru harus dapat direproduksi tanpa akses
ke production.

## 16. Implementation Plan

### Fase 0 — Stabilkan baseline

- Dokumentasikan baseline lint, typecheck, unit test, integration test, dan build.
- Perbaiki atau karantina secara eksplisit kegagalan baseline existing.
- Tambahkan fixture database production-like yang tersanitasi.
- Tetapkan feature flag dan kill switch provider baru.

Exit criteria: baseline dapat dibedakan dengan jelas dari regresi baru dan tidak
ada operasi Docker native yang aktif.

### Fase 1 — Provider seam dan Coolify adapter

- Definisikan contract, capability, normalized error, dan operation model.
- Bungkus integrasi Coolify existing sebagai adapter.
- Tambahkan provider registry.
- Jalankan contract suite terhadap Coolify adapter.
- Pertahankan API/UI behavior existing.

Exit criteria: seluruh jalur existing berjalan melalui seam provider tanpa
perubahan perilaku teramati.

### Fase 2 — Generic schema dan shadow migration

- Tambah tabel/kolom generic.
- Implementasikan backfill idempotent.
- Jalankan shadow read dan reconciliation report.
- Tambah observability untuk divergence.

Exit criteria: data Coolify existing terwakili pada model generic tanpa orphan
atau perubahan ownership.

### Fase 3 — Coolify parity

- Pindahkan provisioning, lifecycle, domain, dan reconciliation satu per satu.
- Validasi service/billing dan overdue gate.
- Hapus akses Coolify langsung dari business service; akses tetap ada hanya di
  adapter.

Exit criteria: Coolify memenuhi contract suite dan end-to-end flow existing.

### Fase 4 — Go Agent read-only

- Buat agent skeleton, enrollment, identity, heartbeat, dan version negotiation.
- Implementasikan inventory read-only dan observed state.
- Uji reconnect, credential revocation, dan agent offline.

Exit criteria: staging menampilkan node dan inventory tanpa memberi agent izin
mutasi workload.

### Fase 5 — Docker native staging

- Implementasikan structured application operations.
- Tambah Compose/BuildKit policy, resource limit, dan secret redaction.
- Integrasikan Traefik route, domain, dan health check.
- Aktifkan mutasi hanya untuk staging node melalui feature flag.

Exit criteria: satu aplikasi dapat diprovision dan dikelola end-to-end secara
idempotent pada staging, termasuk billing gate.

### Fase 6 — Database, storage, backup, dan monitoring

- Tambah port provider per capability.
- Implementasikan lifecycle database sesuai prioritas.
- Tambah volume/backup policy dan verifikasi restore.
- Integrasikan metrics backend dan alerting yang dipilih.

Exit criteria: setiap capability memiliki contract test, runbook, dan rollback
yang tervalidasi.

### Fase 7 — Evaluasi production migration

- Audit hasil staging dan capacity test.
- Susun mapping workload, maintenance window, backup, dan rollback per customer.
- Minta persetujuan eksplisit sebelum perubahan production.

Fase ini bukan bagian dari persetujuan PRD awal.

## 17. Acceptance Criteria MVP

MVP local/staging diterima jika:

1. Coolify dan Docker Agent terdaftar sebagai dua provider dengan capability
   masing-masing.
2. Seluruh fitur Coolify existing yang masuk scope melewati contract dan
   regression test tanpa perubahan hasil bisnis.
3. Backfill pada database production-like mempertahankan jumlah resource,
   identifier, service relation, domain relation, dan ownership.
4. Provisioning Docker native dapat diulang dengan idempotency key yang sama
   tanpa membuat aplikasi, route, atau job duplikat.
5. Aplikasi staging dapat deploy, start, stop, restart, menerima limit, dan
   melaporkan health melalui API/UI yang sama dengan provider legacy.
6. Domain dan TLS staging berfungsi serta overdue gate dapat memblokir dan
   memulihkan akses berdasarkan status billing.
7. Agent offline ditampilkan sebagai unavailable/stale tanpa memutus fungsi
   invoice, payment, portal, atau metadata.
8. Tidak ada secret pada log, audit payload, API response, atau UI.
9. Agent menolak arbitrary shell, privileged container, host path, dan action
   replay secara default.
10. Semua operasi mutasi memiliki authorization, audit trail, correlation ID,
    normalized error, dan bounded retry.
11. Bootstrap serta test lokal terdokumentasi dan berhasil pada environment
    bersih.
12. Tidak ada deployment atau perubahan data/configuration production.

## 18. Non-Functional Requirements

### 18.1 Reliability

- Operasi infrastructure harus idempotent dan resumable.
- Provider outage tidak boleh merusak state billing.
- Status stale harus eksplisit; platform tidak boleh menganggap data lama
  sebagai healthy.
- Retry menggunakan backoff dan batas attempt yang dapat dikonfigurasi.

### 18.2 Security

- Credential terenkripsi at rest dan teredaksi in transit/log.
- Machine identity dapat dirotasi dan dicabut.
- Semua input agent divalidasi dan menggunakan allowlist.
- Authorization diuji pada level API dan service, tidak hanya UI.
- Dependency dan container image memiliki vulnerability scanning pada CI.

### 18.3 Performance dan capacity

- Target awal adalah server development 4 core, RAM 32 GB, dan SSD.
- Build concurrency dibatasi satu secara default sampai capacity test selesai.
- Polling inventory/heartbeat tidak boleh tanpa batas atau memenuhi database.
- Resource limit dan disk watermark wajib sebelum workload customer diuji.
- Load test mencakup build bersamaan, reconciliation, billing job, dan request
  dashboard.

### 18.4 Maintainability

- Core domain tidak bergantung pada SDK provider.
- Provider adapter memiliki contract test yang sama.
- Schema/API change memiliki migration note.
- Operasi penting memiliki runbook dan failure-mode test.

## 19. Testing Strategy

### 19.1 Unit test

- provider registry, capability resolution, error mapping, policy, dan
  idempotency;
- billing invariant dan provider-neutral service lifecycle; serta
- redaction, authorization, dan state transition.

### 19.2 Contract test

Suite yang sama dijalankan untuk Coolify dan Docker Agent. Test mencakup
inventory, ensure, deploy, lifecycle, limit, unsupported capability, conflict,
unavailable provider, dan retry semantics.

### 19.3 Database migration test

- Jalankan seluruh migration dari database kosong.
- Jalankan upgrade dari snapshot schema/data existing yang tersanitasi.
- Verifikasi count, UUID/external ID, orphan, uniqueness, dan foreign key.
- Ulangi backfill untuk membuktikan idempotency.
- Uji rollback aplikasi dengan schema additive tetap terpasang.

### 19.4 Integration test

- PostgreSQL nyata, bukan hanya mock.
- Coolify API fake/sandbox dengan response dan failure realistis.
- Docker Engine/Compose/BuildKit pada environment terisolasi.
- Traefik route, Cloudflare sandbox/mock, dan overdue ForwardAuth.
- Agent enrollment, reconnect, expiry, revocation, dan version mismatch.

### 19.5 End-to-end staging

- Buat customer, plan, service, resource, dan domain.
- Provision dan deploy aplikasi.
- Verifikasi health, route, TLS, log redaction, dan audit.
- Simulasikan overdue, block, payment/recovery, dan unsuspend.
- Simulasikan agent/provider offline pada setiap langkah penting.

### 19.6 Failure injection dan security test

- timeout, duplicate delivery, partial deploy, stale inventory, disk penuh,
  image pull failure, build failure, dan database restart;
- forged/replayed command, expired identity, unauthorized node, malicious Compose
  option, secret leakage, dan cross-customer access; serta
- recovery setelah control plane atau agent restart di tengah operasi.

## 20. Release dan Rollback Strategy

- Semua provider baru dimulai dengan feature flag off.
- Enrollment agent, read-only inventory, dan mutation memiliki flag terpisah.
- Cutover dilakukan per capability dan per environment, bukan global.
- Shadow read berjalan sebelum dual-write atau mutasi.
- Kill switch menghentikan command baru tanpa menghapus workload yang sudah ada.
- Rollback aplikasi kembali ke Coolify adapter/model legacy selama masa
  coexistence.
- Rollback tidak otomatis menghapus container, volume, DNS, atau data customer.
- Setiap cutover staging membutuhkan backup, validation report, dan runbook.

## 21. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Dual control Coolify dan Agent | State berkonflik atau workload rusak | Provider ownership immutable, lock per resource, migration workflow eksplisit |
| Retry membuat resource duplikat | Biaya dan route konflik | Idempotency key, external ID unik, reconciliation |
| Kegagalan parsial provisioning | Service menggantung | Operation state machine, compensation terbatas, runbook manual |
| Akses Docker socket | Eskalasi ke host | Socket hanya untuk agent, allowlist action, sandbox/policy, audit |
| Secret bocor | Kompromi customer/provider | Encryption, reference, redaction test, log policy |
| Host 4-core kehabisan resource | Control plane tidak responsif | Limit, build concurrency, queue, disk watermark, capacity test |
| Migrasi FK/data keliru | Relasi billing/resource putus | Additive schema, backfill report, production-like migration test |
| Agent offline/NAT tidak stabil | Operasi tertunda | Outbound connection, durable queue, expiry, stale state, retry bounds |
| Perbedaan capability provider | UX tidak konsisten | Capability-driven UI/API dan explicit unsupported response |
| Gate/domain ikut berubah | Customer salah blokir/terbuka | Provider-neutral gate contract dan E2E overdue test |

## 22. Observability dan Operasional

Minimal telemetry yang diperlukan:

- correlation ID dari API hingga provider operation/agent;
- jumlah operation per status, durasi, retry, dan terminal error;
- provider health, node heartbeat age, queue depth, dan reconciliation drift;
- build/deploy result dan resource utilization ringkas;
- audit event untuk perubahan configuration dan privilege; serta
- alert untuk agent offline, operation stuck, disk watermark, dan repeated
  reconciliation failure.

Log harus structured, memiliki environment/provider/node/resource identifier,
dan tidak mengandung secret.

## 23. Deliverables

- ADR batas domain dan `InfrastructureProvider`;
- provider contract dan shared contract test suite;
- Coolify adapter dengan parity existing;
- generic database schema, migration, backfill, dan validation report;
- Go Agent dengan enrollment, heartbeat, inventory, dan structured operations;
- Docker native adapter untuk staging;
- local development guide dan staging runbook;
- security threat model dan secret-handling policy;
- monitoring dashboard/alerts minimum; serta
- rollback dan incident runbook.

## 24. Keputusan yang Masih Terbuka

Keputusan berikut harus diselesaikan melalui ADR sebelum capability terkait
diimplementasikan:

1. Transport agent: long polling, WebSocket/gRPC stream, atau kombinasi.
2. PKI/secret backend untuk machine identity dan provider credential.
3. Registry serta policy sumber image/build context.
4. Network isolation antar customer pada Docker host.
5. Backend metrics dan log retention.
6. Backend object storage serta retention/restore backup.
7. Strategi shared versus dedicated database untuk fase lanjutan.
8. Batas tindakan lifecycle yang boleh dilakukan customer.

Default sementara: outbound agent connection, deny-by-default capability,
staging-only credentials, dan tidak ada production cutover.

## 25. Approval Gates

Pekerjaan hanya maju ke fase berikutnya setelah artefak fase berjalan direview.
Secara khusus:

- PRD dan ADR disetujui sebelum refactor besar;
- Coolify parity disetujui sebelum agent memperoleh write capability;
- migration validation disetujui sebelum dual-write;
- security review disetujui sebelum staging mutation; dan
- production membutuhkan proposal, backup, maintenance window, rollback, serta
  persetujuan terpisah.
