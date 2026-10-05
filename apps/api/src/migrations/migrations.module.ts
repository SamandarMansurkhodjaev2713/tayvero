import { Module } from "@nestjs/common";
import { TrpcModule } from "../trpc/trpc.module";
import { MigrationsRouter } from "./migrations.router";
import { MigrationsService } from "./migrations.service";
@Module({ imports: [TrpcModule], providers: [MigrationsService, MigrationsRouter] })
export class MigrationsModule {
}
