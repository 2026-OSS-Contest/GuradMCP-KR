import org.gradle.language.jvm.tasks.ProcessResources

plugins {
    kotlin("jvm") version "2.3.21"
    kotlin("plugin.spring") version "2.3.21"
    id("org.springframework.boot") version "4.0.7"
    id("io.spring.dependency-management") version "1.1.7"
}

group = "kr.guardmcp"
version = "0.1.0"

java {
    toolchain { languageVersion = JavaLanguageVersion.of(21) }
}

repositories { mavenCentral() }

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("org.springframework.boot:spring-boot-starter-actuator")
    implementation("org.springframework.boot:spring-boot-starter-jdbc")
    implementation("com.fasterxml.jackson.module:jackson-module-kotlin")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    // Spring Boot 4 moved Flyway autoconfiguration out of spring-boot-autoconfigure into its
    // own starter (spring-boot-flyway) — flyway-database-postgresql alone isn't picked up.
    implementation("org.springframework.boot:spring-boot-starter-flyway")
    implementation("org.flywaydb:flyway-database-postgresql")
    // `implementation`, not `runtimeOnly`: the audit repository uses PGobject/Array directly
    // (text[] and jsonb columns) rather than going through an ORM.
    implementation("org.postgresql:postgresql")
    // GMCP-80 §3.7 (POST /sessions/{id}/export): renders the session report's HTML straight to
    // PDF, no external binary (wkhtmltopdf, headless Chrome) required.
    implementation("io.github.openhtmltopdf:openhtmltopdf-pdfbox:1.1.73")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
    testImplementation("org.springframework.boot:spring-boot-testcontainers")
    testImplementation("org.testcontainers:testcontainers-junit-jupiter")
    testImplementation("org.testcontainers:testcontainers-postgresql")
    testImplementation("io.kotest:kotest-runner-junit5-jvm:6.2.2")
    testImplementation("io.kotest:kotest-assertions-core-jvm:6.2.2")
}

kotlin {
    compilerOptions {
        freeCompilerArgs.add("-Xjsr305=strict")
    }
}

tasks.withType<Test> {
    useJUnitPlatform()
}

// GMCP-80 §3.4 (GET /attacklab/scenarios): the scenario catalog has exactly one source of
// truth, attack-lab/scenarios/catalog.json (the same file the runner, GMCP-55, executes
// against) — bundling it onto the classpath at build time means the endpoint can never drift
// from it the way a hand-copied or hardcoded scenario list would. The Docker build stage
// (services/control-plane/Dockerfile) COPYs the same repo-root file into the same relative
// path before this task runs, so the source lines up in both places.
tasks.named<ProcessResources>("processResources") {
    from("../../attack-lab/scenarios/catalog.json") {
        into("attacklab")
    }
}
