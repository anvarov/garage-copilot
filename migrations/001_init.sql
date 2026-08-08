CREATE EXTENSION IF NOT EXISTS vector;


CREATE TABLE documents (
    id      BIGSERIAL PRIMARY KEY,
    source_type     TEXT NOT NULL,
    source_url      TEXT,
    title       TEXT NOT NULL,
    author      TEXT,
    license     TEXT,
    ingested_at TIMESTAMPTZ NOT NULL DEFAULT now()
);


CREATE TABLE chunks (
    id      BIGSERIAL PRIMARY KEY,
    document_id     BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    ordinal     INT NOT NULL,
    content     TEXT NOT NULL,
    embedding   vector(1536),
    UNIQUE  (document_id, ordinal)
);