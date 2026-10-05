#!/usr/bin/env node
import process from "node:process";
import { auditRepository } from "./lib/repository-audit.mjs";

const root = process.cwd();
const findings = await auditRepository(root);
if (findings.length === 0) {
  console.log("Repository audit passed: no critical identity, secret, BOM, or manifest findings.");
  process.exit(0);
}
for (const finding of findings) {
  console.error(`${finding.severity.toUpperCase()} ${finding.code} ${finding.file}:${finding.line} ${finding.message}`);
}
console.error(`Repository audit failed with ${findings.length} finding(s).`);
process.exit(1);
