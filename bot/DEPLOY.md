# mogugi bot — deployment & user guide

End-to-end runbook: generate keys, create the Discord bot, host it (Docker or
systemd), and how a user gets their activation code.

The chain in one line:

```
you: keygen ─┬─ PublicKeyHex + MacKeyHex → license-build.txt → release.ps1 → mogugi.exe ──┐ ship
             └─ MOGUGI_ED25519_PRIV → bot .env                                             │
                        │                                                                 ▼
user: /getkey ──(bot signs with PRIV)──> MOGUGI-xxxx ──paste to activate──> mogugi.exe (verifies with public key) ✅
```

The bot's **private** key signs codes; the App's embedded **public** key verifies
them. They are one pair — if they don't match, every code is rejected.

---

## 1. Generate the real keypair (once)

The repo ships with a throwaway dev keypair. Before going live, in the repo root:

```
go run ./cmd/keygen
```

It prints three lines:

| Output | Goes to | Purpose |
|---|---|---|
| `MOGUGI_ED25519_PRIV=...` | the bot's `.env` (this guide) | **signs** codes — **secret**, never commit |
| `PublicKeyHex=...` | repo `license-build.txt` (App build) | **verifies** codes |
| `MacKeyHex=...` | repo `license-build.txt` (App build) | tamper-proofs `license.dat` |

Then rebuild the App so the exe embeds the real public key, and ship **that** exe:

```
.\release.ps1        # produces dist/mogugi_<version>.exe/.zip
```

---

## 2. Create the Discord bot (once)

1. [Developer Portal](https://discord.com/developers/applications) → **New Application** (name it e.g. `mogugi`).
2. **Bot** → **Reset Token** → copy it → this is `DISCORD_TOKEN` (shown only once).
3. **OAuth2 → URL Generator** → scopes **`bot`** + **`applications.commands`** →
   open the generated URL → pick your server → authorize (invites the bot).
4. No privileged intents are needed (slash commands only).
5. *(Optional)* Enable Discord Developer Mode → right-click your server → **Copy Server ID**
   → this is `MOGUGI_GUILD_ID` (makes the `/getkey` command appear instantly instead of ~1h).

---

## 3. Configure `.env`

Create `.env` next to `bot.py` (it is gitignored):

```bash
DISCORD_TOKEN=your_bot_token
MOGUGI_ED25519_PRIV=priv_seed_from_keygen
# optional: instant slash-command sync
MOGUGI_GUILD_ID=your_server_id
# optional: seconds between issues per user (default 10)
MOGUGI_COOLDOWN=10
# optional: bump when you rotate the signing key (default 1)
MOGUGI_KEY_VERSION=1
# MOGUGI_DB is set by Docker/systemd below — leave it out here.
```

> ⚠️ **Do NOT put inline `# comments` after a value.** Both Docker Compose's
> `env_file` and systemd's `EnvironmentFile` treat everything after `=` as the
> value — the `# ...` becomes part of it and will crash the bot (e.g.
> `int('10  # ...')`). Put comments on their own lines, as above.

| Var | Required | Purpose |
|---|---|---|
| `DISCORD_TOKEN` | yes | Bot token |
| `MOGUGI_ED25519_PRIV` | yes | 32-byte seed hex from `cmd/keygen` — **secret** |
| `MOGUGI_GUILD_ID` | no | Guild ID → instant slash-command sync |
| `MOGUGI_DB` | no | SQLite path (Docker: `/data/...`; systemd: an abs path) |
| `MOGUGI_COOLDOWN` | no | Seconds between issues per user (default `10`) |
| `MOGUGI_KEY_VERSION` | no | Recorded per code for rotation tracking (default `1`) |

`chmod 600 .env` — it holds the signing key.

---

## 4a. Host with Docker (recommended)

Files `Dockerfile` + `compose.yaml` are in this folder. With Docker + Compose installed:

```bash
cd bot
# put your .env here (step 3)
docker compose up -d          # build image + start in background
docker compose logs -f        # watch for "logged in as ..."
```

- The DB persists on a named volume `mogugi-db` (survives `down`/recreation).
- No ports are published — the bot only connects out to Discord.
- Update after a code change: `git pull && docker compose up -d --build`.
- Back up the DB: `docker run --rm -v bot_mogugi-db:/data -v "$PWD":/backup alpine cp /data/mogugi_keys.db /backup/`.

## 4b. Host with systemd (no Docker)

```bash
sudo mkdir -p /opt/mogugi-bot        # copy bot/ contents here
cd /opt/mogugi-bot
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
# create .env here; set MOGUGI_DB=/opt/mogugi-bot/mogugi_keys.db
chmod 600 .env

sudo useradd -r -s /usr/sbin/nologin mogugibot
sudo chown -R mogugibot:mogugibot /opt/mogugi-bot
```

```ini
# /etc/systemd/system/mogugi-bot.service
[Unit]
Description=mogugi license bot
After=network-online.target

[Service]
WorkingDirectory=/opt/mogugi-bot
ExecStart=/opt/mogugi-bot/.venv/bin/python bot.py
EnvironmentFile=/opt/mogugi-bot/.env
Restart=always
RestartSec=5
User=mogugibot

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now mogugi-bot
journalctl -u mogugi-bot -f
```

> systemd's `EnvironmentFile` does **not** run a shell: `.env` may only contain
> `KEY=value` lines — no `export`, no quotes wrapping the whole line, no inline comments.

---

## 5. How a user gets their key

1. In your Discord server, the user runs **`/getkey`**.
2. They receive an **ephemeral** message (only they can see it) with a `MOGUGI-...`
   code, valid for **30 minutes**.
3. They open **mogugi.exe** → first launch shows the activation screen → paste the
   code → **Activate**.
4. The code binds to that machine; it works forever afterward (no re-entry on restart).

Notes:
- Each code embeds the requester's Discord user ID + display name; the App shows the
  name in the toolbar after activation.
- Codes expire in 30 min (anti-forwarding) — if it expires, just `/getkey` again.
- New PC / reinstall → `/getkey` again for a fresh code.
- Anyone in the server can run `/getkey` — restrict who can see/use the command with
  Discord's own **Server Settings → Integrations → mogugi → /getkey** permissions if needed.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Every code shows "invalid" in the App | Bot private key ≠ App's embedded public key. Re-run `keygen`, update `license-build.txt`, rebuild with `release.ps1`, and put the matching `MOGUGI_ED25519_PRIV` in the bot `.env`. |
| `/getkey` doesn't appear | Global sync takes ~1h. Set `MOGUGI_GUILD_ID` for instant per-guild sync. |
| Bot won't start, `KeyError` | A required env var (`DISCORD_TOKEN` / `MOGUGI_ED25519_PRIV`) is missing. |
| "must be a 32-byte seed hex" | `MOGUGI_ED25519_PRIV` isn't the 64-hex-char seed from `cmd/keygen`. |
| Lost the DB | Only affects issue tracking/rate-limiting; already-issued codes still activate. |

Leaking `MOGUGI_ED25519_PRIV` lets anyone mint valid codes — protect it like a signing key.
