import { HttpException, HttpStatus, Injectable } from "@nestjs/common";
import { TRPCError } from "@trpc/server";
import type {
	MiddlewareOptions,
	MiddlewareResponse,
	TRPCMiddleware,
} from "nestjs-trpc";

type TrpcErrorCode =
	| "BAD_REQUEST"
	| "UNAUTHORIZED"
	| "FORBIDDEN"
	| "NOT_FOUND"
	| "CONFLICT"
	| "PRECONDITION_FAILED"
	| "TOO_MANY_REQUESTS"
	| "INTERNAL_SERVER_ERROR";

function statusToTrpcCode(status: number): TrpcErrorCode {
	switch (status) {
		case HttpStatus.BAD_REQUEST:
			return "BAD_REQUEST";
		case HttpStatus.UNAUTHORIZED:
			return "UNAUTHORIZED";
		case HttpStatus.FORBIDDEN:
			return "FORBIDDEN";
		case HttpStatus.NOT_FOUND:
			return "NOT_FOUND";
		case HttpStatus.CONFLICT:
			return "CONFLICT";
		case HttpStatus.PRECONDITION_FAILED:
			return "PRECONDITION_FAILED";
		case HttpStatus.TOO_MANY_REQUESTS:
			return "TOO_MANY_REQUESTS";
		default:
			return "INTERNAL_SERVER_ERROR";
	}
}

@Injectable()
export class DomainErrorMiddleware implements TRPCMiddleware {
	async use(opts: MiddlewareOptions): Promise<MiddlewareResponse> {
		const result = await opts.next();

		if (result.ok) {
			return result;
		}

		const failure = result as { error?: unknown };
		const cause = (failure.error as { cause?: unknown } | undefined)?.cause;

		if (cause instanceof HttpException) {
			throw new TRPCError({
				code: statusToTrpcCode(cause.getStatus()),
				message: cause.message,
			});
		}

		return result;
	}
}
