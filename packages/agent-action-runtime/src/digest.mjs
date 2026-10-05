// Narrow typed facade over the same canonicalization used by execution receipts.
import {
	canonicalJson as canonicalize,
	sha256Hex as digest,
} from "./index.mjs";

export const canonicalJson = canonicalize;
export const sha256Hex = digest;
