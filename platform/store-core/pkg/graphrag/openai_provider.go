package graphrag

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"os"
	"time"
)

// ===================================================
// OpenAI LLM Provider
// Implements LLMProvider interface for OpenAI API
// ===================================================

// OpenAIProvider implements LLMProvider using OpenAI's chat completion API.
type OpenAIProvider struct {
	apiKey  string
	baseURL string
	client  *http.Client
}

// NewOpenAIProvider creates a new OpenAI provider.
// If apiKey is empty, it reads from OPENAI_API_KEY environment variable.
func NewOpenAIProvider(apiKey string) (*OpenAIProvider, error) {
	if apiKey == "" {
		apiKey = os.Getenv("OPENAI_API_KEY")
	}
	if apiKey == "" {
		return nil, fmt.Errorf("OPENAI_API_KEY not set")
	}
	return &OpenAIProvider{
		apiKey:  apiKey,
		baseURL: "https://api.openai.com/v1/chat/completions",
		client:  &http.Client{Timeout: 60 * time.Second},
	}, nil
}

// Name returns the provider name.
func (p *OpenAIProvider) Name() string {
	return "openai"
}

// Complete sends a prompt to OpenAI and returns the completion.
func (p *OpenAIProvider) Complete(ctx context.Context, prompt string, options LLMCompletionOptions) (string, error) {
	model := options.Model
	if model == "" {
		model = "gpt-4o-mini"
	}
	maxTokens := options.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 1024
	}
	temp := options.Temperature
	if temp <= 0 {
		temp = 0.3
	}

	messages := []openAIMessage{}
	if options.SystemPrompt != "" {
		messages = append(messages, openAIMessage{Role: "system", Content: options.SystemPrompt})
	}
	messages = append(messages, openAIMessage{Role: "user", Content: prompt})

	reqBody := openAIChatRequest{
		Model:       model,
		Messages:    messages,
		Temperature: float64(temp),
		MaxTokens:   maxTokens,
	}

	data, err := json.Marshal(reqBody)
	if err != nil {
		return "", fmt.Errorf("failed to marshal request: %w", err)
	}

	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, p.baseURL, bytes.NewReader(data))
	if err != nil {
		return "", fmt.Errorf("failed to create request: %w", err)
	}
	httpReq.Header.Set("Authorization", "Bearer "+p.apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	resp, err := p.client.Do(httpReq)
	if err != nil {
		return "", fmt.Errorf("request failed: %w", err)
	}
	defer resp.Body.Close()

	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("openai error status %d: %s", resp.StatusCode, string(body))
	}

	var parsed openAIChatResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", fmt.Errorf("failed to parse response: %w", err)
	}
	if len(parsed.Choices) == 0 || parsed.Choices[0].Message.Content == "" {
		return "", fmt.Errorf("openai returned empty content")
	}

	return parsed.Choices[0].Message.Content, nil
}

// OpenAI API types
type openAIChatRequest struct {
	Model       string          `json:"model"`
	Messages    []openAIMessage `json:"messages"`
	Temperature float64         `json:"temperature,omitempty"`
	MaxTokens   int             `json:"max_tokens,omitempty"`
}

type openAIMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type openAIChatResponse struct {
	Choices []struct {
		Message struct {
			Content string `json:"content"`
		} `json:"message"`
	} `json:"choices"`
}

// Ensure OpenAIProvider implements LLMProvider
var _ LLMProvider = (*OpenAIProvider)(nil)
