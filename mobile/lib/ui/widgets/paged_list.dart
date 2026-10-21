import 'package:flutter/material.dart';
import 'package:provider/provider.dart';

import 'package:billengine_mobile/core/list_controller.dart';
import 'package:billengine_mobile/core/theme.dart';
import 'package:billengine_mobile/ui/widgets/common.dart';

/// Scrollable, paginated list body shared by every admin list screen.
///
/// Handles the loading shell, the error state, the empty state, and infinite
/// scroll ("load more") so screens only describe a single row.
class PagedList<T> extends StatefulWidget {
  const PagedList({
    super.key,
    required this.controller,
    required this.itemBuilder,
    required this.emptyTitle,
    this.emptyDescription,
    this.emptyIcon = Icons.inbox_outlined,
    this.emptyAction,
    this.header,
    this.padding = const EdgeInsets.only(bottom: 24),
    this.separator = 8,
  });

  final ListController<T> controller;
  final Widget Function(BuildContext context, T item, int index) itemBuilder;
  final String emptyTitle;
  final String? emptyDescription;
  final IconData emptyIcon;
  final Widget? emptyAction;
  final Widget? header;
  final EdgeInsets padding;
  final double separator;

  @override
  State<PagedList<T>> createState() => _PagedListState<T>();
}

class _PagedListState<T> extends State<PagedList<T>> {
  final _scroll = ScrollController();

  @override
  void initState() {
    super.initState();
    _scroll.addListener(_onScroll);
  }

  @override
  void dispose() {
    _scroll.removeListener(_onScroll);
    _scroll.dispose();
    super.dispose();
  }

  void _onScroll() {
    if (!_scroll.hasClients) return;
    if (_scroll.position.pixels >= _scroll.position.maxScrollExtent - 240) {
      widget.controller.loadMore();
    }
  }

  @override
  Widget build(BuildContext context) {
    return Consumer<ListController<T>>(
      builder: (context, controller, _) {
        final rows = controller.rows;

        if (controller.isLoading && !controller.isLoaded) {
          return ListView(
            controller: _scroll,
            padding: widget.padding,
            children: [
              if (widget.header != null) widget.header!,
              const LoadingList(count: 5, height: 76),
            ],
          );
        }

        if (controller.error != null && rows.isEmpty) {
          return ListView(
            controller: _scroll,
            padding: widget.padding,
            children: [
              if (widget.header != null) widget.header!,
              ErrorState(message: controller.error!, onRetry: controller.refresh),
            ],
          );
        }

        if (rows.isEmpty) {
          return ListView(
            controller: _scroll,
            padding: widget.padding,
            children: [
              if (widget.header != null) widget.header!,
              EmptyState(
                title: widget.emptyTitle,
                description: widget.emptyDescription,
                icon: widget.emptyIcon,
                action: widget.emptyAction,
              ),
            ],
          );
        }

        return ListView.separated(
          controller: _scroll,
          padding: widget.padding,
          itemCount: rows.length + 2 + (widget.header != null ? 1 : 0),
          separatorBuilder: (_, _) => SizedBox(height: widget.separator),
          itemBuilder: (context, index) {
            var offset = index;
            if (widget.header != null) {
              if (offset == 0) return widget.header!;
              offset -= 1;
            }
            if (offset == rows.length) {
              return controller.hasMore
                  ? const Padding(
                      padding: EdgeInsets.symmetric(vertical: 14),
                      child: Center(
                        child: SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        ),
                      ),
                    )
                  : const SizedBox.shrink();
            }
            if (offset == rows.length + 1) {
              return Padding(
                padding: const EdgeInsets.only(top: 8),
                child: Text(
                  '${controller.meta.total} data · halaman ${controller.meta.page}/${controller.meta.totalPages}',
                  textAlign: TextAlign.center,
                  style: Theme.of(context).textTheme.bodySmall,
                ),
              );
            }
            return widget.itemBuilder(context, rows[offset], offset);
          },
        );
      },
    );
  }
}

/// Small labelled counter row used above list bodies (e.g. "12 customers").
class ListCountHeader extends StatelessWidget {
  const ListCountHeader({super.key, required this.label, this.trailing});

  final String label;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final colors = context.colors;
    return Padding(
      padding: const EdgeInsets.only(bottom: 8),
      child: Row(
        children: [
          Expanded(
            child: Text(label, style: TextStyle(fontSize: 11.5, color: colors.muted)),
          ),
          ?trailing,
        ],
      ),
    );
  }
}
