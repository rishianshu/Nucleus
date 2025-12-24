package activities

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"hash/fnv"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"
)

// EmbeddingProvider defines the minimal embed API.
type EmbeddingProvider interface {
	EmbedText(model string, texts []string) ([][]float32, error)
	ModelName() string // Returns the active model name for metadata
}

// zeroProvider returns zero vectors (placeholder until real provider is wired).
type zeroProvider struct {
	dim int
}

func (p *zeroProvider) EmbedText(_ string, texts []string) ([][]float32, error) {
	if p.dim <= 0 {
		return nil, errors.New("invalid embedding dimension")
	}
	out := make([][]float32, len(texts))
	for i := range texts {
		out[i] = make([]float32, p.dim)
	}
	return out, nil
}

func (p *zeroProvider) ModelName() string {
	return "zero-vector"
}

var (
	embedOnce sync.Once
	embedProv EmbeddingProvider
	embedErr  error
)

func getEmbeddingProvider() (EmbeddingProvider, error) {
	embedOnce.Do(func() {
		dim := 1536
		if v := os.Getenv("EMBED_DIM"); v != "" {
			if parsed, err := strconv.Atoi(v); err == nil && parsed > 0 {
				dim = parsed
			}
		}
		switch strings.ToLower(os.Getenv("EMBEDDING_PROVIDER")) {
		case "openai":
			apiKey := os.Getenv("OPENAI_API_KEY")
			model := os.Getenv("EMBEDDING_MODEL")
			if model == "" {
				model = "text-embedding-3-small"
			}
			if apiKey != "" {
				embedProv = &openAIProvider{apiKey: apiKey, model: model, dim: dim}
				return
			}
		case "local":
			embedProv = &localProvider{dim: dim}
			return
		}
		embedProv = &zeroProvider{dim: dim} // fallback
	})
	return embedProv, embedErr
}

// Minimal OpenAI embeddings client (no extra deps).
type openAIProvider struct {
	apiKey string
	model  string
	dim    int
}

type openAIRequest struct {
	Model string   `json:"model"`
	Input []string `json:"input"`
}

type openAIResponse struct {
	Data []struct {
		Embedding []float64 `json:"embedding"`
	} `json:"data"`
}

func (p *openAIProvider) EmbedText(model string, texts []string) ([][]float32, error) {
	if model == "" {
		model = p.model
	}
	reqBody, err := json.Marshal(openAIRequest{Model: model, Input: texts})
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequest("POST", "https://api.openai.com/v1/embeddings", bytes.NewReader(reqBody))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode >= 300 {
		body, _ := io.ReadAll(resp.Body)
		return nil, fmt.Errorf("embedding request failed: status=%d body=%s", resp.StatusCode, string(body))
	}
	var decoded openAIResponse
	if err := json.NewDecoder(resp.Body).Decode(&decoded); err != nil {
		return nil, err
	}
	if len(decoded.Data) != len(texts) {
		return nil, errors.New("embedding count mismatch")
	}
	out := make([][]float32, len(texts))
	for i, d := range decoded.Data {
		vec := make([]float32, len(d.Embedding))
		for j, v := range d.Embedding {
			vec[j] = float32(v)
		}
		out[i] = vec
	}
	return out, nil
}

func (p *openAIProvider) ModelName() string {
	return p.model
}

// localProvider produces deterministic hashed embeddings without external services.
type localProvider struct {
	dim int
}

func (p *localProvider) EmbedText(_ string, texts []string) ([][]float32, error) {
	if p.dim <= 0 {
		return nil, errors.New("invalid embedding dimension")
	}
	out := make([][]float32, len(texts))
	for i, t := range texts {
		out[i] = p.embedOne(t)
	}
	return out, nil
}

func (p *localProvider) embedOne(text string) []float32 {
	vec := make([]float32, p.dim)
	words := strings.Fields(text)
	if len(words) == 0 {
		return vec
	}
	for _, w := range words {
		h := fnv.New32a()
		_, _ = h.Write([]byte(w))
		idx := int(h.Sum32()) % p.dim
		if idx < 0 {
			idx = -idx
		}
		vec[idx] += 1.0
	}
	// simple L2 norm
	var norm float32
	for _, v := range vec {
		norm += v * v
	}
	if norm > 0 {
		n := float32(1.0) / norm
		for i := range vec {
			vec[i] = vec[i] * n
		}
	}
	return vec
}

func (p *localProvider) ModelName() string {
	return "local-fnv-hash"
}
