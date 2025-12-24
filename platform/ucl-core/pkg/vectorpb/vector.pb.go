// Code generated manually for bootstrap. Replace with protoc-generated code for production.
package vectorpb

import (
	context "context"

	grpc "google.golang.org/grpc"
	codes "google.golang.org/grpc/codes"
	status "google.golang.org/grpc/status"
)

// Compile-time assertions.
var _ context.Context
var _ grpc.ClientConnInterface

const _ = grpc.SupportPackageIsVersion7

type SearchRequest struct {
	TenantId       string    `protobuf:"bytes,1,opt,name=tenant_id,json=tenantId,proto3" json:"tenant_id,omitempty"`
	ProjectId      string    `protobuf:"bytes,2,opt,name=project_id,json=projectId,proto3" json:"project_id,omitempty"`
	ProfileIds     []string  `protobuf:"bytes,3,rep,name=profile_ids,json=profileIds,proto3" json:"profile_ids,omitempty"`
	SourceFamily   string    `protobuf:"bytes,4,opt,name=source_family,json=sourceFamily,proto3" json:"source_family,omitempty"`
	ArtifactId     string    `protobuf:"bytes,5,opt,name=artifact_id,json=artifactId,proto3" json:"artifact_id,omitempty"`
	RunId          string    `protobuf:"bytes,6,opt,name=run_id,json=runId,proto3" json:"run_id,omitempty"`
	SinkEndpointId string    `protobuf:"bytes,7,opt,name=sink_endpoint_id,json=sinkEndpointId,proto3" json:"sink_endpoint_id,omitempty"`
	DatasetSlug    string    `protobuf:"bytes,8,opt,name=dataset_slug,json=datasetSlug,proto3" json:"dataset_slug,omitempty"`
	TopK           int32     `protobuf:"varint,9,opt,name=top_k,json=topK,proto3" json:"top_k,omitempty"`
	Embedding      []float32 `protobuf:"fixed32,10,rep,packed,name=embedding,proto3" json:"embedding,omitempty"`
}

type SearchHit struct {
	NodeId      string            `protobuf:"bytes,1,opt,name=node_id,json=nodeId,proto3" json:"node_id,omitempty"`
	ProfileId   string            `protobuf:"bytes,2,opt,name=profile_id,json=profileId,proto3" json:"profile_id,omitempty"`
	Score       float32           `protobuf:"fixed32,3,opt,name=score,proto3" json:"score,omitempty"`
	ContentText string            `protobuf:"bytes,4,opt,name=content_text,json=contentText,proto3" json:"content_text,omitempty"`
	Metadata    map[string]string `protobuf:"bytes,5,rep,name=metadata,proto3" json:"metadata,omitempty"`
}

type SearchResponse struct {
	Hits []*SearchHit `protobuf:"bytes,1,rep,name=hits,proto3" json:"hits,omitempty"`
}

// Client API
type VectorServiceClient interface {
	Search(ctx context.Context, in *SearchRequest, opts ...grpc.CallOption) (*SearchResponse, error)
}

type vectorServiceClient struct {
	cc grpc.ClientConnInterface
}

func NewVectorServiceClient(cc grpc.ClientConnInterface) VectorServiceClient {
	return &vectorServiceClient{cc}
}

func (c *vectorServiceClient) Search(ctx context.Context, in *SearchRequest, opts ...grpc.CallOption) (*SearchResponse, error) {
	out := new(SearchResponse)
	err := c.cc.Invoke(ctx, "/vector.VectorService/Search", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Server API
type VectorServiceServer interface {
	Search(context.Context, *SearchRequest) (*SearchResponse, error)
}

// UnimplementedVectorServiceServer can be embedded for forward compatibility.
type UnimplementedVectorServiceServer struct{}

func (*UnimplementedVectorServiceServer) Search(context.Context, *SearchRequest) (*SearchResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method Search not implemented")
}

func RegisterVectorServiceServer(s *grpc.Server, srv VectorServiceServer) {
	s.RegisterService(&_VectorService_serviceDesc, srv)
}

func _VectorService_Search_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(SearchRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(VectorServiceServer).Search(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/vector.VectorService/Search",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(VectorServiceServer).Search(ctx, req.(*SearchRequest))
	}
	return interceptor(ctx, in, info, handler)
}

var _VectorService_serviceDesc = grpc.ServiceDesc{
	ServiceName: "vector.VectorService",
	HandlerType: (*VectorServiceServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "Search",
			Handler:    _VectorService_Search_Handler,
		},
	},
	Streams:  []grpc.StreamDesc{},
	Metadata: "vector.proto",
}

