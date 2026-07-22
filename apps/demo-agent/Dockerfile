# syntax=docker/dockerfile:1.7
ARG BUILDPLATFORM=linux/amd64
FROM --platform=${BUILDPLATFORM} eclipse-temurin:21-jdk-alpine AS build
WORKDIR /workspace

COPY apps/demo-agent/gradlew ./gradlew
COPY apps/demo-agent/gradle ./gradle
COPY apps/demo-agent/settings.gradle.kts apps/demo-agent/build.gradle.kts ./
RUN --mount=type=cache,id=guardmcp-demo-agent-gradle,target=/root/.gradle ./gradlew --no-daemon dependencies >/dev/null

COPY apps/demo-agent/src ./src
RUN --mount=type=cache,id=guardmcp-demo-agent-gradle,target=/root/.gradle \
    ./gradlew --no-daemon bootJar && \
    cp "$(find build/libs -maxdepth 1 -type f -name '*.jar' ! -name '*-plain.jar' | head -n 1)" /workspace/app.jar

FROM eclipse-temurin:21-jre-alpine AS runtime
ARG GUARDMCP_VERSION=dev
ENV PORT=3002 \
    GUARDMCP_VERSION=${GUARDMCP_VERSION}
RUN apk add --no-cache wget && \
    addgroup -S guardmcp && \
    adduser -S -G guardmcp -h /app guardmcp
WORKDIR /app
COPY --from=build --chown=guardmcp:guardmcp /workspace/app.jar ./app.jar
USER guardmcp
EXPOSE 3002
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-Djava.security.egd=file:/dev/urandom", "-jar", "/app/app.jar"]

# Development mode reuses the immutable runtime image; APP_MODE is set via Compose.
FROM runtime AS development
