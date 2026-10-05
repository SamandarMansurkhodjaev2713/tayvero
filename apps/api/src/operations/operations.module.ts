import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { OperationsRouter } from "./operations.router";
import { OperationsService } from "./operations.service";
@Module({
	imports: [TrpcModule],
	providers: [OperationsService, OperationsRouter],
})
export class OperationsModule {}
