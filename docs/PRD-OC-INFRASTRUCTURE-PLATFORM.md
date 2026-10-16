# PRD — OC Infrastructure Platform

- Versi: 0.2
- Status: Draft untuk review
- Target awal: local development dan satu server staging Ubuntu
- Repository: `mbx92/billEngine`
- Branch pengembangan: `feature/oc-infrastructure-platform`

## 1. Ringkasan Keputusan

OC Infrastructure Platform akan dirombak menjadi control plane native untuk
mengelola workload pada Ubuntu Server. Platform tidak menggunakan Coolify,
baik sebagai runtime, provider legacy, jalur fallback, maupun komponen migrasi.

Nuxt menjadi control plane untuk dashboard, API, authorization, orchestration,
billing, dan desired state. Go Agent menjadi satu-satunya executor operasi
infrastructure pada Ubuntu Server. Workload dijalankan dengan Docker Engine,
Docker Compose v2, dan BuildKit. Traefik tetap menangani reverse proxy dan
billing gate, sedangkan Cloudflare menangani DNS dan tunnel bila diperlukan.

Branch ini mengizinkan perubahan breaking pada domain infrastructure agar model,
API, database, service, UI, dan test tidak lagi membawa abstraksi atau istilah
Coolify. Domain billing dan dokumen finansial tetap harus kompatibel dan tidak
boleh diregresikan.

Pengembangan dan validasi awal dilakukan secara lokal dan pada server staging
Ubuntu. Deployment production atau migrasi workload production memerlukan
persetujuan dan runbook terpisah.

## 2. Latar Belakang

BillEngine saat ini menggunakan Nuxt 4, TypeScript, PostgreSQL, dan Drizzle ORM.
Platform telah memiliki customer, plan, service, invoice, payment, refund,
credit note, deployment blueprint, provisioning job, Cloudflare Tunnel, domain
management, Traefik ForwardAuth, dan shared PostgreSQL provisioning.

Implementasi infrastructure existing masih terikat pada Coolify melalui:

- API client, konfigurasi, schema, dan service Coolify;
- tabel server, node, dan resource yang menggunakan identitas Coolify;
- lifecycle aplikasi, reconciliation, domain, dan provisioning;
- route API, komponen UI, shared contract, seed, dan test; serta
- label Traefik dan pesan operasional yang memakai istilah Coolify.

Karena server yang tersedia menggunakan Ubuntu dan Coolify tidak lagi menjadi
bagian dari arah produk, mempertahankan coexistence hanya menambah kompleksitas.
Target baru adalah satu jalur operasi yang dimiliki penuh oleh OC: control plane,
protokol agent, model data, dan lifecycle workload.

## 3. Problem Statement

Platform memerlukan control plane infrastructure yang:

1. mengoperasikan satu atau lebih Ubuntu Server tanpa Coolify;
2. memisahkan domain billing dari status teknis container;
3. tidak memberikan Docker socket atau akses shell kepada dashboard/customer;
4. membuat seluruh operasi mutasi idempotent, asynchronous, dan dapat diaudit;
5. mempertahankan layanan metadata dan billing ketika node offline;
6. mengelola aplikasi, route, domain, database, storage, backup, dan observability
   melalui model milik OC; serta
7. dapat dipasang ulang dan dipulihkan tanpa ketergantungan pada platform PaaS
   eksternal.

## 4. Tujuan Produk

### 4.1 Tujuan utama

- Menjadikan Ubuntu Server sebagai satu-satunya sistem operasi host yang
  didukung.
- Menyediakan Go Agent untuk inventory dan operasi terstruktur pada Docker
  Engine, Compose, dan BuildKit.
- Menyediakan satu kontrak internal antara control plane dan agent tanpa
  provider registry atau adapter Coolify.
- Menyatukan lifecycle aplikasi, domain, database, storage, monitoring, dan
  billing melalui resource model milik OC.
- Menghapus dependency runtime, konfigurasi, database model, API, UI, dan test
  yang khusus Coolify dari target akhir branch.
- Memastikan mutation idempotent, resumable, dapat diaudit, dan aman terhadap
  retry maupun kegagalan parsial.
- Menyediakan bootstrap dan runbook Ubuntu yang dapat direproduksi.

### 4.2 Sasaran keberhasilan MVP

- Satu server staging Ubuntu dapat di-enroll dan dikelola dari control plane.
- Agent melaporkan heartbeat, capacity, inventory, dan versi secara aman.
- Satu aplikasi dapat dibuat dari image atau build context, di-deploy, diberi
  domain, dipantau, dihentikan, dimulai ulang, dan dihapus secara idempotent.
- Billing gate dapat memblokir dan memulihkan akses tanpa bergantung pada status
  teknis container.
- Database dan volume persisten tidak terhapus akibat retry atau penghapusan
  metadata.
- Tidak ada request runtime, credential, tabel aktif, atau jalur UI yang
  memerlukan Coolify.

## 5. Non-Goals

Rilis awal tidak mencakup:

- dukungan atau kompatibilitas dengan Coolify;
- Kubernetes, Swarm, Nomad, atau orchestrator multi-cluster;
- host selain Ubuntu Server;
- high availability control plane, PostgreSQL, atau agent;
- akses shell umum, terminal web, atau akses Docker socket untuk customer;
- hard multi-tenant isolation setara virtual machine pada satu host;
- migrasi otomatis workload production dari Coolify;
- redesign payment gateway atau accounting core; dan
- marketplace aplikasi atau public plugin system.

## 6. Pengguna dan Peran

### 6.1 Administrator platform

Mendaftarkan node Ubuntu, menetapkan policy dan capacity, menjalankan operasi,
melihat health, log operasi, dan audit trail, serta menangani kegagalan.

### 6.2 Staf billing/operasional

Mengelola customer, service, invoice, payment, dan status billing tanpa perlu
memiliki akses Docker atau memahami detail host.

### 6.3 Customer

Melihat service, status, invoice, domain, dan tindakan lifecycle yang diizinkan
melalui portal dengan isolasi data per customer.

### 6.4 Machine identity

Setiap Go Agent memiliki identitas sendiri. Identitas agent bukan akun
administrator dan hanya dapat mengakses endpoint serta operasi yang diperlukan.

## 7. Prinsip Desain

1. **Ubuntu-only.** Implementasi, dokumentasi, CI integration, dan runbook host
   menargetkan Ubuntu Server.
2. **Satu jalur kontrol.** Semua mutation infrastructure melalui control plane
   dan Go Agent; tidak ada dual control dengan Coolify.
3. **Billing terpisah dari runtime.** Status service bisnis tidak diturunkan
   langsung dari status container.
4. **Desired versus observed state.** Control plane menyimpan intent, sedangkan
   agent melaporkan hasil aktual beserta waktu observasinya.
5. **Asynchronous by default.** Mutation direpresentasikan sebagai operation
   yang dapat dipoll, di-retry, dan direkonsiliasi.
6. **Idempotent mutation.** Retry dengan idempotency key yang sama tidak membuat
   resource duplikat.
7. **Control plane tetap tersedia saat node offline.** Billing, invoice, dan
   metadata tidak ikut gagal ketika agent tidak terhubung.
8. **Least privilege.** Dashboard tidak mengakses Docker socket dan agent tidak
   mengeksekusi arbitrary shell command.
9. **Deny by default.** Opsi berbahaya seperti privileged mode, host network,
   device, host path, dan Linux capability ditolak kecuali ada policy eksplisit.
10. **Safe deletion.** Penghapusan metadata, workload, volume, backup, DNS, dan
    credential merupakan tindakan terpisah dengan guard masing-masing.

## 8. Scope Rombak Branch

Branch ini melakukan clean break pada domain infrastructure. Pekerjaan mencakup:

- mengganti seluruh model Coolify dengan node, resource, operation, observation,
  route, volume, dan secret reference milik OC;
- mengganti Coolify client/service dengan client protokol Go Agent;
- mengganti provisioning, lifecycle, reconciliation, domain, dan database flow;
- mengganti route API, shared schema, komponen UI, seed, fixture, serta test;
- menghapus environment variable, pesan error, label, dan dokumentasi Coolify;
- menyediakan migration atau reset path yang eksplisit untuk database
  development/staging; dan
- mempertahankan integritas customer, service, invoice, payment, refund, credit
  note, dan audit finansial.

Kode Coolify boleh tetap muncul hanya pada migration historis atau dokumen arsip
yang memang diperlukan untuk menjelaskan asal schema. Kode tersebut tidak boleh
diimpor, dikonfigurasi, atau dijalankan oleh aplikasi.

## 9. Kapabilitas yang Harus Dipertahankan

- snapshot customer, plan, harga, pajak, dan service pada dokumen finansial;
- recurring invoice dengan unique guard per billing period;
- alokasi payment, refund, dan credit note yang transaksional;
- nomor dokumen yang dialokasikan secara atomik;
- audit event dalam transaction boundary yang relevan;
- isolasi customer pada portal dan API;
- authentication, authorization, settings, email, dan report;
- service lifecycle bisnis;
- domain routing dan Cloudflare Tunnel yang masih digunakan;
- Traefik ForwardAuth overdue gate; dan
- shared PostgreSQL provisioning selama masuk scope aktif.

## 10. Ruang Lingkup Fungsional

### 10.1 Node Ubuntu

- Administrator dapat membuat enrollment token sekali pakai, mendaftarkan node,
  mengganti nama/label, menonaktifkan, mencabut identity, dan melihat health.
- Node menyimpan environment, label, capacity, versi agent, versi Docker,
  heartbeat terakhir, serta observed status.
- Enrollment hanya berhasil untuk host Ubuntu yang memenuhi versi dan dependency
  minimum yang ditetapkan runbook.
- Node offline tidak menghambat API billing dan metadata.
- Drain mode mencegah penempatan workload baru tanpa menghentikan workload aktif.

### 10.2 Inventory dan reconciliation

- Agent melaporkan container, image, Compose project, network, volume, dan
  resource milik OC.
- Semua object yang dibuat platform memiliki label ownership stabil.
- Resource asing ditampilkan sebagai unmanaged dan tidak dimutasi otomatis.
- Drift antara desired state dan observed state terlihat tanpa menimpa
  konfigurasi secara diam-diam.
- Observasi memiliki timestamp agar status stale berbeda dari healthy.
- Reconciliation menggunakan lock per resource, bounded retry, dan backoff.

### 10.3 Application lifecycle

- Membuat aplikasi dari image registry atau build context yang diizinkan.
- Mengelola environment variable dan secret reference tanpa membocorkan value.
- Menetapkan CPU/memory limit, health check, dan restart policy.
- Deploy, start, stop, restart, redeploy, rollback versi, dan delete sesuai role.
- Menyimpan desired revision, observed revision, image digest, dan hasil deploy.
- Menampilkan log teredaksi dan terbatas sesuai authorization.
- Penghapusan workload tidak otomatis menghapus volume, backup, DNS, atau
  metadata service.

### 10.4 Database

- Inventory instance/cluster database dan status koneksinya.
- Provisioning database menggunakan operasi terstruktur, bukan arbitrary shell.
- Username/password dibuat dengan sumber randomness yang aman dan disimpan
  terenkripsi.
- Template bawaan PostgreSQL, MySQL, dan Redis dapat dideploy berulang kali
  dengan nama, host port, username, database, dan password yang berbeda.
- Default MVP adalah instance/container dedicated per deployment dengan volume
  persisten. Integrasi shared cluster memakai database dan role terpisah per
  service pada fase berikutnya; satu credential tidak boleh digunakan lintas
  service.
- Secret disimpan terenkripsi di control plane, direferensikan dari desired spec,
  lalu diambil agent hanya saat operation aktif dan dipasang sebagai file dengan
  permission terbatas. Plaintext tidak disimpan pada operation atau audit log.
- Shared PostgreSQL existing tetap didukung melalui resource model baru.
- Backup dan restore wajib memiliki verifikasi hasil sebelum dianggap sukses.
- Hanya PostgreSQL workload yang dibuat sebagai resource Template native yang
  dapat dipromosikan menjadi database cluster. PostgreSQL metadata Billing tidak
  masuk inventory kandidat dan tidak boleh dikelola control plane sendiri.
- Aktivasi pertama menggunakan mode `standalone`. Agent memverifikasi ownership
  container dan menjalankan preflight PostgreSQL secara lokal; control plane
  tidak memerlukan koneksi TCP langsung ke database pada node remote.
- Mode `replicated` dan penambahan standby lintas node hanya diaktifkan setelah
  lifecycle primary, backup, dan private data-plane network tervalidasi.
- Shared cluster membuat database, role, dan password berbeda untuk setiap
  service melalui action agent `database.service.ensure`; control plane tidak
  membuka koneksi TCP langsung ke PostgreSQL workload.
- Password service dan connection URI disimpan terenkripsi. Secret hanya
  diberikan kepada agent selama operation aktif dan explicit admin reveal
  menggunakan response `no-store` serta audit tanpa plaintext.
- MVP shared cluster mengharuskan aplikasi dan PostgreSQL berada pada node yang
  sama serta memakai managed Docker network `oc-private`. Setelah provisioning
  berhasil, connection URI dipasang sebagai `<ENV_KEY>_FILE` dan aplikasi
  dijadwalkan redeploy otomatis.

### 10.4.1 Template deployment

- Istilah produk adalah **Template**; nama `blueprint` lama hanya boleh tersisa
  pada migration historis sampai clean-break schema selesai.
- Template memiliki versi immutable pada setiap deployment agar perubahan resep
  tidak mengubah resource yang sudah berjalan secara diam-diam.
- Parameter non-secret masuk ke environment tervalidasi, sedangkan parameter
  secret menjadi managed secret reference.
- Resource menyimpan `template_id` dan `template_version`, tetapi lifecycle
  container tetap memakai operation native yang sama dengan aplikasi biasa.
- Menghapus container tidak otomatis menghapus named volume persisten.

### 10.5 Domain, Cloudflare, dan Traefik

- Domain dihubungkan langsung ke infrastructure resource milik OC.
- Agent menghasilkan konfigurasi/label Traefik dari route spec tervalidasi.
- DNS/tunnel dan route memiliki operation serta audit trail terpisah.
- TLS dan route dinyatakan aktif setelah health check berhasil.
- Overdue gate membaca status service/billing, bukan status node atau container.
- Penghapusan aplikasi tidak otomatis menghapus DNS.

### 10.6 Storage dan backup

- Volume memiliki resource owner, mount policy, jenis ephemeral/persistent, dan
  retention metadata.
- Host path mount ditolak untuk workload customer pada MVP.
- Backup menyimpan status, checksum, ukuran, lokasi, retention, dan hasil
  verifikasi.
- Restore selalu menjadi operation eksplisit dan diaudit.

### 10.7 Monitoring

- Agent mengirim heartbeat, version, capacity, utilization ringkas, dan inventory.
- Metrics high-cardinality tidak disimpan pada tabel metadata utama.
- Dashboard membedakan healthy, degraded, offline, unknown, dan stale.
- Alert minimum mencakup agent offline, disk watermark, operation stuck,
  deploy gagal berulang, dan backup gagal.

### 10.8 Billing integration

- `service_resources` menghubungkan service ke `infrastructure_resources`.
- Harga dan invoice tidak dihitung langsung dari live Docker/agent response.
- Suspension dan unsuspension membuat operation yang idempotent.
- Kegagalan node menghasilkan operation retryable dan audit event; tidak
  mengubah invoice atau payment secara implisit.
- Satu service dapat memiliki beberapa resource dengan ownership customer yang
  tervalidasi.

### 10.9 Audit dan keamanan

- Perubahan node, identity, resource, lifecycle, domain, secret, role, dan policy
  dicatat dalam audit log.
- Secret tidak muncul pada response API/UI biasa, log aplikasi, log agent, atau
  audit payload. Admin dapat melakukan explicit reveal melalui response
  `no-store`; tindakan diaudit hanya dengan nama key dan plaintext dibersihkan
  dari state UI saat dialog ditutup.
- Mutation memerlukan authorization, idempotency key, correlation ID, dan
  operation record.
- Agent menolak action yang tidak dikenal, expired, replayed, tidak ditandatangani,
  atau berada di luar policy node.
- Agent `0.8.0+` menerima upgrade/rollback sebagai operation terstruktur. Binary
  diverifikasi menggunakan version dan SHA-256 dari operation terautentikasi,
  diganti oleh helper systemd root, serta otomatis di-rollback jika heartbeat
  versi target tidak muncul dalam batas waktu.

## 11. Arsitektur Target

### 11.1 Komponen

- **Nuxt control plane:** dashboard, API, authorization, orchestration, billing,
  desired state, dan operation queue.
- **PostgreSQL metadata:** node, identity, resource, operation, observation,
  route, relasi service, dan audit.
- **Go Agent:** executor tunggal untuk operasi tervalidasi pada Ubuntu Server.
- **Docker Engine + Compose v2 + BuildKit:** runtime dan build workload.
- **Traefik:** reverse proxy, TLS termination, dan overdue gate.
- **Cloudflare:** DNS dan tunnel bila topologi membutuhkannya.
- **Backup backend:** object storage atau target lain yang dipilih melalui ADR.

Coolify bukan bagian dari arsitektur target maupun arsitektur transisi.

### 11.2 Batas tanggung jawab

Control plane memiliki desired state, authorization, scheduling sederhana, dan
audit. Agent memiliki akses lokal ke Docker tetapi tidak memiliki akses ke domain
billing. Agent hanya menerima command terstruktur. Traefik melakukan routing dan
enforcement. Cloudflare menangani DNS/tunnel. PostgreSQL metadata tidak menyimpan
Docker secret plaintext, log mentah tanpa batas, atau metrics high-cardinality.

### 11.3 Topologi MVP

MVP menggunakan satu server staging Ubuntu yang menjalankan Go Agent, Docker,
Traefik, dan workload uji. Control plane dan PostgreSQL dapat berjalan pada host
yang sama untuk staging kecil, tetapi harus berada pada Compose project, network,
volume, dan resource limit terpisah dari workload customer.

Model data tetap menggunakan entitas node agar penambahan server Ubuntu kedua
tidak memerlukan redesign, tetapi scheduler multi-node otomatis bukan scope MVP.

## 12. Kontrak Control Plane–Agent

Kontrak final ditetapkan melalui ADR dan versioned protocol. Bentuk awalnya:

```ts
interface InfrastructureRuntime {
  getNodeStatus(nodeId: string): Promise<NodeStatus>
  listInventory(nodeId: string): Promise<InventorySnapshot>
  ensureApplication(spec: ApplicationSpec, context: OperationContext): Promise<OperationRef>
  configureEnvironment(resource: ResourceRef, spec: EnvironmentSpec, context: OperationContext): Promise<OperationRef>
  configureRoutes(resource: ResourceRef, routes: RouteSpec[], context: OperationContext): Promise<OperationRef>
  deploy(resource: ResourceRef, context: OperationContext): Promise<OperationRef>
  setLifecycle(resource: ResourceRef, state: 'running' | 'stopped' | 'deleted', context: OperationContext): Promise<OperationRef>
  setLimits(resource: ResourceRef, limits: ResourceLimits, context: OperationContext): Promise<OperationRef>
}
```

Ketentuan kontrak:

- setiap mutation membawa idempotency key, correlation ID, actor, target node,
  expiry, dan expected resource revision;
- hasil mutation berupa operation, bukan asumsi selesai sinkron;
- error dinormalisasi menjadi retryable, terminal, unauthorized, unsupported,
  conflict, invalid-spec, atau unavailable;
- protocol memiliki versi dan compatibility window yang eksplisit;
- duplicate delivery mengembalikan operation/result yang sama;
- payload dan log tidak mengandung secret plaintext; dan
- business service tidak mengakses Docker API atau client agent secara langsung.

## 13. Desain Go Agent

### 13.1 Tanggung jawab

- enrollment, machine identity, rotasi, dan revocation;
- heartbeat, version negotiation, capacity, dan inventory;
- operasi Docker/Compose/BuildKit yang terstruktur;
- validasi spec dan enforcement policy lokal;
- health check, status operation, dan observed state;
- secret redaction dan local audit correlation; serta
- recovery operation setelah agent restart.

### 13.2 Model koneksi

Default adalah koneksi outbound dari agent ke control plane agar server tidak
memerlukan port agent publik. Transport final dapat berupa long polling atau
stream terautentikasi dan harus mendukung:

- one-time enrollment token;
- machine identity berbasis mTLS atau credential berumur pendek;
- rotation dan revocation;
- signature/correlation untuk command;
- expiry dan replay protection;
- reconnect dengan exponential backoff; dan
- acknowledgement yang durable untuk command yang sudah diterima.

### 13.3 Instalasi Ubuntu

- Agent didistribusikan sebagai binary atau package dengan checksum/signature.
- Agent berjalan sebagai service `systemd` dengan user khusus.
- Unit service menerapkan hardening yang kompatibel dengan akses Docker yang
  memang dibutuhkan agent.
- Direktori config, state, dan log memiliki ownership serta permission ketat.
- Docker, Compose plugin, BuildKit, firewall, NTP, disk, dan DNS diperiksa oleh
  preflight command.
- Instalasi dan upgrade agent bersifat versioned serta memiliki rollback.

### 13.4 Batas keamanan

- Agent tidak menyediakan endpoint arbitrary command execution.
- Input Compose/build divalidasi terhadap schema dan policy.
- Privileged container, host network, device mount, host PID/IPC, host path, dan
  penambahan Linux capability ditolak secara default.
- Secret disampaikan sebagai reference atau encrypted envelope dan dihapus dari
  output operation.
- Build concurrency dibatasi agar control plane dan database tetap responsif.
- Akses Docker socket dianggap privileged dan dibatasi hanya untuk process agent;
  risikonya harus dicatat pada threat model.

## 14. Desain Data dan Migrasi

### 14.1 Model target

- `infrastructure_nodes`: nama, environment, label, identity, version, capacity,
  heartbeat, drain flag, dan observed status;
- `infrastructure_resources`: node owner, customer owner, service relation, kind,
  stable external ID, desired/observed revision, state, dan metadata terbatas;
- `infrastructure_operations`: idempotency key, action, actor, target, status,
  attempt, correlation, expected revision, error teredaksi, dan timestamp;
- `resource_observations`: snapshot status ringkas dan observed timestamp;
- `resource_routes`: hostname, target port, TLS, middleware, desired/observed
  state, dan operation relation;
- `resource_volumes`: jenis, mount target, retention, backup policy, dan delete
  protection; serta
- `node_enrollments`/`node_identities`: hash token/credential, expiry, rotation,
  revocation, dan last-used metadata.

Secret value disimpan melalui mekanisme terenkripsi yang diputuskan pada ADR;
tabel metadata hanya menyimpan reference dan metadata aman.

### 14.2 Clean-break migration

Karena branch ini merombak total infrastructure control, tidak ada dual-read,
dual-write, provider registry, atau adapter compatibility dengan Coolify.

Urutan migrasi development/staging:

1. catat baseline dan ekspor data infrastructure existing untuk audit/rollback;
2. bekukan mutation infrastructure lama;
3. buat schema target dan mapping hanya untuk relasi bisnis yang masih valid;
4. hubungkan `service_resources`, domain, dan provisioning ke resource baru;
5. deploy control plane baru dan enroll agent Ubuntu;
6. buat ulang workload uji melalui jalur native;
7. validasi billing, domain, route, volume, dan audit;
8. hapus kode dan konfigurasi Coolify; dan
9. drop tabel/kolom Coolify hanya setelah backup serta validation report disetujui.

Reset database diperbolehkan untuk environment development yang disposable.
Database staging harus menggunakan migration terukur dan backup. Migrasi atau
penghapusan data production tidak termasuk persetujuan PRD ini.

### 14.3 Invariant migrasi

- ID customer, service, invoice, payment, dan dokumen finansial tidak berubah.
- Resource tidak boleh diklaim agent hanya berdasarkan nama container.
- Mapping resource memerlukan stable ownership label atau verifikasi manual.
- Volume persisten, DNS, dan backup tidak dihapus sebagai efek samping schema
  migration.
- Backfill yang disediakan harus idempotent dan menghasilkan validation report.
- Rollback aplikasi tidak boleh memerlukan penghapusan data finansial.

## 15. Workflow Development dan Staging

### 15.1 Local development

- Nuxt control plane dan PostgreSQL metadata berjalan lokal.
- Docker/Traefik/workload uji berjalan pada network dan Compose project terisolasi.
- Go Agent dapat berjalan pada VM Ubuntu lokal atau node development khusus.
- Validasi final selalu dilakukan pada Ubuntu Server.
- Cloudflare menggunakan credential development/staging, bukan production.

### 15.2 Prasyarat

- Node.js dan npm sesuai versi repository;
- PostgreSQL versi yang didukung repository;
- Ubuntu Server pada node integrasi;
- Docker Engine, Docker Compose v2, dan BuildKit;
- Go versi yang dipin di `go.mod`; dan
- hostname/domain staging untuk pengujian routing.

### 15.3 Isolasi dan secret

- Gunakan database disposable atau snapshot tersanitasi.
- `.env` lokal tidak di-commit.
- Token Cloudflare, SMTP, payment, enrollment, dan database production tidak
  dipakai pada test lokal.
- Container, network, dan volume uji diberi label project serta ownership.
- Cleanup hanya memproses resource yang memiliki label ownership test yang tepat.
- Agent development hanya menerima workload pada namespace/network yang
  ditentukan.

### 15.4 Developer experience

Repository menyediakan command terdokumentasi untuk:

- bootstrap dependency dan database;
- menjalankan migration serta seed;
- menjalankan Nuxt dan Go Agent;
- melakukan preflight Ubuntu;
- enroll/revoke node development;
- menjalankan unit, integration, security, dan end-to-end test; serta
- membersihkan hanya resource uji milik project.

## 16. Implementation Plan

### Fase 0 — Baseline dan guardrail

- Catat hasil lint, typecheck, unit test, integration test, dan build.
- Inventarisasi seluruh coupling Coolify pada kode, schema, config, UI, dan test.
- Ekspor data infrastructure development/staging yang perlu dipertahankan.
- Tetapkan ownership label, naming convention, feature flag, dan kill switch.

Exit criteria: baseline dan daftar penghapusan Coolify terdokumentasi; tidak ada
mutation ke server staging selama cutover disiapkan.

### Fase 1 — Domain dan schema baru

- Definisikan resource, operation, observation, route, volume, node, dan identity.
- Implementasikan repository serta service tanpa provider abstraction.
- Tambahkan schema/migration baru dan mapping relasi service.
- Ganti shared schema dan API contract.

Exit criteria: control plane dapat membuat desired state dan operation tanpa
memuat module atau tipe Coolify.

### Fase 2 — Go Agent read-only

- Buat agent, installer Ubuntu, service `systemd`, enrollment, identity, dan
  version negotiation.
- Implementasikan heartbeat, preflight, capacity, dan inventory read-only.
- Uji reconnect, duplicate delivery, expiry, revocation, dan agent offline.

Exit criteria: staging menampilkan node serta inventory Ubuntu dengan status
stale/offline yang benar dan tanpa izin mutation workload.

### Fase 3 — Application operations

- Implementasikan ensure, deploy, start, stop, restart, redeploy, rollback, dan
  delete sebagai operation terstruktur.
- Terapkan Compose/BuildKit policy, resource limit, locking, dan secret redaction.
- Implementasikan reconciliation desired/observed state.

Exit criteria: satu aplikasi dapat dikelola end-to-end secara idempotent pada
staging Ubuntu dan pulih dari restart agent/control plane.

### Fase 4 — Domain, Traefik, dan billing gate

- Generate route Traefik dari route spec tervalidasi.
- Integrasikan Cloudflare DNS/tunnel yang masih diperlukan.
- Hubungkan suspend/unsuspend ke billing gate dan lifecycle operation.
- Uji TLS, health check, overdue, payment recovery, dan delete guard.

Exit criteria: domain staging aktif dan billing gate bekerja tanpa label,
endpoint, atau proses Coolify.

### Fase 5 — Database, storage, backup, dan monitoring

- [x] Migrasikan shared PostgreSQL provisioning ke resource/operation baru.
- [x] Implementasikan backup/restore logical database workload dan verifikasi checksum.
- [x] Tambahkan snapshot CPU/RAM/disk, heartbeat offline, operation stuck, dashboard,
  dan metrics Prometheus.
- [x] Tambahkan menu Backup, S3-compatible object storage, scheduled policy,
  retention count, dan email failure alert untuk PostgreSQL workload.
- [ ] Tambahkan restore rehearsal otomatis, backup database Billing terjadwal,
  driver database eksternal/MySQL/Redis, dan volume backup non-PostgreSQL.

Exit criteria: capability memiliki test, runbook, alert, backup, dan prosedur
recovery yang tervalidasi.

### Fase 6 — Penghapusan Coolify dan release readiness

- Hapus client, service, route, UI, config, env, fixture, seed, dan test Coolify.
- Hapus schema legacy setelah backup dan validation report disetujui.
- Jalankan pencarian repository untuk memastikan tidak ada dependency runtime.
- Jalankan fresh-install dan upgrade rehearsal pada Ubuntu staging.
- Susun threat model, incident runbook, dan production proposal terpisah.

Exit criteria: branch berjalan penuh secara native pada Ubuntu dan seluruh
acceptance criteria terpenuhi.

## 17. Acceptance Criteria MVP

MVP local/staging diterima jika:

1. Server staging Ubuntu dapat di-enroll, dicabut, dan di-enroll ulang dengan
   identity baru tanpa menyisakan credential aktif lama.
2. Agent melaporkan version, Docker version, capacity, heartbeat, dan inventory.
3. Provisioning dengan idempotency key yang sama tidak membuat aplikasi, route,
   volume, atau operation duplikat.
4. Aplikasi dapat deploy, start, stop, restart, redeploy, menerima limit, dan
   melaporkan health melalui API/UI.
5. Desired/observed revision dan drift ditampilkan dengan timestamp yang benar.
6. Domain dan TLS staging berfungsi; overdue gate dapat memblokir lalu memulihkan
   akses berdasarkan status billing.
7. Agent offline ditampilkan sebagai offline/stale tanpa memutus invoice,
   payment, portal, atau metadata.
8. Tidak ada secret pada log, audit payload, response API/UI biasa, atau
   operation error; explicit admin reveal wajib `no-store` dan diaudit tanpa
   plaintext.
9. Agent menolak arbitrary shell, privileged container, host network, device,
   host path, capability berbahaya, command expired, dan replay.
10. Setiap mutation memiliki authorization, audit trail, correlation ID,
    normalized error, locking, dan bounded retry.
11. Delete workload tidak menghapus persistent volume, backup, DNS, atau
    financial/service metadata tanpa action eksplisit.
12. Bootstrap dan test berhasil pada environment bersih serta server Ubuntu baru.
13. Tidak ada import, API call, environment variable aktif, route UI, atau
    dependency runtime Coolify.
14. Regression test billing dan dokumen finansial tetap lulus.
15. Tidak ada deployment atau perubahan data/configuration production.

## 18. Non-Functional Requirements

### 18.1 Reliability

- Operation harus idempotent, resumable, dan memiliki state machine valid.
- Node outage tidak boleh merusak state billing.
- Status stale eksplisit dan tidak dianggap healthy.
- Retry menggunakan exponential backoff, jitter, dan batas attempt.
- Command acknowledgement serta hasil operation tetap konsisten setelah restart.

### 18.2 Security

- Credential terenkripsi at rest dan teredaksi pada transit/log.
- Machine identity dapat dirotasi dan dicabut.
- Semua input agent divalidasi dengan schema dan allowlist.
- Authorization diuji pada API dan service, bukan hanya UI.
- Image dependency menjalani vulnerability scanning pada CI.
- Artifact agent memiliki checksum/signature dan provenance build.

### 18.3 Performance dan capacity

- Capacity target server dicatat dari hasil preflight, bukan hard-code asumsi.
- Build concurrency satu secara default sampai capacity test menyatakan aman.
- Heartbeat dan inventory menggunakan interval, pagination, dan retention yang
  tidak memenuhi database.
- CPU/memory limit dan disk watermark wajib sebelum workload customer diuji.
- Load test mencakup build, reconciliation, billing job, dan request dashboard.

### 18.4 Maintainability

- Core billing tidak bergantung pada Docker SDK atau protokol agent.
- Protocol agent versioned dan memiliki compatibility test.
- Schema/API change memiliki migration note.
- Operation penting memiliki runbook dan failure-mode test.
- Istilah pada API, UI, schema, dan log konsisten menggunakan node/resource/
  operation, bukan istilah provider legacy.

## 19. Testing Strategy

### 19.1 Unit test

- state transition operation, idempotency, locking, retry, dan error mapping;
- validation spec, policy, ownership, authorization, dan redaction;
- billing invariant serta service lifecycle; dan
- reconciliation desired/observed revision.

### 19.2 Protocol/contract test

Suite control plane–agent mencakup version negotiation, inventory, ensure,
deploy, lifecycle, limit, invalid spec, duplicate delivery, conflict, timeout,
unavailable node, expiry, replay, dan retry semantics.

### 19.3 Database migration test

- Jalankan migration dari database kosong.
- Jalankan upgrade dari snapshot schema/data existing yang tersanitasi.
- Verifikasi count, UUID, relasi service/domain, orphan, uniqueness, dan FK.
- Ulangi backfill untuk membuktikan idempotency.
- Uji rollback aplikasi dengan backup schema/data tersedia.

### 19.4 Integration test

- PostgreSQL nyata, bukan hanya mock.
- Docker Engine, Compose, dan BuildKit pada VM/runner Ubuntu terisolasi.
- Traefik route, Cloudflare sandbox/mock, dan overdue ForwardAuth.
- Enrollment, reconnect, expiry, revocation, dan version mismatch.
- Persistent volume, backup, restore, serta cleanup ownership.

### 19.5 End-to-end staging

- Buat customer, plan, service, resource, dan domain.
- Provision dan deploy aplikasi pada Ubuntu.
- Verifikasi health, route, TLS, log redaction, resource limit, dan audit.
- Simulasikan overdue, block, payment/recovery, dan unsuspend.
- Simulasikan agent offline/restart pada setiap langkah penting.
- Hapus workload dan buktikan data persisten yang dilindungi tetap ada.

### 19.6 Failure injection dan security test

- timeout, duplicate delivery, partial deploy, stale inventory, disk penuh,
  image pull failure, build failure, dan database restart;
- forged/replayed command, expired identity, unauthorized node, malicious Compose
  option, secret leakage, dan cross-customer access; serta
- recovery setelah control plane atau agent restart di tengah operation.

## 20. Release dan Rollback Strategy

- Enrollment, inventory, mutation, routing, dan delete memiliki flag terpisah.
- Mutation staging dimulai dalam mode deny-by-default.
- Kill switch menghentikan command baru tanpa menghapus workload aktif.
- Rollback control plane/agent menggunakan versi protocol yang kompatibel.
- Rollback tidak otomatis menghapus container, volume, DNS, backup, atau data.
- Sebelum schema legacy dihapus, simpan backup dan validation report.
- Rollback ke Coolify bukan strategi yang didukung; recovery menggunakan versi
  terakhir control plane/agent native yang tervalidasi.
- Setiap release staging membutuhkan backup, smoke test, dan runbook.

## 21. Risiko dan Mitigasi

| Risiko | Dampak | Mitigasi |
| --- | --- | --- |
| Agent memiliki akses Docker | Kompromi agent dapat menguasai host | Dedicated user/service, credential rotation, policy, audit, host hardening, threat model |
| Retry membuat resource duplikat | Konflik route dan pemborosan resource | Idempotency key, stable ID, unique constraint, reconciliation |
| Kegagalan parsial provisioning | Service menggantung | Operation state machine, checkpoint, bounded compensation, runbook |
| Clean break kehilangan mapping lama | Service/domain salah terhubung | Export, explicit mapping, validation report, rehearsal staging |
| Secret bocor | Kompromi customer/node | Encryption, reference/envelope, redaction test, log policy |
| Host kehabisan CPU/RAM/disk | Control plane/workload tidak responsif | Limit, queue, build concurrency, watermark, capacity test |
| Agent offline atau koneksi tidak stabil | Operation tertunda | Outbound connection, durable queue, expiry, stale state, backoff |
| Spec Compose berbahaya | Eskalasi privilege host | Schema ketat, denylist + allowlist, no raw arbitrary Compose for customer |
| Gate/domain salah konfigurasi | Customer salah blokir atau terbuka | Provider-independent gate contract, health check, E2E overdue test |
| Single-node failure | Semua workload staging berhenti | Backup, restore rehearsal, documented RTO/RPO; HA di fase berikutnya |

## 22. Observability dan Operasional

Telemetry minimum:

- correlation ID dari API hingga operation dan log agent;
- jumlah operation per status, durasi, retry, dan terminal error;
- node health, heartbeat age, queue depth, dan reconciliation drift;
- build/deploy result, CPU, memory, disk, dan network ringkas;
- audit event perubahan configuration, identity, dan privilege; serta
- alert agent offline, operation stuck, disk watermark, backup gagal, dan
  reconciliation failure berulang.

Log harus structured, memiliki environment/node/resource/operation identifier,
memiliki retention, dan tidak mengandung secret.

## 23. Deliverables

- ADR arsitektur Ubuntu-only dan batas control plane–agent;
- schema data, migration, mapping, backup, dan validation report;
- versioned agent protocol dan contract test suite;
- Go Agent, installer Ubuntu, unit `systemd`, preflight, dan upgrade/rollback;
- infrastructure API/service/UI tanpa dependency Coolify;
- application, domain, database, storage, backup, dan monitoring flow;
- local development guide dan Ubuntu staging runbook;
- threat model, secret-handling policy, dan host-hardening checklist;
- dashboard/alert minimum; serta
- recovery dan incident runbook.

## 24. Keputusan yang Masih Terbuka

Keputusan berikut diselesaikan melalui ADR sebelum capability terkait aktif:

1. versi minimum Ubuntu Server yang didukung;
2. evolusi transport setelah MVP: long polling, WebSocket/gRPC stream, atau
   kombinasi; MVP short polling HTTPS telah diputuskan dalam ADR-001;
3. PKI dan secret backend untuk machine identity serta application secret;
4. registry dan policy sumber image/build context;
5. network isolation antar customer pada Docker host;
6. metrics backend dan log retention;
7. object storage, retention, encryption, dan restore policy backup;
8. topology shared cluster untuk produksi (HA, connection pooling, quota, dan
   backup); default isolasi logical database/user per service sudah diputuskan;
   dan
9. batas tindakan lifecycle yang boleh dilakukan customer.

Default sementara: outbound agent connection, deny-by-default, satu staging node
Ubuntu, build concurrency satu, credential staging-only, dan tidak ada production
cutover.

## 25. Approval Gates

Pekerjaan maju setelah artefak fase berjalan direview. Secara khusus:

- PRD dan ADR disetujui sebelum refactor besar;
- schema dan backup plan disetujui sebelum clean-break migration staging;
- threat model disetujui sebelum agent memperoleh write capability;
- route/TLS/billing gate test lulus sebelum workload staging dibuka;
- backup dan restore rehearsal lulus sebelum data persisten dipakai; dan
- production membutuhkan proposal, inventory, backup, maintenance window,
  rollback/recovery plan, serta persetujuan terpisah.
