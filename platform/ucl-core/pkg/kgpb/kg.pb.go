// Code generated manually for bootstrap. Replace with protoc-generated code for production.
package kgpb

import (
	context "context"

	grpc "google.golang.org/grpc"
	codes "google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
)

// Node represents a KG node.
type Node struct {
	Id         string            `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
	Type       string            `protobuf:"bytes,2,opt,name=type,proto3" json:"type,omitempty"`
	Properties map[string]string `protobuf:"bytes,3,rep,name=properties,proto3" json:"properties,omitempty" protobuf_key:"bytes,1,opt,name=key,proto3" protobuf_val:"bytes,2,opt,name=value,proto3"`
}

// Edge represents a KG edge.
type Edge struct {
	Id         string            `protobuf:"bytes,1,opt,name=id,proto3" json:"id,omitempty"`
	Type       string            `protobuf:"bytes,2,opt,name=type,proto3" json:"type,omitempty"`
	FromId     string            `protobuf:"bytes,3,opt,name=from_id,json=fromId,proto3" json:"from_id,omitempty"`
	ToId       string            `protobuf:"bytes,4,opt,name=to_id,json=toId,proto3" json:"to_id,omitempty"`
	Properties map[string]string `protobuf:"bytes,5,rep,name=properties,proto3" json:"properties,omitempty" protobuf_key:"bytes,1,opt,name=key,proto3" protobuf_val:"bytes,2,opt,name=value,proto3"`
}

type UpsertNodeRequest struct {
	TenantId  string `protobuf:"bytes,1,opt,name=tenant_id,json=tenantId,proto3" json:"tenant_id,omitempty"`
	ProjectId string `protobuf:"bytes,2,opt,name=project_id,json=projectId,proto3" json:"project_id,omitempty"`
	Node      *Node  `protobuf:"bytes,3,opt,name=node,proto3" json:"node,omitempty"`
}
type UpsertNodeResponse struct {
	Node *Node `protobuf:"bytes,1,opt,name=node,proto3" json:"node,omitempty"`
}

type UpsertEdgeRequest struct {
	TenantId  string `protobuf:"bytes,1,opt,name=tenant_id,json=tenantId,proto3" json:"tenant_id,omitempty"`
	ProjectId string `protobuf:"bytes,2,opt,name=project_id,json=projectId,proto3" json:"project_id,omitempty"`
	Edge      *Edge  `protobuf:"bytes,3,opt,name=edge,proto3" json:"edge,omitempty"`
}
type UpsertEdgeResponse struct {
	Edge *Edge `protobuf:"bytes,1,opt,name=edge,proto3" json:"edge,omitempty"`
}

type GetNodeRequest struct {
	TenantId  string `protobuf:"bytes,1,opt,name=tenant_id,json=tenantId,proto3" json:"tenant_id,omitempty"`
	ProjectId string `protobuf:"bytes,2,opt,name=project_id,json=projectId,proto3" json:"project_id,omitempty"`
	NodeId    string `protobuf:"bytes,3,opt,name=node_id,json=nodeId,proto3" json:"node_id,omitempty"`
}
type GetNodeResponse struct {
	Node *Node `protobuf:"bytes,1,opt,name=node,proto3" json:"node,omitempty"`
}

type ListEntitiesRequest struct {
	TenantId    string   `protobuf:"bytes,1,opt,name=tenant_id,json=tenantId,proto3" json:"tenant_id,omitempty"`
	ProjectId   string   `protobuf:"bytes,2,opt,name=project_id,json=projectId,proto3" json:"project_id,omitempty"`
	EntityTypes []string `protobuf:"bytes,3,rep,name=entity_types,json=entityTypes,proto3" json:"entity_types,omitempty"`
	Limit       int32    `protobuf:"varint,4,opt,name=limit,proto3" json:"limit,omitempty"`
}
type ListEntitiesResponse struct {
	Nodes []*Node `protobuf:"bytes,1,rep,name=nodes,proto3" json:"nodes,omitempty"`
}

type ListEdgesRequest struct {
	TenantId  string   `protobuf:"bytes,1,opt,name=tenant_id,json=tenantId,proto3" json:"tenant_id,omitempty"`
	ProjectId string   `protobuf:"bytes,2,opt,name=project_id,json=projectId,proto3" json:"project_id,omitempty"`
	EdgeTypes []string `protobuf:"bytes,3,rep,name=edge_types,json=edgeTypes,proto3" json:"edge_types,omitempty"`
	SourceId  string   `protobuf:"bytes,4,opt,name=source_id,json=sourceId,proto3" json:"source_id,omitempty"`
	TargetId  string   `protobuf:"bytes,5,opt,name=target_id,json=targetId,proto3" json:"target_id,omitempty"`
	Limit     int32    `protobuf:"varint,6,opt,name=limit,proto3" json:"limit,omitempty"`
}
type ListEdgesResponse struct {
	Edges []*Edge `protobuf:"bytes,1,rep,name=edges,proto3" json:"edges,omitempty"`
}

type ListNeighborsRequest struct {
	TenantId  string   `protobuf:"bytes,1,opt,name=tenant_id,json=tenantId,proto3" json:"tenant_id,omitempty"`
	ProjectId string   `protobuf:"bytes,2,opt,name=project_id,json=projectId,proto3" json:"project_id,omitempty"`
	NodeId    string   `protobuf:"bytes,3,opt,name=node_id,json=nodeId,proto3" json:"node_id,omitempty"`
	EdgeTypes []string `protobuf:"bytes,4,rep,name=edge_types,json=edgeTypes,proto3" json:"edge_types,omitempty"`
	Limit     int32    `protobuf:"varint,5,opt,name=limit,proto3" json:"limit,omitempty"`
}
type ListNeighborsResponse struct {
	Neighbors []*Node `protobuf:"bytes,1,rep,name=neighbors,proto3" json:"neighbors,omitempty"`
}

// Client API
type KgServiceClient interface {
	UpsertNode(ctx context.Context, in *UpsertNodeRequest, opts ...grpc.CallOption) (*UpsertNodeResponse, error)
	UpsertEdge(ctx context.Context, in *UpsertEdgeRequest, opts ...grpc.CallOption) (*UpsertEdgeResponse, error)
	GetNode(ctx context.Context, in *GetNodeRequest, opts ...grpc.CallOption) (*GetNodeResponse, error)
	ListEntities(ctx context.Context, in *ListEntitiesRequest, opts ...grpc.CallOption) (*ListEntitiesResponse, error)
	ListEdges(ctx context.Context, in *ListEdgesRequest, opts ...grpc.CallOption) (*ListEdgesResponse, error)
	ListNeighbors(ctx context.Context, in *ListNeighborsRequest, opts ...grpc.CallOption) (*ListNeighborsResponse, error)
}

type kgServiceClient struct {
	cc grpc.ClientConnInterface
}

func NewKgServiceClient(cc grpc.ClientConnInterface) KgServiceClient {
	return &kgServiceClient{cc}
}

func (c *kgServiceClient) UpsertNode(ctx context.Context, in *UpsertNodeRequest, opts ...grpc.CallOption) (*UpsertNodeResponse, error) {
	out := new(UpsertNodeResponse)
	err := c.cc.Invoke(ctx, "/kg.KgService/UpsertNode", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *kgServiceClient) UpsertEdge(ctx context.Context, in *UpsertEdgeRequest, opts ...grpc.CallOption) (*UpsertEdgeResponse, error) {
	out := new(UpsertEdgeResponse)
	err := c.cc.Invoke(ctx, "/kg.KgService/UpsertEdge", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *kgServiceClient) GetNode(ctx context.Context, in *GetNodeRequest, opts ...grpc.CallOption) (*GetNodeResponse, error) {
	out := new(GetNodeResponse)
	err := c.cc.Invoke(ctx, "/kg.KgService/GetNode", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *kgServiceClient) ListEntities(ctx context.Context, in *ListEntitiesRequest, opts ...grpc.CallOption) (*ListEntitiesResponse, error) {
	out := new(ListEntitiesResponse)
	err := c.cc.Invoke(ctx, "/kg.KgService/ListEntities", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *kgServiceClient) ListEdges(ctx context.Context, in *ListEdgesRequest, opts ...grpc.CallOption) (*ListEdgesResponse, error) {
	out := new(ListEdgesResponse)
	err := c.cc.Invoke(ctx, "/kg.KgService/ListEdges", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *kgServiceClient) ListNeighbors(ctx context.Context, in *ListNeighborsRequest, opts ...grpc.CallOption) (*ListNeighborsResponse, error) {
	out := new(ListNeighborsResponse)
	err := c.cc.Invoke(ctx, "/kg.KgService/ListNeighbors", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Server API
type KgServiceServer interface {
	UpsertNode(context.Context, *UpsertNodeRequest) (*UpsertNodeResponse, error)
	UpsertEdge(context.Context, *UpsertEdgeRequest) (*UpsertEdgeResponse, error)
	GetNode(context.Context, *GetNodeRequest) (*GetNodeResponse, error)
	ListEntities(context.Context, *ListEntitiesRequest) (*ListEntitiesResponse, error)
	ListEdges(context.Context, *ListEdgesRequest) (*ListEdgesResponse, error)
	ListNeighbors(context.Context, *ListNeighborsRequest) (*ListNeighborsResponse, error)
}

type UnimplementedKgServiceServer struct{}

func (*UnimplementedKgServiceServer) UpsertNode(context.Context, *UpsertNodeRequest) (*UpsertNodeResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method UpsertNode not implemented")
}
func (*UnimplementedKgServiceServer) UpsertEdge(context.Context, *UpsertEdgeRequest) (*UpsertEdgeResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method UpsertEdge not implemented")
}
func (*UnimplementedKgServiceServer) GetNode(context.Context, *GetNodeRequest) (*GetNodeResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method GetNode not implemented")
}
func (*UnimplementedKgServiceServer) ListEntities(context.Context, *ListEntitiesRequest) (*ListEntitiesResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method ListEntities not implemented")
}
func (*UnimplementedKgServiceServer) ListEdges(context.Context, *ListEdgesRequest) (*ListEdgesResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method ListEdges not implemented")
}
func (*UnimplementedKgServiceServer) ListNeighbors(context.Context, *ListNeighborsRequest) (*ListNeighborsResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method ListNeighbors not implemented")
}

func RegisterKgServiceServer(s *grpc.Server, srv KgServiceServer) {
	s.RegisterService(&_KgService_serviceDesc, srv)
}

func _KgService_UpsertNode_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(UpsertNodeRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(KgServiceServer).UpsertNode(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/kg.KgService/UpsertNode",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(KgServiceServer).UpsertNode(ctx, req.(*UpsertNodeRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _KgService_UpsertEdge_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(UpsertEdgeRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(KgServiceServer).UpsertEdge(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/kg.KgService/UpsertEdge",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(KgServiceServer).UpsertEdge(ctx, req.(*UpsertEdgeRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _KgService_GetNode_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(GetNodeRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(KgServiceServer).GetNode(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/kg.KgService/GetNode",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(KgServiceServer).GetNode(ctx, req.(*GetNodeRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _KgService_ListEntities_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ListEntitiesRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(KgServiceServer).ListEntities(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/kg.KgService/ListEntities",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(KgServiceServer).ListEntities(ctx, req.(*ListEntitiesRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _KgService_ListEdges_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ListEdgesRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(KgServiceServer).ListEdges(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/kg.KgService/ListEdges",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(KgServiceServer).ListEdges(ctx, req.(*ListEdgesRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _KgService_ListNeighbors_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ListNeighborsRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(KgServiceServer).ListNeighbors(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/kg.KgService/ListNeighbors",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(KgServiceServer).ListNeighbors(ctx, req.(*ListNeighborsRequest))
	}
	return interceptor(ctx, in, info, handler)
}

var _KgService_serviceDesc = grpc.ServiceDesc{
	ServiceName: "kg.KgService",
	HandlerType: (*KgServiceServer)(nil),
	Methods: []grpc.MethodDesc{
		{MethodName: "UpsertNode", Handler: _KgService_UpsertNode_Handler},
		{MethodName: "UpsertEdge", Handler: _KgService_UpsertEdge_Handler},
		{MethodName: "GetNode", Handler: _KgService_GetNode_Handler},
		{MethodName: "ListEntities", Handler: _KgService_ListEntities_Handler},
		{MethodName: "ListEdges", Handler: _KgService_ListEdges_Handler},
		{MethodName: "ListNeighbors", Handler: _KgService_ListNeighbors_Handler},
	},
	Streams:  []grpc.StreamDesc{},
	Metadata: "kg.proto",
}

