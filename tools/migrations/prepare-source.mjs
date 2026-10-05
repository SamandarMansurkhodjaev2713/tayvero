#!/usr/bin/env node
import { constants } from "node:fs";
import { open } from "node:fs/promises";
import path from "node:path";
/** Operator-only, preparation-only CLI. No database client or CRM writes. */
import { parseArgs } from "node:util";
import { createMigrationSourcePreparation } from "../../packages/migration-runtime/src/source-preparation.mjs";
import { createEncryptedFileSourceStore } from "../../packages/migration-runtime/src/source-store.mjs";

const MAX_BYTES = 4 * 1024 * 1024;
function reject(message) {
	throw new Error(message);
}
async function readBounded(filename, maximum) {
	const handle = await open(
		filename,
		constants.O_RDONLY | constants.O_NOFOLLOW,
	);
	try {
		const stat = await handle.stat();
		if (!stat.isFile() || stat.size < 1 || stat.size > maximum)
			reject(
				"Input must be a non-empty regular file within its documented size limit.",
			);
		const buffer = Buffer.alloc(stat.size + 1);
		let length = 0;
		while (length < buffer.length) {
			const { bytesRead } = await handle.read(
				buffer,
				length,
				buffer.length - length,
				null,
			);
			if (!bytesRead) break;
			length += bytesRead;
		}
		if (length !== stat.size)
			reject("Input changed during reading; no plan was accepted.");
		return buffer.subarray(0, length);
	} finally {
		await handle.close();
	}
}
async function main() {
	const { values, positionals } = parseArgs({
		options: {
			help: { type: "boolean" },
			file: { type: "string" },
			out: { type: "string" },
			definition: { type: "string" },
			source: { type: "string" },
			sha256: { type: "string" },
		},
		allowPositionals: true,
		strict: true,
	});
	if (values.help) {
		console.log(
			"Prepare only (never imports):\n  prepare-source.mjs upload --file customers.csv --out preview.json\n  prepare-source.mjs plan --source <id> --sha256 <digest> --definition mapping.json --out plan.json\nRequired env: MIGRATION_SOURCE_ROOT, MIGRATION_SOURCE_KEY_HEX (64 hex characters), MIGRATION_TENANT_ID, MIGRATION_ACTOR_ID.\nUse the workspace resolver documented in docs/runbooks/migration-source-preparation.md.",
		);
		return;
	}
	const command = positionals[0];
	if (
		positionals.length !== 1 ||
		!["upload", "plan"].includes(command) ||
		!values.out
	)
		reject("Use upload or plan and an explicit --out file. See --help.");
	const env = process.env;
	if (
		!env.MIGRATION_SOURCE_ROOT ||
		!/^[a-fA-F0-9]{64}$/.test(env.MIGRATION_SOURCE_KEY_HEX ?? "") ||
		!env.MIGRATION_TENANT_ID ||
		!env.MIGRATION_ACTOR_ID
	)
		reject(
			"Explicit private source storage, encryption key and operator context are required. No default key is generated.",
		);
	// Refuse overwriting an existing report before persisting another source.
	const output = await open(
		values.out,
		constants.O_WRONLY |
			constants.O_CREAT |
			constants.O_EXCL |
			constants.O_NOFOLLOW,
		0o600,
	);
	try {
		const store = await createEncryptedFileSourceStore({
			root: env.MIGRATION_SOURCE_ROOT,
			keys: { operator_v1: Buffer.from(env.MIGRATION_SOURCE_KEY_HEX, "hex") },
			activeKeyId: "operator_v1",
			maxBytes: MAX_BYTES,
		});
		const service = createMigrationSourcePreparation({
			store,
			maxBytes: MAX_BYTES,
		});
		const context = {
			tenantId: env.MIGRATION_TENANT_ID,
			actorId: env.MIGRATION_ACTOR_ID,
		};
		let result;
		if (command === "upload") {
			if (!values.file || values.source || values.sha256 || values.definition)
				reject("upload requires --file, without plan-specific arguments.");
			const bytes = await readBounded(values.file, MAX_BYTES);
			result = await service.upload({
				context,
				filename: path.basename(values.file),
				mimeType:
					path.extname(values.file).toLowerCase() === ".tsv"
						? "text/tab-separated-values"
						: "text/csv",
				bytes,
			});
		} else {
			if (
				values.file ||
				!/^[a-f0-9]{32}$/.test(values.source ?? "") ||
				!/^[a-f0-9]{64}$/.test(values.sha256 ?? "") ||
				!values.definition
			)
				reject(
					"plan requires --source, --sha256 and --definition, without --file.",
				);
			const definition = JSON.parse(
				new TextDecoder("utf-8", { fatal: true }).decode(
					await readBounded(values.definition, 65536),
				),
			);
			result = await service.plan({
				context,
				sourceId: values.source,
				expectedSha256: values.sha256,
				entityType: definition.entityType,
				mapping: definition.mapping,
				targetSchema: definition.targetSchema,
				existingDedupeKeys: definition.existingDedupeKeys ?? [],
				batchSize: definition.batchSize ?? 500,
			});
		}
		const report = {
			status: "PREPARATION_ONLY",
			crmWrites: false,
			databaseDedupeVerified: false,
			...result,
		};
		await output.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8");
		await output.sync();
		// Do not put names, addresses, source rows or encryption keys in logs.
		console.log(
			JSON.stringify({
				status: "PREPARATION_ONLY",
				crmWrites: false,
				sourceId: result.source.id,
				sha256: result.source.sha256,
			}),
		);
	} finally {
		await output.close();
	}
}
main().catch((error) => {
	// A reserved empty report can remain after failure. It is not a completed plan;
	// never delete a pathname after an error (another process could replace it).
	const code =
		typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
			? error.code
			: "PREPARATION_FAILED";
	console.error(
		`${code}: Source preparation failed. No CRM records were written; verify arguments, private storage, file limits, key and digest. An empty reserved output may remain.`,
	);
	process.exitCode = 1;
});
