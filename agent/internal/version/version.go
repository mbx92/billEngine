package version

import (
	_ "embed"
	"strings"
)

//go:embed VERSION
var embedded string

var Value = strings.TrimSpace(embedded)
