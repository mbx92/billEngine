export type OperationErrorStage =
  | 'agent'
  | 'database'
  | 'image'
  | 'build'
  | 'container'
  | 'network'
  | 'secret'
  | 'route'
  | 'backup'
  | 'unknown'

export type OperationErrorDecision =
  | 'retry'
  | 'retry_after_check'
  | 'fix_configuration'
  | 'restore_dependency'
  | 'manual_investigation'

export interface NormalizedOperationError {
  code: string
  stage: OperationErrorStage
  title: string
  summary: string
  decision: OperationErrorDecision
  retryable: boolean
  recommendedAction: string
  technicalDetail: string | null
}

interface OperationErrorInput {
  action: string
  status: string
  errorCode: string | null
  errorMessage: string | null
  attemptCount: number
  maxAttempts: number
}

interface ErrorDescriptor {
  stage: OperationErrorStage
  title: string
  summary: string
  decision: OperationErrorDecision
  retryable: boolean
  recommendedAction: string
}

const exactErrors: Record<string, ErrorDescriptor> = {
  force_stopped: {
    stage: 'agent',
    title: 'Operation dihentikan paksa',
    summary: 'Administrator menghentikan operation sebelum tahap ini selesai.',
    decision: 'manual_investigation',
    retryable: false,
    recommendedAction: 'Periksa kemungkinan perubahan parsial pada node sebelum membuat deployment baru.',
  },
  operation_timeout: {
    stage: 'agent',
    title: 'Operation melewati batas waktu',
    summary: 'Agent tidak menyelesaikan tahap ini sebelum deadline.',
    decision: 'retry_after_check',
    retryable: true,
    recommendedAction: 'Pastikan agent dan Docker responsif, lalu jalankan deployment ulang.',
  },
  database_inspect_timeout: {
    stage: 'database',
    title: 'Pemeriksaan container database timeout',
    summary: 'Docker tidak merespons saat agent memeriksa container PostgreSQL.',
    decision: 'restore_dependency',
    retryable: true,
    recommendedAction: 'Periksa status Docker dan container PostgreSQL pada node, lalu coba ulang.',
  },
  database_network_timeout: {
    stage: 'database',
    title: 'Koneksi network database timeout',
    summary: 'Agent tidak dapat menyiapkan atau menghubungkan network Docker untuk PostgreSQL.',
    decision: 'restore_dependency',
    retryable: true,
    recommendedAction: 'Periksa Docker network oc-private dan kesehatan Docker daemon, lalu coba ulang.',
  },
  database_network_failed: {
    stage: 'database',
    title: 'Koneksi network database gagal',
    summary: 'Container PostgreSQL gagal dihubungkan ke network aplikasi.',
    decision: 'restore_dependency',
    retryable: true,
    recommendedAction: 'Periksa konflik network/alias Docker pada node, lalu coba ulang.',
  },
  database_provision_timeout: {
    stage: 'database',
    title: 'Provisioning PostgreSQL timeout',
    summary: 'Pembuatan role atau database tidak selesai dalam dua menit.',
    decision: 'retry_after_check',
    retryable: true,
    recommendedAction: 'Periksa log dan lock PostgreSQL, pastikan cluster sehat, lalu coba ulang.',
  },
  database_provision_failed: {
    stage: 'database',
    title: 'Provisioning PostgreSQL gagal',
    summary: 'PostgreSQL menolak atau gagal menjalankan perintah pembuatan database.',
    decision: 'fix_configuration',
    retryable: true,
    recommendedAction: 'Baca detail teknis, periksa kredensial provisioner dan log PostgreSQL, lalu coba ulang.',
  },
  postgres_preflight_failed: {
    stage: 'database',
    title: 'PostgreSQL belum siap',
    summary: 'Pemeriksaan kesiapan cluster PostgreSQL gagal.',
    decision: 'restore_dependency',
    retryable: true,
    recommendedAction: 'Pastikan container PostgreSQL running dan menerima koneksi, lalu coba aktivasi kembali.',
  },
  local_image_missing: {
    stage: 'image',
    title: 'Image lokal tidak ditemukan',
    summary: 'Image yang dipilih tidak lagi tersedia pada node target.',
    decision: 'fix_configuration',
    retryable: false,
    recommendedAction: 'Build ulang image atau pilih image yang masih tersedia pada node sebelum deploy ulang.',
  },
  image_pull_failed: {
    stage: 'image',
    title: 'Docker image gagal diunduh',
    summary: 'Node tidak dapat menarik image dari registry.',
    decision: 'restore_dependency',
    retryable: true,
    recommendedAction: 'Periksa koneksi registry, nama/tag image, dan kredensial registry, lalu coba ulang.',
  },
  registry_auth_failed: {
    stage: 'image',
    title: 'Autentikasi registry gagal',
    summary: 'Kredensial registry tidak dapat digunakan oleh agent.',
    decision: 'fix_configuration',
    retryable: false,
    recommendedAction: 'Perbarui kredensial registry sebelum mencoba deployment kembali.',
  },
  secret_delivery_failed: {
    stage: 'secret',
    title: 'Secret gagal dikirim ke agent',
    summary: 'Agent tidak dapat mengambil secret yang diperlukan operation.',
    decision: 'restore_dependency',
    retryable: true,
    recommendedAction: 'Periksa koneksi agent ke control plane, lalu coba ulang.',
  },
  secret_unavailable: {
    stage: 'secret',
    title: 'Secret tidak tersedia',
    summary: 'Secret wajib tidak ditemukan atau nilainya tidak valid.',
    decision: 'fix_configuration',
    retryable: false,
    recommendedAction: 'Lengkapi atau perbarui secret resource sebelum mencoba ulang.',
  },
  secret_write_failed: {
    stage: 'secret',
    title: 'Secret gagal ditulis pada node',
    summary: 'Agent gagal membuat file atau environment secret.',
    decision: 'restore_dependency',
    retryable: true,
    recommendedAction: 'Periksa permission dan kapasitas disk direktori secret agent, lalu coba ulang.',
  },
  resource_not_found: {
    stage: 'container',
    title: 'Resource dependency tidak ditemukan',
    summary: 'Container yang dibutuhkan operation tidak ditemukan pada node.',
    decision: 'restore_dependency',
    retryable: false,
    recommendedAction: 'Pulihkan atau deploy ulang resource dependency sebelum mengulang operation.',
  },
  lifecycle_inspect_failed: {
    stage: 'container',
    title: 'Status container gagal diperiksa',
    summary: 'Agent tidak dapat memeriksa container melalui Docker daemon.',
    decision: 'restore_dependency',
    retryable: true,
    recommendedAction: 'Periksa Docker daemon dan permission socket pada node, lalu coba ulang.',
  },
  resource_ownership_mismatch: {
    stage: 'container',
    title: 'Kepemilikan container tidak cocok',
    summary:
      'Container dengan nama target dimiliki oleh resource lain atau tidak memiliki label yang sesuai.',
    decision: 'manual_investigation',
    retryable: false,
    recommendedAction:
      'Periksa label container pada node sebelum menghapus atau mengganti container tersebut.',
  },
  ownership_conflict: {
    stage: 'container',
    title: 'Konflik kepemilikan container',
    summary: 'Nama container sudah digunakan oleh container yang tidak dikelola resource ini.',
    decision: 'manual_investigation',
    retryable: false,
    recommendedAction: 'Periksa container yang konflik pada node; jangan hapus sebelum memastikan pemiliknya.',
  },
  container_create_failed: {
    stage: 'container',
    title: 'Container aplikasi gagal dibuat',
    summary: 'Docker menolak konfigurasi pembuatan container aplikasi.',
    decision: 'fix_configuration',
    retryable: false,
    recommendedAction: 'Periksa detail teknis, port, volume, environment, dan limit resource aplikasi.',
  },
  container_start_failed: {
    stage: 'container',
    title: 'Container aplikasi gagal dimulai',
    summary: 'Container berhasil dibuat tetapi Docker tidak dapat menjalankannya.',
    decision: 'retry_after_check',
    retryable: true,
    recommendedAction: 'Periksa log container dan konflik port/volume, lalu coba ulang.',
  },
  build_operation_expired: {
    stage: 'build',
    title: 'Build kedaluwarsa sebelum dijalankan',
    summary: 'Builder node tidak mengambil tugas build sebelum deadline.',
    decision: 'restore_dependency',
    retryable: true,
    recommendedAction: 'Pastikan builder node online dan memiliki capability image-build, lalu build ulang.',
  },
  image_build_failed: {
    stage: 'build',
    title: 'Build image gagal',
    summary: 'BuildKit gagal menghasilkan image aplikasi.',
    decision: 'fix_configuration',
    retryable: false,
    recommendedAction: 'Periksa log build, Dockerfile, dan dependency source sebelum build ulang.',
  },
  route_write_failed: {
    stage: 'route',
    title: 'Konfigurasi route gagal ditulis',
    summary: 'Agent gagal menyimpan konfigurasi routing aplikasi.',
    decision: 'restore_dependency',
    retryable: true,
    recommendedAction: 'Periksa permission konfigurasi gateway dan kapasitas disk, lalu coba ulang.',
  },
  gateway_not_ready: {
    stage: 'route',
    title: 'Gateway belum siap',
    summary: 'Traefik belum menerima konfigurasi route aplikasi.',
    decision: 'restore_dependency',
    retryable: true,
    recommendedAction: 'Pulihkan kesehatan gateway Traefik, lalu jalankan konfigurasi route kembali.',
  },
  invalid_payload: {
    stage: 'agent',
    title: 'Payload operation tidak valid',
    summary: 'Control plane mengirim data yang tidak dapat diproses agent.',
    decision: 'fix_configuration',
    retryable: false,
    recommendedAction: 'Periksa versi control plane/agent dan konfigurasi deployment sebelum mencoba ulang.',
  },
  invalid_spec: {
    stage: 'agent',
    title: 'Spesifikasi resource tidak valid',
    summary: 'Agent menolak spesifikasi deployment yang diterima.',
    decision: 'fix_configuration',
    retryable: false,
    recommendedAction: 'Perbaiki konfigurasi resource sesuai detail teknis, lalu buat deployment baru.',
  },
  unsupported: {
    stage: 'agent',
    title: 'Operation tidak didukung agent',
    summary: 'Versi atau capability agent tidak mendukung operation ini.',
    decision: 'fix_configuration',
    retryable: false,
    recommendedAction: 'Upgrade agent atau ubah konfigurasi agar sesuai capability node.',
  },
}

const prefixDescriptors: Array<[string, ErrorDescriptor]> = [
  [
    'database_backup_',
    {
      stage: 'backup',
      title: 'Operasi backup database gagal',
      summary: 'Agent gagal memproses artifact backup database.',
      decision: 'retry_after_check',
      retryable: true,
      recommendedAction: 'Periksa storage, ruang disk, dan detail teknis sebelum mencoba ulang.',
    },
  ],
  [
    'database_restore_',
    {
      stage: 'backup',
      title: 'Restore database gagal',
      summary: 'Agent gagal memulihkan database dari artifact backup.',
      decision: 'manual_investigation',
      retryable: false,
      recommendedAction: 'Validasi artifact dan checksum backup sebelum menjalankan restore kembali.',
    },
  ],
  [
    'gateway_',
    {
      stage: 'route',
      title: 'Gateway gagal diproses',
      summary: 'Operation gateway tidak dapat diselesaikan oleh agent.',
      decision: 'restore_dependency',
      retryable: true,
      recommendedAction: 'Periksa container dan log Traefik pada node, lalu coba ulang.',
    },
  ],
  [
    'route_',
    {
      stage: 'route',
      title: 'Konfigurasi route gagal',
      summary: 'Route aplikasi tidak dapat diterapkan pada gateway.',
      decision: 'retry_after_check',
      retryable: true,
      recommendedAction: 'Periksa gateway dan konfigurasi hostname, lalu coba ulang.',
    },
  ],
  [
    'container_',
    {
      stage: 'container',
      title: 'Operasi container gagal',
      summary: 'Docker tidak dapat menyelesaikan operation container.',
      decision: 'retry_after_check',
      retryable: true,
      recommendedAction: 'Periksa kondisi Docker dan detail teknis operation sebelum mencoba ulang.',
    },
  ],
  [
    'image_',
    {
      stage: 'image',
      title: 'Operasi image gagal',
      summary: 'Docker tidak dapat menyelesaikan operation image.',
      decision: 'retry_after_check',
      retryable: true,
      recommendedAction: 'Periksa image dan Docker daemon pada node sebelum mencoba ulang.',
    },
  ],
  [
    'repository_',
    {
      stage: 'build',
      title: 'Source repository gagal diproses',
      summary: 'Builder tidak dapat mengambil atau memilih revision source.',
      decision: 'fix_configuration',
      retryable: false,
      recommendedAction: 'Periksa URL repository, kredensial, dan revision sebelum build ulang.',
    },
  ],
]

export function normalizeOperationError(
  input: OperationErrorInput,
): NormalizedOperationError | null {
  if (!['failed', 'expired'].includes(input.status) && !input.errorCode && !input.errorMessage) {
    return null
  }

  const code = input.errorCode?.trim().toLowerCase() || fallbackCode(input.status)
  const descriptor = exactErrors[code] ?? prefixDescriptor(code) ?? fallbackDescriptor(input.action)
  const attemptsAvailable = input.attemptCount < input.maxAttempts
  const retryable = descriptor.retryable && attemptsAvailable

  return {
    code,
    stage: descriptor.stage === 'agent' ? stageFromAction(input.action) : descriptor.stage,
    title: descriptor.title,
    summary: descriptor.summary,
    decision: retryable ? descriptor.decision : nonRetryDecision(descriptor.decision),
    retryable,
    recommendedAction:
      descriptor.retryable && !attemptsAvailable
        ? 'Batas percobaan operation telah habis. Periksa detail teknis dan buat deployment baru setelah penyebab diperbaiki.'
        : descriptor.recommendedAction,
    technicalDetail: input.errorMessage?.trim() || null,
  }
}

function prefixDescriptor(code: string) {
  return prefixDescriptors.find(([prefix]) => code.startsWith(prefix))?.[1]
}

function fallbackCode(status: string) {
  return status === 'expired' ? 'operation_expired' : 'deployment_error'
}

function stageFromAction(action: string): OperationErrorStage {
  if (action.startsWith('database.backup')) return 'backup'
  if (action.startsWith('database.')) return 'database'
  if (action === 'application.build') return 'build'
  if (action.startsWith('application.') || action === 'container.exec') return 'container'
  if (action.startsWith('route.') || action.startsWith('gateway.')) return 'route'
  if (action.startsWith('image.')) return 'image'
  if (action.startsWith('agent.')) return 'agent'
  return 'unknown'
}

function fallbackDescriptor(action: string): ErrorDescriptor {
  return {
    stage: stageFromAction(action),
    title: 'Deployment gagal',
    summary: 'Operation tidak dapat diselesaikan.',
    decision: 'manual_investigation',
    retryable: false,
    recommendedAction: 'Periksa detail teknis dan log agent sebelum menentukan apakah aman mencoba ulang.',
  }
}

function nonRetryDecision(decision: OperationErrorDecision): OperationErrorDecision {
  return decision === 'retry' || decision === 'retry_after_check'
    ? 'manual_investigation'
    : decision
}
