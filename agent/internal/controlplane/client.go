package controlplane

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/mbx92/billEngine/agent/internal/docker"
	"github.com/mbx92/billEngine/agent/internal/platform"
)

const ProtocolVersion = "1"

type Client struct {
	baseURL    string
	httpClient *http.Client
}

type Identity struct {
	NodeID          string `json:"nodeId"`
	NodeName        string `json:"nodeName"`
	Environment     string `json:"environment"`
	Role            string `json:"role"`
	Credential      string `json:"credential"`
	ProtocolVersion string `json:"protocolVersion"`
}

type EnrollmentRequest struct {
	Token           string   `json:"token"`
	AgentVersion    string   `json:"agentVersion"`
	ProtocolVersion string   `json:"protocolVersion"`
	OSRelease       string   `json:"osRelease"`
	Architecture    string   `json:"architecture"`
	DockerVersion   string   `json:"dockerVersion"`
	ComposeVersion  string   `json:"composeVersion"`
	Capabilities    []string `json:"capabilities"`
}

type HeartbeatRequest struct {
	AgentVersion    string            `json:"agentVersion"`
	ProtocolVersion string            `json:"protocolVersion"`
	OSRelease       string            `json:"osRelease"`
	Architecture    string            `json:"architecture"`
	DockerVersion   string            `json:"dockerVersion"`
	ComposeVersion  string            `json:"composeVersion"`
	Capabilities    []string          `json:"capabilities"`
	Capacity        platform.Capacity `json:"capacity"`
	Usage           *platform.Usage   `json:"usage,omitempty"`
	Gateway         *docker.Gateway   `json:"gateway,omitempty"`
	Update          *AgentUpdate      `json:"update,omitempty"`
}

type AgentUpdate struct {
	PreviousVersion string `json:"previousVersion,omitempty"`
}

type InventoryRequest struct {
	ObservedAt time.Time         `json:"observedAt"`
	Resources  []docker.Resource `json:"resources"`
}

type Operation struct {
	ID                       string          `json:"id"`
	ResourceID               string          `json:"resourceId"`
	CorrelationID            string          `json:"correlationId"`
	Action                   string          `json:"action"`
	Status                   string          `json:"status"`
	ExpectedResourceRevision *int            `json:"expectedResourceRevision"`
	Payload                  json.RawMessage `json:"payload"`
	AttemptCount             int             `json:"attemptCount"`
	MaxAttempts              int             `json:"maxAttempts"`
}

type OperationStatusRequest struct {
	Status           string         `json:"status"`
	Retryable        bool           `json:"retryable"`
	Result           map[string]any `json:"result,omitempty"`
	ErrorCode        string         `json:"errorCode,omitempty"`
	ErrorMessage     string         `json:"errorMessage,omitempty"`
	ObservedRevision *int           `json:"observedRevision,omitempty"`
}

type OperationSecrets struct {
	Secrets  map[string]string   `json:"secrets"`
	Registry *RegistryCredential `json:"registry"`
}

type RegistryCredential struct {
	Host     string `json:"host"`
	Username string `json:"username"`
	Token    string `json:"token"`
}

func New(baseURL string, client *http.Client) *Client {
	return &Client{baseURL: strings.TrimRight(baseURL, "/"), httpClient: client}
}

func (c *Client) Enroll(ctx context.Context, request EnrollmentRequest) (Identity, error) {
	var response struct {
		Data Identity `json:"data"`
	}
	if err := c.do(ctx, http.MethodPost, "/api/infrastructure/agent/enroll", "", request, &response); err != nil {
		return Identity{}, err
	}
	if response.Data.NodeID == "" || response.Data.Credential == "" {
		return Identity{}, errors.New("control plane returned an incomplete identity")
	}
	return response.Data, nil
}

func (c *Client) Heartbeat(ctx context.Context, credential string, request HeartbeatRequest) error {
	return c.do(ctx, http.MethodPost, "/api/infrastructure/agent/heartbeat", credential, request, nil)
}

func (c *Client) Inventory(ctx context.Context, credential string, request InventoryRequest) error {
	return c.do(ctx, http.MethodPost, "/api/infrastructure/agent/inventory", credential, request, nil)
}

func (c *Client) NextOperation(ctx context.Context, credential string) (*Operation, error) {
	var response struct {
		Data *Operation `json:"data"`
	}
	if err := c.do(ctx, http.MethodGet, "/api/infrastructure/agent/operations/next", credential, nil, &response); err != nil {
		return nil, err
	}
	return response.Data, nil
}

func (c *Client) UpdateOperation(
	ctx context.Context,
	credential string,
	operationID string,
	request OperationStatusRequest,
) error {
	return c.do(
		ctx,
		http.MethodPost,
		"/api/infrastructure/agent/operations/"+operationID+"/status",
		credential,
		request,
		nil,
	)
}

func (c *Client) OperationSecrets(
	ctx context.Context,
	credential string,
	operationID string,
) (OperationSecrets, error) {
	var response struct {
		Data OperationSecrets `json:"data"`
	}
	err := c.do(
		ctx,
		http.MethodGet,
		"/api/infrastructure/agent/operations/"+operationID+"/secrets",
		credential,
		nil,
		&response,
	)
	return response.Data, err
}

func (c *Client) DownloadAgentBinary(
	ctx context.Context,
	credential string,
	architecture string,
	destination io.Writer,
	maxBytes int64,
) (int64, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodGet,
		c.baseURL+"/api/infrastructure/agent/binary?arch="+architecture,
		http.NoBody,
	)
	if err != nil {
		return 0, fmt.Errorf("create agent download request: %w", err)
	}
	request.Header.Set("User-Agent", "oc-agent")
	request.Header.Set("Authorization", "Bearer "+credential)

	response, err := c.httpClient.Do(request)
	if err != nil {
		return 0, fmt.Errorf("download agent binary: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		limited, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return 0, fmt.Errorf(
			"agent binary endpoint returned HTTP %d: %s",
			response.StatusCode,
			strings.TrimSpace(string(limited)),
		)
	}

	written, err := io.Copy(destination, io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return written, fmt.Errorf("write agent binary: %w", err)
	}
	if written > maxBytes {
		return written, fmt.Errorf("agent binary exceeds the %d byte limit", maxBytes)
	}
	return written, nil
}

func (c *Client) do(
	ctx context.Context,
	method string,
	path string,
	credential string,
	payload any,
	result any,
) error {
	var body io.Reader = http.NoBody
	if payload != nil {
		encoded, err := json.Marshal(payload)
		if err != nil {
			return fmt.Errorf("encode request: %w", err)
		}
		body = bytes.NewReader(encoded)
	}
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return fmt.Errorf("create request: %w", err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("User-Agent", "oc-agent")
	if credential != "" {
		request.Header.Set("Authorization", "Bearer "+credential)
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("control plane request: %w", err)
	}
	defer response.Body.Close()

	if response.StatusCode < 200 || response.StatusCode >= 300 {
		limited, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
		return fmt.Errorf("control plane returned HTTP %d: %s", response.StatusCode, strings.TrimSpace(string(limited)))
	}
	if result == nil {
		_, _ = io.Copy(io.Discard, response.Body)
		return nil
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(result); err != nil {
		return fmt.Errorf("decode control plane response: %w", err)
	}
	return nil
}
