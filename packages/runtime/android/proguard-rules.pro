# net.i2p eddsa references a JDK-only class in a code path Android never takes (X509 key encoding).
-dontwarn sun.security.x509.**
-keep class net.i2p.crypto.eddsa.** { *; }
-dontwarn org.apache.commons.compress.**
-dontwarn org.tukaani.xz.**
-dontwarn com.github.luben.zstd.**
-dontwarn org.brotli.dec.**
-dontwarn org.objectweb.asm.**
