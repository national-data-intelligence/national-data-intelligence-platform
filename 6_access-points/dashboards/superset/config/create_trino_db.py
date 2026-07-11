"""Idempotently upsert the READ-ONLY Trino 'marts' database connection into
Superset's metadata, exposed in SQL Lab. Run in the init after `superset init`.

The `marts` Trino catalog is postgresql → nhdw_vault (bi_* marts, read via the
bi_reader catalog creds). Trino has no HTTP auth in-cluster (the nhdw-gateway is
the PEP), so the SQLAlchemy user is a plain session identity, no password."""
import logging

from superset.app import create_app

log = logging.getLogger("nhdw.superset.trino")

NAME = "NHDW Marts (Trino)"
URI = "trino://superset@nhdw-trino.nhdw.svc.cluster.local:8080/marts"

app = create_app()
with app.app_context():
    from superset import db
    from superset.models.core import Database

    existing = db.session.query(Database).filter_by(database_name=NAME).first()
    if existing:
        existing.set_sqlalchemy_uri(URI)
        existing.expose_in_sqllab = True
        action = "updated"
    else:
        d = Database(database_name=NAME, expose_in_sqllab=True)
        d.set_sqlalchemy_uri(URI)
        db.session.add(d)
        action = "created"
    db.session.commit()
    print(f"[create_trino_db] {action} '{NAME}' -> {URI}")
