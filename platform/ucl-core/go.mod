module github.com/nucleus/ucl-core

go 1.24.0

require (
	github.com/google/uuid v1.6.0
	github.com/jackc/pgx/v5 v5.5.4
	github.com/lib/pq v1.10.9
	github.com/minio/minio-go/v7 v7.0.97
	github.com/nucleus/store-core v0.0.0-00010101000000-000000000000
	github.com/xitongsys/parquet-go v1.6.2
	github.com/xitongsys/parquet-go-source v0.0.0-20200817004010-026bad9b25d0
	golang.org/x/time v0.14.0
	google.golang.org/grpc v1.77.0
	google.golang.org/protobuf v1.36.11
)

require (
	github.com/apache/arrow/go/arrow v0.0.0-20200730104253-651201b0f516 // indirect
	github.com/apache/thrift v0.14.2 // indirect
	github.com/dustin/go-humanize v1.0.1 // indirect
	github.com/go-ini/ini v1.67.0 // indirect
	github.com/golang/snappy v0.0.3 // indirect
	github.com/jackc/pgpassfile v1.0.0 // indirect
	github.com/jackc/pgservicefile v0.0.0-20221227161230-091c0ba34f0a // indirect
	github.com/jackc/puddle/v2 v2.2.1 // indirect
	github.com/klauspost/compress v1.18.0 // indirect
	github.com/klauspost/cpuid/v2 v2.2.11 // indirect
	github.com/klauspost/crc32 v1.3.0 // indirect
	github.com/minio/crc64nvme v1.1.0 // indirect
	github.com/minio/md5-simd v1.1.2 // indirect
	github.com/philhofer/fwd v1.2.0 // indirect
	github.com/pierrec/lz4/v4 v4.1.8 // indirect
	github.com/rogpeppe/go-internal v1.14.1 // indirect
	github.com/rs/xid v1.6.0 // indirect
	github.com/tinylib/msgp v1.3.0 // indirect
	golang.org/x/crypto v0.43.0 // indirect
	golang.org/x/net v0.46.1-0.20251013234738-63d1a5100f82 // indirect
	golang.org/x/sync v0.17.0 // indirect
	golang.org/x/sys v0.37.0 // indirect
	golang.org/x/text v0.30.0 // indirect
	golang.org/x/xerrors v0.0.0-20191204190536-9bdfabe68543 // indirect
	google.golang.org/genproto/googleapis/rpc v0.0.0-20251022142026-3a174f9686a8 // indirect
	gopkg.in/yaml.v3 v3.0.1 // indirect
)

replace github.com/nucleus/store-core => ../store-core
