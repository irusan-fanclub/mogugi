"""MOGU license bot — issues per-user dilmeter activation codes via /getkey.

The code format MUST match lib/license/code.go (decodeCode):
    payload = issuedAt(uint32 BE) + userID(uint64 BE) + displayName(UTF-8)
    code    = "MOGU-" + base64url_nopad(payload || ed25519_sign(payload))   # sig = trailing 64 bytes

The Ed25519 private key (seed) is read from MOGU_ED25519_PRIV and never logged
or stored. Codes are only valid for 30 minutes (the App's activation window).
"""

import base64
import logging
import os
import sqlite3
import struct
import time

import discord
from discord import app_commands
from nacl.signing import SigningKey

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
log = logging.getLogger("mogu-bot")

# --- config (from environment) ---
TOKEN = os.environ["DISCORD_TOKEN"]
PRIV_HEX = os.environ["MOGU_ED25519_PRIV"]  # 32-byte seed hex from `go run ./cmd/keygen`
GUILD_ID = os.environ.get("MOGU_GUILD_ID")  # optional: instant per-guild command sync
ROLE_ID = os.environ.get("MOGU_ROLE_ID")    # optional: restrict /getkey to one role
DB_PATH = os.environ.get("MOGU_DB", "mogu_keys.db")
COOLDOWN_SEC = int(os.environ.get("MOGU_COOLDOWN", "10"))

_seed = bytes.fromhex(PRIV_HEX.strip())
if len(_seed) != 32:
    raise SystemExit("MOGU_ED25519_PRIV must be a 32-byte seed hex (from cmd/keygen)")
signing_key = SigningKey(_seed)

# --- storage: one row per user, for tracking + rate limiting ---
db = sqlite3.connect(DB_PATH)
db.execute(
    """
    CREATE TABLE IF NOT EXISTS keys (
        user_id     INTEGER PRIMARY KEY,
        username    TEXT,
        display_name TEXT,
        issued_at   INTEGER,
        issue_count INTEGER DEFAULT 0,
        code        TEXT
    )
    """
)
db.commit()


def mint_code(user_id: int, display_name: str) -> tuple[str, int]:
    """Build and sign a v2 MOGU code. Mirrors lib/license exactly."""
    issued_at = int(time.time())
    # ">IQ" = big-endian uint32 (issuedAt) + uint64 (userID) = 12 bytes header.
    payload = struct.pack(">IQ", issued_at, user_id) + display_name.encode("utf-8")
    sig = signing_key.sign(payload).signature  # detached 64-byte signature
    code = "MOGU-" + base64.urlsafe_b64encode(payload + sig).rstrip(b"=").decode()
    return code, issued_at


# --- discord ---
intents = discord.Intents.default()
client = discord.Client(intents=intents)
tree = app_commands.CommandTree(client)


@client.event
async def on_ready():
    if GUILD_ID:
        guild = discord.Object(id=int(GUILD_ID))
        tree.copy_global_to(guild=guild)
        await tree.sync(guild=guild)
    else:
        await tree.sync()  # global sync can take up to ~1 hour to propagate
    log.info("logged in as %s (guild_sync=%s)", client.user, bool(GUILD_ID))


@tree.command(name="getkey", description="取得 dilmeter 啟用驗證碼（30 分鐘內有效）")
async def getkey(interaction: discord.Interaction):
    user = interaction.user

    # Role gate (skipped if MOGU_ROLE_ID unset). DMs have no roles → blocked when gated.
    if ROLE_ID:
        role_ids = {r.id for r in getattr(user, "roles", [])}
        if int(ROLE_ID) not in role_ids:
            await interaction.response.send_message(
                "你沒有領取驗證碼的權限。", ephemeral=True
            )
            return

    now = int(time.time())
    row = db.execute("SELECT issued_at FROM keys WHERE user_id=?", (user.id,)).fetchone()
    if row and now - row[0] < COOLDOWN_SEC:
        wait = COOLDOWN_SEC - (now - row[0])
        await interaction.response.send_message(
            f"請稍候 {wait} 秒再領取。", ephemeral=True
        )
        return

    display_name = user.display_name
    code, issued_at = mint_code(user.id, display_name)

    db.execute(
        """
        INSERT INTO keys (user_id, username, display_name, issued_at, issue_count, code)
        VALUES (?, ?, ?, ?, 1, ?)
        ON CONFLICT(user_id) DO UPDATE SET
            username=excluded.username,
            display_name=excluded.display_name,
            issued_at=excluded.issued_at,
            issue_count=keys.issue_count+1,
            code=excluded.code
        """,
        (user.id, str(user), display_name, issued_at, code),
    )
    db.commit()
    log.info("issued code to %s (%s)", user.id, display_name)

    await interaction.response.send_message(
        "你的 dilmeter 啟用驗證碼（**30 分鐘內**於 App 啟用畫面貼上）:\n"
        f"```\n{code}\n```\n"
        f"此碼綁定 **{display_name}**，逾時請重新 `/getkey`。",
        ephemeral=True,
    )


if __name__ == "__main__":
    client.run(TOKEN)
