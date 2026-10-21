import 'package:flutter/material.dart';

import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/theme.dart';

/// Rounded surface container with an optional header row, matching `UiCard`.
class AppCard extends StatelessWidget {
  const AppCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.title,
    this.subtitle,
    this.trailing,
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final String? title;
  final String? subtitle;
  final Widget? trailing;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final content = Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        if (title != null)
          Padding(
            padding: const EdgeInsets.fromLTRB(16, 14, 12, 12),
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Expanded(
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(
                        title!,
                        style: TextStyle(
                          fontSize: 14,
                          fontWeight: FontWeight.w600,
                          color: colors.ink,
                        ),
                      ),
                      if (subtitle != null)
                        Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(
                            subtitle!,
                            style: TextStyle(fontSize: 11.5, color: colors.muted),
                          ),
                        ),
                    ],
                  ),
                ),
                ?trailing,
              ],
            ),
          ),
        if (title != null) Divider(height: 1, color: colors.line),
        Flexible(child: Padding(padding: padding, child: child)),
      ],
    );

    return Container(
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors.line),
      ),
      clipBehavior: Clip.antiAlias,
      child: onTap == null
          ? content
          : InkWell(onTap: onTap, child: content),
    );
  }
}

/// Card used for list rows and key/value detail blocks.
class AppSurface extends StatelessWidget {
  const AppSurface({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(14),
    this.onTap,
    this.highlight = false,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final VoidCallback? onTap;
  final bool highlight;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Material(
      color: highlight ? colors.brand.withValues(alpha: 0.06) : colors.surface,
      borderRadius: BorderRadius.circular(12),
      child: InkWell(
        onTap: onTap,
        borderRadius: BorderRadius.circular(12),
        child: Container(
          padding: padding,
          decoration: BoxDecoration(
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: highlight ? colors.brand.withValues(alpha: 0.4) : colors.line),
          ),
          child: child,
        ),
      ),
    );
  }
}

class SectionHeader extends StatelessWidget {
  const SectionHeader({
    super.key,
    required this.eyebrow,
    required this.title,
    this.subtitle,
    this.trailing,
  });

  final String eyebrow;
  final String title;
  final String? subtitle;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Row(
      crossAxisAlignment: CrossAxisAlignment.end,
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                eyebrow.toUpperCase(),
                style: TextStyle(
                  fontSize: 10.5,
                  fontWeight: FontWeight.w700,
                  letterSpacing: 0.9,
                  color: colors.brand,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                title,
                style: TextStyle(
                  fontSize: 21,
                  fontWeight: FontWeight.w600,
                  letterSpacing: -0.4,
                  color: colors.ink,
                ),
              ),
              if (subtitle != null)
                Padding(
                  padding: const EdgeInsets.only(top: 4),
                  child: Text(
                    subtitle!,
                    style: TextStyle(fontSize: 13, height: 1.4, color: colors.muted),
                  ),
                ),
            ],
          ),
        ),
        if (trailing != null) ...[const SizedBox(width: 12), trailing!],
      ],
    );
  }
}

class StatTile extends StatelessWidget {
  const StatTile({
    super.key,
    required this.label,
    required this.value,
    this.detail,
    this.tone = 'neutral',
    this.icon,
  });

  final String label;
  final String value;
  final String? detail;
  final String tone;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final accent = switch (tone) {
      'warning' => colors.warning,
      'danger' => colors.danger,
      'success' => colors.brand,
      'info' => colors.info,
      _ => colors.muted,
    };

    return Container(
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(
        color: colors.surface,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: colors.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              if (icon != null) ...[
                Icon(icon, size: 14, color: accent),
                const SizedBox(width: 6),
              ],
              Expanded(
                child: Text(
                  label.toUpperCase(),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: TextStyle(
                    fontSize: 10,
                    fontWeight: FontWeight.w700,
                    letterSpacing: 0.7,
                    color: colors.muted,
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 8),
          Text(
            value,
            maxLines: 2,
            overflow: TextOverflow.ellipsis,
            style: TextStyle(
              fontSize: 20,
              fontWeight: FontWeight.w600,
              letterSpacing: -0.5,
              color: colors.ink,
              fontFeatures: const [FontFeature.tabularFigures()],
            ),
          ),
          if (detail != null) ...[
            const SizedBox(height: 4),
            Text(
              detail!,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style: TextStyle(fontSize: 11.5, color: colors.muted),
            ),
          ],
        ],
      ),
    );
  }
}

class StatusPill extends StatelessWidget {
  const StatusPill({
    super.key,
    required this.label,
    this.tone = 'neutral',
    this.dense = false,
  });

  /// Derives the tone from an invoice/service/resource status string.
  factory StatusPill.status(String status, {String? label, bool dense = false}) {
    return StatusPill(label: label ?? statusLabel(status), tone: statusTone(status), dense: dense);
  }

  final String label;
  final String tone;
  final bool dense;

  static String statusLabel(String status) {
    return switch (status) {
      'draft' => 'Draft',
      'unpaid' => 'Belum dibayar',
      'paid' => 'Lunas',
      'overdue' => 'Jatuh tempo',
      'cancelled' => 'Dibatalkan',
      'pending' => 'Menunggu',
      'completed' => 'Selesai',
      'failed' => 'Gagal',
      'refunded' => 'Refund',
      'active' => 'Aktif',
      'inactive' => 'Nonaktif',
      'suspended' => 'Suspend',
      'running' => 'Berjalan',
      'stopped' => 'Berhenti',
      'restarting' => 'Restart',
      'degraded' => 'Degraded',
      'deleting' => 'Menghapus',
      'deleted' => 'Terhapus',
      'unknown' => 'Tidak diketahui',
      'online' => 'Online',
      'offline' => 'Offline',
      'revoked' => 'Dicabut',
      'queued' => 'Antri',
      'dispatched' => 'Dikirim',
      'succeeded' => 'Berhasil',
      'provisioning' => 'Provisioning',
      'pending_deletion' => 'Akan dihapus',
      'issued' => 'Diterbitkan',
      'voided' => 'Dibatalkan',
      'healthy' => 'Sehat',
      'warning' => 'Perhatian',
      'critical' => 'Kritis',
      'installing' => 'Instalasi',
      'enrolling' => 'Enrollment',
      _ => Fmt.label(status),
    };
  }

  static String statusTone(String status) {
    return switch (status) {
      'paid' || 'active' || 'completed' || 'running' || 'online' || 'succeeded' || 'healthy' ||
      'issued' || 'matched' => 'success',
      'overdue' || 'warning' || 'suspended' || 'degraded' || 'restarting' || 'pending' => 'warning',
      'unpaid' || 'draft' || 'queued' || 'dispatched' || 'provisioning' || 'enrolling' ||
      'installing' || 'pending_deletion' => 'info',
      'failed' || 'cancelled' || 'revoked' || 'critical' || 'voided' => 'danger',
      'offline' || 'stopped' || 'inactive' || 'deleted' => 'muted',
      _ => 'neutral',
    };
  }

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    final (Color fg, Color bg) = switch (tone) {
      'success' => (colors.brand, colors.brand.withValues(alpha: 0.12)),
      'warning' => (colors.warning, colors.warning.withValues(alpha: 0.13)),
      'danger' => (colors.danger, colors.danger.withValues(alpha: 0.12)),
      'info' => (colors.info, colors.info.withValues(alpha: 0.12)),
      'muted' => (colors.muted, colors.surfaceRaised),
      _ => (colors.muted, colors.surfaceRaised),
    };

    return Container(
      padding: EdgeInsets.symmetric(horizontal: dense ? 7 : 9, vertical: dense ? 2.5 : 3.5),
      decoration: BoxDecoration(
        color: bg,
        borderRadius: BorderRadius.circular(999),
        border: Border.all(color: fg.withValues(alpha: 0.32)),
      ),
      child: Text(
        label,
        style: TextStyle(
          fontSize: dense ? 10 : 10.5,
          fontWeight: FontWeight.w600,
          letterSpacing: 0.2,
          color: fg,
        ),
      ),
    );
  }
}

class KeyValueRow extends StatelessWidget {
  const KeyValueRow({
    super.key,
    required this.label,
    required this.value,
    this.valueColor,
    this.mono = false,
    this.wrap = false,
  });

  final String label;
  final String value;
  final Color? valueColor;
  final bool mono;
  final bool wrap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 6),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 124,
            child: Text(
              label,
              style: TextStyle(fontSize: 12.5, color: colors.muted),
            ),
          ),
          const SizedBox(width: 8),
          Expanded(
            child: Text(
              value,
              maxLines: wrap ? null : 2,
              overflow: wrap ? null : TextOverflow.ellipsis,
              style: TextStyle(
                fontSize: 12.5,
                height: 1.35,
                color: valueColor ?? colors.ink,
                fontFamily: mono ? 'monospace' : null,
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class EmptyState extends StatelessWidget {
  const EmptyState({
    super.key,
    required this.title,
    this.description,
    this.icon = Icons.inbox_outlined,
    this.action,
  });

  final String title;
  final String? description;
  final IconData icon;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 36, horizontal: 20),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Container(
            padding: const EdgeInsets.all(12),
            decoration: BoxDecoration(
              color: colors.surfaceRaised,
              borderRadius: BorderRadius.circular(999),
            ),
            child: Icon(icon, size: 22, color: colors.muted),
          ),
          const SizedBox(height: 14),
          Text(
            title,
            textAlign: TextAlign.center,
            style: TextStyle(fontSize: 14, fontWeight: FontWeight.w600, color: colors.ink),
          ),
          if (description != null) ...[
            const SizedBox(height: 6),
            Text(
              description!,
              textAlign: TextAlign.center,
              style: TextStyle(fontSize: 12.5, height: 1.45, color: colors.muted),
            ),
          ],
          if (action != null) ...[const SizedBox(height: 16), action!],
        ],
      ),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.message, this.onRetry});

  final String message;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) {
    return EmptyState(
      icon: Icons.error_outline,
      title: 'Tidak dapat memuat data',
      description: message,
      action: onRetry == null
          ? null
          : OutlinedButton.icon(
              onPressed: onRetry,
              icon: const Icon(Icons.refresh, size: 16),
              label: const Text('Coba lagi'),
            ),
    );
  }
}

class LoadingList extends StatelessWidget {
  const LoadingList({super.key, this.count = 5, this.height = 64});

  final int count;
  final double height;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Column(
      children: List<Widget>.generate(
        count,
        (index) => Container(
          height: height,
          margin: const EdgeInsets.only(bottom: 10),
          decoration: BoxDecoration(
            color: colors.surfaceRaised,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: colors.line),
          ),
        ),
      ),
    );
  }
}

/// Row used for invoice/service/resources list entries.
class ListRow extends StatelessWidget {
  const ListRow({
    super.key,
    required this.title,
    this.subtitle,
    this.mono,
    this.trailing,
    this.leading,
    this.onTap,
    this.pill,
  });

  final String title;
  final String? subtitle;
  final String? mono;
  final Widget? trailing;
  final Widget? leading;
  final Widget? pill;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return InkWell(
      onTap: onTap,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        child: Row(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            if (leading != null) ...[leading!, const SizedBox(width: 12)],
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Row(
                    children: [
                      Expanded(
                        child: Text(
                          title,
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            fontSize: 13.5,
                            fontWeight: FontWeight.w600,
                            color: colors.ink,
                          ),
                        ),
                      ),
                      if (pill != null) ...[const SizedBox(width: 8), pill!],
                    ],
                  ),
                  if (mono != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 2),
                      child: Text(
                        mono!,
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(
                          fontSize: 11,
                          color: colors.brand,
                          fontFamily: 'monospace',
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  if (subtitle != null)
                    Padding(
                      padding: const EdgeInsets.only(top: 3),
                      child: Text(
                        subtitle!,
                        maxLines: 2,
                        overflow: TextOverflow.ellipsis,
                        style: TextStyle(fontSize: 11.5, height: 1.4, color: colors.muted),
                      ),
                    ),
                ],
              ),
            ),
            if (trailing != null) ...[const SizedBox(width: 10), trailing!],
          ],
        ),
      ),
    );
  }
}

class MoneyText extends StatelessWidget {
  const MoneyText(
    this.amount, {
    super.key,
    this.currency = 'IDR',
    this.bold = false,
    this.size,
    this.color,
  });

  final Object? amount;
  final String currency;
  final bool bold;
  final double? size;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return Text(
      Fmt.money(amount, currency),
      style: TextStyle(
        fontSize: size ?? 13,
        fontWeight: bold ? FontWeight.w700 : FontWeight.w500,
        color: color ?? context.colors.ink,
        fontFeatures: const [FontFeature.tabularFigures()],
      ),
    );
  }
}

/// Small label describing a filter combination, e.g. "2 filter aktif".
class FilterChipRow extends StatelessWidget {
  const FilterChipRow({
    super.key,
    required this.options,
    required this.selected,
    required this.onChanged,
    this.labelBuilder,
  });

  final List<String> options;
  final String selected;
  final ValueChanged<String> onChanged;
  final String Function(String)? labelBuilder;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return SizedBox(
      height: 34,
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        itemCount: options.length,
        separatorBuilder: (_, _) => const SizedBox(width: 6),
        itemBuilder: (context, index) {
          final option = options[index];
          final active = option == selected;
          return InkWell(
            onTap: () => onChanged(option),
            borderRadius: BorderRadius.circular(8),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 11, vertical: 6),
              decoration: BoxDecoration(
                color: active ? colors.brand.withValues(alpha: 0.12) : colors.surfaceRaised,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(
                  color: active ? colors.brand.withValues(alpha: 0.45) : colors.line,
                ),
              ),
              child: Text(
                labelBuilder?.call(option) ?? option,
                style: TextStyle(
                  fontSize: 11.5,
                  fontWeight: FontWeight.w600,
                  color: active ? colors.brand : colors.muted,
                ),
              ),
            ),
          );
        },
      ),
    );
  }
}

void showAppSnack(BuildContext context, String message, {bool error = false}) {
  final colors = context.colors;
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(
      SnackBar(
        content: Text(message),
        backgroundColor: error ? colors.danger : colors.ink,
        duration: const Duration(seconds: 3),
      ),
    );
}

Future<bool> confirmAction(
  BuildContext context, {
  required String title,
  required String message,
  String confirmLabel = 'Lanjutkan',
  bool destructive = false,
}) async {
  final colors = context.colors;
  final result = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      backgroundColor: colors.surface,
      title: Text(title, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.w600)),
      content: Text(message, style: const TextStyle(fontSize: 13, height: 1.5)),
      actions: [
        TextButton(
          onPressed: () => Navigator.of(context).pop(false),
          child: const Text('Batal'),
        ),
        FilledButton(
          onPressed: () => Navigator.of(context).pop(true),
          style: destructive
              ? FilledButton.styleFrom(backgroundColor: colors.danger)
              : null,
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result ?? false;
}
