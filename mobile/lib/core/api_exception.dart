
/// Error returned by the control plane API or the transport layer.
class ApiException implements Exception {
  const ApiException({
    required this.message,
    this.code = 'UNKNOWN',
    this.statusCode,
    this.details,
  });

  final String message;
  final String code;
  final int? statusCode;
  final Map<String, dynamic>? details;

  bool get isAuthenticationRequired => statusCode == 401 || code == 'AUTHENTICATION_REQUIRED';

  bool get isForbidden => statusCode == 403 || code == 'FORBIDDEN';

  @override
  String toString() => message;

  /// Field-level messages from a Zod `VALIDATION_ERROR` response.
  List<String> get fieldMessages {
    final payload = details?['issues'] ?? details?['details'];
    if (payload is! List) return const <String>[];
    return payload
        .whereType<Map<String, dynamic>>()
        .map((issue) {
          final path = issue['path'];
          final label = path is List && path.isNotEmpty ? path.last.toString() : null;
          final text = issue['message']?.toString() ?? 'Nilai tidak valid.';
          return label == null ? text : '$label: $text';
        })
        .toList(growable: false);
  }
}
