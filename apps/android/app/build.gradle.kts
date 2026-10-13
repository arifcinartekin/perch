import java.util.Properties

plugins {
  alias(libs.plugins.android.application)
  alias(libs.plugins.kotlin.compose)
  alias(libs.plugins.kotlin.serialization)
}

android {
  namespace = "app.perch.android"
  compileSdk = 37

  defaultConfig {
    applicationId = "app.perch.android"
    minSdk = 28
    targetSdk = 37
    versionCode = 1
    versionName = "0.1.0"
  }

  // The upload key for Google Play, from apps/android/keystore.properties (never committed):
  //   storeFile=/path/to/perch-upload.jks  storePassword=…  keyAlias=upload  keyPassword=…
  val keystore = rootProject.file("keystore.properties").takeIf { it.exists() }?.let { f ->
    Properties().apply { f.inputStream().use(::load) }
  }
  signingConfigs {
    if (keystore != null) {
      create("upload") {
        storeFile = file(keystore.getProperty("storeFile"))
        storePassword = keystore.getProperty("storePassword")
        keyAlias = keystore.getProperty("keyAlias")
        keyPassword = keystore.getProperty("keyPassword")
      }
    }
  }

  buildTypes {
    release {
      if (keystore != null) signingConfig = signingConfigs.getByName("upload")
      isMinifyEnabled = true
      isShrinkResources = true
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
    }
  }
  buildFeatures {
    compose = true
    buildConfig = true
  }
  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }
  testOptions { unitTests.isReturnDefaultValues = true }
}

kotlin { compilerOptions { jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17) } }

dependencies {
  implementation(platform(libs.compose.bom))
  implementation(libs.compose.ui)
  implementation(libs.compose.foundation)
  implementation(libs.compose.material3)
  implementation(libs.compose.material.icons)
  implementation(libs.compose.ui.tooling.preview)
  debugImplementation(libs.compose.ui.tooling)
  implementation(libs.activity.compose)
  implementation(libs.lifecycle.viewmodel.compose)
  implementation(libs.lifecycle.runtime.compose)
  implementation(libs.navigation.compose)
  implementation(libs.work.runtime)
  // The home-screen widget.
  implementation(libs.glance.appwidget)
  implementation(libs.coroutines.android)
  implementation(libs.serialization.json)
  implementation(libs.okhttp)
  implementation(libs.coil.compose)
  implementation(libs.coil.okhttp)
  implementation(libs.haze)
  implementation(libs.haze.glass)
  implementation(libs.haze.blur)
  // QR codes for sync chains: drawn with ZXing, scanned with CameraX (no Play services).
  implementation(libs.zxing)
  // Argon2id for Perch account passwords (the same stretching as every other Perch client).
  implementation(libs.bouncycastle)
  // The app lock: fingerprint or face (BiometricPrompt needs a FragmentActivity).
  implementation(libs.biometric)
  implementation(libs.fragment)
  implementation(libs.camera.camera2)
  implementation(libs.camera.lifecycle)
  implementation(libs.camera.view)

  testImplementation(libs.junit)
  testImplementation(libs.kxml2)
  testImplementation(libs.coroutines.test)
  testImplementation(libs.okhttp.mockwebserver)
}
