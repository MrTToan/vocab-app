# Deploy — the background knowledge (read this alongside DEPLOY.md)

`DEPLOY.md` tells you **what commands to run**. This doc explains **what's actually happening and why**, so
the steps stop being magic. Read a phase here, then do that phase there. No copy-paste — just understanding.

---

## The big picture (a mental model to hold the whole time)

There are **three computers** in this story, and they only talk in specific ways:

```
   YOUR LAPTOP                 GITHUB                    THE SERVER (VPS)                THE INTERNET
   where you write code   →   a backup + history   ...  a rented computer that runs  →  your users' browsers
   and run `deploy`           of your code              your app 24/7                    hit https://your-domain
```

- **Your laptop** is where you *write and test*. It's not online 24/7, so it can't *host* the app.
- **A VPS** (Virtual Private Server) is a computer you rent that's always on and has a public address on the
  internet — so it *can* host. It's just a Linux box in a data center.
- **GitHub** is version-control + backup. Important: in *our* setup, **the server does NOT get code from
  GitHub** — you `rsync` it straight from your laptop. GitHub is your safety net, not part of the deploy.
- **The internet** reaches your server through a **domain name** (DNS) and a **secure connection** (HTTPS).

Everything in the 10 phases is just: *rent the box → lock it down → put software on it → point a name at it
→ make it secure → keep it that way.*

Two more ideas that unlock everything:

- **A "server" is just a program that waits for requests and answers them.** Your Next.js app is a server.
  Caddy is a server. The database is a server. They pass requests to each other.
- **A "port" is a numbered door on a computer.** Web traffic uses port **80** (http) and **443** (https).
  SSH uses **22**. Your app listens on **3000**. A firewall decides which doors are open to the world.

---

## Docker & containers (the idea behind Phases 0, 3, 6, 8)

This is the biggest concept, so it comes first.

**The problem Docker solves:** "it works on my laptop but not on the server" — because the two machines have
different versions of Node, different libraries, different OS. **A container is a sealed box that carries the
app *and everything it needs to run* (its exact Node version, its libraries, its files).** Ship the box, and
it runs identically anywhere.

The vocabulary:
- **Dockerfile** — a *recipe*. "Start from Node 22, copy my code in, install packages, build." It's a text
  file in your repo.
- **Image** — the *finished meal* the recipe produces. A frozen, ready-to-run snapshot of your app. (~1 GB
  for a Next.js app — that's Node + your code + all dependencies.)
- **Container** — a *running instance* of an image. One image can start many containers. When it stops,
  anything written *inside* it is lost — which is why the database lives *outside* (see Volumes).
- **Docker Compose** — a way to run *several* containers together from one file (`docker-compose.yml`).
  We run two: your **app** container and the **Caddy** container. Compose also gives them a private network
  so they can talk (`caddy` → `app:3000`) without exposing the app to the internet.

**"Build" vs "run" (the cooking analogy):** *building* the image is like cooking a big meal — it needs a lot
of kitchen space (RAM). *Running* it is like reheating a finished dish — cheap. That's why the *build* wants
4 GB but the *running* app is light, and why the swap file matters only during the build.

**Volumes / bind mounts:** a container is disposable, but your database must survive. A **bind mount**
(`./data:/app/.data`) is a folder on the *server* that's plugged into the container. The container reads and
writes it, but it lives on the host — so rebuilding the container never touches your data.

---

## Phase 1 — the VPS (what you're actually renting)

A VPS is a slice of a big physical server, running its own Linux. The specs you pick:
- **vCPU** — processing power (how many things at once / how fast).
- **RAM** — working memory. This is the number that matters for us, because *building* Next.js is
  memory-hungry (hence 4 GB).
- **Disk** — storage for the OS, Docker images, and your DB.
- **x86 vs ARM** — the *CPU instruction set*. A Docker image is built for one or the other. We build for
  x86/amd64, so the server must be x86 — an ARM box would refuse to run the image. (This is a real, silent
  footgun.)

"The cloud" is not magical — it's someone else's computer you rent by the month.

---

## Phase 2 — hardening (the security concepts)

**SSH** ("Secure Shell") is how you get a command line *on the server* from your laptop, over an encrypted
connection. Two ways to prove who you are:
- **Password** — weak; bots hammer servers guessing passwords all day.
- **Key pair** — you have a **private key** (a secret file on your laptop, `~/.ssh/id_ed25519`) and the
  server has your matching **public key**. Math lets the server verify you hold the private key *without it
  ever leaving your laptop*. Nearly unbreakable, and no password to steal. This is why we use keys and then
  *turn passwords off entirely*.

**root vs a sudo user:** `root` is the all-powerful admin account — a favorite target for attackers. Best
practice: create a normal user (`toan`), give it the ability to *temporarily* act as admin with `sudo`, and
**disable root login over SSH**. That's why, after hardening, `ssh root@` is refused and `ssh toan@` works —
it's the security *working*, not breaking.

**Firewall (ufw):** decides which "doors" (ports) the world can knock on. We open only 22 (SSH), 80, 443
(web) and slam everything else shut.

**Swap:** disk space the OS uses as *overflow* when RAM runs out. It's slower than RAM, but it stops a
memory-hungry build from crashing (getting "OOM-killed") on a 4 GB box.

**fail2ban / unattended-upgrades:** auto-ban IPs that brute-force you, and auto-install security patches.
Set-and-forget hygiene.

---

## Phase 3 — installing Docker (and the "permission denied" moment)

Installing Docker gives you the **Docker Engine** (runs containers) + **Compose** (orchestrates several).

The `permission denied … docker.sock` you hit: Docker runs as a privileged background service; to talk to it
without `sudo`, your user must be in the `docker` **group**. Linux only reads your group memberships when a
session *starts* — so after adding yourself to the group you must **log out and back in** for it to apply.
Not a broken install; just how Unix groups work.

---

## Phase 4 — DNS & Cloudflare (how a name finds your server)

**DNS** (Domain Name System) is the internet's phone book: it turns a *name* people type
(`lexi.vnfriends.com`) into an *IP address* (`2.29.21.95`) that computers route to. An **A record** is one
phone-book entry: "this name → this IPv4 address."

**Cloudflare** is two things at once here:
1. A **DNS provider** — it holds your phone-book entries (free).
2. A **reverse proxy / CDN** — optionally, it sits *in front* of your server. Visitors hit Cloudflare;
   Cloudflare relays to your server. That hides your server's real IP, and adds free DDoS protection and a
   firewall (WAF).

**Grey cloud vs orange cloud:** grey = "DNS only" (Cloudflare just tells people your IP; traffic goes
straight to you). Orange = "Proxied" (traffic flows *through* Cloudflare). We start grey so the server can
prove it owns the domain to get its first certificate, then flip to orange for the shield.

---

## Phase 5 — Google sign-in (the OAuth concepts)

**OAuth** is the standard behind every "Sign in with Google/GitHub/…" button. The idea: instead of your app
storing passwords, you *delegate* login to Google. The dance:

1. User clicks "Sign in" → your app sends them to Google.
2. Google authenticates them and asks "allow this app to see your email + name?"
3. Google sends them back to your app at a pre-registered **redirect URI**, with a token.
4. Your app exchanges that token for the user's identity (email, name).

The pieces you configured:
- **Client ID + secret** — your app's "username + password" *with Google*. Proves the request is really from
  your app.
- **Redirect URI** — the exact URL Google is allowed to send users back to. Must match *exactly* (a stray
  slash breaks it) — a security measure so an attacker can't redirect the login elsewhere.
- **Scopes** — *what* you're asking for. `email`/`profile`/`openid` are "non-sensitive," so Google doesn't
  require a review. Ask for more (someone's Drive, Gmail) and you'd need verification.
- **Consent screen / Testing vs Production** — Testing = only emails you list can sign in (an allowlist).
  Production = anyone — which is why Google demands a real privacy policy + homepage first (they're
  protecting *users* from sketchy apps).

**`AUTH_SECRET` / sessions:** once you're logged in, the app gives your browser a **cookie** so it doesn't
re-ask every click. That cookie is *signed* with `AUTH_SECRET` so nobody can forge one. It's just a long
random string that must stay secret and consistent.

---

## Phase 6 — env vars & compose (config without hardcoding)

**Environment variables** are configuration passed to a program *from outside its code* — so the same code
runs in dev and prod with different settings, and **secrets never get hardcoded into the source** (which
would end up in git). Your `.env` file holds them on the server; the app reads them at startup.

Why secrets live *only* on the server and *never* in git: git history is forever and often public. A leaked
key = someone spending your money. (This is exactly why we deleted that stray `client_secret` file.)

The **compose file** ties it together: it declares the `app` and `caddy` **services**, the **ports** Caddy
exposes to the world, the **volume** that persists the DB, the **env_file** with secrets, and a private
**network** so Caddy can reach the app internally without the app being exposed.

---

## Phase 7 — the database (SQLite & persistence)

**SQLite** is a database that's just *a single file* (`lexi.db`) — no separate database server to run, pay
for, or maintain. Perfect for one machine with moderate traffic. (You'd switch to Postgres/Turso only if you
needed many app servers hitting one DB at once.)

It's **not in git** because it's *data*, not *code* — it changes every time a user does anything, and it's
yours/private. Code is versioned; data is backed up. Two different jobs. That's why the DB has to be uploaded
separately and lives in a bind-mounted folder that survives every rebuild.

---

## Phase 8 — going live (HTTPS, TLS, reverse proxy)

**HTTPS** = HTTP + encryption. The padlock means the connection between browser and server is scrambled so
nobody in between can read or tamper with it. It relies on a **TLS certificate** — a file that (a) encrypts
the traffic and (b) proves "this really is lexi.vnfriends.com," signed by an authority browsers trust.

**Let's Encrypt** is a free authority that issues those certificates automatically. To get one, your server
has to *prove it controls the domain* — which is why DNS must point at it first, and why the record starts
grey-clouded (so Let's Encrypt can reach your server directly).

**Caddy (a reverse proxy)** sits at the front door (ports 80/443). It:
- terminates HTTPS (handles the certificate + encryption),
- automatically gets and renews the Let's Encrypt cert (near-zero config),
- forwards the plain request inward to your app on port 3000.

So the flow is: **browser → (HTTPS) → Caddy → (plain http, internal) → your app → back out.** Your app never
has to think about certificates; Caddy does it all.

---

## Phase 9 — the Cloudflare proxy & Origin certificate (the trickiest concept)

When you turn on the Cloudflare **proxy** (orange cloud), there are now **two encrypted hops**, not one:

```
browser  ──HTTPS──▶  Cloudflare  ──HTTPS──▶  your server (Caddy)
         (edge cert)              (origin cert)
```

- The **edge certificate** (browser ↔ Cloudflare) is handled by Cloudflare automatically — that's the
  trusted padlock your visitors see.
- The **origin certificate** (Cloudflare ↔ your server) secures the *second* hop. Here's the subtlety we hit:
  once Cloudflare is in front, your server's Let's Encrypt cert can no longer *renew* (Let's Encrypt can't
  reach the server directly through the proxy). So Cloudflare gives you a special **Origin Certificate** — a
  15-year cert that only Cloudflare needs to trust — and you point Caddy at it. No more renewal to break.

**SSL/TLS mode = "Full", not "Full (strict)":** this setting controls how strict Cloudflare is about the
*origin* hop's certificate — and it applies to your **whole domain zone**, not just this app. "Strict" would
also demand a perfect cert on *other* sites under `vnfriends.com` and could break them. "Full" still encrypts
everything; it just doesn't over-validate. ("Flexible" is the dangerous one — it talks *plain http* to your
server, which breaks login cookies. Never use it.)

**Cron jobs** (Phase 9 backups/cleanup) are the OS's scheduler: "run this command at this time, forever."
`0 3 * * *` = 3 a.m. daily. That's how the nightly DB backup and the weekly Docker cleanup happen on their
own.

---

## Phase 10 — the deploy loop (rsync & the build-run cycle)

**`rsync`** copies files from A to B *efficiently* — it only sends what changed, and with `--delete` it makes
B an exact **mirror** of A. That "mirror" power is why the excludes matter so much: without them, files that
exist only on the server (your `.env`, the database, the certs) aren't in the source, so `--delete`
*removes* them. Excluding them says "leave these server-only files alone."

**The deploy cycle:** you change code locally → `rsync` the new source up → the server **rebuilds the image**
(recompiles) → swaps the running container for the new one → your DB (in its volume) is untouched. That's
the whole loop, wrapped in your `deploy lexi` command.

**CI/CD** (which you chose to skip for now): **CI** = automatically run your tests when you push (you have
this — the GitHub Action). **CD** = automatically *deploy* on push. You correctly deferred CD because it
makes `main` = production; manual deploys keep you in control until you want that.

---

## A 12-word glossary to anchor it

- **VPS** — a rented always-on Linux computer with a public IP.
- **SSH** — encrypted remote command line; use key pairs, not passwords.
- **Port** — a numbered door on a machine (80/443 web, 22 SSH, 3000 app).
- **Docker image** — a frozen, portable snapshot of your app + everything it needs.
- **Container** — a running instance of an image (disposable).
- **Volume / bind mount** — a host folder plugged into a container so data survives.
- **DNS / A record** — name → IP address lookup.
- **Reverse proxy** — a front-door server (Caddy) that handles HTTPS and forwards inward.
- **TLS certificate** — the file that makes HTTPS work and proves your identity.
- **OAuth** — delegating login to Google instead of storing passwords.
- **Environment variable** — config/secrets passed to code from outside, kept out of git.
- **Cron** — the OS scheduler for recurring commands.

---

_Read this once end-to-end, then keep it beside `DEPLOY.md`: the runbook says "do X", this says "X is Y, and
here's why." On your next app, try running the phases yourself and using this to understand what each command
means — that's where the real learning lives._
