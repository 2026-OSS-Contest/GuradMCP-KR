# syntax=docker/dockerfile:1.7
ARG BUILDPLATFORM=linux/amd64
FROM --platform=${BUILDPLATFORM} eclipse-temurin:21-jdk-alpine AS build
# Nested two levels under /build (mirroring services/control-plane sitting two levels under
# the monorepo root for a local, non-Docker build) so build.gradle.kts's processResources
# `../../attack-lab/...` reference resolves to an ordinary directory in both places. Landing
# it at the literal filesystem root (the old `/workspace` two-levels-up) broke Gradle's VFS
# watcher in some container runtimes: "Cannot snapshot /dev/core: not a regular file".
WORKDIR /build/services/control-plane

COPY services/control-plane/gradlew ./gradlew
COPY services/control-plane/gradle ./gradle
COPY services/control-plane/settings.gradle.kts services/control-plane/build.gradle.kts ./
RUN --mount=type=cache,target=/root/.gradle ./gradlew --no-daemon dependencies >/dev/null

# GMCP-80: build.gradle.kts's processResources task bundles this file onto the classpath
# so GET /attacklab/scenarios never drifts from the real scenario catalog.
COPY attack-lab/scenarios/catalog.json /build/attack-lab/scenarios/catalog.json

COPY services/control-plane/src ./src
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon bootJar && \
    cp "$(find build/libs -maxdepth 1 -type f -name '*.jar' ! -name '*-plain.jar' | head -n 1)" /build/app.jar

FROM eclipse-temurin:21-jre-alpine AS runtime
ARG GUARDMCP_VERSION=dev
ENV PORT=8080 \
    GUARDMCP_VERSION=${GUARDMCP_VERSION}
RUN apk add --no-cache wget && \
    addgroup -S guardmcp && \
    adduser -S -G guardmcp -h /app guardmcp
WORKDIR /app
COPY --from=build --chown=guardmcp:guardmcp /build/app.jar ./app.jar
USER guardmcp
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-Djava.security.egd=file:/dev/urandom", "-jar", "/app/app.jar"]
