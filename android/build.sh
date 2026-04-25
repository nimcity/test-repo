#!/bin/bash
set -e
cd "$(dirname "$0")"

ANDROID_JAR=/usr/lib/android-sdk/platforms/android-23/android.jar
PKG=com/puzzlefighter
BUILD=build
APK=puzzle-fighter.apk

echo "==> Cleaning..."
rm -rf $BUILD
mkdir -p $BUILD/gen $BUILD/obj $BUILD/dex $BUILD/apk

echo "==> Generating R.java..."
aapt package -f -m \
  -J $BUILD/gen \
  -S res \
  -M AndroidManifest.xml \
  -I $ANDROID_JAR

echo "==> Compiling Java..."
javac -source 8 -target 8 \
  -bootclasspath $ANDROID_JAR \
  -classpath $ANDROID_JAR \
  -d $BUILD/obj \
  src/$PKG/MainActivity.java \
  $BUILD/gen/$PKG/R.java

echo "==> Creating DEX..."
/usr/lib/android-sdk/build-tools/debian/dx \
  --dex --output=$BUILD/dex/classes.dex $BUILD/obj

echo "==> Packaging APK..."
aapt package -f \
  -M AndroidManifest.xml \
  -S res \
  -A assets \
  -I $ANDROID_JAR \
  -F $BUILD/apk/unsigned.apk

# Add classes.dex
cd $BUILD/dex && aapt add ../apk/unsigned.apk classes.dex && cd ../..

echo "==> Generating keystore..."
if [ ! -f debug.keystore ]; then
  keytool -genkeypair -v \
    -keystore debug.keystore \
    -alias puzzlefighter \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass android -keypass android \
    -dname "CN=PuzzleFighter,OU=Game,O=Dev,L=City,ST=State,C=US" \
    2>/dev/null
fi

echo "==> Aligning APK (before signing)..."
zipalign -f 4 $BUILD/apk/unsigned.apk $BUILD/apk/aligned.apk

echo "==> Signing APK..."
apksigner sign \
  --ks debug.keystore \
  --ks-pass pass:android \
  --key-pass pass:android \
  --ks-key-alias puzzlefighter \
  --out $APK \
  $BUILD/apk/aligned.apk

echo ""
echo "✅  Done! APK: android/$APK"
