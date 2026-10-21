import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/models/infrastructure.dart';
import 'package:billengine_mobile/models/platform.dart';
import 'package:billengine_mobile/services/api_service.dart';
import 'package:billengine_mobile/ui/shells/shells.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';
import 'package:billengine_mobile/ui/widgets/forms.dart';

/// Deploys one of the built-in infrastructure templates onto a node.
class TemplatesScreen extends StatefulWidget {
  const TemplatesScreen({super.key});

  @override
  State<TemplatesScreen> createState() => _TemplatesScreenState();
}

class _TemplatesScreenState extends State<TemplatesScreen> {
  late final ItemController<List<InfraTemplate>> _templates;
  final _action = ActionController();

  @override
  void initState() {
    super.initState();
    _templates = ItemController<List<InfraTemplate>>(fetch: context.read<ApiService>().templates);
    _templates.load();
  }

  @override
  void dispose() {
    _templates.dispose();
    _action.dispose();
    super.dispose();
  }

  Future<void> _deploy(InfraTemplate template) async {
    final api = context.read<ApiService>();
    List<InfraNode> nodes;
    try {
      nodes = await api.nodes();
    } catch (error) {
      if (mounted) showAppSnack(context, 'Node tidak dapat dimuat: $error', error: true);
      return;
    }
    if (!mounted) return;
    if (nodes.isEmpty) {
      showAppSnack(context, 'Belum ada node untuk deploy template.', error: true);
      return;
    }

    final values = await showRecordForm(
      context,
      title: 'Deploy ${template.name}',
      description: template.description ?? 'Tentukan node dan parameter environment template.',
      submitLabel: 'Deploy',
      fields: [
        FieldSpec.select(
          'nodeId',
          'Node',
          options: {
            for (final node in nodes)
              node.id: '${node.name} · ${Fmt.label(node.environment)}',
          },
          required: true,
        ),
        FieldSpec.text(
          'name',
          'Nama resource',
          hint: 'Slug lowercase, contoh: db-postgres-01',
          required: true,
        ),
        FieldSpec.text('subdomain', 'Subdomain', hint: 'Opsional untuk akses domain'),
        FieldSpec.select(
          'classification',
          'Klasifikasi',
          options: const {
            'internal': 'Internal',
            'billable': 'Billable',
            'ignored': 'Diabaikan',
          },
          initial: 'internal',
        ),
        FieldSpec.select(
          'exposure',
          'Akses',
          options: const {'domain': 'Domain', 'port': 'Port langsung'},
          initial: 'domain',
        ),
        FieldSpec.integer('hostPort', 'Host port', hint: 'Wajib untuk akses port'),
        for (final parameter in template.definition.parameters)
          FieldSpec.text(
            'value:${parameter.key}',
            parameter.label,
            hint: parameter.help ?? parameter.environmentKey,
            initial: parameter.generated ? null : parameter.defaultValue,
            required: parameter.required && !parameter.generated,
          ),
      ],
    );
    if (values == null || !mounted) return;

    final deployValues = <String, String>{};
    for (final entry in values.entries) {
      if (entry.key.startsWith('value:') && entry.value.toString().trim().isNotEmpty) {
        deployValues[entry.key.substring(6)] = entry.value.toString();
      }
    }

    final payload = <String, dynamic>{
      'nodeId': values['nodeId'],
      'name': values['name'],
      'classification': values['classification'] ?? 'internal',
      'exposure': values['exposure'] ?? 'domain',
      'values': deployValues,
      if (values['subdomain'] != null) 'subdomain': values['subdomain'],
      if (values['hostPort'] != null) 'hostPort': int.tryParse(values['hostPort'].toString()),
    };

    final ok = await _action.run(() => api.deployTemplate(template.id, payload));
    if (!mounted) return;
    if (ok) {
      showAppSnack(context, '${template.name} masuk antrean deploy.');
      await _templates.refresh();
    } else {
      showAppSnack(context, _action.error ?? 'Template gagal di-deploy.', error: true);
    }
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return AdminScaffold(
      child: ChangeNotifierProvider<ItemController<List<InfraTemplate>>>.value(
        value: _templates,
        child: Consumer<ItemController<List<InfraTemplate>>>(
          builder: (context, controller, _) {
            final templates = controller.value ?? const <InfraTemplate>[];
            return ListView(
              children: [
                SectionHeader(
                  eyebrow: 'Infrastructure',
                  title: 'Templates',
                  subtitle:
                      'Blueprint internal untuk database, cache, dan aplikasi yang siap dideploy.',
                  trailing: StatusPill(
                    label: '${templates.length} template',
                    tone: 'muted',
                    dense: true,
                  ),
                ),
                const SizedBox(height: 14),
                if (controller.isLoading && !controller.isLoaded)
                  const LoadingList(count: 4, height: 110)
                else if (controller.error != null && templates.isEmpty)
                  AppCard(
                    child: ErrorState(message: controller.error!, onRetry: controller.refresh),
                  )
                else if (templates.isEmpty)
                  const AppCard(
                    child: EmptyState(
                      title: 'Belum ada template',
                      description: 'Template builtin disediakan oleh server control plane.',
                      icon: Icons.code_outlined,
                    ),
                  )
                else
                  for (final template in templates) ...[
                    Container(
                      decoration: BoxDecoration(
                        color: colors.surface,
                        borderRadius: BorderRadius.circular(12),
                        border: Border.all(color: colors.line),
                      ),
                      child: Padding(
                        padding: const EdgeInsets.all(14),
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.stretch,
                          children: [
                            Row(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Expanded(
                                  child: Column(
                                    crossAxisAlignment: CrossAxisAlignment.start,
                                    children: [
                                      Text(
                                        template.name,
                                        style: TextStyle(
                                          fontSize: 14,
                                          fontWeight: FontWeight.w600,
                                          color: colors.ink,
                                        ),
                                      ),
                                      Text(
                                        '${template.slug} · v${template.version}',
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
                                  label: template.isBuiltin ? 'Builtin' : 'Custom',
                                  tone: template.isBuiltin ? 'info' : 'muted',
                                  dense: true,
                                ),
                              ],
                            ),
                            if (template.description != null)
                              Padding(
                                padding: const EdgeInsets.only(top: 6),
                                child: Text(
                                  template.description!,
                                  style: TextStyle(
                                    fontSize: 11.5,
                                    height: 1.45,
                                    color: colors.muted,
                                  ),
                                ),
                              ),
                            const SizedBox(height: 8),
                            Wrap(
                              spacing: 6,
                              runSpacing: 6,
                              children: [
                                StatusPill(
                                  label: Fmt.label(template.category),
                                  tone: 'muted',
                                  dense: true,
                                ),
                                StatusPill(
                                  label: 'restart ${template.definition.restartPolicy}',
                                  tone: 'muted',
                                  dense: true,
                                ),
                                if (template.definition.limits.cpuMilli != null)
                                  StatusPill(
                                    label: Fmt.cpu(template.definition.limits.cpuMilli! / 1000),
                                    tone: 'muted',
                                    dense: true,
                                  ),
                                if (template.definition.limits.memoryBytes != null)
                                  StatusPill(
                                    label: Fmt.bytes(template.definition.limits.memoryBytes),
                                    tone: 'muted',
                                    dense: true,
                                  ),
                                StatusPill(
                                  label:
                                      '${template.definition.parameters.length} parameter',
                                  tone: 'muted',
                                  dense: true,
                                ),
                              ],
                            ),
                            const SizedBox(height: 10),
                            Align(
                              alignment: Alignment.centerRight,
                              child: FilledButton.icon(
                                onPressed: _action.isPending || !template.isActive
                                    ? null
                                    : () => _deploy(template),
                                icon: const Icon(Icons.rocket_launch_outlined, size: 15),
                                label: const Text('Deploy'),
                              ),
                            ),
                          ],
                        ),
                      ),
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
