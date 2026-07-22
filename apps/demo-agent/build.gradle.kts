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

// LangChain4j gives the demo agent its tool-call abstractions (ToolSpecification /
// ToolExecutionRequest in langchain4j-core, ToolExecutor in the main module). The
// skeleton drives them with a deterministic planner; GMCP-57 swaps in an LLM-backed
// AiServices in front of the same executors without touching the execution path.
val langchain4jVersion = "1.18.0"

dependencies {
    implementation("org.springframework.boot:spring-boot-starter-web")
    implementation("tools.jackson.module:jackson-module-kotlin")
    implementation("org.jetbrains.kotlin:kotlin-reflect")
    implementation("dev.langchain4j:langchain4j:$langchain4jVersion")

    testImplementation("org.springframework.boot:spring-boot-starter-test")
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
