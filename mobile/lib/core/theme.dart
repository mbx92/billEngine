import 'package:flutter/material.dart';

/// Colour tokens copied from `app/assets/css/main.css` so the mobile client
/// matches the web console in both light and dark mode.
class AppColors extends ThemeExtension<AppColors> {
  const AppColors({
    required this.canvas,
    required this.surface,
    required this.surfaceRaised,
    required this.line,
    required this.lineStrong,
    required this.ink,
    required this.muted,
    required this.brand,
    required this.brandStrong,
    required this.danger,
    required this.warning,
    required this.info,
  });

  final Color canvas;
  final Color surface;
  final Color surfaceRaised;
  final Color line;
  final Color lineStrong;
  final Color ink;
  final Color muted;
  final Color brand;
  final Color brandStrong;
  final Color danger;
  final Color warning;
  final Color info;

  static const AppColors light = AppColors(
    canvas: Color(0xFFF4F6F8),
    surface: Color(0xFFFFFFFF),
    surfaceRaised: Color(0xFFEEF2F5),
    line: Color(0xFFDCE2E8),
    lineStrong: Color(0xFFC5CED8),
    ink: Color(0xFF17202B),
    muted: Color(0xFF667386),
    brand: Color(0xFF15803D),
    brandStrong: Color(0xFF166534),
    danger: Color(0xFFBE123C),
    warning: Color(0xFFB45309),
    info: Color(0xFF2563EB),
  );

  static const AppColors dark = AppColors(
    canvas: Color(0xFF080B10),
    surface: Color(0xFF10151D),
    surfaceRaised: Color(0xFF151B24),
    line: Color(0xFF242C38),
    lineStrong: Color(0xFF334052),
    ink: Color(0xFFE8EDF4),
    muted: Color(0xFF8C98A8),
    brand: Color(0xFF4ADE80),
    brandStrong: Color(0xFF22C55E),
    danger: Color(0xFFFB7185),
    warning: Color(0xFFFBBF24),
    info: Color(0xFF60A5FA),
  );

  @override
  AppColors copyWith({
    Color? canvas,
    Color? surface,
    Color? surfaceRaised,
    Color? line,
    Color? lineStrong,
    Color? ink,
    Color? muted,
    Color? brand,
    Color? brandStrong,
    Color? danger,
    Color? warning,
    Color? info,
  }) {
    return AppColors(
      canvas: canvas ?? this.canvas,
      surface: surface ?? this.surface,
      surfaceRaised: surfaceRaised ?? this.surfaceRaised,
      line: line ?? this.line,
      lineStrong: lineStrong ?? this.lineStrong,
      ink: ink ?? this.ink,
      muted: muted ?? this.muted,
      brand: brand ?? this.brand,
      brandStrong: brandStrong ?? this.brandStrong,
      danger: danger ?? this.danger,
      warning: warning ?? this.warning,
      info: info ?? this.info,
    );
  }

  @override
  AppColors lerp(ThemeExtension<AppColors>? other, double t) {
    if (other is! AppColors) return this;
    return AppColors(
      canvas: Color.lerp(canvas, other.canvas, t)!,
      surface: Color.lerp(surface, other.surface, t)!,
      surfaceRaised: Color.lerp(surfaceRaised, other.surfaceRaised, t)!,
      line: Color.lerp(line, other.line, t)!,
      lineStrong: Color.lerp(lineStrong, other.lineStrong, t)!,
      ink: Color.lerp(ink, other.ink, t)!,
      muted: Color.lerp(muted, other.muted, t)!,
      brand: Color.lerp(brand, other.brand, t)!,
      brandStrong: Color.lerp(brandStrong, other.brandStrong, t)!,
      danger: Color.lerp(danger, other.danger, t)!,
      warning: Color.lerp(warning, other.warning, t)!,
      info: Color.lerp(info, other.info, t)!,
    );
  }
}

extension AppColorsContext on BuildContext {
  AppColors get colors => Theme.of(this).extension<AppColors>() ?? AppColors.light;
}

class AppTheme {
  AppTheme._();

  static ThemeData build(Brightness brightness) {
    final colors = brightness == Brightness.dark ? AppColors.dark : AppColors.light;
    final scheme =
        ColorScheme.fromSeed(
          seedColor: colors.brand,
          brightness: brightness,
        ).copyWith(
          surface: colors.surface,
          onSurface: colors.ink,
          primary: colors.brand,
          onPrimary: brightness == Brightness.dark ? const Color(0xFF05230F) : Colors.white,
          error: colors.danger,
          outline: colors.lineStrong,
        );

    final base = ThemeData(
      useMaterial3: true,
      brightness: brightness,
      colorScheme: scheme,
      scaffoldBackgroundColor: colors.canvas,
      canvasColor: colors.canvas,
      dividerColor: colors.line,
      fontFamily: 'Roboto',
    );

    return base.copyWith(
      extensions: <ThemeExtension<dynamic>>[colors],
      appBarTheme: AppBarTheme(
        backgroundColor: colors.canvas,
        foregroundColor: colors.ink,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        centerTitle: false,
        scrolledUnderElevation: 0.5,
        titleTextStyle: TextStyle(
          color: colors.ink,
          fontSize: 17,
          fontWeight: FontWeight.w600,
          letterSpacing: -0.2,
        ),
      ),
      cardTheme: CardThemeData(
        color: colors.surface,
        surfaceTintColor: Colors.transparent,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(12),
          side: BorderSide(color: colors.line),
        ),
      ),
      dividerTheme: DividerThemeData(color: colors.line, thickness: 1, space: 1),
      listTileTheme: ListTileThemeData(
        iconColor: colors.muted,
        textColor: colors.ink,
        contentPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 4),
      ),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: colors.surface,
        isDense: true,
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 14),
        hintStyle: TextStyle(color: colors.muted, fontSize: 14),
        labelStyle: TextStyle(color: colors.muted, fontSize: 14),
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: colors.lineStrong),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: colors.line),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: colors.brand, width: 1.6),
        ),
        errorBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(10),
          borderSide: BorderSide(color: colors.danger),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          backgroundColor: colors.brand,
          foregroundColor: brightness == Brightness.dark ? const Color(0xFF05230F) : Colors.white,
          minimumSize: const Size(0, 44),
          padding: const EdgeInsets.symmetric(horizontal: 18),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          foregroundColor: colors.ink,
          minimumSize: const Size(0, 44),
          padding: const EdgeInsets.symmetric(horizontal: 16),
          side: BorderSide(color: colors.lineStrong),
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
        ),
      ),
      textButtonTheme: TextButtonThemeData(
        style: TextButton.styleFrom(
          foregroundColor: colors.brand,
          textStyle: const TextStyle(fontWeight: FontWeight.w600, fontSize: 14),
        ),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: colors.surfaceRaised,
        side: BorderSide(color: colors.line),
        labelStyle: TextStyle(color: colors.ink, fontSize: 12),
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(999)),
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        backgroundColor: colors.ink,
        contentTextStyle: TextStyle(color: colors.surface, fontSize: 13),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: colors.surface,
        surfaceTintColor: Colors.transparent,
        indicatorColor: colors.brand.withValues(alpha: 0.14),
        elevation: 0,
        labelTextStyle: WidgetStatePropertyAll(
          TextStyle(fontSize: 11, fontWeight: FontWeight.w600, color: colors.muted),
        ),
      ),
      progressIndicatorTheme: ProgressIndicatorThemeData(color: colors.brand),
      textTheme: base.textTheme.apply(bodyColor: colors.ink, displayColor: colors.ink),
    );
  }
}
