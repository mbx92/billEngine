package agent

import (
	"context"
	"log/slog"
	"strings"
	"sync"
	"time"

	"github.com/mbx92/billEngine/agent/internal/controlplane"
)

const (
	operationLogFlushEvery = 750 * time.Millisecond
	operationLogBatchSize  = 25
	operationLogQueueLimit = 200
)

type operationLogReporter struct {
	ctx         context.Context
	client      *controlplane.Client
	credential  string
	operationID string
	logger      *slog.Logger

	mu      sync.Mutex
	flushMu sync.Mutex
	entries []controlplane.OperationLogEntry
	wake    chan struct{}
	stop    chan struct{}
	done    chan struct{}
	once    sync.Once
}

func newOperationLogReporter(
	ctx context.Context,
	client *controlplane.Client,
	credential string,
	operationID string,
	logger *slog.Logger,
) *operationLogReporter {
	reporter := &operationLogReporter{
		ctx:         ctx,
		client:      client,
		credential:  credential,
		operationID: operationID,
		logger:      logger,
		wake:        make(chan struct{}, 1),
		stop:        make(chan struct{}),
		done:        make(chan struct{}),
	}
	go reporter.run()
	return reporter
}

func (reporter *operationLogReporter) Emit(level string, message string) {
	message = strings.TrimSpace(message)
	if message == "" {
		return
	}
	if len(message) > 4000 {
		message = message[len(message)-4000:]
	}
	if level != "warning" && level != "error" {
		level = "info"
	}
	reporter.mu.Lock()
	reporter.entries = append(reporter.entries, controlplane.OperationLogEntry{
		OccurredAt: time.Now().UTC(),
		Level:      level,
		Message:    message,
	})
	if len(reporter.entries) > operationLogQueueLimit {
		reporter.entries = reporter.entries[len(reporter.entries)-operationLogQueueLimit:]
	}
	shouldWake := len(reporter.entries) >= operationLogBatchSize
	reporter.mu.Unlock()
	if shouldWake {
		select {
		case reporter.wake <- struct{}{}:
		default:
		}
	}
}

func (reporter *operationLogReporter) Flush() {
	reporter.flushAll()
}

func (reporter *operationLogReporter) Close() {
	reporter.once.Do(func() { close(reporter.stop) })
	<-reporter.done
}

func (reporter *operationLogReporter) run() {
	defer close(reporter.done)
	ticker := time.NewTicker(operationLogFlushEvery)
	defer ticker.Stop()
	for {
		select {
		case <-ticker.C:
			reporter.flush()
		case <-reporter.wake:
			reporter.flush()
		case <-reporter.stop:
			reporter.flushAll()
			return
		case <-reporter.ctx.Done():
			reporter.flushAll()
			return
		}
	}
}

func (reporter *operationLogReporter) flushAll() {
	for reporter.flush() {
	}
}

func (reporter *operationLogReporter) flush() bool {
	reporter.flushMu.Lock()
	defer reporter.flushMu.Unlock()

	reporter.mu.Lock()
	if len(reporter.entries) == 0 {
		reporter.mu.Unlock()
		return false
	}
	count := min(len(reporter.entries), operationLogBatchSize)
	entries := append([]controlplane.OperationLogEntry(nil), reporter.entries[:count]...)
	reporter.entries = reporter.entries[count:]
	reporter.mu.Unlock()

	requestCtx, cancel := context.WithTimeout(reporter.ctx, 5*time.Second)
	err := reporter.client.AppendOperationLogs(
		requestCtx,
		reporter.credential,
		reporter.operationID,
		controlplane.OperationLogRequest{Entries: entries},
	)
	cancel()
	if err == nil {
		return true
	}
	reporter.logger.Warn("operation logs could not be uploaded", "operation_id", reporter.operationID, "error", err)
	reporter.mu.Lock()
	reporter.entries = append(entries, reporter.entries...)
	if len(reporter.entries) > operationLogQueueLimit {
		reporter.entries = reporter.entries[:operationLogQueueLimit]
	}
	reporter.mu.Unlock()
	return false
}
