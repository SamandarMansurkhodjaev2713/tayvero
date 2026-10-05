import { Module } from "@nestjs/common";
import { AgentModule } from "../agent/agent.module";
import { CurrencyModule } from "../currency/currency.module";
import { FieldsModule } from "../fields/fields.module";
import { TrpcModule } from "../trpc/trpc.module";
import { DealPipelineBridgeService } from "./deal-pipeline-bridge.service";
import { DealsRouter } from "./deals.router";
import { DealsService } from "./deals.service";

@Module({
	imports: [AgentModule, FieldsModule, TrpcModule, CurrencyModule],
	providers: [DealPipelineBridgeService, DealsService, DealsRouter],
	exports: [DealsService],
})
export class DealsModule {}
