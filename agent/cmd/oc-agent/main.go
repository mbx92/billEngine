package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"

	"github.com/mbx92/billEngine/agent/internal/agent"
	"github.com/mbx92/billEngine/agent/internal/config"
)

func main() {
	logger := slog.New(slog.NewJSONHandler(os.Stdout, nil))
	cfg, err := config.Load()
	if err != nil {
		logger.Error("invalid agent configuration", "error", err)
		os.Exit(1)
	}

	ctx, cancel := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer cancel()

	if err := agent.New(cfg, logger).Run(ctx); err != nil && !errors.Is(err, context.Canceled) {
		logger.Error("agent stopped", "error", err)
		os.Exit(1)
	}
}
