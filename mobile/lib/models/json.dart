
/// Defensive JSON helpers. The control plane serializes PostgreSQL `bigint`
/// and `numeric` values as strings, so numbers have to be parsed leniently.
library;

typedef Json = Map<String, dynamic>;

Json? asMap(Object? value) {
  if (value is Map<String, dynamic>) return value;
  if (value is Map) return value.map((key, item) => MapEntry(key.toString(), item));
  return null;
}

List<Json> asMapList(Object? value) {
  if (value is! List) return const <Json>[];
  return value.map(asMap).whereType<Json>().toList(growable: false);
}

String? asString(Object? value) {
  if (value == null) return null;
  if (value is String) return value;
  return value.toString();
}

String asStringOr(Object? value, String fallback) => asString(value) ?? fallback;

int? asInt(Object? value) {
  if (value == null) return null;
  if (value is int) return value;
  if (value is num) return value.toInt();
  return int.tryParse(value.toString());
}

int asIntOr(Object? value, int fallback) => asInt(value) ?? fallback;

double? asDouble(Object? value) {
  if (value == null) return null;
  if (value is num) return value.toDouble();
  return double.tryParse(value.toString());
}

bool asBool(Object? value, {bool fallback = false}) {
  if (value == null) return fallback;
  if (value is bool) return value;
  final text = value.toString().toLowerCase();
  return text == 'true' || text == '1';
}

List<String> asStringList(Object? value) {
  if (value is! List) return const <String>[];
  return value.map(asString).whereType<String>().toList(growable: false);
}

DateTime? asDate(Object? value) {
  final text = asString(value);
  if (text == null) return null;
  return DateTime.tryParse(text);
}

/// Unwraps the `{ data: ... }` envelope every endpoint returns.
Json? envelope(Object? response) {
  final map = asMap(response);
  if (map == null) return null;
  return asMap(map['data']);
}

JsonList envelopeList(Object? response) {
  final map = asMap(response);
  if (map == null) return const <Json>[];
  return asMapList(map['data']);
}

/// Pagination metadata returned next to `data` for list endpoints.
class PageMeta {
  const PageMeta({
    required this.page,
    required this.perPage,
    required this.total,
    required this.totalPages,
  });

  const PageMeta.empty() : page = 1, perPage = 25, total = 0, totalPages = 0;

  final int page;
  final int perPage;
  final int total;
  final int totalPages;

  bool get hasMore => page < totalPages;

  factory PageMeta.from(Object? response, {int perPage = 25}) {
    final meta = asMap(asMap(response)?['meta']);
    if (meta == null) return const PageMeta.empty();
    return PageMeta(
      page: asIntOr(meta['page'], 1),
      perPage: asIntOr(meta['perPage'], perPage),
      total: asIntOr(meta['total'], 0),
      totalPages: asIntOr(meta['totalPages'], 0),
    );
  }
}

typedef JsonList = List<Json>;
