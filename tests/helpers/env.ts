import { randomUUID } from "node:crypto";

// Loaded with --import before any test file, so every module, including auth's startup seeding, sees the test prefix.
process.env.FALKORDB_GRAPH_PREFIX = `axontest_${randomUUID().slice(0, 8)}`;
