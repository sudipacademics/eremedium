#!/bin/bash
# Read-only: test OpenAI connectivity for telephony AI brain via bench execute (no bookings/calls).
cd /opt/health-ecosystem/docker
docker compose exec -T backend bash -lc "cd /home/frappe/frappe-bench && bench --site health.localhost execute health_ecosystem_core.health_ecosystem_core.clinical_phase64_telephony._openai_chat_turn --kwargs \"{'messages': [{'role': 'user', 'content': 'Reply with the single word pong'}]}\" 2>&1 | grep -vE 'version.*obsolete|^time=' | tail -12"
