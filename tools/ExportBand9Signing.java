import java.nio.file.*;
import java.nio.file.attribute.PosixFilePermissions;
import java.security.*;
import java.util.*;

// Export the SAME PKCS12 identity used by Android. Never overwrite mismatching PEMs.
class ExportBand9Signing {
    private static byte[] pem(String label, byte[] bytes) {
        String body = Base64.getMimeEncoder(64, new byte[] {'\n'}).encodeToString(bytes);
        return ("-----BEGIN " + label + "-----\n" + body + "\n-----END " + label + "-----\n")
            .getBytes(java.nio.charset.StandardCharsets.US_ASCII);
    }
    private static void writeChecked(Path file, byte[] bytes) throws Exception {
        if (Files.exists(file)) {
            if (!Arrays.equals(Files.readAllBytes(file), bytes)) throw new IllegalStateException("Existing signing file differs: " + file.getFileName());
            return;
        }
        Files.createDirectories(file.getParent());
        Files.write(file, bytes, StandardOpenOption.CREATE_NEW);
        try { Files.setPosixFilePermissions(file, PosixFilePermissions.fromString("rw-------")); }
        catch (UnsupportedOperationException ignored) { /* Windows ACLs apply. */ }
    }
    public static void main(String[] args) throws Exception {
        if (args.length != 1) throw new IllegalArgumentException("Pass the repository root.");
        Path root = Path.of(args[0]).toAbsolutePath();
        KeyStore store = KeyStore.getInstance("PKCS12");
        try (var input = Files.newInputStream(root.resolve("signing/band9/development.p12"))) {
            store.load(input, "android".toCharArray());
        }
        Key key = store.getKey("band9-navigation", "android".toCharArray());
        var cert = store.getCertificate("band9-navigation");
        if (!(key instanceof PrivateKey) || cert == null) throw new IllegalStateException("Missing Band 9 alias.");
        byte[] privatePem = pem("PRIVATE KEY", key.getEncoded());
        byte[] certPem = pem("CERTIFICATE", cert.getEncoded());
        for (String mode : new String[] {"debug", "release"}) {
            Path dir = root.resolve("band9/sign/" + mode);
            writeChecked(dir.resolve("private.pem"), privatePem);
            writeChecked(dir.resolve("certificate.pem"), certPem);
        }
        System.out.println("Paired PEM files checked/exported. Private key material is not printed.");
    }
}
