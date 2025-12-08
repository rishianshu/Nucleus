# UCL Action Development Workflow

---
description: Add a new action to an existing UCL connector
---

## Prerequisites
- [ ] Connector exists and Read operations work
- [ ] Target API action documented
- [ ] Input/Output schema defined

## Phase 1: Action Specification

### 1.1 Create Action Intent
```bash
mkdir -p intents/ucl-action-<connector>-<action>
```

Create `INTENT.md`:
```yaml
title: UCL <Connector> <Action> Action
slug: ucl-action-<connector>-<action>
type: feature
context: platform/ucl-core/internal/connector/<connector>
scope_in:
  - Execute RPC for "<action>"
  - Input validation
  - Response mapping
  - Error handling
scope_out:
  - Batch operations
  - Async via Temporal (unless specified)
acceptance:
  1. Action creates/updates entity successfully
  2. Invalid input returns INVALID_ARGUMENT
  3. Auth failures return UNAUTHENTICATED
  4. Rate limits handled with backoff
```

### 1.2 Define Action Spec
Create `SPEC.md` with:
- API endpoint
- Request/Response schema
- Error codes
- Idempotency rules

---

## Phase 2: Implementation

### 2.1 Add Action Handler
In `service.go`:
```go
func (s *Service) Execute(ctx, req) (*ExecuteResponse, error) {
    switch req.Action {
    case "<action>":
        return s.<action>(ctx, req.Parameters)
    default:
        return nil, status.Errorf(codes.InvalidArgument, 
            "unknown action: %s", req.Action)
    }
}

func (s *Service) <action>(ctx, params) (*ExecuteResponse, error) {
    // 1. Validate params
    // 2. Call API
    // 3. Map response
    // 4. Return result
}
```

### 2.2 Update GetCapabilities
Add action to capabilities:
```go
Actions: []*connectorv1.ActionDescriptor{
    {
        Name: "<action>",
        DisplayName: "<Human Name>",
        Description: "<what it does>",
        InputSchema: "<JSON Schema>",
    },
},
```

---

## Phase 3: Testing

### 3.1 Unit Tests
// turbo
```bash
go test ./internal/connector/<connector>/... -run Test<Action>
```

### 3.2 Integration Tests
Test against real API (with test account).

---

## Phase 4: Documentation

### 4.1 Update Connector Docs
Add action to `docs/connectors/<connector>.md`:
```markdown
### <action>
**Description**: <what it does>
**Parameters**:
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| <field> | <type> | <yes/no> | <desc> |

**Returns**: <output structure>
**Errors**: <error codes>
```
