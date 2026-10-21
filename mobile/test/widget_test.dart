import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:billengine_mobile/core/theme.dart';

void main() {
  testWidgets('theme builds a Material 3 app with the billing shell', (tester) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.build(Brightness.light),
        darkTheme: AppTheme.build(Brightness.dark),
        home: const Scaffold(body: Center(child: Text('Billing Infra'))),
      ),
    );

    expect(find.text('Billing Infra'), findsOneWidget);
    expect(Theme.of(tester.element(find.text('Billing Infra'))).useMaterial3, isTrue);
  });
}
