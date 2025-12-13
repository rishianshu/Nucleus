package minio

import "fmt"

const (
	CodeEndpointUnreachable = "E_ENDPOINT_UNREACHABLE"
	CodeAuthInvalid         = "E_AUTH_INVALID"
	CodeBucketNotFound      = "E_BUCKET_NOT_FOUND"
	CodeObjectNotFound      = "E_OBJECT_NOT_FOUND"
	CodePermissionDenied    = "E_PERMISSION_DENIED"
	CodeTimeout             = "E_TIMEOUT"
	CodeStagingWriteFailed  = "E_STAGING_WRITE_FAILED"
	CodeSinkWriteFailed     = "E_SINK_WRITE_FAILED"
)


// Error wraps MinIO-specific failures with retryability hints.
type Error struct {
	Code      string
	Retryable bool
	Err       error
}

func (e *Error) Error() string {
	if e == nil {
		return ""
	}
	if e.Err != nil {
		return fmt.Sprintf("%s: %v", e.Code, e.Err)
	}
	return e.Code
}

func (e *Error) Unwrap() error         { return e.Err }
func (e *Error) CodeValue() string     { return e.Code }
func (e *Error) RetryableStatus() bool { return e.Retryable }

func wrapError(code string, retryable bool, err error) *Error {
	if err == nil {
		return &Error{Code: code, Retryable: retryable}
	}
	return &Error{Code: code, Retryable: retryable, Err: err}
}
