# mogugi license bot — container image.
#
# The SQLite DB lives on a mounted volume at /data so it survives container
# recreation. Secrets (DISCORD_TOKEN, MOGUGI_ED25519_PRIV) come from the
# environment / .env at run time and are never baked into the image.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY bot.py .

# Run as a non-root user; own /data so the fresh named volume inherits write
# permission for the bot process.
RUN useradd -r -u 10001 mogugi && mkdir -p /data && chown mogugi:mogugi /data
USER mogugi

# DB path on the volume; can be overridden, but compose pins it here too.
ENV MOGUGI_DB=/data/mogugi_keys.db

# -u = unbuffered stdout/stderr so `docker logs` shows output immediately.
CMD ["python", "-u", "bot.py"]
