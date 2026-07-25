#!/bin/bash
cd /opt/health-ecosystem/docker
docker compose exec -T backend bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_hrms_repair.probe_training_schema
