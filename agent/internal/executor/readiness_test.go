package executor

import (
	"context"
	"testing"
)

func TestReadinessRejectsExitedAndUnhealthyApplications(t *testing.T) {
	for _, fixture := range []struct{ state, code string }{
		{`{"Running":false}`, "application_not_running"},
		{`{"Running":true,"Health":{"Status":"unhealthy"}}`, "application_unhealthy"},
	} {
		failure := waitApplicationReady(context.Background(), "example", func(context.Context, string, ...string) ([]byte, error) {
			return []byte(fixture.state), nil
		})
		if failure == nil || failure.Code != fixture.code {
			t.Fatalf("state %s: %#v", fixture.state, failure)
		}
	}
}

func TestReadinessAcceptsHealthyApplication(t *testing.T) {
	failure := waitApplicationReady(context.Background(), "example", func(context.Context, string, ...string) ([]byte, error) {
		return []byte(`{"Running":true,"Health":{"Status":"healthy"}}`), nil
	})
	if failure != nil {
		t.Fatal(failure)
	}
}
