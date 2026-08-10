plugins {
    // Lets Gradle auto-provision the JDK 21 toolchain (build.gradle.kts) on machines that
    // don't happen to have it installed, instead of failing the build outright.
    id("org.gradle.toolchains.foojay-resolver-convention") version "1.0.0"
}

rootProject.name = "guardmcp-control-plane"
