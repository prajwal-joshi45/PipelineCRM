# Pipeline CRM — self-hosted

A small Express server + JSON-file database, serving the CRM to everyone on
your local network. No cloud account, no monthly cost — just this laptop
turned on while people need access.

## 1. Install Node.js (one-time)

Download the **LTS** installer from https://nodejs.org and run it. To check
it worked, open a terminal (Command Prompt / Terminal.app) and run:

```
node --version
```

You should see something like `v20.x.x` or higher.

## 2. Install dependencies (one-time, needs internet)

In a terminal, `cd` into the `server` folder from this project, then:

```
cd server
npm install
```

This downloads Express, bcrypt (password hashing), and rate-limiting —
all pure JavaScript, nothing that needs a compiler.

## 3. Start the server

```
npm start
```

You'll see:

```
Pipeline CRM server running:
  On this machine:   http://localhost:3000
  On your network:   http://<this-computer's-LAN-IP>:3000
```

- On **this laptop**, open `http://localhost:3000` in a browser.
- On **teammates' phones/laptops** (same WiFi), find this computer's LAN IP
  (Windows: `ipconfig`, look for "IPv4 Address"; Mac: `ifconfig | grep inet`,
  or System Settings → WiFi → Details) and have them open
  `http://<that-ip>:3000` in their browser.

Keep the terminal window open — closing it stops the server. To stop
on purpose, press `Ctrl+C` in that terminal.

## 4. First-time setup

The first person to open the app gets a **"Set up this board"** screen —
that creates the one Admin account. Everyone after that logs in with a
username + password, and the Admin adds their accounts from the Admin tab.

## Where your data lives

Everything (leads, activity, users, settings) is stored in
`server/data/db.json`. **Back this file up regularly** — copy it somewhere
safe (Drive, USB stick) periodically, especially before any Windows/Mac
update or before closing this laptop's lid for a long stretch.

## Firewall note

The first time you run `npm start`, Windows/Mac may ask to allow Node.js
to accept network connections — click **Allow**, or teammates on other
devices won't be able to reach it.

## Access from outside your WiFi (remote / on-the-go)

The steps above only work for people on the same WiFi as this laptop. To
let someone check the CRM from mobile data or another network, see
**TUNNEL.md** — it sets up a free Cloudflare Tunnel so you get a public
`https://...` link, no router configuration needed.

## Moving to a real server later

When you outgrow the laptop, the same `server/` folder runs unchanged on
any VPS (DigitalOcean, Render, Railway, a free-tier cloud box, etc.) —
just copy the folder over, run `npm install && npm start` there, and point
people at that machine's address instead. The `data/db.json` file can be
copied over too, so no leads are lost in the move.
