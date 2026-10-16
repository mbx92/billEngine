# OC Agent pada Ubuntu Server

Dokumen ini adalah runbook awal untuk OC Agent. Agent hanya mendukung Ubuntu
Server, melakukan preflight Docker/Compose, memakai enrollment token satu kali,
menyimpan identity lokal dengan mode `0600`, mengirim heartbeat dan inventory,
serta mengeksekusi operation terstruktur untuk container yang dimiliki OC.

Agent tidak berkomunikasi melalui SSH. Agent membuka koneksi HTTPS outbound ke
control plane, melakukan polling operation setiap dua detik secara default, lalu
mengirim status dan hasil melalui HTTPS. Server hanya memerlukan akses keluar ke
port `443`; tidak ada port agent yang perlu dibuka ke internet. Detail keputusan
transport ada di [ADR-001](./adr/001-agent-transport.md).

Versi ini mengeksekusi aplikasi berbasis image untuk operasi ensure, start,
stop, restart, redeploy, dan delete. Setelah enrollment, control plane otomatis
mengantrekan `gateway.ensure`; agent menjalankan satu container Traefik bernama
`oc-gateway` pada network `oc-private`, tanpa membuka dashboard administrasi.
Agent `0.8.0+` mendukung upgrade dan rollback terstruktur melalui helper systemd
root yang terpisah. Agent `0.10.0+` menambahkan backup dan restore PostgreSQL
workload milik OC serta snapshot CPU, RAM, dan root disk pada heartbeat. Dump
workload disimpan dengan permission `0600` di
`/var/lib/oc-agent/backups/<allocation-id>/` dan diverifikasi sebelum dilaporkan
berhasil.

Agent `0.11.0+` mendukung role `builder`. Pilih role **Image builder** ketika membuat enrollment
token dan pastikan `git` serta plugin `docker buildx` tersedia. Builder melaporkan capability
`image-build`, membuat workspace sementara di `/var/lib/oc-agent/builds`, lalu mendorong image dan
cache BuildKit ke registry Application. Builder murni tidak memasang Traefik dan tidak menerima
deployment workload.

Untuk scheduled backup, agent mengunggah dump langsung ke endpoint S3-compatible
dengan AWS Signature V4. Access key dan secret key dienkripsi di control plane,
hanya dikirim ketika operation aktif, dan tidak disimpan dalam payload operation
atau audit log. Restore mengunduh kembali artifact jika cache lokal node sudah
tidak tersedia. Retention menghapus object dan cache lokal melalui operation
terpisah yang tetap diaudit.

## Build

```bash
npm run agent:build:linux
sha256sum dist/oc-agent-linux-amd64
```

Gunakan `OC_AGENT_ARCH=arm64 npm run agent:build:linux` untuk server ARM.
Checksum artifact harus dicatat pada release.
Versi binary bersumber dari `agent/internal/version/VERSION`; build script juga
membuat `dist/oc-agent-manifest.json` berisi version, ukuran, dan SHA-256 yang
divalidasi control plane sebelum operation update dibuat.

Untuk menyediakan installer bagi kedua arsitektur dari control plane, jalankan:

```bash
npm run agent:build:linux:all
```

Control plane melayani installer pada `/install/oc-agent.sh` dan binary pada
`/api/infrastructure/agent/binary?arch=amd64` atau `arch=arm64`. Lokasi artifact
dapat diubah melalui `NUXT_AGENT_ARTIFACT_DIRECTORY`.

## Membuat enrollment

Sebagai administrator, panggil:

```http
POST /api/infrastructure/nodes/enrollments
Content-Type: application/json

{
  "nodeName": "staging-01",
  "environment": "staging",
  "role": "deployment",
  "expiresInMinutes": 30,
  "labels": { "region": "id-bali" }
}
```

Token pada response hanya ditampilkan satu kali. Jangan menyimpannya di Git,
shell history, atau log.

Setelah token dibuat, halaman Nodes menampilkan perintah installer:

```bash
curl -fsSL 'https://panel.example.com/install/oc-agent.sh' | \
  sudo bash -s -- --url 'https://panel.example.com'
```

Installer meminta enrollment token melalui terminal sehingga token tidak masuk
ke URL atau access log, memilih binary `amd64`/`arm64`, memverifikasi checksum,
memasang unit `systemd`, dan menjalankan agent.

Untuk percobaan pada LAN development tanpa HTTPS, opt-in harus diberikan secara
eksplisit:

Atur `NUXT_PUBLIC_AGENT_CONTROL_PLANE_URL` ke URL IP yang dapat dijangkau node,
misalnya `http://10.5.80.141:3000`. Halaman enrollment akan memakai URL ini
untuk environment `development` dan menambahkan `--allow-insecure-http` secara
otomatis.

```bash
curl -fsSL 'http://10.5.80.141:3000/install/oc-agent.sh' | \
  sudo bash -s -- --url 'http://10.5.80.141:3000' --allow-insecure-http
```

Mode ini menulis `OC_ALLOW_INSECURE_HTTP=true` pada konfigurasi agent. Token dan
machine credential tidak terenkripsi selama transit, sehingga mode ini dilarang
untuk staging dan production.

Jika Docker belum terpasang pada server development, tambahkan
`--install-docker`. Opsi ini memakai convenience script resmi Docker yang memang
ditujukan untuk testing/development:

```bash
curl -fsSL 'http://10.5.80.141:3000/install/oc-agent.sh' | \
  sudo bash -s -- --url 'http://10.5.80.141:3000' \
  --allow-insecure-http --install-docker
```

## Instalasi

Salin repository checkout atau minimal binary, installer, dan unit service ke
server. Dari root repository:

```bash
sudo bash scripts/install-oc-agent.sh dist/oc-agent-linux-amd64 deploy/agent/oc-agent.service
sudoedit /etc/oc-agent/agent.env
sudo systemctl enable --now oc-agent
sudo systemctl status oc-agent
```

Gunakan URL HTTPS control plane dan enrollment token yang baru dibuat. Setelah
enrollment berhasil, hapus `OC_ENROLLMENT_TOKEN` dari `agent.env`; identity aktif
berada di `/var/lib/oc-agent/identity.json`.

## Verifikasi

```bash
sudo journalctl -u oc-agent --since "10 minutes ago"
sudo stat -c '%a %U:%G %n' /var/lib/oc-agent/identity.json
docker version
docker compose version
```

File identity harus bermode `600` dan dimiliki `oc-agent`. Node harus muncul pada
`GET /api/infrastructure/nodes` dengan status `online`, heartbeat terbaru, dan
`gatewayStatus` bernilai `healthy`. Proses bootstrap dapat dipantau pada halaman
**Deployments** sebagai operation `gateway.ensure`.

Traefik memakai port host `80` dan `443`. Pastikan port tersebut belum digunakan
service lain. Image dapat dipin melalui `NUXT_INFRASTRUCTURE_GATEWAY_IMAGE`; nilai
default adalah `traefik:v3.7.14`. Konfigurasi route dinamis disimpan di
`/var/lib/oc-agent/gateway/dynamic` dan dibaca read-only oleh container gateway.
Healthcheck memakai endpoint `/ping` pada entrypoint internal `management:8082`;
port ini tidak dipublikasikan ke host. Karena healthcheck berjalan sebagai proses
CLI terpisah, command healthcheck membawa konfigurasi entrypoint yang sama.

Deployment template aplikasi membuat hostname `<subdomain>.<platform-domain>`.
Setelah `application.ensure` berhasil, control plane mengantrekan
`route.configure`; agent menulis konfigurasi file provider Traefik secara
atomik. Untuk resource billable, route memasang ForwardAuth ke
`NUXT_BILLING_GATE_INTERNAL_URL` dengan shared key yang dikirim hanya melalui
endpoint operation secret. Siapkan DNS wildcard `*.platform-domain` dan arahkan
Cloudflare Tunnel ke HTTP port `80` node agar hostname publik mencapai gateway.

## Membuat aplikasi berbasis image

Setelah node online, administrator dapat membuat desired state aplikasi. Setiap
mutation wajib membawa `Idempotency-Key` yang stabil untuk satu intent.

```http
POST /api/infrastructure/resources
Idempotency-Key: app:customer-42:initial
Content-Type: application/json

{
  "nodeId": "<node-uuid>",
  "name": "customer-42-app",
  "classification": "billable",
  "spec": {
    "source": { "type": "image", "reference": "ghcr.io/example/app:1.0.0" },
    "limits": { "cpuMilli": 500, "memoryBytes": "536870912" },
    "ports": [{ "containerPort": 3000, "protocol": "tcp" }],
    "environment": { "NODE_ENV": "production" },
    "volumes": [
      { "name": "data", "mountTarget": "/app/data", "kind": "persistent" }
    ]
  }
}
```

Agent mengambil operation secara outbound, membuat container dengan label
ownership OC, lalu melaporkan result dan observed revision. Lifecycle berikutnya
menggunakan `POST /api/infrastructure/resources/{id}/operations` dengan action
`application.start`, `application.stop`, `application.restart`,
`application.redeploy`, atau `application.delete`. Delete container tidak
menghapus named volume.

Konfigurasi aplikasi dapat diedit dari halaman **Native Applications**. Saat
disimpan, control plane menaikkan desired revision dan mengantrekan redeploy.
Image baru di-pull sebelum container lama diganti. Named volume dan secret
reference yang tidak diedit oleh form tetap dipertahankan.

Template PostgreSQL, MySQL, dan Redis membutuhkan agent `0.3.0` atau lebih baru.
Control plane menyimpan password dalam bentuk AES-256-GCM dan operation hanya
membawa managed secret reference. Setelah operation berstatus running, agent
mengambil secret dengan identity node, menulisnya di bawah
`/var/lib/oc-agent/secrets/{resource-id}` yang hanya dapat ditelusuri user agent,
lalu memasang file tersebut read-only ke `/run/secrets` di container. Docker
environment hanya berisi pointer `*_FILE`, bukan nilai password.

Promosi PostgreSQL resource menjadi native database cluster membutuhkan agent
`0.4.0` atau lebih baru. Action `database.cluster.activate` hanya melakukan
preflight terstruktur pada container yang memiliki label ownership sesuai:
agent memverifikasi pemilik container lalu menjalankan `pg_isready` dengan nama
database dan role yang tervalidasi. Tidak ada arbitrary shell atau koneksi
PostgreSQL langsung dari control plane.

Provisioning database per service membutuhkan agent `0.5.0` atau lebih baru.
Pull image dari private registry yang dikelola melalui Applications membutuhkan agent `0.6.0`
atau lebih baru.
Action `database.service.ensure` membuat database dan role secara idempotent
melalui `psql` stdin di container PostgreSQL. Password hanya tersedia sebagai
operation secret selama operation aktif, tidak masuk payload, command arguments,
result, atau audit log. Aplikasi dan PostgreSQL menggunakan Docker network
private `oc-private`; MVP membatasi keduanya pada node yang sama.

## Upgrade agent

Node yang masih menggunakan agent sebelum `0.8.0` harus menjalankan ulang
installer satu kali. Langkah bootstrap ini memasang `oc-agent-update.path`,
`oc-agent-update.service`, dan helper root tanpa mengganti identity node:

```bash
curl -fsSL 'http://10.5.80.141:3000/install/oc-agent.sh' | \
  sudo bash -s -- --url 'http://10.5.80.141:3000' --allow-insecure-http
```

Setelah bootstrap, versi berikutnya dapat dipasang dari tombol **Update agent**
pada halaman **Infrastructure → Nodes**. Alurnya:

1. control plane menghitung SHA-256 artifact sesuai arsitektur node;
2. agent mengunduh artifact melalui koneksi control plane yang sudah
   terautentikasi, memverifikasi ukuran, checksum, arsitektur, dan output
   `--version`;
3. agent menaruh binary di `/var/lib/oc-agent/update` dan membuat request untuk
   helper systemd;
4. helper root menyimpan binary aktif sebagai `/usr/local/bin/oc-agent.previous`,
   mengganti binary secara atomik, dan menyalakan ulang service; dan
5. jika versi baru tidak mengirim heartbeat sehat dalam 75 detik, helper
   otomatis mengembalikan binary sebelumnya.

Rollback manual tersedia setelah setidaknya satu upgrade remote berhasil.
Operation upgrade/rollback tetap `running` sampai agent hasil update melaporkan
hasilnya. Pantau hasil pada halaman **Infrastructure → Deployments**.

Sebelum mengantrekan update, artifact kedua arsitektur harus tersedia:

```bash
npm run agent:build:linux:all
```

Untuk deployment container, stage `agent-builder` pada `Dockerfile` sudah
memasukkan kedua artifact tersebut ke direktori `dist` image control plane.

## Revocation

Panggil `POST /api/infrastructure/nodes/{id}/revoke`. Seluruh identity aktif node
dicabut dalam satu transaksi. Agent yang sudah dicabut akan menerima HTTP 401
pada heartbeat dan harus di-enroll ulang menggunakan token baru.
