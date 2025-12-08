# Low-Level Design: UCL CDM Service

## 1. Overview
The CDM (Canonical Data Model) Service provides a **centralized mapping layer** that transforms source-specific records into normalized, domain-specific models.

---

## 2. Component Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      CDM Service                             │
├─────────────────────────────────────────────────────────────┤
│  ┌─────────────────────────────────────────────────────┐    │
│  │                  gRPC Server                        │    │
│  │                                                     │    │
│  │  ListModels  │  GetModel  │  ApplyCdm              │    │
│  └───────┬──────────────┬─────────────┬───────────────┘    │
│          │              │             │                     │
│  ┌───────┴──────────────┴─────────────┴───────────────┐    │
│  │                  Mapper Registry                    │    │
│  │                                                     │    │
│  │  (family, unit_id) → Mapper                        │    │
│  └───────────────────────┬─────────────────────────────┘    │
│                          │                                  │
│  ┌───────────────────────┴─────────────────────────────┐    │
│  │                  Mapper Engine                      │    │
│  │                                                     │    │
│  │  ┌─────────┐  ┌─────────┐  ┌─────────┐            │    │
│  │  │  Jira   │  │Confluenc│  │ Generic │            │    │
│  │  │ Mappers │  │ Mappers │  │ Mappers │            │    │
│  │  └─────────┘  └─────────┘  └─────────┘            │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

---

## 2. Package Structure

```
cmd/ucl-cdm/
├── main.go              # Entry point
└── config.go            # Configuration

internal/cdm/
├── service.go           # CdmRegistryService impl
├── registry/
│   ├── registry.go      # Mapper registry
│   └── loader.go        # Config-based loader
├── mappers/
│   ├── mapper.go        # Mapper interface
│   ├── jira/
│   │   ├── project.go   # JiraProject → CdmWorkProject
│   │   ├── issue.go     # JiraIssue → CdmWorkItem
│   │   ├── user.go      # JiraUser → CdmWorkUser
│   │   └── comment.go   # JiraComment → CdmWorkComment
│   ├── confluence/
│   │   ├── page.go      # ConfluencePage → CdmDocItem
│   │   └── space.go     # ConfluenceSpace → CdmDocSpace
│   └── generic/
│       └── passthrough.go # No-op mapper
├── models/
│   ├── work.go          # CdmWorkItem, CdmWorkProject, etc.
│   └── docs.go          # CdmDocItem, CdmDocSpace, etc.
└── idgen/
    └── cdm_id.go        # CDM ID generation
```

---

## 3. Key Interfaces

### 3.1 Mapper Interface
```go
type Mapper interface {
    // ModelID returns the CDM model this mapper produces
    ModelID() string
    
    // Map transforms a source record to a CDM record
    Map(ctx context.Context, record *structpb.Struct) (*CdmRecord, error)
    
    // Schema returns the expected input/output schema
    Schema() *MapperSchema
}

type MapperSchema struct {
    InputFields  []FieldInfo
    OutputFields []FieldInfo
}

type FieldInfo struct {
    Name     string
    Type     string
    Required bool
}
```

### 3.2 Registry Interface
```go
type Registry interface {
    // Register a mapper
    Register(family, unitID, modelID string, mapper Mapper)
    
    // Resolve a mapper by key
    Resolve(family, unitID, modelID string) (Mapper, bool)
    
    // List supported models for a family/unit
    SupportedModels(family, unitID string) []string
    
    // All registered models
    AllModels() []ModelDescriptor
}
```

---

## 4. CDM ID Generation

CDM IDs follow a URN-like pattern for global uniqueness:

```
Format: cdm:{domain}:{entity}:{source}:{key}

Examples:
- cdm:work:project:jira:PROJ
- cdm:work:item:jira:PROJ-123
- cdm:work:user:jira:acc123456
- cdm:docs:item:confluence:12345678
```

### ID Generator
```go
type CdmIDGenerator struct {
    domain string
    entity string
    source string
}

func (g *CdmIDGenerator) Generate(key string) string {
    return fmt.Sprintf("cdm:%s:%s:%s:%s", g.domain, g.entity, g.source, key)
}

// Usage
gen := &CdmIDGenerator{domain: "work", entity: "item", source: "jira"}
id := gen.Generate("PROJ-123") // "cdm:work:item:jira:PROJ-123"
```

---

## 5. Mapper Implementations

### 5.1 Jira Issue Mapper
```go
type JiraIssueMapper struct {
    idGen *CdmIDGenerator
}

func NewJiraIssueMapper() *JiraIssueMapper {
    return &JiraIssueMapper{
        idGen: &CdmIDGenerator{domain: "work", entity: "item", source: "jira"},
    }
}

func (m *JiraIssueMapper) ModelID() string {
    return "cdm.work.item"
}

func (m *JiraIssueMapper) Map(ctx context.Context, record *structpb.Struct) (*CdmRecord, error) {
    fields := record.GetFields()
    
    key := getStringField(fields, "key")
    if key == "" {
        return nil, errors.New("missing required field: key")
    }
    
    issueFields := getStructField(fields, "fields")
    
    cdmItem := &CdmWorkItem{
        CdmId:           m.idGen.Generate(key),
        SourceSystem:    "jira",
        SourceIssueKey:  key,
        ProjectCdmId:    m.projectCdmId(issueFields),
        ReporterCdmId:   m.userCdmId(getStructField(issueFields, "reporter")),
        AssigneeCdmId:   m.userCdmId(getStructField(issueFields, "assignee")),
        IssueType:       getNestedString(issueFields, "issuetype", "name"),
        Status:          getNestedString(issueFields, "status", "name"),
        StatusCategory:  getNestedString(issueFields, "status", "statusCategory", "name"),
        Priority:        getNestedString(issueFields, "priority", "name"),
        Summary:         getStringField(issueFields, "summary"),
        Description:     getStringField(issueFields, "description"),
        Labels:          getStringArray(issueFields, "labels"),
        CreatedAt:       parseTimestamp(getStringField(issueFields, "created")),
        UpdatedAt:       parseTimestamp(getStringField(issueFields, "updated")),
    }
    
    return &CdmRecord{
        CdmId:   cdmItem.CdmId,
        ModelId: m.ModelID(),
        Data:    structpb.NewStructValue(toStruct(cdmItem)),
    }, nil
}
```

### 5.2 Configuration-Driven Mapping
For simpler cases, support declarative mapping:

```yaml
# mappers/jira_project.yaml
family: jira
unit_id: jira_projects
cdm_model: cdm.work.project

id_template: "cdm:work:project:jira:{{.key}}"

field_mappings:
  - source: key
    target: source_project_key
    required: true
  - source: name
    target: name
    required: true
  - source: description
    target: description
  - source: projectTypeKey
    target: properties.project_type
```

---

## 6. Service Implementation

### 6.1 ListModels
```go
func (s *Service) ListModels(ctx context.Context, req *ListModelsRequest) (*ListModelsResponse, error) {
    var models []*CdmModelDescriptor
    
    if req.Family == "" {
        // Return all models
        models = s.registry.AllModels()
    } else {
        // Filter by family/unit
        modelIDs := s.registry.SupportedModels(req.Family, req.UnitId)
        for _, id := range modelIDs {
            models = append(models, s.getModelDescriptor(id))
        }
    }
    
    return &ListModelsResponse{Models: models}, nil
}
```

### 6.2 ApplyCdm
```go
func (s *Service) ApplyCdm(ctx context.Context, req *ApplyCdmRequest) (*ApplyCdmResponse, error) {
    mapper, found := s.registry.Resolve(req.Family, req.UnitId, req.CdmModelId)
    if !found {
        return nil, status.Errorf(codes.NotFound, 
            "no mapper for (%s, %s, %s)", req.Family, req.UnitId, req.CdmModelId)
    }
    
    var results []*CdmRecord
    var skipped int
    
    for _, record := range req.Records {
        cdmRecord, err := mapper.Map(ctx, record)
        if err != nil {
            log.Warn("mapping failed", "error", err)
            skipped++
            continue
        }
        
        // Attach source metadata
        cdmRecord.SourceMetadata = &structpb.Struct{
            Fields: map[string]*structpb.Value{
                "dataset_id":  structpb.NewStringValue(req.DatasetId),
                "endpoint_id": structpb.NewStringValue(req.EndpointId),
            },
        }
        
        results = append(results, cdmRecord)
    }
    
    return &ApplyCdmResponse{
        Records:      results,
        MappedCount:  int32(len(results)),
        SkippedCount: int32(skipped),
    }, nil
}
```

---

## 7. Configuration

```yaml
cdm:
  host: 0.0.0.0
  port: 50053
  
  # Mapper sources
  mappers:
    # Built-in mappers
    builtin:
      - jira
      - confluence
    
    # Custom mappers (YAML-based)
    custom_dir: /etc/ucl/cdm/mappers
  
  # Caching
  cache:
    enabled: true
    ttl: 1h
    max_entries: 10000
  
  # Metrics
  metrics:
    enabled: true
    port: 9090
```

---

## 8. Observability

### Metrics
```
ucl_cdm_mappings_total{family, unit_id, model_id, status}
ucl_cdm_mapping_duration_seconds{family, model_id}
ucl_cdm_cache_hits_total{model_id}
ucl_cdm_cache_misses_total{model_id}
```

### Traces
- Span per `ApplyCdm` call
- Child spans per record mapping
- Attributes: family, unit_id, model_id, record_count
