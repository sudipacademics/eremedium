# Multi-stage production image for Remedium RFMS (Node local-api + static Next exports)
FROM node:20-bookworm AS build
WORKDIR /app

# Absolute: the apps run `new URL(...)` on this at build time.
ARG NEXT_PUBLIC_RFMS_API_URL=https://www.e-remedium.in/rfms-api/v1
ARG NEXT_PUBLIC_RFMS_MARKETING_URL=https://www.e-remedium.in/franchise
ARG NEXT_PUBLIC_RFMS_PORTAL_URL=https://www.e-remedium.in/onboard
ARG NEXT_PUBLIC_RFMS_ADMIN_URL=https://www.e-remedium.in/ffms
# Empty = app served at the root of its own host; otherwise a path prefix.
ARG MARKETING_BASE_PATH=/franchise
ARG PORTAL_BASE_PATH=/onboard
ARG ADMIN_BASE_PATH=/ffms
ARG NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=

ENV NEXT_TELEMETRY_DISABLED=1
ENV NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY

COPY package.json ./
COPY apps/marketing-web/package.json apps/marketing-web/
COPY apps/franchise-portal/package.json apps/franchise-portal/
COPY apps/admin-dashboard/package.json apps/admin-dashboard/
COPY packages ./packages

RUN npm install --no-audit --no-fund

COPY apps/marketing-web apps/marketing-web
COPY apps/franchise-portal apps/franchise-portal
COPY apps/admin-dashboard apps/admin-dashboard
COPY apps/local-api apps/local-api

# Each app is built separately so it gets its own basePath.
RUN NEXT_PUBLIC_RFMS_API_URL=$NEXT_PUBLIC_RFMS_API_URL \
    NEXT_PUBLIC_RFMS_MARKETING_URL=$NEXT_PUBLIC_RFMS_MARKETING_URL \
    NEXT_PUBLIC_RFMS_PORTAL_URL=$NEXT_PUBLIC_RFMS_PORTAL_URL \
    NEXT_PUBLIC_RFMS_ADMIN_URL=$NEXT_PUBLIC_RFMS_ADMIN_URL \
    NEXT_PUBLIC_BASE_PATH=$MARKETING_BASE_PATH \
    npm run build --workspace @rfms/marketing-web

RUN NEXT_PUBLIC_RFMS_API_URL=$NEXT_PUBLIC_RFMS_API_URL \
    NEXT_PUBLIC_RFMS_MARKETING_URL=$NEXT_PUBLIC_RFMS_MARKETING_URL \
    NEXT_PUBLIC_RFMS_PORTAL_URL=$NEXT_PUBLIC_RFMS_PORTAL_URL \
    NEXT_PUBLIC_RFMS_ADMIN_URL=$NEXT_PUBLIC_RFMS_ADMIN_URL \
    NEXT_PUBLIC_BASE_PATH=$PORTAL_BASE_PATH \
    npm run build --workspace @rfms/franchise-portal

RUN NEXT_PUBLIC_RFMS_API_URL=$NEXT_PUBLIC_RFMS_API_URL \
    NEXT_PUBLIC_RFMS_MARKETING_URL=$NEXT_PUBLIC_RFMS_MARKETING_URL \
    NEXT_PUBLIC_RFMS_PORTAL_URL=$NEXT_PUBLIC_RFMS_PORTAL_URL \
    NEXT_PUBLIC_RFMS_ADMIN_URL=$NEXT_PUBLIC_RFMS_ADMIN_URL \
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY=$NEXT_PUBLIC_GOOGLE_MAPS_API_KEY \
    NEXT_PUBLIC_BASE_PATH=$ADMIN_BASE_PATH \
    npm run build --workspace @rfms/admin-dashboard

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production \
    RFMS_API_PORT=8090 \
    RFMS_MARKETING_PORT=3000 \
    RFMS_PORTAL_PORT=3001 \
    RFMS_ADMIN_PORT=3002

COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages
COPY --from=build /app/apps/local-api ./apps/local-api
COPY --from=build /app/apps/marketing-web/out ./apps/marketing-web/out
COPY --from=build /app/apps/franchise-portal/out ./apps/franchise-portal/out
COPY --from=build /app/apps/admin-dashboard/out ./apps/admin-dashboard/out

RUN mkdir -p /data/work /data/uploads \
 && ln -sfn /data/work /app/work

VOLUME ["/data"]
EXPOSE 8090 3000 3001 3002

CMD ["node", "apps/local-api/server.mjs"]
