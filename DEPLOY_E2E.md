# Deploying OTS on E2E Networks

Deploying with Docker on AWS instead? Use [DEPLOY_AWS.md](DEPLOY_AWS.md). Sections 0 and 8 below still apply there.

Step-by-step for putting the kiosk/admin site on E2E Networks, on one node. Do it
top to bottom; each step says how to check it worked.

The site never touches R2 and sends no data files: samples are a Google Drive link,
and a dataset's bucket is filled by hand.

---

## 0. Before you start (once)

- [ ] **Supabase**: SQL files 001–015 run, the Orion (with batch 6) and Axis indexes
      imported. Check in the SQL editor:
      ```sql
      select capture_setup, count(*), round(sum(duration_s)/3600.0) as hours
        from public.ots_episodes group by 1;          -- ego 48,387 / 11,555 h, head_wrist 15,599 / 3,146 h
      ```
- [ ] **Supabase plan**: on Free, a project with no activity for 7 days is paused,
      and then the kiosk stops taking requests. Use Pro, or open the admin page
      every few days.
- [ ] **Google Drive**: the Ego-centric sample folder exists, shared as "anyone with the
      link can view", with its link ready for step 5.
- [ ] **Domain**: pick the address, e.g. `ots.awign.com`. Whoever manages
      awign.com DNS will add one A record in step 3.
- [ ] **Resend**: verify the sending domain (e.g. `awign.in`) in Resend → Domains
      and add the DNS records it shows. Until then emails only reach the Resend
      account owner. Then `EMAIL_FROM=Awign Robotics Data <data@awign.in>`.
- [ ] **The code**: this folder isn't in git yet. Either push it to a private repo
      (then `git clone` on the server), or copy the folder over with `scp`/WinSCP,
      **without** `node_modules/`, `.next/`, `.env`, `data/`, `archive/`.

## 1. Create the web node

E2E console → Nodes → Create:

- Ubuntu 22.04 or 24.04
- at least **2 vCPU / 4 GB RAM** (the build needs ~2 GB)
- region **Mumbai or Delhi** (close to the booth)
- add your SSH key

Note its public IP.

## 2. Install Node 22, Nginx, pm2

```bash
ssh root@<web-node-ip>
apt update && apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt -y install nodejs nginx
npm install -g pm2
node -v          # must print v22.x
adduser --disabled-password --gecos "" ots   # the app runs as this user, not root
```

## 3. Point the domain at it

DNS for awign.com: **A record** `ots` → `<web-node-ip>`.
Check: `ping ots.awign.com` answers from that IP (can take a few minutes).

## 4. Put the code on the server

```bash
su - ots
git clone <repo-url> ots        # or copy the folder to /home/ots/ots
cd ~/ots
npm ci
```

## 5. The server's `.env`

`nano ~/ots/.env`, then `chmod 600 ~/ots/.env`:

```bash
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_PUBLIC=<anon key>               # same as your local .env
RESEND_API_KEY=<resend key>
EMAIL_FROM=Awign Robotics Data <data@awign.in>
SAMPLE_DRIVE_URL_EGO=https://drive.google.com/drive/folders/<ego folder>
OFFER_MCAP=true                               # full-dataset sizes count MCAP; see the note in README
```

**Never on the server:** `SUPABASE_SERVICE_ROLE`, or any R2 key. The site doesn't use R2.
Your local `.env` has `SUPABASE_SERVICE_ROLE`; don't copy that line. The code
never reads it.

## 6. Build and start the site

```bash
cd ~/ots
npm run build
pm2 start npm --name ots-web -- start -- -H 127.0.0.1
pm2 save
exit                                   # back to root
pm2 startup systemd -u ots --hp /home/ots   # run the command it prints, so it starts on reboot
```

`-H 127.0.0.1`: the app only listens inside the machine, and Nginx is the only
way in. Check: `curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:3010/` prints `200`.

## 7. Nginx + HTTPS

`/etc/nginx/sites-available/ots`:

```nginx
server {
    listen 80;
    server_name ots.awign.com;

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";

        # A big dataset file list takes a while to build.
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/ots /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
apt -y install certbot python3-certbot-nginx
certbot --nginx -d ots.awign.com        # free HTTPS certificate, renews itself
ufw allow OpenSSH && ufw allow 'Nginx Full' && ufw enable
```

Check: `https://ots.awign.com` opens the kiosk.

## 8. Check the site end to end

- [ ] Kiosk: step through, numbers load (hours on the cards).
- [ ] `https://ots.awign.com/admin`: admin login works.
- [ ] Request an **Ego-centric free sample** with your own email. The email arrives
      and its button opens the Drive folder. The request shows **Sent** in the admin.
- [ ] Request a **head + wrist free sample**. The "we're preparing it" email arrives
      and the request shows **Pending delivery**. Send the bucket access from the
      request page: the keys arrive and it shows **Sent**.
- [ ] Request a **full dataset** with your own email. The confirmation arrives, and
      the request page shows the breakdown per environment and skill.
- [ ] **Download the file list** on that request; its rows match the selection.
- [ ] Reject the test request, with a note.

## 9. First real dataset

The steps are on the request page, and in README ("Request lifecycle", "What goes in
the bucket"). Before the first one:

- [ ] Try the emailed `aws s3 sync` command yourself with a test bucket and token,
      from a machine outside Awign.
- [ ] Make sure the token is **Object Read only, for this bucket only**: the email
      that carries it stays in Resend's logs for a while.

## Updating the site later

```bash
ssh root@<web-node-ip>
su - ots && cd ~/ots
git pull                 # or copy the changed files over
npm ci && npm run build
pm2 reload ots-web
```

New SQL files in `supabase/` are run in the Supabase SQL editor **before**
`pm2 reload`.

## When something's wrong

| You see | Look at |
|---|---|
| Site down / 502 | `pm2 status`, `pm2 logs ots-web` |
| A customer's email didn't go out | The reason is on the request page. Then `EMAIL_FROM`, Resend domain verified, and **Send again** |
| Ego-centric samples stay "Pending delivery" | `SAMPLE_DRIVE_URL_EGO` in `.env`, then `pm2 reload ots-web --update-env` |
| Admin page: `PGRST202` in logs | a SQL file in `supabase/` hasn't been run |
| Customer gets `AccessDenied` on the bucket | the token's bucket or its Object Read permission in R2 |
| File list download fails | `pm2 logs ots-web`; it's all or nothing, so try again |
| Kiosk review says "Estimate" | `ots_inventory()` failed or timed out (Supabase paused, or slow under load); `pm2 logs ots-web` says which |
| Everything stopped at once | Supabase Free paused the project after 7 idle days: dashboard → Restore |
