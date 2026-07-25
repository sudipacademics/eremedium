#!/bin/bash
cd /opt/health-ecosystem/docker
docker compose exec -T backend bench --site health.localhost execute \
  health_ecosystem_core.health_ecosystem_core.clinical_phase74_performance.submit_training_feedback \
  --kwargs '{"user":"phlebotomist@health.local","training_event":"NABL & Lab Quality Basics — Intro Session","rating":4,"feedback":"test"}'
