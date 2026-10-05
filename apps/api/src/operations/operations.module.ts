import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { OperationsService } from "./operations.service";
import { OperationsRouter } from "./operations.router";
@Module({ imports: [TrpcModule], providers: [OperationsService, OperationsRouter] })
export class OperationsModule {
}
