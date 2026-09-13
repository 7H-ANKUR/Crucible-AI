"""apps/api/core/db.py — Aiven PostgreSQL connection pool"""
from contextlib import contextmanager

from psycopg2 import pool

from .config import settings

_pool = None

def init_db():
    global _pool
    _pool = pool.ThreadedConnectionPool(2, 10, settings.DATABASE_URL)

def get_conn():
    global _pool
    if _pool is None:
        init_db()
    return _pool.getconn()

def release_conn(conn):
    _pool.putconn(conn)

def query(sql: str, params=None):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            if cur.description:
                cols = [d[0] for d in cur.description]
                res = [dict(zip(cols, row)) for row in cur.fetchall()]
                conn.commit()
                return res
            conn.commit()
            return []
    except Exception:
        # Aborted transactions poison a pooled connection until rolled back
        conn.rollback()
        raise
    finally:
        release_conn(conn)

def execute(sql: str, params=None):
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, params)
            conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        release_conn(conn)


@contextmanager
def transaction():
    """Context manager for multi-statement atomic transactions.
    Yields a TxCursor that executes queries and updates within a single transaction.
    Commits on successful block exit, rolls back on exception, and guarantees connection release.
    """
    conn = get_conn()
    try:
        with conn.cursor() as cur:
            class TxCursor:
                def execute(self, sql, params=None):
                    cur.execute(sql, params)
                    return cur

                def query(self, sql, params=None):
                    cur.execute(sql, params)
                    if cur.description:
                        cols = [d[0] for d in cur.description]
                        return [dict(zip(cols, row)) for row in cur.fetchall()]
                    return []

            yield TxCursor()
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        release_conn(conn)

