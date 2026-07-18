# syntax=docker/dockerfile:1.7
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /workspace

COPY services/control-plane/gradlew ./gradlew
COPY services/control-plane/gradle ./gradle
COPY services/control-plane/settings.gradle.kts services/control-plane/build.gradle.kts ./
RUN --mount=type=cache,target=/root/.gradle ./gradlew --no-daemon dependencies >/dev/null

COPY services/control-plane/src ./src
RUN --mount=type=cache,target=/root/.gradle \
    ./gradlew --no-daemon bootJar && \
    cp "$(find build/libs -maxdepth 1 -type f -name '*.jar' ! -name '*-plain.jar' | head -n 1)" /workspace/app.jar

FROM eclipse-temurin:21-jre-alpine AS runtime
ARG GUARDMCP_VERSION=dev
ENV PORT=8080 \
    GUARDMCP_VERSION=${GUARDMCP_VERSION}
RUN apk add --no-cache wget && \
    addgroup -S guardmcp && \
    adduser -S -G guardmcp -h /app guardmcp
WORKDIR /app
COPY --from=build --chown=guardmcp:guardmcp /workspace/app.jar ./app.jar
USER guardmcp
EXPOSE 8080
ENTRYPOINT ["java", "-XX:MaxRAMPercentage=75.0", "-Djava.security.egd=file:/dev/urandom", "-jar", "/app/app.jar"]
