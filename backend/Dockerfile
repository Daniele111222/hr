FROM python:3.13-slim-trixie

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        libreoffice-calc=4:25.2.3-2+deb13u8 \
        python3-uno=4:25.2.3-2+deb13u8 \
        libseccomp2 \
    && rm -rf /var/lib/apt/lists/* \
    && chmod 0755 /tmp /var/tmp

COPY pyproject.toml .
COPY src ./src
COPY alembic.ini .
COPY alembic ./alembic
COPY sql ./sql
COPY docker-entrypoint.sh .

RUN pip install --no-cache-dir . \
    && chmod +x docker-entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["./docker-entrypoint.sh"]
