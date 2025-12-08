package main

import (
	"context"
	"flag"
	"fmt"
	"net"
	"os"
	"os/signal"
	"syscall"
	"time"

	"google.golang.org/grpc"
	"google.golang.org/grpc/health"
	"google.golang.org/grpc/health/grpc_health_v1"
	"google.golang.org/grpc/reflection"

	"github.com/nucleus/ucl-core/internal/gateway"
)

func main() {
	// Configuration flags
	port := flag.Int("port", 50051, "gRPC server port")
	flag.Parse()

	// Create listener
	addr := fmt.Sprintf(":%d", *port)
	lis, err := net.Listen("tcp", addr)
	if err != nil {
		fmt.Fprintf(os.Stderr, "failed to listen: %v\n", err)
		os.Exit(1)
	}

	// Create gRPC server with interceptors
	server := grpc.NewServer(
		grpc.ChainUnaryInterceptor(
			loggingInterceptor,
			recoveryInterceptor,
		),
	)

	// Register services
	gatewaySvc := gateway.NewService()
	gateway.RegisterGatewayServiceServer(server, gatewaySvc)

	// Health check
	healthSvc := health.NewServer()
	grpc_health_v1.RegisterHealthServer(server, healthSvc)
	healthSvc.SetServingStatus("ucl.gateway.v1.GatewayService", grpc_health_v1.HealthCheckResponse_SERVING)

	// Reflection for debugging
	reflection.Register(server)

	// Start server in goroutine
	go func() {
		fmt.Printf("UCL Gateway listening on %s\n", addr)
		if err := server.Serve(lis); err != nil {
			fmt.Fprintf(os.Stderr, "server error: %v\n", err)
		}
	}()

	// Graceful shutdown
	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	fmt.Println("Shutting down gracefully...")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	// Set health to NOT_SERVING
	healthSvc.SetServingStatus("ucl.gateway.v1.GatewayService", grpc_health_v1.HealthCheckResponse_NOT_SERVING)

	// Wait for drain
	stopped := make(chan struct{})
	go func() {
		server.GracefulStop()
		close(stopped)
	}()

	select {
	case <-ctx.Done():
		fmt.Println("Timeout, forcing stop")
		server.Stop()
	case <-stopped:
		fmt.Println("Server stopped gracefully")
	}
}

// loggingInterceptor logs each RPC call
func loggingInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (interface{}, error) {
	start := time.Now()
	resp, err := handler(ctx, req)
	duration := time.Since(start)

	status := "OK"
	if err != nil {
		status = "ERROR"
	}

	fmt.Printf("[%s] %s %s (%v)\n", status, info.FullMethod, duration, err)
	return resp, err
}

// recoveryInterceptor recovers from panics
func recoveryInterceptor(ctx context.Context, req interface{}, info *grpc.UnaryServerInfo, handler grpc.UnaryHandler) (resp interface{}, err error) {
	defer func() {
		if r := recover(); r != nil {
			fmt.Printf("PANIC in %s: %v\n", info.FullMethod, r)
			err = fmt.Errorf("internal server error")
		}
	}()
	return handler(ctx, req)
}
