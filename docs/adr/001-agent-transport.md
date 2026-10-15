# ADR-001: Transport OC Agent

- Status: Accepted untuk MVP staging
- Tanggal: 2026-10-15
- Scope: komunikasi control plane dan OC Agent pada Ubuntu Server

## Keputusan

OC Agent menggunakan HTTPS outbound dengan short polling untuk MVP. Agent tidak
menerima koneksi dari control plane dan tidak menggunakan SSH sebagai protokol
aplikasi.

Alur komunikasi:

1. Administrator membuat one-time enrollment token di control plane.
2. Agent mengirim token tersebut melalui `POST /api/infrastructure/agent/enroll`.
3. Control plane mengembalikan machine credential. Agent menyimpannya lokal
   dengan permission `0600`; database hanya menyimpan hash credential.
4. Agent mengirim heartbeat dan inventory berkala memakai bearer credential.
5. Agent meminta operation berikutnya melalui HTTPS setiap dua detik secara
   default.
6. Agent memvalidasi action terhadap allowlist, menjalankannya secara lokal, dan
   mengirim status `running`, `succeeded`, atau `failed` ke control plane.

HTTP tanpa TLS hanya diizinkan untuk loopback pada development. Staging dan
production wajib memakai sertifikat HTTPS yang valid. Ubuntu Server cukup
membuka trafik keluar ke control plane pada port `443`; endpoint agent atau SSH
tidak perlu diekspos ke aplikasi.

## Mengapa bukan SSH

SSH cocok untuk administrasi manusia dan recovery, tetapi bukan command channel
platform. Menggunakan SSH akan memerlukan private key host pada control plane,
membuka inbound port pada setiap node, dan memperbesar ruang lingkup command
menjadi shell umum. Model outbound HTTPS mempertahankan command terstruktur,
audit per operation, retry idempotent, revocation, dan node yang dapat berada di
balik NAT atau firewall.

SSH tetap boleh dipakai operator untuk instalasi awal, diagnosis, dan recovery.
Aktivitas tersebut berada di luar protokol agent dan tidak boleh dipanggil oleh
API customer atau operation queue.

## Keamanan dan batas MVP

- Credential agent bersifat bearer secret, tidak pernah dikirim melalui query
  string, dan tidak dicatat pada log.
- Enrollment token sekali pakai, memiliki expiry, dan disimpan sebagai hash.
- Identity dapat dicabut dari control plane.
- Agent menolak URL non-HTTPS selain host loopback.
- Payload hanya dapat menjalankan action yang dikenal; arbitrary shell command
  tidak tersedia.
- Operation memiliki expiry, idempotency key, correlation ID, revision, dan
  batas retry.

Bearer credential adalah mekanisme staging MVP. Sebelum production, machine
identity harus ditingkatkan ke mTLS atau credential berumur pendek dengan rotasi
otomatis dan replay protection yang lebih kuat.

## Konsekuensi

Short polling sederhana untuk dioperasikan dan dapat melewati NAT/firewall,
tetapi menghasilkan request berkala dan latensi sampai interval polling. Jika
jumlah node bertambah besar, transport dapat dikembangkan ke long polling atau
stream terautentikasi tanpa mengubah model operation dan desired/observed state.
