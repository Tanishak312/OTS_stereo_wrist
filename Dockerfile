# OTS kiosk + admin (Next.js standalone server).
# No key is needed to build: everything is read from the environment when the
# container starts, so one image runs anywhere. See DEPLOY_AWS.md.

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS run
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3010
RUN addgroup -S ots && adduser -S ots -G ots
# Owned by the app user: Next writes its cache under .next at runtime.
COPY --from=build --chown=ots:ots /app/.next/standalone ./
COPY --from=build --chown=ots:ots /app/.next/static ./.next/static
COPY --from=build --chown=ots:ots /app/public ./public
USER ots
EXPOSE 3010
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# HOSTNAME is set here, not with ENV: container platforms overwrite it with the
# container's name, and the server would then not answer the load balancer.
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]
