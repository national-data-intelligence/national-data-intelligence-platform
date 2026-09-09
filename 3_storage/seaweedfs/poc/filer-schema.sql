-- SeaweedFS filer metadata schema for the PostgreSQL store.
--
-- TWO things this file exists to get right, both discovered in the Phase 1 PoC:
--
-- 1. The table is NOT auto-created. The filer crashes on first start with
--    'relation "filemeta" does not exist' unless this has been applied. Any
--    Kubernetes deployment therefore needs this as an init step, not an
--    afterthought — a fresh filer pod against a fresh database will not come up.
--
-- 2. COLLATE "C" on `name` is REQUIRED, not cosmetic. Under a locale collation
--    such as en_US.utf8 the filer warns that S3 list order is not
--    byte-lexicographic and silently falls back to a slower sort. S3 clients
--    that merge sorted listings can then report spurious differences — the kind
--    of fault that shows up as phantom data drift in a pipeline, not as an error.
CREATE TABLE IF NOT EXISTS filemeta (
    dirhash   BIGINT,
    name      VARCHAR(65535) COLLATE "C",
    directory VARCHAR(65535) COLLATE "C",
    meta      bytea,
    PRIMARY KEY (dirhash, name)
);
