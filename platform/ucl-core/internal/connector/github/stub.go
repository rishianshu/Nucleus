package github

import (
	"crypto/sha1"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"time"
)

// StubServer hosts an in-memory GitHub API for tests (no network listeners).
type StubServer struct {
	token     string
	repos     map[string]stubRepo
	handler   http.Handler
	transport http.RoundTripper
	baseURL   string
}

type stubRepo struct {
	repo  Repo
	files []stubFile
}

type stubFile struct {
	Path    string
	Content []byte
	Binary  bool
	HTMLURL string
}

// NewStubServer constructs a deterministic stub without binding to a port.
func NewStubServer() *StubServer {
	s := &StubServer{
		token:   "stub-token",
		repos:   map[string]stubRepo{},
		baseURL: "http://stub.github.local",
	}

	s.repos["octo/alpha"] = buildStubRepo("octo", "alpha", []stubFile{
		{Path: "README.md", Content: []byte("# Alpha\nHello from stub\n"), HTMLURL: "https://github.local/octo/alpha/README.md"},
		{Path: "src/main.go", Content: []byte(strings.Repeat("package main\n\n// hello world\n", 10)), HTMLURL: "https://github.local/octo/alpha/src/main.go"},
		{Path: "bin/tool", Content: []byte{0x00, 0x01, 0x02, 0x03}, Binary: true, HTMLURL: "https://github.local/octo/alpha/bin/tool"},
		{Path: "docs/big.txt", Content: []byte(strings.Repeat("large-content-", 200)), HTMLURL: "https://github.local/octo/alpha/docs/big.txt"},
	})

	s.repos["octo/beta"] = buildStubRepo("octo", "beta", []stubFile{
		{Path: "guide.md", Content: []byte("Beta guide content\nLine 2\n"), HTMLURL: "https://github.local/octo/beta/guide.md"},
	})

	mux := http.NewServeMux()
	mux.HandleFunc("/", s.handle)
	s.handler = mux
	s.transport = &stubRoundTripper{handler: mux}
	return s
}

// URL returns the stub base URL (no network listener is used).
func (s *StubServer) URL() string {
	return s.baseURL
}

// Transport returns a RoundTripper that serves requests in-process.
func (s *StubServer) Transport() http.RoundTripper {
	return s.transport
}

// Close is a no-op for compatibility with previous server-backed stubs.
func (s *StubServer) Close() {}

func (s *StubServer) handle(w http.ResponseWriter, r *http.Request) {
	auth := strings.TrimSpace(r.Header.Get("Authorization"))
	switch {
	case strings.Contains(strings.ToLower(auth), "rate-limit"):
		w.WriteHeader(http.StatusTooManyRequests)
		_, _ = w.Write([]byte(`{"message":"rate limited"}`))
		return
	case auth == "" || (!strings.HasPrefix(auth, "Bearer "+s.token) && !strings.HasPrefix(auth, "token "+s.token)):
		w.WriteHeader(http.StatusUnauthorized)
		_, _ = w.Write([]byte(`{"message":"bad credentials"}`))
		return
	}

	switch {
	case r.URL.Path == "/user":
		writeJSON(w, map[string]any{"login": "stub-user"})
	case r.URL.Path == "/user/repos":
		var repos []repoResponse
		for _, repo := range s.repos {
			repos = append(repos, repoResponse{
				Name:          repo.repo.Name,
				FullName:      repo.repo.ProjectKey(),
				DefaultBranch: repo.repo.DefaultBranch,
				HTMLURL:       repo.repo.HTMLURL,
				URL:           repo.repo.APIURL,
				Visibility:    repo.repo.Visibility,
				Owner:         ownerInfo{Login: repo.repo.Owner},
				UpdatedAt:     repo.repo.UpdatedAt.Format(time.RFC3339),
				Files:         repo.repo.Files,
			})
		}
		writeJSON(w, repos)
	case strings.HasPrefix(r.URL.Path, "/repos/") && strings.Contains(r.URL.Path, "/git/trees/"):
		s.handleTree(w, r)
	case strings.HasPrefix(r.URL.Path, "/repos/") && strings.Contains(r.URL.Path, "/contents/"):
		s.handleContents(w, r)
	case strings.HasPrefix(r.URL.Path, "/repos/"):
		s.handleRepo(w, r)
	default:
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"message":"not found"}`))
	}
}

func (s *StubServer) handleRepo(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/repos/"), "/")
	if len(parts) < 2 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	key := strings.ToLower(fmt.Sprintf("%s/%s", parts[0], parts[1]))
	repo, ok := s.repos[key]
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	writeJSON(w, repoResponse{
		Name:          repo.repo.Name,
		FullName:      repo.repo.ProjectKey(),
		DefaultBranch: repo.repo.DefaultBranch,
		HTMLURL:       repo.repo.HTMLURL,
		URL:           repo.repo.APIURL,
		Visibility:    repo.repo.Visibility,
		Owner:         ownerInfo{Login: repo.repo.Owner},
		UpdatedAt:     repo.repo.UpdatedAt.Format(time.RFC3339),
		Files:         repo.repo.Files,
	})
}

func (s *StubServer) handleTree(w http.ResponseWriter, r *http.Request) {
	parts := strings.Split(strings.TrimPrefix(r.URL.Path, "/repos/"), "/")
	if len(parts) < 4 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	key := strings.ToLower(fmt.Sprintf("%s/%s", parts[0], parts[1]))
	repo, ok := s.repos[key]
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	writeJSON(w, treeResponse{Tree: repo.repo.Files, Truncated: false})
}

func (s *StubServer) handleContents(w http.ResponseWriter, r *http.Request) {
	path := strings.TrimPrefix(r.URL.Path, "/repos/")
	parts := strings.SplitN(path, "/contents/", 2)
	if len(parts) != 2 {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	key := strings.ToLower(parts[0])
	repo, ok := s.repos[key]
	if !ok {
		w.WriteHeader(http.StatusNotFound)
		return
	}
	targetPath := strings.Trim(parts[1], "/")
	for _, file := range repo.files {
		if strings.EqualFold(file.Path, targetPath) {
			writeJSON(w, contentResponse{
				Path:     file.Path,
				SHA:      computeSHA(file.Path, file.Content),
				Size:     int64(len(file.Content)),
				HTMLURL:  file.HTMLURL,
				Content:  base64.StdEncoding.EncodeToString(file.Content),
				Encoding: "base64",
				Type:     "file",
			})
			return
		}
	}
	w.WriteHeader(http.StatusNotFound)
	_, _ = w.Write([]byte(`{"message":"not found"}`))
}

func writeJSON(w http.ResponseWriter, payload any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(payload)
}

func computeSHA(path string, content []byte) string {
	sum := sha1.Sum(append([]byte(path+"::"), content...))
	return hex.EncodeToString(sum[:])
}

func buildStubRepo(owner, name string, files []stubFile) stubRepo {
	tree := make([]treeEntry, 0, len(files))
	for _, f := range files {
		tree = append(tree, treeEntry{
			Path: f.Path,
			Type: "blob",
			SHA:  computeSHA(f.Path, f.Content),
			Size: int64(len(f.Content)),
		})
	}
	return stubRepo{
		repo: Repo{
			Owner:         owner,
			Name:          name,
			DefaultBranch: "main",
			HTMLURL:       fmt.Sprintf("https://github.local/%s/%s", owner, name),
			APIURL:        fmt.Sprintf("https://api.github.local/repos/%s/%s", owner, name),
			Visibility:    "public",
			UpdatedAt:     time.Date(2025, 12, 13, 0, 0, 0, 0, time.UTC),
			Files:         tree,
		},
		files: files,
	}
}

type stubRoundTripper struct {
	handler http.Handler
}

func (rt *stubRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	rr := httptest.NewRecorder()
	rt.handler.ServeHTTP(rr, req)
	res := rr.Result()
	res.Request = req
	return res, nil
}
