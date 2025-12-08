package endpoint

// =============================================================================
// ACTION REGISTRY
// =============================================================================

// actionRegistry maps endpoint IDs to action descriptors.
var actionRegistry = make(map[string][]*ActionDescriptor)

// RegisterActions registers available actions for an endpoint.
func RegisterActions(endpointID string, actions []*ActionDescriptor) {
	actionRegistry[endpointID] = actions
}

// GetRegisteredActions returns registered actions for an endpoint.
func GetRegisteredActions(endpointID string) []*ActionDescriptor {
	return actionRegistry[endpointID]
}

// ListAllActions returns actions from all registered endpoints.
func ListAllActions() map[string][]*ActionDescriptor {
	result := make(map[string][]*ActionDescriptor)
	for id, actions := range actionRegistry {
		result[id] = actions
	}
	return result
}
