#!/bin/bash
cd /home/frappe/frappe-bench/apps/hrms/hrms/hr/doctype 2>/dev/null || exit 0
ls -1 | grep -iE 'training|appraisal|goal|skill|performance|kra' || true
echo '---'
for d in appraisal appraisal_template appraisal_cycle training_event training_program training_result goal employee_skill_map; do
  test -d "$d" && echo "FOUND $d" || echo "MISS $d"
done
