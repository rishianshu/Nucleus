/**
 * Signal store re-export for backward compatibility
 * Maps old signalStore.js imports to new grpcSignalStore.js
 */
export { 
  GrpcSignalStore as PrismaSignalStore,
  GrpcSignalStore,
  grpcSignalStore,
} from "./grpcSignalStore.js";
