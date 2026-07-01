# MOGUGI license bot

Discord bot that issues per-user dilmeter activation codes via `/getkey`. Each
code embeds the requester's Discord user ID + display name, is signed with your
Ed25519 private key, and is valid for **30 minutes** (the App's activation window).

The code format is verified byte-for-byte compatible with `lib/license` (Go).

> **Just want to deploy?** See **[DEPLOY.md](DEPLOY.md)** for the full end-to-end
> runbook (keygen → Discord setup → Docker/systemd hosting → how users get a code).
> Docker quick start: put your `.env` here, then `docker compose up -d`.

## 1. Generate keys (once)

In the Go repo root:

```
go run ./cmd/keygen
```

- `MOGUGI_ED25519_PRIV=...` → the bot's secret (this README, §3). **Never commit it.**
- `PublicKeyHex=...` / `MacKeyHex=...` → put into the repo's `license-build.txt`
  so the App build embeds them (see the main project's release/dev scripts).

The App's embedded **public** key must match the bot's **private** key, or codes
won't activate.

## 2. Install

```
cd bot
python -m venv .venv
.venv\Scripts\activate          # Windows; on Linux: source .venv/bin/activate
pip install -r requirements.txt
```

## 3. Configure (environment variables)

| Var | Required | Purpose |
|---|---|---|
| `DISCORD_TOKEN` | yes | Bot token (Discord Developer Portal) |
| `MOGUGI_ED25519_PRIV` | yes | 32-byte seed hex from `cmd/keygen` — **secret** |
| `MOGUGI_GUILD_ID` | no | A guild ID → instant slash-command sync (else global sync, ~1h) |
| `MOGUGI_DB` | no | SQLite path (default `mogugi_keys.db`) |
| `MOGUGI_COOLDOWN` | no | Seconds between issues per user (default `10`) |

Keep these in a `.env` file (gitignored) or systemd `EnvironmentFile`.

## 4. Discord setup (once)

1. [Developer Portal](https://discord.com/developers/applications) → New Application → **Bot** → copy the **Token**.
2. OAuth2 → URL generator → scopes `bot` + `applications.commands` → invite to your server.
3. No privileged intents needed (slash commands only).

## 5. Run

```
python bot.py
```

Then in Discord run `/getkey` — you get an **ephemeral** message with your code.
Paste it into the App's activation screen within 30 minutes.

## 6. Deploy (systemd, recommended)

```ini
# /etc/systemd/system/mogugi-bot.service
[Unit]
Description=MOGUGI license bot
After=network-online.target

[Service]
WorkingDirectory=/opt/mogugi-bot
ExecStart=/opt/mogugi-bot/.venv/bin/python bot.py
EnvironmentFile=/opt/mogugi-bot/.env      # chmod 600; holds MOGUGI_ED25519_PRIV + DISCORD_TOKEN
Restart=always
RestartSec=5
User=mogugibot

[Install]
WantedBy=multi-user.target
```

```
chmod 600 /opt/mogugi-bot/.env
systemctl enable --now mogugi-bot
journalctl -u mogugi-bot -f
```

The bot only connects out (Discord gateway) — no inbound ports. Back up `mogugi_keys.db`.

## Notes

- `/getkey` re-issues a **fresh** code each call (so it's never expired when handed out);
  the DB keeps one row per user (`issue_count`, latest `issued_at`/`code`) for tracking.
- Leaking `MOGUGI_ED25519_PRIV` lets anyone mint valid codes — protect it like a signing key.
- Code format (must match `lib/license/code.go`): `MOGUGI-` + base64url_nopad(
  `issuedAt(uint32 BE) ‖ userID(uint64 BE) ‖ displayName(UTF-8) ‖ ed25519_sig(64)` ).
