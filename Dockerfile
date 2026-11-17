# syntax=docker/dockerfile:1
# Hey Ann: one Node process serving the UI + API (:8080, tailnet) and OAuth MCP (:8081, public via the tunnel).
# Everything it needs at runtime is in the image (built UI, no native modules), so the pod needs no network egress.
# Build from the repository root on an x64 machine:
#   docker build --platform linux/amd64 -t ghcr.io/kar6677thik/hey-ann:candidate .
ARG NODE_IMAGE=node:24.15.0-bookworm-slim@sha256:4e6b70dd6cbfc88c8157ba19aa3d9f9cce6ba4703576d55459e45efcbc9c5f5d

# ---- Production dependencies only
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-fund --no-audit && npm cache clean --force

# ---- Typecheck, test, build the UI
FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-fund --no-audit
COPY tsconfig.json ./
COPY src/ src/
COPY web/ web/
COPY tests/ tests/
COPY scripts/ scripts/
RUN npm run typecheck && npm test && npm run build

# ---- Runtime
FROM ${NODE_IMAGE} AS runtime
WORKDIR /app
# Root-owned and read-only to the app user; state lives only on the /data volume.
COPY --from=deps --chown=root:root /app/node_modules/ node_modules/
COPY --from=build --chown=root:root /app/web/dist/ web/dist/
COPY --chown=root:root package.json ./
COPY --chown=root:root src/ src/
# The volume mount point. Kubernetes sets ownership with fsGroup; this covers plain `docker run -v`.
RUN mkdir /data && chown 1654:1654 /data
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080 \
    HEYANN_DATA=/data \
    HOME=/tmp
# Numeric, so kubelet can verify runAsNonRoot.
USER 1654:1654
EXPOSE 8080 8081
CMD ["node", "--no-warnings", "src/server/index.ts"]
