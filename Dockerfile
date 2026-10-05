# syntax=docker/dockerfile:1

FROM node:24-bookworm-slim AS build
WORKDIR /app
# Nothing here starts Electron: the unit tests run in plain Node.js, and
# electron-builder fetches the macOS build of Electron on its own.
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json electron-builder.yml ./
COPY src src
COPY test test
COPY scripts scripts
RUN npm run build

FROM build AS package
# Linux can build the .app but not the .dmg, and it cannot sign.
RUN npx electron-builder --mac dir

# Holds only the app, for "docker build --output".
FROM scratch AS app
COPY --from=package /app/dist/mac-arm64/OdooBar.app /OdooBar.app
