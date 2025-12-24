package activities

import (
	"os"
	"strings"
)

// getenv returns the env var or the default if empty.
func getenv(key, def string) string {
	if v := strings.TrimSpace(os.Getenv(key)); v != "" {
		return v
	}
	return def
}
