// ignore_for_file: prefer_initializing_formals

import 'package:flutter/foundation.dart';

import 'package:billengine_mobile/core/api_exception.dart';
import 'package:billengine_mobile/core/formatters.dart';
import 'package:billengine_mobile/core/session_store.dart';
import 'package:billengine_mobile/models/user.dart';
import 'package:billengine_mobile/services/api_service.dart';

enum AuthStatus { unknown, signedOut, signedIn }

/// Owns the session and the current user, and decides which shell (admin vs
/// customer portal) the router should show.
class AuthController extends ChangeNotifier {
  AuthController({required ApiService api, required SessionStore sessionStore})
    : _api = api,
      _sessionStore = sessionStore;

  final ApiService _api;
  final SessionStore _sessionStore;

  AuthStatus _status = AuthStatus.unknown;
  AppUser? _user;
  String? _error;
  bool _submitting = false;

  AuthStatus get status => _status;

  AppUser? get user => _user;

  String? get error => _error;

  bool get isSubmitting => _submitting;

  bool get isSignedIn => _status == AuthStatus.signedIn && _user != null;

  bool get isAdmin => _user?.isAdmin ?? false;

  bool get isCustomer => _user?.isCustomer ?? false;

  String get baseUrl => _api.baseUrl;

  /// Restores a persisted server address, then probes the Better Auth session.
  Future<void> bootstrap() async {
    final savedBaseUrl = await _sessionStore.readBaseUrl();
    if (savedBaseUrl != null && savedBaseUrl.isNotEmpty) {
      _api.baseUrl = savedBaseUrl;
    }

    try {
      final user = await _api.currentUser();
      _user = user;
      _status = AuthStatus.signedIn;
    } on ApiException catch (error) {
      if (error.isAuthenticationRequired) {
        _status = AuthStatus.signedOut;
      } else {
        // Keep the user on the login screen but surface why the session could
        // not be verified (server down, wrong address).
        _status = AuthStatus.signedOut;
        _error = error.message;
      }
    } catch (error) {
      _status = AuthStatus.signedOut;
      _error = '$error';
    }
    notifyListeners();
  }

  Future<bool> signIn({required String email, required String password, String? baseUrl}) async {
    if (email.trim().isEmpty || password.isEmpty) {
      _error = 'Email dan password wajib diisi.';
      notifyListeners();
      return false;
    }

    _submitting = true;
    _error = null;
    notifyListeners();

    try {
      if (baseUrl != null && baseUrl.trim().isNotEmpty) {
        _api.baseUrl = baseUrl;
        await _sessionStore.writeBaseUrl(_api.baseUrl);
      }
      final user = await _api.signIn(email: email, password: password);
      _user = user;
      _status = AuthStatus.signedIn;
      return true;
    } on ApiException catch (error) {
      _error = error.statusCode == 401
          ? 'Email atau password salah.'
          : error.message;
      return false;
    } catch (error) {
      _error = 'Tidak dapat masuk: $error';
      return false;
    } finally {
      _submitting = false;
      notifyListeners();
    }
  }

  Future<void> signOut() async {
    await _api.signOut();
    _user = null;
    _status = AuthStatus.signedOut;
    _error = null;
    notifyListeners();
  }

  /// Updates the cached user after the profile changes elsewhere.
  Future<void> refreshUser() async {
    try {
      _user = await _api.currentUser();
      notifyListeners();
    } on ApiException catch (error) {
      if (error.isAuthenticationRequired) await signOut();
    }
  }

  void clearError() {
    if (_error == null) return;
    _error = null;
    notifyListeners();
  }
}

/// Billing configuration (company name, timezone, currency) shared app-wide.
class SettingsController extends ChangeNotifier {
  SettingsController(this._api);

  final ApiService _api;

  BillingSettingsValue _value = const BillingSettingsValue();
  bool _loaded = false;

  BillingSettingsValue get value => _value;

  bool get isLoaded => _loaded;

  Future<void> load({bool force = false}) async {
    if (_loaded && !force) return;
    try {
      final settings = await _api.settings();
      _value = BillingSettingsValue(
        companyName: settings.companyName,
        currency: settings.billingCurrency,
        timezone: settings.billingTimezone,
        email: settings.companyEmail,
        address: settings.companyAddress,
        taxId: settings.companyTaxId,
        defaultTaxRate: settings.defaultTaxRate,
        billingAutomationEnabled: settings.billingAutomationEnabled,
      );
    } catch (_) {
      // The app still renders with defaults when settings are unavailable.
    }
    _loaded = true;
    notifyListeners();
  }

  String get currency => _value.currency;

  /// Formats money in the configured billing currency.
  String money(Object? amount, [String? currencyCode]) =>
      Fmt.money(amount, currencyCode ?? _value.currency);
}

class BillingSettingsValue {
  const BillingSettingsValue({
    this.companyName = 'Billing Infra',
    this.currency = 'IDR',
    this.timezone = 'Asia/Makassar',
    this.email,
    this.address,
    this.taxId,
    this.defaultTaxRate,
    this.billingAutomationEnabled = true,
  });

  final String companyName;
  final String currency;
  final String timezone;
  final String? email;
  final String? address;
  final String? taxId;
  final String? defaultTaxRate;
  final bool billingAutomationEnabled;
}
