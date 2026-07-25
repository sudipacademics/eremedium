# career.e-remedium.in — nginx / DNS notes

Phase 1 careers portal uses the **same SPA** as www (`/opt/health-ecosystem/health_web_app/dist`).

## DNS
- Add `career.e-remedium.in` A/AAAA to the same edge IP as `www.e-remedium.in`.

## Nginx
Mirror an existing portal vhost (e.g. `reach.e-remedium.in`):
- `server_name career.e-remedium.in;`
- TLS cert (certbot or existing wildcard if available)
- `root` / `try_files` → same `health_web_app/dist`
- Proxy `/api/` to the Frappe backend (same as www)

## Frappe domain + seed
After DNS/nginx:

```bash
cd /opt/health-ecosystem/docker
./bench.sh --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase30_domain.setup_e_remedium_domain --kwargs "{'https': True}"
./bench.sh --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase73b_careers.setup_phase73b
```

## Local / www testing
Routes also work on www and localhost at `/careers`, `/jobs`, `/hr/applications` (HR requires System Manager / HR Manager / Health System Admin).
