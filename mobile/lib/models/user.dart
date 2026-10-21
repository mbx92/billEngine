import 'package:billengine_mobile/models/json.dart';

/// Mirrors `ApiCurrentUser` / `ApiUser` in `shared/types/api.ts`.
class AppUser {
  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    required this.role,
    this.customerId,
    this.customerName,
    this.createdAt,
  });

  final String id;
  final String name;
  final String email;
  final String role;
  final String? customerId;
  final String? customerName;
  final DateTime? createdAt;

  bool get isSuperAdmin => role == 'super_admin';

  bool get isAdmin => role == 'admin' || role == 'super_admin';

  bool get isCustomer => role == 'customer';

  String get roleLabel => switch (role) {
    'super_admin' => 'Super admin',
    'admin' => 'Admin',
    'customer' => 'Customer',
    _ => role,
  };

  factory AppUser.fromJson(Json json) {
    return AppUser(
      id: asStringOr(json['id'], ''),
      name: asStringOr(json['name'], ''),
      email: asStringOr(json['email'], ''),
      role: asStringOr(json['role'], 'customer'),
      customerId: asString(json['customerId']),
      customerName: asString(json['customerName']),
      createdAt: asDate(json['createdAt']),
    );
  }
}
