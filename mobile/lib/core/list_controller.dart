import 'package:flutter/foundation.dart';

import 'package:billengine_mobile/core/api_exception.dart';
import 'package:billengine_mobile/models/json.dart';

/// Paginated list loader shared by every list screen.
///
/// Each screen supplies a `fetch` callback that returns one page of rows plus
/// the `PageMeta` envelope, so paging, refresh, and error handling live in one
/// place.
class ListController<T> extends ChangeNotifier {
  ListController({required this.fetch, this.perPage = 25});

  final Future<({List<T> rows, PageMeta meta})> Function(int page, int perPage) fetch;
  final int perPage;

  final List<T> _rows = <T>[];
  PageMeta _meta = const PageMeta.empty();
  String? _error;
  bool _loading = false;
  bool _loaded = false;
  int _page = 1;

  List<T> get rows => List<T>.unmodifiable(_rows);

  PageMeta get meta => _meta;

  String? get error => _error;

  bool get isLoading => _loading;

  bool get isLoaded => _loaded;

  bool get isEmpty => _loaded && _rows.isEmpty;

  bool get hasMore => _meta.hasMore;

  /// Loads the first page. `refresh: true` reloads page 1 even when data has
  /// already been fetched.
  Future<void> load({bool refresh = false}) async {
    if (_loading) return;
    if (_loaded && !refresh) return;
    await _fetchPage(1, replace: true);
  }

  Future<void> refresh() => _fetchPage(1, replace: true);

  Future<void> loadMore() async {
    if (_loading || !_meta.hasMore) return;
    await _fetchPage(_page + 1, replace: false);
  }

  Future<void> _fetchPage(int page, {required bool replace}) async {
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      final result = await fetch(page, perPage);
      if (replace) _rows.clear();
      _rows.addAll(result.rows);
      _meta = result.meta;
      _page = page;
      _loaded = true;
    } on ApiException catch (error) {
      _error = error.message;
      if (replace) _rows.clear();
    } catch (error) {
      _error = '$error';
      if (replace) _rows.clear();
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  /// Replaces the in-memory rows after an inline edit.
  void replaceWhere(bool Function(T row) test, T updated) {
    final index = _rows.indexWhere(test);
    if (index == -1) return;
    _rows[index] = updated;
    notifyListeners();
  }

  void removeWhere(bool Function(T row) test) {
    final before = _rows.length;
    _rows.removeWhere(test);
    if (before != _rows.length) notifyListeners();
  }
}

/// Single-object loader used by detail screens and option endpoints.
class ItemController<T> extends ChangeNotifier {
  ItemController({required this.fetch});

  /// Mutable so screens can rebind the fetcher when a filter changes.
  Future<T> Function() fetch;

  T? _value;
  String? _error;
  bool _loading = false;
  bool _loaded = false;

  T? get value => _value;

  String? get error => _error;

  bool get isLoading => _loading;

  bool get isLoaded => _loaded;

  Future<T?> load({bool refresh = false}) async {
    if (_loading) return _value;
    if (_loaded && !refresh) return _value;
    _loading = true;
    _error = null;
    notifyListeners();
    try {
      _value = await fetch();
      _loaded = true;
      return _value;
    } on ApiException catch (error) {
      _error = error.message;
      return null;
    } catch (error) {
      _error = '$error';
      return null;
    } finally {
      _loading = false;
      notifyListeners();
    }
  }

  /// Reloads the current value regardless of the cached state.
  Future<T?> refresh() => load(refresh: true);
}

/// Wraps a one-shot action (POST/PATCH/DELETE) with pending and error state.
class ActionController extends ChangeNotifier {
  bool _pending = false;
  String? _error;

  bool get isPending => _pending;

  String? get error => _error;

  Future<bool> run(Future<void> Function() action) async {
    if (_pending) return false;
    _pending = true;
    _error = null;
    notifyListeners();
    try {
      await action();
      return true;
    } on ApiException catch (error) {
      _error = error.message;
      return false;
    } catch (error) {
      _error = '$error';
      return false;
    } finally {
      _pending = false;
      notifyListeners();
    }
  }

  void clearError() {
    _error = null;
    notifyListeners();
  }
}
