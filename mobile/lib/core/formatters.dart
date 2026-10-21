import 'package:intl/intl.dart';

/// Formatting helpers that mirror `app/lib/format.ts` and
/// `shared/utils/billing-display.ts` so the mobile app shows the same strings
/// as the web console.
class Fmt {
  Fmt._();

  static const List<String> _months = <String>[
    'Jan',
    'Feb',
    'Mar',
    'Apr',
    'Mei',
    'Jun',
    'Jul',
    'Agu',
    'Sep',
    'Okt',
    'Nov',
    'Des',
  ];

  static final NumberFormat _decimal = NumberFormat.decimalPattern('id_ID');

  /// Formats a PostgreSQL `date` (YYYY-MM-DD) without timezone conversion so
  /// the rendered day never shifts.
  static String date(String? isoDate) {
    if (isoDate == null || isoDate.length < 10) return '—';
    final parts = isoDate.substring(0, 10).split('-');
    if (parts.length != 3) return '—';
    final year = int.tryParse(parts[0]);
    final month = int.tryParse(parts[1]);
    final day = int.tryParse(parts[2]);
    if (year == null || month == null || day == null) return '—';
    if (month < 1 || month > 12) return '—';
    return '${day.toString().padLeft(2, '0')} ${_months[month - 1]} $year';
  }

  static String dateTime(String? isoValue, {String? timeZone}) {
    if (isoValue == null) return '—';
    final parsed = DateTime.tryParse(isoValue);
    if (parsed == null) return '—';
    final local = parsed.toLocal();
    return DateFormat('d MMM yyyy, HH:mm', 'id_ID').format(local);
  }

  /// Money amounts arrive as decimal strings because the server serializes
  /// PostgreSQL `bigint` columns at the API boundary.
  static String money(Object? amount, [String currency = 'IDR']) {
    final numeric = _toDouble(amount);
    if (numeric == null) return '—';
    return NumberFormat.currency(
      locale: 'id_ID',
      symbol: _symbol(currency),
      decimalDigits: 0,
    ).format(numeric);
  }

  static String compactMoney(Object? amount, [String currency = 'IDR']) {
    final numeric = _toDouble(amount);
    if (numeric == null) return '—';
    if (numeric.abs() >= 1000000000) {
      return '${(numeric / 1000000000).toStringAsFixed(1)} M';
    }
    if (numeric.abs() >= 1000000) {
      return '${(numeric / 1000000).toStringAsFixed(1)} jt';
    }
    if (numeric.abs() >= 1000) return '${(numeric / 1000).toStringAsFixed(0)} rb';
    return numeric.toStringAsFixed(0);
  }

  static String count(Object? value) {
    final numeric = value is int ? value : int.tryParse('${value ?? ''}');
    if (numeric == null) return '0';
    return _decimal.format(numeric);
  }

  static String number(Object? value, {int decimals = 0}) {
    final numeric = _toDouble(value);
    if (numeric == null) return '—';
    return NumberFormat.decimalPatternDigits(locale: 'id_ID', decimalDigits: decimals).format(numeric);
  }

  static String cpu(Object? value) {
    final numeric = _toDouble(value);
    if (numeric == null) return '—';
    if (numeric == 0) return 'Unlimited';
    return '${NumberFormat.decimalPatternDigits(locale: 'id_ID', decimalDigits: 3).format(numeric)} core';
  }

  static String bytes(Object? value) {
    final numeric = _toDouble(value);
    if (numeric == null) return '—';
    if (numeric == 0) return 'Unlimited';
    const units = <String>['B', 'KB', 'MB', 'GB', 'TB'];
    var size = numeric;
    var unit = 0;
    while (size >= 1024 && unit < units.length - 1) {
      size /= 1024;
      unit += 1;
    }
    final digits = unit == 0 ? 0 : 1;
    return '${NumberFormat.decimalPatternDigits(locale: 'id_ID', decimalDigits: digits).format(size)} ${units[unit]}';
  }

  static String percentOfFraction(Object? value) {
    final numeric = _toDouble(value);
    if (numeric == null) return '—';
    return '${NumberFormat.decimalPatternDigits(locale: 'id_ID', decimalDigits: 2).format(numeric * 100)}%';
  }

  /// Basis points (`0..10000`) as used by node utilization reports.
  static String basisPoints(Object? value) {
    final numeric = _toDouble(value);
    if (numeric == null) return '—';
    return '${NumberFormat.decimalPatternDigits(locale: 'id_ID', decimalDigits: 1).format(numeric / 100)}%';
  }

  static String relativeTime(String? isoValue) {
    if (isoValue == null) return '—';
    final parsed = DateTime.tryParse(isoValue);
    if (parsed == null) return '—';
    final difference = DateTime.now().difference(parsed);
    if (difference.inSeconds < 60) return '${difference.inSeconds} detik lalu';
    if (difference.inMinutes < 60) return '${difference.inMinutes} menit lalu';
    if (difference.inHours < 24) return '${difference.inHours} jam lalu';
    if (difference.inDays < 30) return '${difference.inDays} hari lalu';
    return date(isoValue.substring(0, 10));
  }

  static const Map<String, String> cycleUnit = <String, String>{
    'one_time': 'sekali bayar',
    'monthly': 'bulan',
    'quarterly': '3 bulan',
    'semi_annually': '6 bulan',
    'annually': 'tahun',
  };

  static const Map<String, String> cycleLabel = <String, String>{
    'one_time': 'Sekali bayar',
    'monthly': 'Bulanan',
    'quarterly': 'Kuartalan',
    'semi_annually': 'Semesteran',
    'annually': 'Tahunan',
  };

  static String billingCycle(String? cycle) => cycleLabel[cycle] ?? (cycle ?? '—');

  static String billingCycleUnit(String? cycle) => cycleUnit[cycle] ?? (cycle ?? '—');

  static String label(String? value) {
    if (value == null || value.isEmpty) return '—';
    return value
        .split('_')
        .map((part) => part.isEmpty ? part : '${part[0].toUpperCase()}${part.substring(1)}')
        .join(' ');
  }

  static String initials(String? name) {
    final trimmed = (name ?? '').trim();
    if (trimmed.isEmpty) return 'US';
    final parts = trimmed.split(RegExp(r'\s+'));
    if (parts.length == 1) {
      return parts.first.substring(0, parts.first.length >= 2 ? 2 : 1).toUpperCase();
    }
    return '${parts[0][0]}${parts[1][0]}'.toUpperCase();
  }

  static String todayIso() => DateFormat('yyyy-MM-dd').format(DateTime.now());

  static String isoDate(DateTime value) => DateFormat('yyyy-MM-dd').format(value);

  static double? _toDouble(Object? value) {
    if (value == null) return null;
    if (value is num) return value.toDouble();
    return double.tryParse(value.toString());
  }

  static String _symbol(String currency) {
    switch (currency.toUpperCase()) {
      case 'IDR':
        return 'Rp ';
      case 'USD':
        return r'$';
      case 'EUR':
        return '€';
      case 'SGD':
        return 'S\$';
      default:
        return '${currency.toUpperCase()} ';
    }
  }
}
