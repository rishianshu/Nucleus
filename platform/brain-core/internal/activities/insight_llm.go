package activities

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
)

type openAIChatRequest struct {
	Model       string       `json:"model"`
	Messages    []openAIChat `json:"messages"`
	Temperature float64      `json:"temperature,omitempty"`
	MaxTokens   int          `json:"max_tokens,omitempty"`
}

type openAIChat struct {
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

type anthropicRequest struct {
	Model       string        `json:"model"`
	MaxTokens   int           `json:"max_tokens"`
	Messages    []anthMessage `json:"messages"`
	Temperature float64       `json:"temperature,omitempty"`
}

type anthMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type anthropicResponse struct {
	Content []struct {
		Type string `json:"type"`
		Text string `json:"text"`
	} `json:"content"`
}

// callLLM executes the skill using the configured provider (env override or skill hint).
func callLLM(ctx context.Context, skill InsightSkill, prompt string) (string, error) {
	provider := strings.ToLower(getenv("INSIGHT_PROVIDER", ""))
	if provider == "" {
		provider = strings.ToLower(skill.ModelProvider)
	}
	model := getenv("INSIGHT_MODEL", "")
	if model == "" {
		model = skill.ModelName
	}
	if model == "" {
		model = "gpt-4o-mini"
	}
	if provider == "" {
		provider = "openai"
	}

	switch provider {
	case "openai":
		return callOpenAI(ctx, model, prompt, skill.ModelTemp)
	case "anthropic":
		return callAnthropic(ctx, model, prompt, skill.ModelTemp)
	default:
		return "", fmt.Errorf("unsupported insight provider: %s", provider)
	}
}

func callOpenAI(ctx context.Context, model string, prompt string, temp float64) (string, error) {
	apiKey := getenv("OPENAI_API_KEY", "")
	if apiKey == "" {
		return "", fmt.Errorf("OPENAI_API_KEY not set")
	}
	reqBody := openAIChatRequest{
		Model: model,
		Messages: []openAIChat{
			{Role: "user", Content: prompt},
		},
		Temperature: temp,
		MaxTokens:   1024,
	}
	data, _ := json.Marshal(reqBody)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.openai.com/v1/chat/completions", bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("Authorization", "Bearer "+apiKey)
	httpReq.Header.Set("Content-Type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("openai status %d: %s", resp.StatusCode, string(body))
	}
	var parsed openAIChatResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Choices) == 0 || parsed.Choices[0].Message.Content == "" {
		return "", fmt.Errorf("openai returned empty content")
	}
	return parsed.Choices[0].Message.Content, nil
}

func callAnthropic(ctx context.Context, model string, prompt string, temp float64) (string, error) {
	apiKey := getenv("ANTHROPIC_API_KEY", "")
	if apiKey == "" {
		return "", fmt.Errorf("ANTHROPIC_API_KEY not set")
	}
	if model == "" {
		model = "claude-3-haiku-20240307"
	}
	reqBody := anthropicRequest{
		Model:       model,
		MaxTokens:   1024,
		Temperature: temp,
		Messages: []anthMessage{
			{Role: "user", Content: prompt},
		},
	}
	data, _ := json.Marshal(reqBody)
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, "https://api.anthropic.com/v1/messages", bytes.NewReader(data))
	if err != nil {
		return "", err
	}
	httpReq.Header.Set("x-api-key", apiKey)
	httpReq.Header.Set("anthropic-version", "2023-06-01")
	httpReq.Header.Set("content-type", "application/json")

	client := &http.Client{Timeout: 30 * time.Second}
	resp, err := client.Do(httpReq)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(resp.Body)
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("anthropic status %d: %s", resp.StatusCode, string(body))
	}
	var parsed anthropicResponse
	if err := json.Unmarshal(body, &parsed); err != nil {
		return "", err
	}
	if len(parsed.Content) == 0 || parsed.Content[0].Text == "" {
		return "", fmt.Errorf("anthropic returned empty content")
	}
	return parsed.Content[0].Text, nil
}
