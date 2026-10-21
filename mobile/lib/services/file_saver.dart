import 'dart:io';

import 'package:open_filex/open_filex.dart';
import 'package:path_provider/path_provider.dart';

import 'package:billengine_mobile/core/api_client.dart';

/// Writes downloaded PDF/CSV payloads into the app cache and hands them to the
/// platform viewer, which is how a server-generated invoice PDF is opened on
/// Android without shipping a WebView.
class FileSaver {
  const FileSaver();

  Future<File> save(DownloadResult download, String fallbackName) async {
    final directory = await getTemporaryDirectory();
    final name = safeName(download.filename ?? fallbackName);
    final file = File('${directory.path}/$name');
    await file.writeAsBytes(download.bytes, flush: true);
    return file;
  }

  Future<({OpenResult result, File file})> saveAndOpen(
    DownloadResult download,
    String fallbackName,
  ) async {
    final file = await save(download, fallbackName);
    final result = await OpenFilex.open(file.path);
    return (result: result, file: file);
  }

  static String safeName(String value) {
    final cleaned = value.replaceAll(RegExp(r'[^A-Za-z0-9._-]'), '-');
    return cleaned.isEmpty ? 'document.bin' : cleaned;
  }
}
