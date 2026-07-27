#!/bin/bash
set -euo pipefail
docker exec docker-rfms-1 node --input-type=module -e '
import { sendOtpViaErp } from "./apps/local-api/hec-frappe-bridge.mjs";
try {
  const r = await sendOtpViaErp("9000000000");
  console.log("SEND_OK", JSON.stringify(r));
} catch (e) {
  console.error("SEND_ERR", e.message);
  process.exit(1);
}
'
