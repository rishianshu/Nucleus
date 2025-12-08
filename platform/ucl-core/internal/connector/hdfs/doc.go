// Package hdfs implements the HDFS connector using WebHDFS REST API.
//
// This connector provides access to Hadoop Distributed File System without
// requiring Spark or native HDFS libraries. It uses the WebHDFS REST API
// which is HTTP-based and works with any Hadoop cluster.
//
// Features:
//   - List files and directories
//   - Read file metadata and content
//   - No Spark or JVM dependencies
//   - Pure Go implementation using HTTP
//
// Configuration:
//
//	{
//	    "namenodeUrl": "http://namenode:9870",
//	    "user": "hdfs",
//	    "basePath": "/data"
//	}
package hdfs
