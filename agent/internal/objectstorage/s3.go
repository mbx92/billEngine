package objectstorage

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
)

type S3Target struct {
	Endpoint  string `json:"endpoint"`
	Region    string `json:"region"`
	Bucket    string `json:"bucket"`
	ObjectKey string `json:"objectKey"`
	PathStyle bool   `json:"pathStyle"`
}

type S3Client struct {
	AccessKey string
	SecretKey string
	HTTP      *http.Client
}

func (c S3Client) Upload(ctx context.Context, target S3Target, filePath, payloadHash string) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	request, err := c.request(ctx, http.MethodPut, target, file, payloadHash)
	if err != nil {
		return err
	}
	request.ContentLength = info.Size()
	return c.execute(request, nil)
}

func (c S3Client) Download(ctx context.Context, target S3Target, filePath string) error {
	emptyHash := sha256.Sum256(nil)
	request, err := c.request(ctx, http.MethodGet, target, nil, hex.EncodeToString(emptyHash[:]))
	if err != nil {
		return err
	}
	temporary := filePath + ".download"
	file, err := os.OpenFile(temporary, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, 0o600)
	if err != nil {
		return err
	}
	if err := c.execute(request, file); err != nil {
		_ = file.Close()
		_ = os.Remove(temporary)
		return err
	}
	if err := file.Close(); err != nil {
		_ = os.Remove(temporary)
		return err
	}
	return os.Rename(temporary, filePath)
}

func (c S3Client) Delete(ctx context.Context, target S3Target) error {
	emptyHash := sha256.Sum256(nil)
	request, err := c.request(ctx, http.MethodDelete, target, nil, hex.EncodeToString(emptyHash[:]))
	if err != nil {
		return err
	}
	return c.execute(request, nil)
}

func (c S3Client) request(
	ctx context.Context,
	method string,
	target S3Target,
	body io.Reader,
	payloadHash string,
) (*http.Request, error) {
	if c.AccessKey == "" || c.SecretKey == "" {
		return nil, errors.New("S3 credentials are missing")
	}
	endpoint, err := url.Parse(target.Endpoint)
	if err != nil || (endpoint.Scheme != "https" && endpoint.Scheme != "http") || endpoint.Host == "" {
		return nil, errors.New("invalid S3 endpoint")
	}
	if target.Region == "" || target.Bucket == "" || target.ObjectKey == "" {
		return nil, errors.New("incomplete S3 target")
	}
	endpoint.RawQuery = ""
	endpoint.Fragment = ""
	if target.PathStyle {
		endpoint.Path = path.Join(endpoint.Path, target.Bucket, target.ObjectKey)
	} else {
		endpoint.Host = target.Bucket + "." + endpoint.Host
		endpoint.Path = path.Join(endpoint.Path, target.ObjectKey)
	}
	if !strings.HasPrefix(endpoint.Path, "/") {
		endpoint.Path = "/" + endpoint.Path
	}
	request, err := http.NewRequestWithContext(ctx, method, endpoint.String(), body)
	if err != nil {
		return nil, err
	}
	now := time.Now().UTC()
	amzDate := now.Format("20060102T150405Z")
	date := now.Format("20060102")
	request.Header.Set("x-amz-content-sha256", payloadHash)
	request.Header.Set("x-amz-date", amzDate)
	canonicalHeaders := "host:" + request.URL.Host + "\n" +
		"x-amz-content-sha256:" + payloadHash + "\n" +
		"x-amz-date:" + amzDate + "\n"
	signedHeaders := "host;x-amz-content-sha256;x-amz-date"
	canonicalRequest := strings.Join([]string{
		method,
		request.URL.EscapedPath(),
		request.URL.Query().Encode(),
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	}, "\n")
	canonicalHash := sha256.Sum256([]byte(canonicalRequest))
	scope := date + "/" + target.Region + "/s3/aws4_request"
	stringToSign := "AWS4-HMAC-SHA256\n" + amzDate + "\n" + scope + "\n" + hex.EncodeToString(canonicalHash[:])
	signingKey := signatureKey(c.SecretKey, date, target.Region)
	signature := hex.EncodeToString(hmacSHA256(signingKey, stringToSign))
	request.Header.Set("Authorization", "AWS4-HMAC-SHA256 Credential="+c.AccessKey+"/"+scope+", SignedHeaders="+signedHeaders+", Signature="+signature)
	return request, nil
}

func (c S3Client) execute(request *http.Request, destination io.Writer) error {
	client := c.HTTP
	if client == nil {
		client = &http.Client{Timeout: 60 * time.Minute}
	}
	response, err := client.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		message, _ := io.ReadAll(io.LimitReader(response.Body, 500))
		return fmt.Errorf("S3 request failed (%d): %s", response.StatusCode, strings.TrimSpace(string(message)))
	}
	if destination != nil {
		_, err = io.Copy(destination, response.Body)
		return err
	}
	return nil
}

func signatureKey(secret, date, region string) []byte {
	dateKey := hmacSHA256([]byte("AWS4"+secret), date)
	regionKey := hmacSHA256(dateKey, region)
	serviceKey := hmacSHA256(regionKey, "s3")
	return hmacSHA256(serviceKey, "aws4_request")
}

func hmacSHA256(key []byte, value string) []byte {
	hash := hmac.New(sha256.New, key)
	_, _ = hash.Write([]byte(value))
	return hash.Sum(nil)
}
