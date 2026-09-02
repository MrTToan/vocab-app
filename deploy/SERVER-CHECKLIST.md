# Server checklist — one-time hardening steps (run on the box)

Repo-side hardening (non-root container, log rotation, `VACUUM INTO` backups,
CI gates) ships in the repo. The steps below are the **server-side half**: run
them once, by hand, over SSH. No secrets, IPs, or account ids here — commands
assume the standard layout (`~/lexi` holding the rsynced tree, DB in
`~/lexi/data`, prod compose file `docker-compose.prod.yml`). Adjust paths if
yours differ. Background/concepts: `docs/DEPLOY-BACKGROUND.md`.

---

## (a) Hand the data dir to uid 1000 — BEFORE the next deploy

The image now runs as the unprivileged `node` user (uid/gid 1000) instead of
root. The bind-mounted data dir on the host must be owned by that uid or the
app can't open the DB:

```sh
sudo chown -R 1000:1000 ~/lexi/data
```

Then deploy as usual. Verify after it's up:

```sh
docker compose -f ~/lexi/docker-compose.prod.yml exec -T app id
# expect: uid=1000(node) gid=1000(node) ...
curl -fsS http://localhost:3000/api/health >/dev/null && echo app-ok \
  || docker compose -f ~/lexi/docker-compose.prod.yml exec -T app \
       node -e "fetch('http://localhost:3000/api/health').then(r=>console.log('app-ok',r.status))"
```

## (b) Replace the nightly `cp` backup + fix the weekly prune

A plain `cp` of a live SQLite file can capture a torn, mid-write copy. The new
`scripts/backup-db.mjs` uses `VACUUM INTO` (a consistent transactional
snapshot, safe with WAL), keeps 14 days, and prunes older snapshots itself.

The weekly `docker system prune` also wiped the build cache, making every
deploy a cold ~full rebuild. `docker image prune -af --filter "until=168h"`
removes only week-old dangling/unused images and **keeps the build cache**, so
deploys stay warm.

Edit the crontab:

```sh
crontab -e
```

Delete the old nightly `cp ...` line and the weekly `docker system prune` line,
and add:

```cron
# nightly 03:30: consistent SQLite snapshot into data/backups, keep 14 days
30 3 * * * cd ~/lexi && docker compose -f docker-compose.prod.yml exec -T app node scripts/backup-db.mjs --dir /app/.data/backups >> ~/lexi/backup.log 2>&1
# weekly Sun 04:30: prune only images unused for 7+ days (keeps build cache -> warm deploys)
30 4 * * 0 docker image prune -af --filter "until=168h" > /dev/null 2>&1
```

Run one backup now and check it:

```sh
cd ~/lexi && docker compose -f docker-compose.prod.yml exec -T app \
  node scripts/backup-db.mjs --dir /app/.data/backups
ls -lh ~/lexi/data/backups/
```

**Optional but recommended — off-box copy.** Snapshots on the same disk don't
survive the disk. `rclone` to a free-tier object store (Cloudflare R2 or
Backblaze B2) covers that: install rclone (`sudo apt install rclone`), run
`rclone config` to add the remote (interactive; keys stay on the box), then
append to the nightly cron line:
`&& rclone copy ~/lexi/data/backups remote:lexi-backups --max-age 48h`

## (c) Caddy: cap request bodies at 2 MB

The app's inputs (pastes, imports) are small; capping bodies at the edge blocks
oversized uploads before they reach Node. In the server's Caddyfile, inside the
site block (alongside `encode`/`reverse_proxy` — mirror of the repo's
`deploy/Caddyfile`):

```caddy
    request_body {
        max_size 2MB
    }
```

Then reload Caddy:

```sh
cd ~/lexi && docker compose -f docker-compose.prod.yml exec -T caddy \
  caddy reload --config /etc/caddy/Caddyfile
```

## (d) Cloudflare free-plan toggles (dashboard, ~5 min)

In the Cloudflare dashboard for the zone:

1. **Rate limiting** — Security → WAF → Rate limiting rules → Create:
   - If incoming requests match: URI Path *starts with* `/api/`
   - Rate: **60 requests / 1 minute** per IP → Action: **Block** (default timeout)
2. **Cache Rule** — Caching → Cache Rules → Create:
   - Match: URI Path *is in* `/` `/how-it-works` `/privacy` `/terms`
   - Then: Eligible for cache, **Edge TTL: 1 hour** (ignore origin cache-control)
3. **Speed toggles** — Speed → Optimization: enable **Brotli**,
   **HTTP/3 (with QUIC)**, **Early Hints**; Caching → Tiered Cache: enable
   **Smart Tiered Caching**.

## (e) Uptime monitor

Point a free-tier monitor (UptimeRobot or BetterStack) at:

```
https://<your-domain>/api/health
```

HTTP(S) check, 5-minute interval, alert on non-2xx. That endpoint exercises the
full stack (Cloudflare → Caddy → Next → DB `SELECT 1`) without auth; it returns
503 `{ ok: false }` when the database is unreachable.

## (f) Deploy hygiene: clean-tree guard

The `deploy` shortcut rsyncs the **working tree** — uncommitted edits would go
live and be unreproducible from git. The repo now ships
`scripts/deploy-check.sh`, which exits 1 unless the tree is clean and `HEAD`
is on `origin/main`. Make the shortcut call it first, e.g.:

```sh
deploy() {
  ./scripts/deploy-check.sh || return 1
  # ...existing rsync + docker compose up -d --build...
}
```

If you have local work in progress when you need to deploy, set it aside first
with `git stash push --include-untracked -m predeploy` (and `git stash pop`
after).
