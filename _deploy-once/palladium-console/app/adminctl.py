"""Console administration from the host, for the cases the web cannot cover.

There is deliberately no back door in the application, which leaves one real
gap: a console whose only admin signs in through an identity that no longer
exists — an OIDC account on a deployment that has since dropped OIDC, or the
developer identities that used to exist and do not any more. Nobody can sign in,
and nobody can grant anybody the right to.

This closes that gap the way it should be closed: a command that requires shell
access to the host, which is a higher bar than any password, and which prints a
single-use link rather than setting a password of its own.

    docker compose exec app python -m app.adminctl invite
    docker compose exec app python -m app.adminctl invite --username saba
    docker compose exec app python -m app.adminctl list

`invite` makes that person a console admin if they are not one already, mints a
reset link valid for an hour, and prints it. Whoever can read the output can
take the account, which is exactly the privilege they already had by being able
to run this at all.
"""
from __future__ import annotations

import argparse
import asyncio
import hashlib
import os
import secrets
import sys
import uuid

import asyncpg

DSN = os.environ.get("CONSOLE_DB_DSN", "")
PUBLIC_URL = os.environ.get("CONSOLE_PUBLIC_URL", "http://localhost:8080").rstrip("/")
TTL_MIN = int(os.environ.get("CONSOLE_RESET_TTL_MIN", "60"))


async def cmd_list(conn: asyncpg.Connection) -> int:
    rows = await conn.fetch("""
        SELECT username, full_name, email, org_role, status,
               (password_hash IS NOT NULL) AS has_password, last_seen
        FROM console.person ORDER BY (org_role = 'admin') DESC, username
    """)
    if not rows:
        print("no accounts yet — the first person to register becomes a console admin")
        return 0
    print(f"{'username':<16} {'role':<7} {'status':<9} {'sign-in':<12} last seen")
    for r in rows:
        how = "password" if r["has_password"] else "NO PASSWORD"
        print(f"{r['username']:<16} {r['org_role']:<7} {r['status']:<9} {how:<12} "
              f"{r['last_seen']:%Y-%m-%d %H:%M}")
    return 0


async def cmd_invite(conn: asyncpg.Connection, username: str | None,
                     create: bool, email: str) -> int:
    if username:
        row = await conn.fetchrow(
            "SELECT * FROM console.person WHERE lower(username)=lower($1)", username)
        if not row and not create:
            print(f"no account called '{username}'. Add --create to make one, or run "
                  f"`list` to see what is here.", file=sys.stderr)
            return 1
    else:
        # Nobody named: take an admin if there is one, otherwise anybody, so the
        # common case is a bare `invite` that does the obvious thing.
        row = await conn.fetchrow("""
            SELECT * FROM console.person
            ORDER BY (org_role = 'admin') DESC, (status = 'active') DESC, first_seen
            LIMIT 1
        """)
        if not row:
            print("this console has no accounts at all — just register on it, and the "
                  "first account becomes a console admin.", file=sys.stderr)
            return 1
        username = row["username"]

    if not row:
        sub = f"local-{uuid.uuid4()}"
        await conn.execute("""
            INSERT INTO console.person (kc_sub, username, full_name, email, org_role)
            VALUES ($1,$2,$3,$4,'admin')
        """, sub, username, username.title(), email.lower())
        row = await conn.fetchrow("SELECT * FROM console.person WHERE kc_sub=$1", sub)
        print(f"created '{username}' as a console admin")

    if row["org_role"] != "admin" or row["status"] != "active":
        await conn.execute(
            "UPDATE console.person SET org_role='admin', status='active' WHERE kc_sub=$1",
            row["kc_sub"])
        print(f"promoted '{username}' to console admin")

    token = secrets.token_urlsafe(32)
    await conn.execute("""
        INSERT INTO console.reset_token (token_hash, person_sub, expires_at)
        VALUES ($1, $2, now() + make_interval(mins => $3))
    """, hashlib.sha256(token.encode()).hexdigest(), row["kc_sub"], TTL_MIN)

    print()
    print(f"  {PUBLIC_URL}/#/reset/{token}")
    print()
    print(f"Single use, {TTL_MIN} minutes, for '{username}'. Opening it sets a password "
          f"and signs in.")
    return 0


async def main() -> int:
    ap = argparse.ArgumentParser(prog="app.adminctl", description=__doc__.split("\n")[0])
    sub = ap.add_subparsers(dest="cmd", required=True)
    sub.add_parser("list", help="who is on this console")
    inv = sub.add_parser("invite", help="mint a sign-in link for a console admin")
    inv.add_argument("--username", default=None)
    inv.add_argument("--create", action="store_true",
                     help="create the account if it does not exist")
    inv.add_argument("--email", default="")
    args = ap.parse_args()

    if not DSN:
        print("CONSOLE_DB_DSN is not set — run this inside the app container.",
              file=sys.stderr)
        return 2
    conn = await asyncpg.connect(DSN)
    try:
        if args.cmd == "list":
            return await cmd_list(conn)
        return await cmd_invite(conn, args.username, args.create, args.email)
    finally:
        await conn.close()


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
