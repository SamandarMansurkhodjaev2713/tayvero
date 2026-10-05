/** Bounded raw JSON body for the new operator surfaces. Does not touch auth/webhook raw bodies. */
export function createOperationsBodyGuard({
	maxBytes = 819200,
	timeoutMs = 30000,
	maxConcurrent = 8,
} = {}) {
	if (
		![maxBytes, timeoutMs, maxConcurrent].every(Number.isSafeInteger) ||
		maxBytes < 1024 ||
		maxBytes > 1048576 ||
		timeoutMs < 10 ||
		timeoutMs > 60000 ||
		maxConcurrent < 1 ||
		maxConcurrent > 64
	)
		throw new TypeError("Invalid operations body guard configuration");
	let inflight = 0;
	return function operationsBodyGuard(req, res, next) {
		let pathname;
		try {
			pathname = decodeURIComponent(
				new URL(req.url ?? "/", "http://localhost").pathname,
			);
		} catch {
			res.statusCode = 400;
			res.end("Invalid request path");
			return;
		}
		const procedures = pathname.replace(/^\/+/, "").split(",");
		if (
			!procedures.some(
				(name) =>
					name.startsWith("migrations.") || name.startsWith("operations."),
			) ||
			["GET", "HEAD", "OPTIONS"].includes(req.method)
		) {
			next();
			return;
		}
		const reply = (status, message) => {
			if (!res.headersSent) {
				res.statusCode = status;
				res.setHeader("Content-Type", "application/json; charset=utf-8");
				res.setHeader("Connection", "close");
				if (status === 429) res.setHeader("Retry-After", "1");
			}
			res.end(JSON.stringify({ error: { message } }));
		};
		if (req.method !== "POST") {
			reply(405, "Use POST for operation mutations");
			return;
		}
		const type = String(req.headers["content-type"] ?? "").toLowerCase();
		if (
			!/^application\/json(?:\s*;\s*charset=utf-8)?\s*$/.test(type) ||
			!["", "identity"].includes(
				String(req.headers["content-encoding"] ?? "").toLowerCase(),
			)
		) {
			reply(415, "Send uncompressed UTF-8 JSON");
			return;
		}
		const length = req.headers["content-length"];
		if (
			length !== undefined &&
			(!/^\d+$/.test(String(length)) || Number(length) > maxBytes)
		) {
			reply(413, "Operation request is too large");
			return;
		}
		if ("body" in req) {
			reply(400, "Operation body was unexpectedly consumed by another parser");
			return;
		}
		if (inflight >= maxConcurrent) {
			reply(
				429,
				"Too many operation requests; retry after the current requests finish",
			);
			return;
		}
		inflight++;
		let released = false,
			finished = false,
			size = 0;
		const chunks = [];
		const release = () => {
			if (released) return;
			released = true;
			inflight--;
			res.off("finish", release);
			res.off("close", release);
		};
		res.once("finish", release);
		res.once("close", release);
		const cleanup = () => {
			clearTimeout(timer);
			req.off("data", onData);
			req.off("end", onEnd);
			req.off("error", onError);
			req.off("aborted", onAbort);
			res.off("close", onClose);
		};
		const reject = (status, message) => {
			if (finished) return;
			finished = true;
			cleanup();
			chunks.length = 0;
			reply(status, message);
			release();
			req.resume?.();
		};
		const onData = (chunk) => {
			const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
			size += bytes.length;
			if (size > maxBytes) {
				reject(413, "Operation request is too large");
				return;
			}
			chunks.push(bytes);
		};
		const onEnd = () => {
			if (finished) return;
			finished = true;
			cleanup();
			let combined;
			try {
				combined = Buffer.concat(chunks, size);
				req.body = new TextDecoder("utf-8", { fatal: true }).decode(combined);
			} catch {
				reply(400, "Operation request must be valid UTF-8");
				release();
				return;
			} finally {
				combined?.fill(0);
				chunks.length = 0;
			}
			next();
		};
		const onError = () => reject(400, "Operation body could not be read");
		const onAbort = () => reject(400, "Operation upload was interrupted");
		const onClose = () => {
			if (finished) return;
			finished = true;
			cleanup();
			chunks.length = 0;
			release();
		};
		const timer = setTimeout(
			() => reject(408, "Operation upload timed out"),
			timeoutMs,
		);
		req.on("data", onData);
		req.once("end", onEnd);
		req.once("error", onError);
		req.once("aborted", onAbort);
		res.once("close", onClose);
	};
}
