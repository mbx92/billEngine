import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/infrastructure.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/forms.dart';

class ApplicationsScreen extends StatefulWidget {
  const ApplicationsScreen({super.key});

  @override
  State<ApplicationsScreen> createState() => _ApplicationsScreenState();
}

class _ApplicationsScreenState extends State<ApplicationsScreen> {
  late final ItemController<ApplicationCatalog> _catalog;
  final _action = ActionController();
  String? _busyApplicationId;

  @override
  void initState() {
    super.initState();
    _catalog = ItemController<ApplicationCatalog>(
      fetch: context.read<ApiService>().applicationCatalog,
    );
    _catalog.load();
  }

  @override
  void dispose() {
    _catalog.dispose();
    _action.dispose();
    super.dispose();
  }

  Future<void> _createRegistry(ApplicationCatalog catalog) async {
    final picked = await showModalBottomSheet<Object>(
      context: context,
      backgroundColor: context.colors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => _RegistryPicker(registries: catalog.registries),
    );
    if (picked == null || !mounted) return;
    final existing = picked is Registry ? picked : null;

    final values = await showRecordForm(
      context,
      title: existing == null ? 'Daftarkan registry' : 'Perbarui registry ${existing.host}',
      description: existing == null
          ? 'Credential dipakai builder untuk push image ke container registry.'
          : 'Token baru akan menggantikan token lama.',
      submitLabel: 'Simpan',
      fields: [
        FieldSpec.text('name', 'Nama', initial: existing?.name, required: true),
        if (existing == null)
          FieldSpec.text('host', 'Host', hint: 'ghcr.io', initial: 'ghcr.io', required: true),
        FieldSpec.text('username', 'Username', initial: existing?.username, required: true),
        FieldSpec.password('token', 'Token / password', required: true),
      ],
    );
    if (values == null || !mounted) return;

    final ok = await _action.run(() async {
      final api = context.read<ApiService>();
      if (existing == null) {
        await api.createRegistry(values);
      } else {
        await api.updateRegistry(existing.id, values);
      }
    });
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Registry tersimpan.');
      await _catalog.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Registry gagal disimpan.', error: true);
    }
  }

  Future<void> _createApplication(ApplicationCatalog catalog) async {
    final builders = catalog.localBuilders;
    final registries = catalog.registries.where((registry) => registry.isActive).toList();

    final values = await showRecordForm(
      context,
      title: 'Application baru',
      description:
          'Mode Local menyimpan image di server hybrid, mode Registry memakai container registry.',
      submitLabel: 'Buat application',
      fields: [
        FieldSpec.text('name', 'Nama aplikasi', required: true),
        FieldSpec.text('slug', 'Slug', hint: 'lowercase, contoh: billing-web', required: true),
        FieldSpec.text('repositoryUrl', 'Repository URL', hint: 'https://github.com/…', required: true),
        FieldSpec.text('defaultBranch', 'Branch default', initial: 'main', required: true),
        FieldSpec.text('dockerfilePath', 'Dockerfile', initial: 'Dockerfile'),
        FieldSpec.text('buildContext', 'Build context', initial: '.'),
        FieldSpec.select(
          'imageStorage',
          'Penyimpanan image',
          options: const {'local': 'Local server (hybrid)', 'registry': 'Container registry'},
          initial: 'local',
          required: true,
        ),
        if (builders.isNotEmpty)
          FieldSpec.select(
            'buildNodeId',
            'Build node',
            options: {
              for (final builder in builders)
                builder.id: '${builder.name}${builder.ready ? '' : ' · belum siap'}',
            },
          ),
        FieldSpec.text(
          'imageRepository',
          'Image repository',
          hint: 'ghcr.io/owner/image — wajib untuk mode registry',
        ),
        if (registries.isNotEmpty)
          FieldSpec.select(
            'registryId',
            'Registry',
            options: {
              for (final registry in registries)
                registry.id: '${registry.name} · ${registry.host}',
            },
          ),
        FieldSpec.select(
          'autoDeploy',
          'Auto rollout',
          options: const {'false': 'Manual', 'true': 'Otomatis setelah build'},
          initial: 'false',
        ),
      ],
    );
    if (values == null || !mounted) return;

    final imageStorage = values['imageStorage']?.toString() ?? 'local';
    final payload = <String, dynamic>{
      'name': values['name'],
      'slug': values['slug'],
      'repositoryUrl': values['repositoryUrl'],
      'defaultBranch': values['defaultBranch'] ?? 'main',
      'dockerfilePath': values['dockerfilePath'] ?? 'Dockerfile',
      'buildContext': values['buildContext'] ?? '.',
      'imageStorage': imageStorage,
      'autoDeploy': values['autoDeploy'] == 'true',
      if (imageStorage == 'local' && values['buildNodeId'] != null)
        'buildNodeId': values['buildNodeId'],
      if (imageStorage == 'registry' && values['imageRepository'] != null)
        'imageRepository': values['imageRepository'],
      if (imageStorage == 'registry' && values['registryId'] != null)
        'registryId': values['registryId'],
    };

    final ok = await _action.run(
      () => context.read<ApiService>().createApplication(payload),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Application ${values['name']} dibuat.');
      await _catalog.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Application gagal dibuat.', error: true);
    }
  }

  Future<void> _queueBuild(DeployableApplication application) async {
    setState(() => _busyApplicationId = application.id);
    try {
      final result = await context.read<ApiService>().queueBuild(application.id);
      if (!mounted) return;
      final build = asMapPreview(result);
      showAppSnack(context, 'Build ${build ?? application.slug} masuk antrean.');
      await _catalog.refresh();
    } catch (error) {
      if (mounted) showAppSnack(context, '$error', error: true);
    } finally {
      if (mounted) setState(() => _busyApplicationId = null);
    }
  }

  Future<void> _recordRelease(DeployableApplication application) async {
    final values = await showRecordForm(
      context,
      title: 'Catat release',
      description: 'Release dipakai untuk rollout image yang sudah dibuild di pipeline eksternal.',
      submitLabel: 'Simpan release',
      fields: [
        FieldSpec.text('version', 'Versi', hint: '1.4.0', required: true),
        FieldSpec.text('commitSha', 'Commit SHA', hint: 'minimal 7 karakter', required: true),
        FieldSpec.text('imageDigest', 'Image digest', hint: 'sha256:…', required: true),
      ],
    );
    if (values == null || !mounted) return;

    final ok = await _action.run(
      () => context.read<ApiService>().createRelease(application.id, values),
    );
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Release ${values['version']} dicatat.');
      await _catalog.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Release gagal dicatat.', error: true);
    }
  }

  Future<void> _rollout(ApplicationCatalog catalog, ApplicationRelease release) async {
    final candidates = catalog.resources
        .where(
          (resource) =>
              release.localNodeId == null || resource.nodeId == release.localNodeId,
        )
        .toList(growable: false);
    if (candidates.isEmpty) {
      showAppSnack(context, 'Belum ada resource untuk release ini.', error: true);
      return;
    }

    final result = await showModalBottomSheet<({List<String> ids, bool trackLatest})>(
      context: context,
      isScrollControlled: true,
      backgroundColor: context.colors.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(16)),
      ),
      builder: (context) => _RolloutSheet(release: release, resources: candidates),
    );
    if (result == null || !mounted) return;

    final ok = await _action.run(() async {
      await context.read<ApiService>().rolloutRelease(
        release.id,
        resourceIds: result.ids,
        trackLatest: result.trackLatest,
      );
    });
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, 'Redeploy release ${release.version} masuk antrean.');
      await _catalog.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Rollout gagal diantrekan.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AdminScaffold(
      child: ChangeNotifierProvider<ItemController<ApplicationCatalog>>.value(
        value: _catalog,
        child: Consumer<ItemController<ApplicationCatalog>>(
          builder: (context, controller, _) {
            final catalog = controller.value ?? ApplicationCatalog.empty;
            final applications = catalog.applications;
            final readyBuilder = catalog.localBuilders.any((builder) => builder.ready);

            return ListView(
              children: [
                SectionHeader(
                  eyebrow: 'Infrastructure',
                  title: 'Applications',
                  subtitle:
                      'Build image dan catat release. Rollout menargetkan resource pada node yang sama.',
                  trailing: StatusPill(
                    label: '${applications.length} app',
                    tone: 'muted',
                    dense: true,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton.icon(
                        onPressed: _action.isPending
                            ? null
                            : () => _createRegistry(catalog),
                        icon: const Icon(Icons.shield_outlined, size: 16),
                        label: const Text('Registry'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: FilledButton.icon(
                        onPressed: _action.isPending
                            ? null
                            : () => _createApplication(catalog),
                        icon: const Icon(Icons.add, size: 16),
                        label: const Text('Application'),
                      ),
                    ),
                  ],
                ),
                if (!readyBuilder) ...[
                  const SizedBox(height: 10),
                  AppSurface(
                    highlight: true,
                    child: Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Icon(Icons.info_outline, size: 16, color: colors.warning),
                        const SizedBox(width: 8),
                        Expanded(
                          child: Text(
                            'Belum ada builder node yang siap. Tambahkan server role hybrid dengan '
                            'Git dan Docker Buildx untuk build image lokal.',
                            style: TextStyle(fontSize: 11.5, height: 1.45, color: colors.muted),
                          ),
                        ),
                      ],
                    ),
                  ),
                ],
                const SizedBox(height: 14),
                if (controller.isLoading && !controller.isLoaded)
                  const LoadingList(count: 3, height: 170)
                else if (controller.error != null && applications.isEmpty)
                  AppCard(
                    child: ErrorState(message: controller.error!, onRetry: controller.refresh),
                  )
                else if (applications.isEmpty)
                  const AppCard(
                    child: EmptyState(
                      title: 'Belum ada application',
                      description:
                          'Daftarkan repository, pilih mode Local, lalu pilih server hybrid untuk build.',
                      icon: Icons.apps_outlined,
                    ),
                  )
                else
                  for (final application in applications) ...[
                    _ApplicationCard(
                      application: application,
                      catalog: catalog,
                      busy: _busyApplicationId == application.id || _action.isPending,
                      onBuild: _queueBuild,
                      onRelease: _recordRelease,
                      onRollout: (release) => _rollout(catalog, release),
                    ),
                    const SizedBox(height: 10),
                  ],
              ],
            );
          },
        ),
      ),
    );
  }
}

String? asMapPreview(Map<String, dynamic> result) {
  final build = result['build'];
  if (build is Map) return build['version']?.toString();
  return null;
}

class _ApplicationCard extends StatelessWidget {
  const _ApplicationCard({
    required this.application,
    required this.catalog,
    required this.busy,
    required this.onBuild,
    required this.onRelease,
    required this.onRollout,
  });

  final DeployableApplication application;
  final ApplicationCatalog catalog;
  final bool busy;
  final Future<void> Function(DeployableApplication) onBuild;
  final Future<void> Function(DeployableApplication) onRelease;
  final Future<void> Function(ApplicationRelease) onRollout;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final releases = catalog.releasesFor(application.id).take(3).toList(growable: false);
    final builds = catalog.buildsFor(application.id).take(3).toList(growable: false);
    final activeBuild = builds.any(
      (build) => build.status == 'queued' || build.status == 'running',
    );
    final builderReady = application.usesLocalImage
        ? catalog.localBuilders.any(
            (builder) => builder.id == application.buildNodeId && builder.ready,
          )
        : catalog.builderAvailable;
    final storageLabel = application.usesLocalImage
        ? 'Local · ${catalog.localBuilders.where((b) => b.id == application.buildNodeId).map((b) => b.name).firstOrNull ?? 'server'}'
        : catalog.registries
                  .where((registry) => registry.id == application.registryId)
                  .map((registry) => registry.name)
                  .firstOrNull ??
              'Registry';

    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.all(14),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 34,
                      height: 34,
                      alignment: Alignment.center,
                      decoration: BoxDecoration(
                        color: colors.brand.withValues(alpha: 0.12),
                        borderRadius: BorderRadius.circular(9),
                      ),
                      child: Icon(
                        Icons.apps_outlined,
                        size: 17,
                        color: colors.brand,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            application.name,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(
                              fontSize: 14,
                              fontWeight: FontWeight.w600,
                              color: colors.ink,
                            ),
                          ),
                          Text(
                            application.repositoryUrl,
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                            style: TextStyle(fontSize: 10.5, color: colors.brand),
                          ),
                        ],
                      ),
                    ),
                    StatusPill(
                      label: application.autoDeploy ? 'Auto rollout' : 'Manual',
                      tone: application.autoDeploy ? 'success' : 'muted',
                      dense: true,
                    ),
                  ],
                ),
                const SizedBox(height: 10),
                Wrap(
                  spacing: 6,
                  runSpacing: 6,
                  children: [
                    StatusPill(label: storageLabel, tone: 'muted', dense: true),
                    StatusPill(
                      label: '${application.defaultBranch} · ${application.dockerfilePath}',
                      tone: 'muted',
                      dense: true,
                    ),
                  ],
                ),
                if (application.imageRepository.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 6),
                    child: Text(
                      application.imageRepository,
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: TextStyle(
                        fontSize: 10.5,
                        fontFamily: 'monospace',
                        color: colors.muted,
                      ),
                    ),
                  ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: OutlinedButton(
                        onPressed: busy || activeBuild || !builderReady
                            ? null
                            : () => onBuild(application),
                        child: Text(activeBuild ? 'Build berjalan…' : 'Build image'),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: FilledButton(
                        onPressed: busy ? null : () => onRelease(application),
                        child: const Text('Catat release'),
                      ),
                    ),
                  ],
                ),
              ],
            ),
          ),
          if (releases.isNotEmpty || builds.isNotEmpty)
            Divider(height: 1, color: colors.line),
          if (releases.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 10, 14, 4),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'RELEASES',
                    style: TextStyle(
                      fontSize: 9.5,
                      letterSpacing: 1,
                      fontWeight: FontWeight.w700,
                      color: colors.muted,
                    ),
                  ),
                  for (final release in releases)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  'v${release.version} · ${release.commitSha.substring(0, release.commitSha.length.clamp(0, 8))}',
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    fontWeight: FontWeight.w600,
                                    color: colors.ink,
                                  ),
                                ),
                                Text(
                                  Fmt.relativeTime(release.createdAt),
                                  style: TextStyle(fontSize: 10, color: colors.muted),
                                ),
                              ],
                            ),
                          ),
                          TextButton(
                            onPressed: busy ? null : () => onRollout(release),
                            child: const Text('Rollout', style: TextStyle(fontSize: 12)),
                          ),
                        ],
                      ),
                    ),
                ],
              ),
            ),
          if (builds.isNotEmpty)
            Padding(
              padding: const EdgeInsets.fromLTRB(14, 6, 14, 12),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  Text(
                    'BUILDS',
                    style: TextStyle(
                      fontSize: 9.5,
                      letterSpacing: 1,
                      fontWeight: FontWeight.w700,
                      color: colors.muted,
                    ),
                  ),
                  for (final build in builds)
                    Padding(
                      padding: const EdgeInsets.only(top: 6),
                      child: Row(
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${build.version} · ${build.nodeName}',
                                  maxLines: 1,
                                  overflow: TextOverflow.ellipsis,
                                  style: TextStyle(fontSize: 11.5, color: colors.ink),
                                ),
                                if (build.errorMessage != null)
                                  Text(
                                    build.errorMessage!,
                                    maxLines: 2,
                                    overflow: TextOverflow.ellipsis,
                                    style: TextStyle(fontSize: 10.5, color: colors.danger),
                                  ),
                              ],
                            ),
                          ),
                          StatusPill.status(build.status, dense: true),
                        ],
                      ),
                    ),
                ],
              ),
            ),
        ],
      ),
    );
  }
}

class _RegistryPicker extends StatelessWidget {
  const _RegistryPicker({required this.registries});

  final List<Registry> registries;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Registry',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: colors.ink),
            ),
            const SizedBox(height: 4),
            Text(
              'Pilih registry untuk memperbarui credential, atau tambah registry baru.',
              style: TextStyle(fontSize: 11.5, color: colors.muted),
            ),
            const SizedBox(height: 12),
            for (final registry in registries)
              Padding(
                padding: const EdgeInsets.only(bottom: 8),
                child: AppSurface(
                  onTap: () => Navigator.of(context).pop(registry),
                  child: Row(
                    children: [
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              registry.name,
                              style: TextStyle(
                                fontSize: 12.5,
                                fontWeight: FontWeight.w600,
                                color: colors.ink,
                              ),
                            ),
                            Text(
                              '${registry.host} · ${registry.username}',
                              style: TextStyle(
                                fontSize: 10.5,
                                fontFamily: 'monospace',
                                color: colors.muted,
                              ),
                            ),
                          ],
                        ),
                      ),
                      StatusPill(
                        label: registry.isActive ? 'Aktif' : 'Nonaktif',
                        tone: registry.isActive ? 'success' : 'muted',
                        dense: true,
                      ),
                    ],
                  ),
                ),
              ),
            const SizedBox(height: 4),
            FilledButton.icon(
              onPressed: () => Navigator.of(context).pop('new'),
              icon: const Icon(Icons.add, size: 16),
              label: const Text('Registry baru'),
            ),
          ],
        ),
      ),
    );
  }
}

class _RolloutSheet extends StatefulWidget {
  const _RolloutSheet({required this.release, required this.resources});

  final ApplicationRelease release;
  final List<ReleaseResource> resources;

  @override
  State<_RolloutSheet> createState() => _RolloutSheetState();
}

class _RolloutSheetState extends State<_RolloutSheet> {
  late final Set<String> _selected = widget.resources.map((r) => r.id).toSet();
  bool _trackLatest = false;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return SafeArea(
      child: Padding(
        padding: const EdgeInsets.fromLTRB(16, 14, 16, 18),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Text(
              'Rollout v${widget.release.version}',
              style: TextStyle(fontSize: 15, fontWeight: FontWeight.w600, color: colors.ink),
            ),
            const SizedBox(height: 4),
            Text(
              'Pilih resource yang akan dideploy ulang dengan release ini.',
              style: TextStyle(fontSize: 11.5, color: colors.muted),
            ),
            const SizedBox(height: 10),
            Flexible(
              child: ListView(
                shrinkWrap: true,
                children: [
                  for (final resource in widget.resources)
                    CheckboxListTile(
                      value: _selected.contains(resource.id),
                      contentPadding: EdgeInsets.zero,
                      dense: true,
                      onChanged: (value) => setState(() {
                        if (value == true) {
                          _selected.add(resource.id);
                        } else {
                          _selected.remove(resource.id);
                        }
                      }),
                      title: Text(resource.name, style: const TextStyle(fontSize: 13)),
                      subtitle: Text(
                        '${resource.nodeName} · ${resource.observedState}',
                        style: const TextStyle(fontSize: 11),
                      ),
                    ),
                  SwitchListTile.adaptive(
                    value: _trackLatest,
                    contentPadding: EdgeInsets.zero,
                    dense: true,
                    onChanged: (value) => setState(() => _trackLatest = value),
                    title: const Text('Track latest release', style: TextStyle(fontSize: 13)),
                    subtitle: const Text(
                      'Resource otomatis ikut release terbaru setelah build sukses.',
                      style: TextStyle(fontSize: 11),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 10),
            FilledButton(
              onPressed: _selected.isEmpty
                  ? null
                  : () => Navigator.of(context).pop((
                      ids: _selected.toList(growable: false),
                      trackLatest: _trackLatest,
                    )),
              child: Text('Rollout ${_selected.length} resource'),
            ),
          ],
        ),
      ),
    );
  }
}
