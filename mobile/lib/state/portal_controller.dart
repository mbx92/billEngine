import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/models/portal.dart';
import 'package:billengine_mobile/services/api_service.dart';

/// Loads the portal summary once and shares it across the portal tabs so the
/// bottom navigation does not hit `/api/portal/summary` four times.
class PortalController extends ItemController<PortalSummary> {
  PortalController({required ApiService api}) : super(fetch: api.portalSummary);

  PortalSummary? get summary => value;

  PortalCustomer? get customer => value?.customer;
}
