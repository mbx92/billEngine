import 'dart:async';
import 'dart:convert';

import 'package:billengine_mobile/core/api_exception.dart';
import 'package:billengine_mobile/core/session_store.dart';

import 'package:http/http.dart' as http;


/// HTTP client for the Nuxt control plane.
///
/// Authentication uses the Better Auth email/password endpoints. Better Auth
/// replies with a signed `Set-Cookie` session token, so the client keeps a
/// cookie jar and replays it on every request instead of relying on a bearer
/// token (the server does not enable the bearer plugin).
class ApiClient {
  ApiClient({String baseUrl = defaultBaseUrl, SessionStore? sessionStore})
    : _baseUrl = normalizeBaseUrl(baseUrl),
      _sessionStore = sessionStore ?? SessionStore();

  /// Compile-time default. `10.0.2.2` only resolves inside the Android
  /// emulator; a physical device on the same USB link uses `127.0.0.1` via
  /// `adb reverse tcp:3000 tcp:3000`. Override at build time with
  /// `--dart-define=BILLENGINE_BASE_URL=http://127.0.0.1:3000`.
  static const String defaultBaseUrl = String.fromEnvironment(
    'BILLENGINE_BASE_URL',
    defaultValue: 'http://10.0.2.2:3000',
  );

  final SessionStore _sessionStore;
  final http.Client _http = http.Client();

  String _baseUrl;
  Map<String, String> _cookies = <String, String>{};
  bool _cookiesLoaded = false;

  String get baseUrl => _baseUrl;

  set baseUrl(String value) {
    _baseUrl = normalizeBaseUrl(value);
  }

  /// Keeps `http://host:port` without a trailing slash so paths can be joined
  /// with a leading slash.
  static String normalizeBaseUrl(String value) {
    var normalized = value.trim();
    if (normalized.isEmpty) return defaultBaseUrl;
    if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
      normalized = 'http://$normalized';
    }
    while (normalized.endsWith('/')) {
      normalized = normalized.substring(0, normalized.length - 1);
    }
    return normalized;
  }

  Future<Map<String, String>> _loadCookies() async {
    if (_cookiesLoaded) return _cookies;
    _cookies = await _sessionStore.readCookies();
    _cookiesLoaded = true;
    return _cookies;
  }

  Future<void> _captureCookies(http.BaseResponse response) async {
    final header = response.headers['set-cookie'];
    if (header == null || header.isEmpty) return;

    var changed = false;
    for (final raw in _splitSetCookie(header)) {
      final pair = raw.split(';').first.trim();
      final separator = pair.indexOf('=');
      if (separator <= 0) continue;
      final name = pair.substring(0, separator).trim();
      final value = pair.substring(separator + 1).trim();
      if (value.isEmpty || value == 'deleted') {
        changed = _cookies.remove(name) != null || changed;
      } else {
        changed = _cookies[name] != value || changed;
        _cookies[name] = value;
      }
    }
    if (changed) await _sessionStore.writeCookies(_cookies);
  }

  /// `package:http` folds repeated `Set-Cookie` headers into one comma-joined
  /// string, so a value that continues after a comma (an `Expires` date) has to
  /// be stitched back onto the previous cookie.
  static List<String> _splitSetCookie(String raw) {
    final parts = <String>[];
    for (final piece in raw.split(',')) {
      if (parts.isNotEmpty && !piece.contains('=')) {
        parts[parts.length - 1] = '${parts.last},$piece';
      } else {
        parts.add(piece.trim());
      }
    }
    return parts;
  }

  Future<Map<String, String>> _headers({
    bool json = true,
    Map<String, String>? extra,
  }) async {
    final cookies = await _loadCookies();
    return <String, String>{
      if (json) 'content-type': 'application/json',
      'accept': 'application/json',
      if (cookies.isNotEmpty)
        'cookie': cookies.entries.map((entry) => '${entry.key}=${entry.value}').join('; '),
      ...?extra,
    };
  }

  Uri _uri(String path, [Map<String, dynamic>? query]) {
    final uri = Uri.parse('$_baseUrl$path');
    if (query == null || query.isEmpty) return uri;
    final params = <String, String>{};
    query.forEach((key, value) {
      if (value == null) return;
      final text = value.toString();
      if (text.isEmpty) return;
      params[key] = text;
    });
    if (params.isEmpty) return uri;
    return uri.replace(queryParameters: {...uri.queryParameters, ...params});
  }

  Future<dynamic> get(String path, {Map<String, dynamic>? query}) {
    return _send(() async => _http.get(_uri(path, query), headers: await _headers()));
  }

  Future<dynamic> post(String path, {Object? body, String? idempotencyKey}) {
    return _send(
      () async => _http.post(
        _uri(path),
        headers: await _headers(extra: _idempotency(idempotencyKey)),
        body: body == null ? null : jsonEncode(body),
      ),
    );
  }

  Future<dynamic> put(String path, {Object? body}) {
    return _send(
      () async => _http.put(
        _uri(path),
        headers: await _headers(),
        body: body == null ? null : jsonEncode(body),
      ),
    );
  }

  Future<dynamic> patch(String path, {Object? body, String? idempotencyKey}) {
    return _send(
      () async => _http.patch(
        _uri(path),
        headers: await _headers(extra: _idempotency(idempotencyKey)),
        body: body == null ? null : jsonEncode(body),
      ),
    );
  }

  Future<dynamic> delete(String path, {Object? body}) {
    return _send(
      () async => _http.delete(
        _uri(path),
        headers: await _headers(),
        body: body == null ? null : jsonEncode(body),
      ),
    );
  }

  /// Downloads a binary response (invoice or report exports).
  Future<DownloadResult> download(String path, {Map<String, dynamic>? query}) async {
    final response = await _http.get(_uri(path, query), headers: await _headers(json: false));
    await _captureCookies(response);
    if (response.statusCode >= 400) {
      throw _toException(response);
    }
    return DownloadResult(
      bytes: response.bodyBytes,
      contentType: response.headers['content-type'],
      filename: _filename(response.headers['content-disposition']),
    );
  }

  Map<String, String> _idempotency(String? key) {
    if (key == null || key.isEmpty) return const <String, String>{};
    return <String, String>{'Idempotency-Key': key};
  }

  Future<dynamic> _send(Future<http.Response> Function() request) async {
    http.Response response;
    try {
      response = await request().timeout(const Duration(seconds: 45));
    } on TimeoutException {
      throw const ApiException(
        message: 'Server tidak merespons. Periksa koneksi dan alamat server.',
        code: 'TIMEOUT',
      );
    } on http.ClientException catch (error) {
      throw ApiException(
        message: 'Tidak dapat menghubungi server: ${error.message}',
        code: 'NETWORK_ERROR',
      );
    } on Exception catch (error) {
      throw ApiException(message: 'Koneksi gagal: $error', code: 'NETWORK_ERROR');
    }

    await _captureCookies(response);
    if (response.statusCode >= 400) throw _toException(response);

    final text = utf8.decode(response.bodyBytes);
    if (text.trim().isEmpty) return null;
    try {
      return jsonDecode(text);
    } on FormatException {
      return text;
    }
  }

  ApiException _toException(http.Response response) {
    var message = 'Permintaan gagal (${response.statusCode}).';
    var code = 'HTTP_${response.statusCode}';
    Map<String, dynamic>? details;

    try {
      final decoded = jsonDecode(utf8.decode(response.bodyBytes));
      if (decoded is Map<String, dynamic>) {
        final error = decoded['error'];
        if (error is Map<String, dynamic>) {
          message = (error['message'] as String?)?.trim().isNotEmpty == true
              ? error['message'] as String
              : message;
          code = error['code'] as String? ?? code;
          if (error['details'] is Map<String, dynamic>) {
            details = error['details'] as Map<String, dynamic>;
          }
        } else if (decoded['message'] is String) {
          message = decoded['message'] as String;
        }
      }
    } on FormatException {
      // Non-JSON error bodies (proxy pages) keep the status-based message.
    }

    return ApiException(
      message: message,
      code: code,
      statusCode: response.statusCode,
      details: details,
    );
  }

  static String? _filename(String? disposition) {
    if (disposition == null) return null;
    final match = RegExp(r'filename="?([^";]+)"?').firstMatch(disposition);
    return match?.group(1);
  }

  Future<void> clearSession() async {
    _cookies = <String, String>{};
    _cookiesLoaded = true;
    await _sessionStore.clear();
  }
}

class DownloadResult {
  const DownloadResult({required this.bytes, this.contentType, this.filename});

  final List<int> bytes;
  final String? contentType;
  final String? filename;
}
