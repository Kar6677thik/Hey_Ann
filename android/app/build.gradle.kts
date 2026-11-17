plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "gg.heyann.wall"
    compileSdk = 36

    defaultConfig {
        applicationId = "gg.heyann.wall"
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    buildFeatures {
        buildConfig = false
    }
    lint {
        // Sideloaded personal app; never fail the build on lint.
        abortOnError = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

dependencies {
    // No runtime dependencies on purpose: plain Views, HttpURLConnection, org.json, Android Keystore.
    testImplementation("junit:junit:4.13.2")
}
