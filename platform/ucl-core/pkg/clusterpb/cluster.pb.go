// Code generated manually for bootstrap. Replace with protoc-generated code for production.
package clusterpb

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

type BuildRequest struct {
	TenantId      string `protobuf:"bytes,1,opt,name=tenant_id,json=tenantId,proto3" json:"tenant_id,omitempty"`
	ProjectId     string `protobuf:"bytes,2,opt,name=project_id,json=projectId,proto3" json:"project_id,omitempty"`
	MaxSeeds      int32  `protobuf:"varint,3,opt,name=max_seeds,json=maxSeeds,proto3" json:"max_seeds,omitempty"`
	MaxClusterSize int32 `protobuf:"varint,4,opt,name=max_cluster_size,json=maxClusterSize,proto3" json:"max_cluster_size,omitempty"`
	WindowStart   string `protobuf:"bytes,5,opt,name=window_start,json=windowStart,proto3" json:"window_start,omitempty"`
	WindowEnd     string `protobuf:"bytes,6,opt,name=window_end,json=windowEnd,proto3" json:"window_end,omitempty"`
}

type BuildResponse struct {
	ClustersCreated int32 `protobuf:"varint,1,opt,name=clusters_created,json=clustersCreated,proto3" json:"clusters_created,omitempty"`
	MembersLinked   int32 `protobuf:"varint,2,opt,name=members_linked,json=membersLinked,proto3" json:"members_linked,omitempty"`
}

type ListRequest struct {
	TenantId    string `protobuf:"bytes,1,opt,name=tenant_id,json=tenantId,proto3" json:"tenant_id,omitempty"`
	ProjectId   string `protobuf:"bytes,2,opt,name=project_id,json=projectId,proto3" json:"project_id,omitempty"`
	WindowStart string `protobuf:"bytes,3,opt,name=window_start,json=windowStart,proto3" json:"window_start,omitempty"`
	WindowEnd   string `protobuf:"bytes,4,opt,name=window_end,json=windowEnd,proto3" json:"window_end,omitempty"`
}

type ClusterSummary struct {
	ClusterNodeId string   `protobuf:"bytes,1,opt,name=cluster_node_id,json=clusterNodeId,proto3" json:"cluster_node_id,omitempty"`
	ClusterKind   string   `protobuf:"bytes,2,opt,name=cluster_kind,json=clusterKind,proto3" json:"cluster_kind,omitempty"`
	MemberNodeIds []string `protobuf:"bytes,3,rep,name=member_node_ids,json=memberNodeIds,proto3" json:"member_node_ids,omitempty"`
}

type ListResponse struct {
	Clusters []*ClusterSummary `protobuf:"bytes,1,rep,name=clusters,proto3" json:"clusters,omitempty"`
}

// Client API
type ClusterServiceClient interface {
	BuildClusters(ctx context.Context, in *BuildRequest, opts ...grpc.CallOption) (*BuildResponse, error)
	ListClusters(ctx context.Context, in *ListRequest, opts ...grpc.CallOption) (*ListResponse, error)
}

type clusterServiceClient struct {
	cc grpc.ClientConnInterface
}

func NewClusterServiceClient(cc grpc.ClientConnInterface) ClusterServiceClient {
	return &clusterServiceClient{cc}
}

func (c *clusterServiceClient) BuildClusters(ctx context.Context, in *BuildRequest, opts ...grpc.CallOption) (*BuildResponse, error) {
	out := new(BuildResponse)
	err := c.cc.Invoke(ctx, "/cluster.ClusterService/BuildClusters", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

func (c *clusterServiceClient) ListClusters(ctx context.Context, in *ListRequest, opts ...grpc.CallOption) (*ListResponse, error) {
	out := new(ListResponse)
	err := c.cc.Invoke(ctx, "/cluster.ClusterService/ListClusters", in, out, opts...)
	if err != nil {
		return nil, err
	}
	return out, nil
}

// Server API
type ClusterServiceServer interface {
	BuildClusters(context.Context, *BuildRequest) (*BuildResponse, error)
	ListClusters(context.Context, *ListRequest) (*ListResponse, error)
}

// UnimplementedClusterServiceServer can be embedded for forward compatibility.
type UnimplementedClusterServiceServer struct{}

func (*UnimplementedClusterServiceServer) BuildClusters(context.Context, *BuildRequest) (*BuildResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method BuildClusters not implemented")
}
func (*UnimplementedClusterServiceServer) ListClusters(context.Context, *ListRequest) (*ListResponse, error) {
	return nil, status.Errorf(codes.Unimplemented, "method ListClusters not implemented")
}

func RegisterClusterServiceServer(s *grpc.Server, srv ClusterServiceServer) {
	s.RegisterService(&_ClusterService_serviceDesc, srv)
}

func _ClusterService_BuildClusters_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(BuildRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(ClusterServiceServer).BuildClusters(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/cluster.ClusterService/BuildClusters",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(ClusterServiceServer).BuildClusters(ctx, req.(*BuildRequest))
	}
	return interceptor(ctx, in, info, handler)
}

func _ClusterService_ListClusters_Handler(srv interface{}, ctx context.Context, dec func(interface{}) error, interceptor grpc.UnaryServerInterceptor) (interface{}, error) {
	in := new(ListRequest)
	if err := dec(in); err != nil {
		return nil, err
	}
	if interceptor == nil {
		return srv.(ClusterServiceServer).ListClusters(ctx, in)
	}
	info := &grpc.UnaryServerInfo{
		Server:     srv,
		FullMethod: "/cluster.ClusterService/ListClusters",
	}
	handler := func(ctx context.Context, req interface{}) (interface{}, error) {
		return srv.(ClusterServiceServer).ListClusters(ctx, req.(*ListRequest))
	}
	return interceptor(ctx, in, info, handler)
}

var _ClusterService_serviceDesc = grpc.ServiceDesc{
	ServiceName: "cluster.ClusterService",
	HandlerType: (*ClusterServiceServer)(nil),
	Methods: []grpc.MethodDesc{
		{
			MethodName: "BuildClusters",
			Handler:    _ClusterService_BuildClusters_Handler,
		},
		{
			MethodName: "ListClusters",
			Handler:    _ClusterService_ListClusters_Handler,
		},
	},
	Streams:  []grpc.StreamDesc{},
	Metadata: "cluster.proto",
}

