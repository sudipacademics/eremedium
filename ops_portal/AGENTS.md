# Smilecure Operations Department portal

Staff console for Lab, Care, Aesthetic and Pharmacy. Public URL: https://ops.e-remedium.in
It runs on the same Hetzner server as remediumlabs.in (`167.233.108.90`).

## Run

```bash
npm install
npm run dev    # http://127.0.0.1:5182/
npm run build  # dist/ for the domain root
```

`/api` and `/files` proxy to the live labs site, the same way the aesthetics site does. The dashboard itself is the operations desk: bookings, approvals, stock and tasks are handled in the portal.

## Deploy

- Web root: `/opt/health-ecosystem/ops_portal/dist`
- Config: `/etc/nginx/sites-available/ops.e-remedium.in` (source in `nginx/ops.e-remedium.in.conf`)
- Certificate: `/etc/letsencrypt/live/ops.e-remedium.in/`
- DNS: `ops.e-remedium.in` A/AAAA to `167.233.108.90`

Until the certificate exists, `nginx/ops.e-remedium.in.http.conf` serves the site on port 80 so certbot can complete.
