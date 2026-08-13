#!/bin/bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BT=/opt/android/sdk/build-tools/34.0.0
ANDROID_JAR=/opt/android/sdk/platforms/android-34/android.jar
JAVA_HOME=/opt/android/jdk-arm
export JAVA_HOME PATH="$JAVA_HOME/bin:$PATH"
QEMU="qemu-x86_64-static -L /usr/x86_64-linux-gnu"
WORK="$ROOT/android/build"
rm -rf "$WORK"; mkdir -p "$WORK/obj" "$WORK/dex"

echo "[1/7] keystore"
if [ ! -f "$WORK/nexus9.keystore" ]; then
  keytool -genkeypair -keystore "$WORK/nexus9.keystore" -alias nexus9 \
    -keyalg RSA -keysize 2048 -validity 10950 -storepass nexus9pass -keypass nexus9pass \
    -dname "CN=NEXUS-9 Mobile, OU=Mobile, O=NEXUS, L=Jakarta, ST=Jakarta, C=ID" >/dev/null 2>&1
fi

echo "[2/7] aapt2 compile res"
$QEMU "$BT/aapt2" compile --dir "$ROOT/android/res" -o "$WORK/res.zip"

echo "[3/7] aapt2 link"
$QEMU "$BT/aapt2" link -o "$WORK/unsigned.apk" -I "$ANDROID_JAR" \
  --manifest "$ROOT/android/AndroidManifest.xml" -R "$WORK/res.zip" \
  --auto-add-overlay --min-sdk-version 24 --target-sdk-version 34 \
  --version-code 1 --version-name 1.0

echo "[4/7] javac"
javac -source 8 -target 8 -bootclasspath "$ANDROID_JAR" -d "$WORK/obj" \
  "$ROOT/android/src/com/nexus9/mobile/MainActivity.java"

echo "[5/7] d8"
"$BT/d8" --release --lib "$ANDROID_JAR" --min-api 24 --output "$WORK/dex" \
  $(find "$WORK/obj" -name '*.class')

echo "[6/7] add dex + zipalign"
cd "$WORK/dex"
zip -q -X "$WORK/unsigned.apk" classes.dex
$QEMU "$BT/zipalign" -f 4 "$WORK/unsigned.apk" "$WORK/aligned.apk"

echo "[7/7] apksigner"
"$BT/apksigner" sign --ks "$WORK/nexus9.keystore" --ks-key-alias nexus9 \
  --ks-pass pass:nexus9pass --key-pass pass:nexus9pass \
  --out "$WORK/nexus9-mobile.apk" "$WORK/aligned.apk"
"$BT/apksigner" verify --print-certs "$WORK/nexus9-mobile.apk" | head -5
echo "APK OK: $WORK/nexus9-mobile.apk"
