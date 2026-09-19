from collections.abc import Generator

from sqlalchemy.orm import Session

from paylite.db.session import SessionLocal


def get_db() -> Generator[Session]:
    with SessionLocal() as session:
        try:
            yield session
        except Exception:
            session.rollback()
            raise
