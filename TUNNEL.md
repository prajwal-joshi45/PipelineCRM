# Remote access (Cloudflare Tunnel)

This gives you a public `https://...trycloudflare.com` link that forwards to
this laptop, so someone on mobile data / a different WiFi can log in — no
router changes, no port forwarding.

## 1. Install `cloudflared` (one-time)

- **Windows:** download the `.exe` from
  https://github.com/cloudflare/cloudflared/releases/latest (get
  `cloudflared-windows-amd64.exe`), rename it to `cloudflared.exe`, and put
  it somewhere on your PATH (or just in this `server` folder).
- **Mac:** `brew install cloudflared`
- **Linux:** see install instructions at
  https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/

Check it worked:
```
cloudflared --version
```

## 2. Run the server + tunnel together

**Mac/Linux:**
```
cd server
./start-with-tunnel.sh
```

**Windows:**
```
cd server
start-with-tunnel.bat
```

This starts the CRM server, then starts the tunnel. In the terminal output,
look for a line like:

```
https://random-words-here.trycloudflare.com
```

That's the link to share with whoever needs remote access — they log in
with their normal username/password like anyone else. Everything still goes
through the same server-side permission checks; the tunnel is just how
their request reaches your laptop.

**Important:** this free "quick tunnel" URL is random and **changes every
time you restart it**. That's fine for occasional on-the-go checks, but if
you want a stable link people can bookmark, you'll want a named tunnel tied
to a Cloudflare account + a domain (free Cloudflare account works, but you
need a domain you control) — see
https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/get-started/
if/when you want that. Worth doing once this becomes daily-use rather than
occasional.

## Stopping it

Close the terminal window, or `Ctrl+C` — this stops both the server and the
tunnel, and the public link stops working immediately.

## Security note

Traffic through the tunnel is HTTPS-encrypted end-to-end. The tunnel itself
doesn't add or remove any permission checks — the same server-side role
checks (`server/auth.js`) apply to every request whether it comes from your
local network or through the tunnel.
