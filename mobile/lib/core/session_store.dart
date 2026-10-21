import 'dart:convert';

import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Persists the Better Auth session cookie and the server address.
class SessionStore {
  SessionStore({FlutterSecureStorage? storage})
    : _storage = storage ?? const FlutterSecureStorage();

  static const String _cookieKey = 'billengine.cookies';
  static const String _baseUrlKey = 'billengine.baseUrl';

  final FlutterSecureStorage _storage;

  Future<Map<String, String>> readCookies() async {
    final raw = await _storage.read(key: _cookieKey);
    if (raw == null || raw.isEmpty) return <String, String>{};
    try {
      final decoded = jsonDecode(raw);
      if (decoded is! Map) return <String, String>{};
      return decoded.map((key, value) => MapEntry(key.toString(), value.toString()));
    } on FormatException {
      return <String, String>{};
    }
  }

  Future<void> writeCookies(Map<String, String> cookies) async {
    if (cookies.isEmpty) {
      await _storage.delete(key: _cookieKey);
      return;
    }
    await _storage.write(key: _cookieKey, value: jsonEncode(cookies));
  }

  Future<String?> readBaseUrl() => _storage.read(key: _baseUrlKey);

  Future<void> writeBaseUrl(String value) => _storage.write(key: _baseUrlKey, value: value);

  Future<void> clear() => _storage.delete(key: _cookieKey);
}
