# Frappe HRMS install notes (Company HRMS rollout)

## Rule: never half-install

If `apps/hrms` exists on the bench **or** `sites/apps.txt` lists `hrms`, the site **must** have a completed `bench --site health.localhost install-app hrms` + `migrate`.

Partial state symptoms:

- Desk Employee form / timeline crashes
- `Module HR not found`
- `list-apps` missing `hrms` while `apps.txt` still lists it

## Clean install (live server)

```bash
# From desktop — upload scripts + HEC repair modules first, then:
scp docker/complete-hrms-install.sh docker/patch-phase21-hr.sh \
  root@167.233.108.90:/opt/health-ecosystem/docker/

scp health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_hrms_repair.py \
  health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/clinical_phase21.py \
  root@167.233.108.90:/opt/health-ecosystem/health_ecosystem_core/health_ecosystem_core/health_ecosystem_core/

ssh root@167.233.108.90 "sed -i 's/\r$//' /opt/health-ecosystem/docker/complete-hrms-install.sh && bash /opt/health-ecosystem/docker/complete-hrms-install.sh"
```

## Success checks

```bash
docker compose exec -T backend bench --site health.localhost list-apps   # must include hrms
docker compose exec -T backend bench --site health.localhost execute \
  health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair.run_repair
docker compose exec -T backend bench --site health.localhost execute \
  health_ecosystem_core.health_ecosystem_core.init.run_phase21_setup
```

## Never

- `docker compose down -v`
- Leave `hrms` on disk without site install
- Full `deploy-on-server.sh` reset unless explicitly requested
