# Shared Database Provisioning Plan

## Tujuan

Menyediakan database PostgreSQL otomatis untuk service customer paket murah dengan model berikut:

- Satu resource PostgreSQL bersama dibuat satu kali di Coolify.
- Setiap service mendapatkan database, role, dan password yang berbeda.
- BillEngine membuat kredensial dan mengirimkan `DATABASE_URL` ke aplikasi secara otomatis.
- Kredensial administrator PostgreSQL tidak pernah diberikan kepada aplikasi customer.
- Retry provisioning tidak membuat database atau role duplikat.

### Peran plan, service, dan resource

- **Plan** adalah template katalog: harga, siklus billing, entitlement resource, dan mode database.
- **Service** adalah instance langganan milik satu customer. Nilai plan disalin sebagai snapshot ke service agar perubahan katalog tidak mengubah kontrak lama.
- **Resource** adalah aplikasi/container nyata di Coolify yang dimiliki service setelah provisioning.
- **Blueprint** adalah resep teknis untuk membuat resource tersebut.

Service dibuat lebih dahulu dan boleh belum mempunyai resource. Pemilihan resource ketika membuat service hanya dipakai untuk mengadopsi aplikasi Coolify yang sudah ada. Untuk aplikasi baru, provisioning menerima `service_id` sebagai identitas pemilik, lalu membuat dan menghubungkan resource secara otomatis. Karena itu provisioning tidak cukup memilih Plan saja: Plan tidak menentukan customer, kontrak billing, lifecycle, maupun identitas unik database.

Alur target:

```text
Pilih Customer + Plan
      |
      v
Buat Service (tanpa resource)
      |
      v
Pilih Service + Blueprint
      |
      v
Buat database + role
      |
      v
Buat aplikasi Coolify
      |
      v
Inject DATABASE_URL
      |
      v
Atur domain -> deploy -> health check -> SSL
      |
      v
Resource terhubung ke Service
```

## Keputusan arsitektur

### Model database

Implementasi awal mendukung:

- `none`: service tidak membutuhkan database.
- `shared`: service mendapatkan logical database di cluster PostgreSQL bersama.
- `dedicated`: disiapkan sebagai nilai model, tetapi provisioning resource PostgreSQL khusus dikerjakan pada fase berikutnya.

Paket murah menggunakan mode `shared`. Resource PostgreSQL tidak dibuat ulang untuk setiap customer. BillEngine hanya membuat logical database dan role di dalam resource tersebut.

Unit isolasi adalah **service**, bukan customer. Jika satu customer membeli dua service, masing-masing mendapatkan database dan role berbeda.

### Tanggung jawab Coolify dan BillEngine

Coolify bertanggung jawab atas:

- Container PostgreSQL bersama.
- Persistent volume.
- Network dan DNS internal.
- Backup resource PostgreSQL.
- Menjalankan aplikasi customer.

BillEngine bertanggung jawab atas:

- Membuat database dan role per service.
- Membuat password acak.
- Menyimpan kredensial terenkripsi.
- Membentuk dan mengirimkan `DATABASE_URL`.
- Menangani retry, lifecycle, audit, dan retensi.

## Persiapan Coolify

Pada fresh install Coolify:

1. Buat satu PostgreSQL resource, misalnya `customer-postgres-shared`.
2. Tempatkan di project `Global Services` dan environment `production`.
3. Pasang persistent volume.
4. Aktifkan backup terjadwal dan uji restore.
5. Jangan membuka port PostgreSQL ke internet.
6. Hubungkan PostgreSQL dan aplikasi customer ke **Predefined Network** Coolify.
7. Buat role khusus BillEngine, misalnya `billengine_provisioner`.
8. Berikan hanya kemampuan yang diperlukan untuk membuat role dan database.

BillEngine harus dapat menjangkau hostname internal PostgreSQL. Jika BillEngine tidak berada pada network Coolify yang sama, koneksi harus melewati jaringan privat atau endpoint TLS dengan firewall yang ketat.

## Perubahan model data

### `database_clusters`

Tabel ini menyimpan konfigurasi cluster bersama:

- `id`
- `coolify_server_id`
- `name`
- `engine`
- `host`
- `port`
- `admin_database`
- `provisioner_username`
- `credential_encrypted`
- `ssl_mode`
- `default_connection_limit`
- `is_active`
- `created_at`
- `updated_at`

Secret disimpan terenkripsi dan tidak pernah dikembalikan oleh API daftar cluster.

### `service_databases`

Tabel ini merekam alokasi database per service:

- `id`
- `service_id`
- `database_cluster_id`
- `provisioning_job_id`
- `database_name`
- `role_name`
- `password_encrypted`
- `status`
- `last_error`
- `retention_until`
- `created_at`
- `updated_at`
- `deleted_at`

Constraint yang diperlukan:

- Satu database shared aktif per service.
- Nama database unik di dalam cluster.
- Nama role unik di dalam cluster.
- Foreign key menggunakan kebijakan delete yang mencegah cluster aktif terhapus tanpa sengaja.

### Plan dan service

Tambahkan:

- `plans.database_mode`
- `services.plan_database_mode`

Nilai dari Plan disalin ke service ketika service dibuat. Dengan demikian, perubahan Plan tidak mengubah entitlement service lama secara diam-diam.

### Deployment blueprint

Tambahkan:

- `database_cluster_id`
- `database_environment_key`, default `DATABASE_URL`
- Konfigurasi dukungan shared database.

Jika service menggunakan mode `shared`, blueprint wajib menunjuk cluster database aktif.

### Provisioning job

Tambahkan:

- Status `provisioning_database`.
- Referensi `service_database_id`.
- Event dan error khusus tahap database.

## Penamaan database dan role

Gunakan `serviceNumber` yang immutable dan unik.

Contoh untuk `SVC-000123`:

```text
Database: be_svc_000123
Role:     be_svc_000123_app
Password: random 32-byte base64url
```

Nama customer tidak digunakan karena dapat berubah dan dapat mengandung karakter yang tidak aman sebagai identifier PostgreSQL.

Semua identifier harus dibentuk oleh BillEngine dan divalidasi dengan allowlist sebelum digunakan dalam SQL.

## Alur provisioning

Status job menjadi:

```text
queued
-> provisioning_database
-> creating_application
-> configuring_environment
-> configuring_domain
-> deploying
-> verifying_health
-> verifying_ssl
-> active
```

Tahap `provisioning_database` melakukan langkah berikut:

1. Mengambil advisory lock berdasarkan service dan cluster.
2. Memeriksa alokasi yang sudah tersimpan di `service_databases`.
3. Membuat nama database dan role deterministik.
4. Membuat password menggunakan cryptographically secure random generator.
5. Membuat role login tanpa hak `SUPERUSER`, `CREATEDB`, atau `CREATEROLE`.
6. Membuat database dengan role aplikasi sebagai owner.
7. Menjalankan `REVOKE CONNECT ... FROM PUBLIC` pada database customer.
8. Memberikan `CONNECT` hanya kepada role yang sesuai.
9. Mengamankan schema `public` dan memberikan akses hanya kepada owner yang sesuai.
10. Menetapkan connection limit berdasarkan konfigurasi atau plan.
11. Menyimpan password dalam bentuk terenkripsi.
12. Membentuk URL koneksi menggunakan URL encoding yang benar.

Contoh URL yang dihasilkan:

```text
postgresql://be_svc_000123_app:<password>@customer-postgres-shared:5432/be_svc_000123
```

Pada tahap `configuring_environment`, BillEngine menggabungkan environment manual dengan environment yang dikelola sistem. Nilai sistem selalu menjadi sumber kebenaran untuk key database.

`DATABASE_URL` menjadi reserved key dan tidak boleh diisi manual ketika database otomatis aktif.

## Idempotensi dan pemulihan

`CREATE DATABASE` PostgreSQL tidak berjalan di dalam transaction block. Oleh karena itu, setiap operasi harus dapat dipanggil ulang dengan aman.

Aturannya:

- Cari alokasi berdasarkan `service_id` sebelum membuat resource baru.
- Periksa keberadaan database dan role pada PostgreSQL.
- Jika role sudah ada tetapi provisioning belum selesai, tetapkan ulang password sebelum aplikasi menerima kredensial.
- Jika database sudah ada, jangan membuat database kedua.
- Retry selalu menggunakan record `service_databases` yang sama.
- Jangan merotasi password database aplikasi yang sudah aktif hanya karena deployment diulang.
- Simpan error tanpa menyertakan DSN atau password.
- Jangan otomatis menghapus role atau database parsial; retry atau rekonsiliasi harus memperbaikinya.

Tambahkan proses rekonsiliasi untuk mendeteksi:

- Record BillEngine ada tetapi database hilang.
- Database ada tetapi record BillEngine belum aktif.
- Role hilang atau tidak dapat login.
- Cluster tidak dapat dijangkau.

## Lifecycle service

Status bisnis yang direkomendasikan:

- `pending_provisioning`: service belum selesai dibuat dan belum dianggap aktif.
- `active`: database, aplikasi, domain, health check, dan SSL sudah berhasil.
- `suspended`: aplikasi dihentikan, database tetap disimpan.
- `cancelled`: akses aplikasi dihentikan dan database memasuki masa retensi.

Saat pembatalan:

1. Tandai database sebagai `pending_deletion`.
2. Tentukan `retention_until`, misalnya 30 hari.
3. Buat atau verifikasi backup terakhir.
4. Hapus database dan role setelah masa retensi melalui job terpisah.
5. Catat seluruh tindakan di audit log.

Database tidak boleh langsung dihapus pada saat service dibatalkan.

## Keamanan

- Kredensial provisioner hanya digunakan oleh server BillEngine.
- Aplikasi customer hanya menerima kredensial database miliknya.
- Secret tidak ditampilkan pada log, event job, audit metadata, atau response API.
- Password disimpan dengan AES-256-GCM melalui utilitas credential BillEngine.
- Gunakan encryption key khusus infrastruktur, misalnya `NUXT_INFRA_CREDENTIALS_KEY`, dengan fallback yang terkontrol selama migrasi.
- API cluster hanya mengembalikan metadata dan indikator bahwa secret telah dikonfigurasi.
- Uji bahwa role service A tidak dapat terhubung ke database service B.
- Batasi koneksi role berdasarkan plan.
- Jangan mengeksekusi identifier yang berasal langsung dari input pengguna.

## UI dan API

### Settings -> Database Clusters

Fitur:

- Tambah dan ubah cluster.
- Pilih koneksi Coolify.
- Test koneksi PostgreSQL.
- Aktifkan atau nonaktifkan cluster.
- Tampilkan metadata koneksi tanpa password.
- Tolak penonaktifan atau penghapusan jika masih memiliki database aktif, kecuali melalui prosedur migrasi.

### Plans

Tambahkan pilihan database mode. Untuk implementasi awal, `none` dan `shared` dapat diaktifkan, sedangkan `dedicated` ditandai sebagai fitur lanjutan.

### Provisioning Blueprint

Tambahkan:

- Select database cluster.
- Environment key, default `DATABASE_URL`.
- Validasi kompatibilitas plan dan blueprint.

### Provisioning Jobs

Tampilkan:

- Tahap pembuatan database.
- Cluster yang dipilih.
- Nama database dan role tanpa password.
- Error aman tanpa kredensial.

### Detail Service

Tampilkan:

- Nama cluster.
- Nama database.
- Nama role.
- Status database.
- Ukuran database dan jumlah koneksi jika tersedia.

Password tidak ditampilkan secara default. Rotasi password dapat ditambahkan sebagai aksi administrator terpisah.

## Backup, kapasitas, dan monitoring

- Aktifkan backup harian resource PostgreSQL dan tetapkan retention policy.
- Uji restore satu database sebelum produksi.
- Pantau `pg_database_size` per service.
- Pantau jumlah koneksi aktif per role dan cluster.
- Tambahkan peringatan kapasitas cluster sebelum disk penuh.
- Pertimbangkan PgBouncer ketika jumlah aplikasi atau koneksi meningkat.

Logical database memberikan isolasi akses, tetapi tidak memberikan batas CPU, RAM, atau storage yang keras per customer. Quota storage untuk paket shared bersifat soft limit melalui monitoring. Customer yang memerlukan isolasi resource harus menggunakan mode `dedicated`.

## Tahapan implementasi

### Fase 1 - Fondasi database

- Tambahkan migration dan Drizzle schema.
- Tambahkan repository cluster dan database service.
- Tambahkan enkripsi kredensial infrastruktur.
- Implementasikan test koneksi PostgreSQL.
- Tambahkan tabel baru ke database readiness check.

### Fase 2 - Integrasi provisioning

- Tambahkan tahap `provisioning_database`.
- Implementasikan pembuatan role dan database.
- Implementasikan retry dan recovery.
- Inject environment database ke aplikasi Coolify.
- Bersihkan secret sementara setelah provisioning selesai.

### Fase 3 - Plan, blueprint, dan UI

- Tambahkan database mode pada Plan dan snapshot service.
- Tambahkan konfigurasi database pada Blueprint.
- Buat halaman pengelolaan database cluster.
- Tampilkan progres database pada job.
- Tampilkan metadata database pada detail service.

### Fase 4 - Lifecycle dan operasional

- Tambahkan status `pending_provisioning` jika lifecycle service dipindahkan sepenuhnya ke workflow otomatis.
- Implementasikan suspend, cancel, retention, dan deletion worker.
- Tambahkan monitoring kapasitas dan koneksi.
- Implementasikan rotasi password.
- Dokumentasikan dan uji prosedur restore.

### Fase 5 - Dedicated database

- Buat resource PostgreSQL terpisah melalui API Coolify.
- Terapkan limit CPU, RAM, dan storage sesuai plan.
- Tambahkan migrasi dari shared ke dedicated.
- Tambahkan prosedur rollback migrasi.

## Strategi pengujian

### Unit test

- Normalisasi nama database dan role.
- Validasi identifier.
- Password generator.
- URL encoding DSN.
- Redaksi credential dari error dan API.
- Validasi plan dan blueprint.

### Integration test

Gunakan PostgreSQL sementara untuk memastikan:

- Database dan role berhasil dibuat.
- Role hanya dapat membuka database miliknya.
- Retry tidak membuat duplikat.
- Recovery berhasil setelah kegagalan antara pembuatan role dan database.
- Connection limit diterapkan.
- Password dapat dirotasi tanpa mengubah nama database.

### End-to-end test

- Buat service dengan plan shared.
- Jalankan provisioning dari UI.
- Pastikan aplikasi Coolify menerima `DATABASE_URL`.
- Pastikan aplikasi dapat menjalankan migration dan health check.
- Pastikan job berakhir `active`.
- Suspend lalu aktifkan kembali service.
- Batalkan service dan pastikan database masuk masa retensi, bukan langsung terhapus.

## Rencana rollout

1. Backup database BillEngine dan PostgreSQL customer.
2. Buat shared PostgreSQL di Coolify dan siapkan network internal.
3. Deploy migration BillEngine dengan provisioning database belum diaktifkan.
4. Daftarkan cluster melalui Settings dan jalankan test koneksi.
5. Aktifkan database mode pada satu plan percobaan.
6. Gunakan satu blueprint dan satu service non-kritis sebagai pilot.
7. Uji retry, suspend, cancel, backup, dan restore.
8. Pantau koneksi, ukuran database, dan log selama masa pilot.
9. Aktifkan untuk paket shared lain setelah pilot berhasil.

## Kriteria selesai

Fitur dianggap siap ketika:

- Satu provisioning menghasilkan tepat satu database dan satu role.
- Retry tidak membuat resource duplikat.
- Aplikasi otomatis menerima `DATABASE_URL` yang valid.
- Role service A tidak dapat terhubung ke database service B.
- Kredensial administrator tidak pernah dikirim ke aplikasi customer.
- Secret tidak muncul pada log, event, audit, atau response API.
- Job hanya menjadi `active` setelah database, aplikasi, domain, health check, dan SSL berhasil.
- Suspend tidak menghapus database.
- Cancel menerapkan masa retensi.
- Backup dan restore telah diuji pada service pilot.
