-- ─────────────────────────────────────────────────────────────────────────────
-- demo_console — schema
--
-- The console's OWN data. Everything here is about running demos: which
-- projects exist, what material belongs to them, who may touch them, and what
-- people did. None of it belongs to any project — a project is reached over the
-- five-endpoint demo contract and is otherwise opaque.
--
-- Idempotent throughout; safe to re-run on every boot.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE SCHEMA IF NOT EXISTS console;

-- ── people ──────────────────────────────────────────────────────────────────
-- Identity is Keycloak's; this is the local cache plus the org-level role. It is
-- JIT-filled on sign-in, never authoritative, exactly like the warehouse's
-- ops_identity.user.
CREATE TABLE IF NOT EXISTS console.person (
    kc_sub       text PRIMARY KEY,
    username     text NOT NULL,
    full_name    text,
    email        text,
    -- org role, distinct from per-project grants below. 'admin' may administer
    -- the console itself; everyone else needs a grant to see anything.
    org_role     text NOT NULL DEFAULT 'member'
                   CONSTRAINT person_org_role_chk CHECK (org_role IN ('member', 'admin')),
    first_seen   timestamptz NOT NULL DEFAULT now(),
    last_seen    timestamptz NOT NULL DEFAULT now()
);

-- ── projects ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS console.project (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    slug         text NOT NULL UNIQUE
                   CONSTRAINT project_slug_chk CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,48}$'),
    name         text NOT NULL,
    client       text,
    summary      text,
    -- two-letter chip + colour, so the UI can render a project without an upload
    chip         text NOT NULL DEFAULT '??',
    colour       text NOT NULL DEFAULT '#3558e8',
    -- Where the demo lives, and where its contract answers. base_url empty means
    -- "resource folder only" — a project with material but no live environment,
    -- which is a legitimate state and must not look broken.
    demo_url     text,
    agent_url    text,
    agent_token  text,
    -- The project's documentation. These are the Overview tab, one column per
    -- section: the creation form collects exactly these and the Overview renders
    -- exactly these, so neither side can grow a field the other does not know
    -- about. Add a section here and you must add it to BOTH, or the next reader
    -- finds a heading with nothing behind it.
    what_it_is   text,   -- what the thing actually is, in a few sentences
    who_for      text,   -- whose problem it solves, and who watches the demo
    what_to_show text,   -- the story to walk through: the moments worth showing
    how_built    text,   -- what it is made of
    caveats      text,   -- what is mock, missing, or not to be promised
    owner_sub    text REFERENCES console.person(kc_sub),
    archived     boolean NOT NULL DEFAULT false,
    created_at   timestamptz NOT NULL DEFAULT now(),
    updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_project_archived ON console.project (archived, name);

COMMENT ON COLUMN console.project.agent_url IS
    $c$Base URL implementing the five-endpoint demo contract (/demo/health, /demo/profile GET+POST, /demo/action/{id}, /demo/job/{id}). NULL = this project is a resource folder only.$c$;
COMMENT ON COLUMN console.project.agent_token IS
    $c$Shared secret presented as X-Demo-Token. Never sent to the browser — the console calls the agent server-side.$c$;

-- ── resources ───────────────────────────────────────────────────────────────
-- Decks, documents, videos, links. Bytes live in the object store; the row holds
-- the key, so a resource is versioned and access-controlled like anything else.
CREATE TABLE IF NOT EXISTS console.resource (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid NOT NULL REFERENCES console.project(id) ON DELETE CASCADE,
    kind         text NOT NULL
                   CONSTRAINT resource_kind_chk
                   CHECK (kind IN ('deck', 'doc', 'video', 'image', 'link', 'code',
                                   'note', 'other')),
    title        text NOT NULL,
    note         text,
    -- exactly one of these is set: a stored object, or an external link
    object_key   text,
    url          text,
    mime         text,
    size_bytes   bigint,
    ordering     int NOT NULL DEFAULT 100,
    uploaded_by  text REFERENCES console.person(kc_sub),
    created_at   timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT resource_payload_chk CHECK (
        (object_key IS NOT NULL AND url IS NULL) OR
        (url IS NOT NULL AND object_key IS NULL))
);
CREATE INDEX IF NOT EXISTS idx_resource_project ON console.resource (project_id, ordering, created_at);

-- ── access ──────────────────────────────────────────────────────────────────
-- Per project, so someone can present one client's work without seeing another's.
CREATE TABLE IF NOT EXISTS console.grant (
    person_sub   text NOT NULL REFERENCES console.person(kc_sub) ON DELETE CASCADE,
    project_id   uuid NOT NULL REFERENCES console.project(id) ON DELETE CASCADE,
    role         text NOT NULL
                   CONSTRAINT grant_role_chk
                   CHECK (role IN ('viewer', 'presenter', 'maintainer', 'admin')),
    granted_by   text REFERENCES console.person(kc_sub),
    granted_at   timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (person_sub, project_id)
);

COMMENT ON TABLE console.grant IS
    $c$viewer reads resources · presenter also opens the demo and fires actions · maintainer also edits resources and swaps profiles · admin also grants access.$c$;

-- ── activity ────────────────────────────────────────────────────────────────
-- APPEND-ONLY. Sign-ins and actions share one table so "who did what" and "who
-- can see what" are answered from one place rather than two that disagree. Never
-- updated, never deleted — the warehouse's governance history works the same way
-- and for the same reason.
CREATE TABLE IF NOT EXISTS console.activity (
    id           bigserial PRIMARY KEY,
    at           timestamptz NOT NULL DEFAULT now(),
    person_sub   text REFERENCES console.person(kc_sub),
    person_name  text,                      -- denormalised: the log outlives renames
    project_id   uuid REFERENCES console.project(id) ON DELETE SET NULL,
    project_name text,                      -- ditto, and survives a deletion
    verb         text NOT NULL,             -- signed-in · swapped-profile · ran-action · …
    detail       text,
    result       text NOT NULL DEFAULT 'ok'
                   CONSTRAINT activity_result_chk CHECK (result IN ('ok', 'failed', 'denied')),
    payload      jsonb NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS idx_activity_at      ON console.activity (at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_project ON console.activity (project_id, at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_person  ON console.activity (person_sub, at DESC);

-- ── booking lock ────────────────────────────────────────────────────────────
-- One environment per project means two colleagues can collide: a rebuild that
-- starts mid-demo breaks the demo. A hold is advisory and visible — it says who
-- has the project and until when, so the collision becomes a conversation
-- instead of a surprise.
CREATE TABLE IF NOT EXISTS console.hold (
    project_id   uuid PRIMARY KEY REFERENCES console.project(id) ON DELETE CASCADE,
    person_sub   text NOT NULL REFERENCES console.person(kc_sub),
    person_name  text,
    reason       text,
    held_from    timestamptz NOT NULL DEFAULT now(),
    held_until   timestamptz NOT NULL
);

-- ── local accounts ──────────────────────────────────────────────────────────
-- Keycloak stays authoritative WHEN IT IS CONFIGURED. Where it is not — which is
-- every console that is not wired to an identity provider yet — people need a
-- way in that is not a development backdoor, so the console can own a password.
-- A person has at most one: an OIDC identity has no hash and can never be signed
-- in with one, and a local account is never minted by the OIDC callback.
ALTER TABLE console.person ADD COLUMN IF NOT EXISTS password_hash text;
ALTER TABLE console.person ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

DO $$ BEGIN
    ALTER TABLE console.person ADD CONSTRAINT person_status_chk
        CHECK (status IN ('active', 'disabled'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Sign-in accepts either, so both have to be unique, and case must not be a way
-- to register a second "Admin" beside "admin".
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_username_lower
    ON console.person (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS uq_person_email_lower
    ON console.person (lower(email)) WHERE email IS NOT NULL AND email <> '';

-- ── password resets ─────────────────────────────────────────────────────────
-- Only the HASH of the token is stored, so a copy of this table is not a set of
-- working reset links. Single use, short lived, and every issue and redemption
-- lands in the activity log.
CREATE TABLE IF NOT EXISTS console.reset_token (
    token_hash   text PRIMARY KEY,
    person_sub   text NOT NULL REFERENCES console.person(kc_sub) ON DELETE CASCADE,
    issued_by    text REFERENCES console.person(kc_sub),   -- NULL = self-service
    issued_at    timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL,
    used_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_reset_person ON console.reset_token (person_sub, expires_at DESC);

-- ── previewable renditions ──────────────────────────────────────────────────
-- An office file no browser renders gets a PDF rendition on upload, when the
-- image carries LibreOffice. The key lives beside the original so a resource
-- can be previewed and downloaded from the same row, and so the absence of a
-- rendition is a fact the interface can state rather than a guess it has to make.
ALTER TABLE console.resource ADD COLUMN IF NOT EXISTS preview_key text;

-- A link to the code is a kind of material in its own right — it belongs on the
-- shelf beside the deck, not filed under "other".
DO $$ BEGIN
    ALTER TABLE console.resource DROP CONSTRAINT IF EXISTS resource_kind_chk;
    -- 'note' is a file attached to a note. It lives in this table so it gets the
    -- same store, rendition and range-serving as everything else, but it is NOT
    -- shelf material: the Resources tab filters it out, because a shelf is what
    -- you chose to show a client and an attachment is an aside to a colleague.
    ALTER TABLE console.resource ADD CONSTRAINT resource_kind_chk
        CHECK (kind IN ('deck', 'doc', 'video', 'image', 'link', 'code',
                        'note', 'other'));
END $$;


-- ── notes ───────────────────────────────────────────────────────────────────
-- What somebody learned about a project and wants the next presenter to know.
-- A note is text, an attached file, or both: `body` carries the text, and the
-- file rides the SAME resource table as everything else a project holds, so it
-- gets the existing upload, rendition, range-serving and deletion paths rather
-- than a second, poorer copy of them.
CREATE TABLE IF NOT EXISTS console.note (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id  uuid NOT NULL REFERENCES console.project(id) ON DELETE CASCADE,
    body        text,
    resource_id uuid REFERENCES console.resource(id) ON DELETE SET NULL,
    author_sub  text REFERENCES console.person(kc_sub),
    author_name text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    -- A note with neither words nor a file is not a note.
    CONSTRAINT note_has_content_chk
        CHECK (coalesce(btrim(body), '') <> '' OR resource_id IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS note_project_idx ON console.note (project_id, created_at DESC);

-- Columns added after the first deployments; the tables above are created once
-- and never dropped, so new columns arrive here.
ALTER TABLE console.project ADD COLUMN IF NOT EXISTS what_it_is   text;
ALTER TABLE console.project ADD COLUMN IF NOT EXISTS who_for      text;
ALTER TABLE console.project ADD COLUMN IF NOT EXISTS what_to_show text;
ALTER TABLE console.project ADD COLUMN IF NOT EXISTS how_built    text;
ALTER TABLE console.project ADD COLUMN IF NOT EXISTS caveats      text;
