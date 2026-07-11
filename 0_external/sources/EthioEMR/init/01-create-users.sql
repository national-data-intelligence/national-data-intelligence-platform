-- EthioEMR — first-boot user provisioning.
-- Runs automatically once on container init (MySQL ENTRYPOINT runs files in
-- /docker-entrypoint-initdb.d alphabetically). The actual dump is loaded by
-- scripts/restore.sh — it's too big to safely load via this hook.

-- Read-only ingestor user (CDC / direct extract). Replication grants allow
-- Debezium or any other CDC tool to attach to the binlog later.
-- Password MUST match scripts/restore.sh ($ETHIOEMR_READER_PASSWORD) and the
-- source-creds/ETHIOEMR_READER_PASSWORD Secret the in-cluster ingestor uses —
-- restore.sh ALTER USERs it to the same value, so keep all three in lock-step.
CREATE USER IF NOT EXISTS 'ingestor'@'%' IDENTIFIED BY 'changeme-reader-password';
GRANT SELECT ON openmrs.* TO 'ingestor'@'%';
GRANT REPLICATION SLAVE, REPLICATION CLIENT ON *.* TO 'ingestor'@'%';

-- OpenMRS web app's DB user — needs full DML, but only on the openmrs DB.
-- Matches $OPENMRS_DB_PASSWORD in the source .env.
CREATE USER IF NOT EXISTS 'openmrs'@'%' IDENTIFIED BY 'changeme-openmrs-app-password';
GRANT ALL PRIVILEGES ON openmrs.* TO 'openmrs'@'%';

FLUSH PRIVILEGES;
