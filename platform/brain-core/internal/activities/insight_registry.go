package activities

import (
	"os"
	"path/filepath"
	"strings"

	"gopkg.in/yaml.v3"
)

// InsightSkill represents a YAML-defined skill (Anthropic/OpenAI style) with input schema and template.
type InsightSkill struct {
	ID              string
	Template        string
	RequiredFields  []string
	CacheTTLSeconds int
	ModelProvider   string
	ModelName       string
	ModelTemp       float64
	MaxInsights     int
	PreferCDM       bool
}

// skillRegistry holds skills keyed by ID.
var skillRegistry = map[string]InsightSkill{}

func init() {
	loadInsightSkills()
}

func loadInsightSkills() {
	dir := strings.TrimSpace(os.Getenv("INSIGHT_SKILL_DIR"))
	if dir == "" {
		// Default to bundled insights folder if not provided.
		dir = filepath.Join("insights")
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	for _, ent := range entries {
		if ent.IsDir() || !strings.HasSuffix(ent.Name(), ".yaml") {
			continue
		}
		path := filepath.Join(dir, ent.Name())
		if skill, err := parseInsightSkill(path); err == nil && skill.ID != "" {
			skillRegistry[skill.ID] = skill
		}
	}
}

func parseInsightSkill(path string) (InsightSkill, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		return InsightSkill{}, err
	}
	var raw struct {
		ID          string `yaml:"id"`
		Template    string `yaml:"template"`
		InputSchema struct {
			Required []string `yaml:"required"`
		} `yaml:"inputSchema"`
		Model struct {
			Provider    string   `yaml:"provider"`
			Name        string   `yaml:"name"`
			Temperature *float64 `yaml:"temperature"`
		} `yaml:"model"`
		Cache struct {
			Enabled    bool `yaml:"enabled"`
			TTLSeconds int  `yaml:"ttlSeconds"`
		} `yaml:"cache"`
		PreferCDM bool `yaml:"preferCdm"`
	}
	if err := yaml.Unmarshal(b, &raw); err != nil {
		return InsightSkill{}, err
	}
	skill := InsightSkill{
		ID:              strings.TrimSpace(raw.ID),
		Template:        raw.Template,
		RequiredFields:  raw.InputSchema.Required,
		CacheTTLSeconds: raw.Cache.TTLSeconds,
		ModelProvider:   strings.TrimSpace(raw.Model.Provider),
		ModelName:       strings.TrimSpace(raw.Model.Name),
		ModelTemp:       0.2,
		MaxInsights:     3,
		PreferCDM:       raw.PreferCDM,
	}
	if raw.Model.Temperature != nil {
		skill.ModelTemp = *raw.Model.Temperature
	}
	return skill, nil
}

// getInsightSkill returns a skill by ID, otherwise empty skill.
func getInsightSkill(profileID string) InsightSkill {
	if s, ok := skillRegistry[profileID]; ok {
		return s
	}
	return InsightSkill{ID: profileID, Template: "", RequiredFields: nil, ModelTemp: 0.2, MaxInsights: 3}
}
