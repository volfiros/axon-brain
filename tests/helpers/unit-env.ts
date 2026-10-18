// Unit tests must never reach a database: modules such as auth connect on import, and an open connection keeps the test process alive.
process.env.FALKORDB_HOST = "127.0.0.1";
process.env.FALKORDB_PORT = "1";
process.env.FALKORDB_GRAPH_PREFIX = "axonunit";
