import Foundation

public struct BundleError: Error, CustomStringConvertible {
    public let description: String
    init(_ d: String) { description = d }
}

/// Bundle files in a private directory. It never decides anything: the TypeScript core verifies the
/// signature and hash; this type only stores bytes and re-checks the hash it is given before it unpacks.
/// It mirrors `BundleStore.java` on Android, and both follow `test/vectors/bundle-store.json`.
public final class BundleStore {
    /// Most bytes an unpacked bundle may take. A zip that claims more is refused.
    public static let maxUnpackedBytes = 256 * 1024 * 1024

    private let dir: URL
    private let served: URL
    private let fm = FileManager.default

    public init(root: URL) {
        dir = root.appendingPathComponent("bundles", isDirectory: true)
        served = root.appendingPathComponent("served", isDirectory: true)
        try? fm.createDirectory(at: dir, withIntermediateDirectories: true)
    }

    public static func isValidName(_ name: String?) -> Bool {
        guard let name = name, !name.isEmpty, name.count <= 128, !name.contains("..") else { return false }
        return name.unicodeScalars.allSatisfy { ($0.value < 128) && (CharacterSet.alphanumerics.contains($0) || "._-".unicodeScalars.contains($0)) }
    }

    private func file(_ name: String?) throws -> URL {
        guard isValidName(name), let name = name else { throw BundleError("bad file name") }
        return dir.appendingPathComponent(name)
    }

    private func isValidName(_ n: String?) -> Bool { Self.isValidName(n) }

    public func write(_ name: String?, _ bytes: Data) throws {
        let f = try file(name)
        let tmp = dir.appendingPathComponent(f.lastPathComponent + ".tmp")
        do {
            try bytes.write(to: tmp, options: .atomic)
            if fm.fileExists(atPath: f.path) { try fm.removeItem(at: f) }
            try fm.moveItem(at: tmp, to: f)
        } catch {
            try? fm.removeItem(at: tmp)
            throw BundleError("could not write \(name ?? "")")
        }
    }

    public func read(_ name: String?) throws -> Data {
        do { return try Data(contentsOf: try file(name)) } catch let e as BundleError { throw e } catch { throw BundleError("could not read \(name ?? "")") }
    }

    public func remove(_ name: String?) throws { try? fm.removeItem(at: try file(name)) }

    public func list() -> [String] {
        ((try? fm.contentsOfDirectory(atPath: dir.path)) ?? []).filter { !$0.hasSuffix(".tmp") }.sorted()
    }

    public func clear() {
        for n in (try? fm.contentsOfDirectory(atPath: dir.path)) ?? [] { try? fm.removeItem(at: dir.appendingPathComponent(n)) }
        try? fm.removeItem(at: served)
    }

    /// Removes every unpacked directory except `keep`. Call it once the web view points at `keep`.
    public func retire(keeping keep: URL) {
        let keepName = keep.standardizedFileURL.lastPathComponent
        for n in (try? fm.contentsOfDirectory(atPath: served.path)) ?? [] where n != keepName {
            try? fm.removeItem(at: served.appendingPathComponent(n))
        }
    }

    /// Unpacks a stored zip into a fresh directory, but only if its sha-256 equals the hash the core
    /// verified against the signed pointer. Entries that escape the directory are refused.
    public func unpack(_ name: String?, expectedSha256: String?) throws -> URL {
        let bytes = try read(name)
        guard let expected = expectedSha256, sha256Hex(bytes).lowercased() == expected.lowercased() else {
            throw BundleError("bundle hash does not match")
        }
        // A fresh directory per call: the web view may still be serving the previous one.
        // The caller removes the old ones with `retire(keeping:)` after the switch succeeds.
        let target = served.appendingPathComponent("\(name!)-\(UUID().uuidString)", isDirectory: true)
        do {
            try fm.createDirectory(at: target, withIntermediateDirectories: true)
            try Zip.extract([UInt8](bytes), to: target, limit: Self.maxUnpackedBytes)
            guard fm.fileExists(atPath: target.appendingPathComponent("index.html").path) else { throw BundleError("bundle has no index.html") }
        } catch {
            try? fm.removeItem(at: target)
            throw (error as? BundleError) ?? BundleError("bad entry in bundle")
        }
        return target
    }
}

enum Zip {
    private static func u16(_ b: [UInt8], _ o: Int) -> Int { Int(b[o]) | Int(b[o + 1]) << 8 }
    private static func u32(_ b: [UInt8], _ o: Int) -> Int { u16(b, o) | u16(b, o + 2) << 16 }

    static func extract(_ b: [UInt8], to target: URL, limit: Int) throws {
        let bad = BundleError("bad entry in bundle")
        // End of central directory: the last 22+ bytes.
        guard b.count >= 22 else { throw bad }
        var eocd = -1
        var i = b.count - 22
        while i >= max(0, b.count - 22 - 65535) {
            if u32(b, i) == 0x06054b50 { eocd = i; break }
            i -= 1
        }
        guard eocd >= 0 else { throw bad }
        let entries = u16(b, eocd + 10)
        var p = u32(b, eocd + 16)
        let root = target.standardizedFileURL.path + "/"
        var total = 0
        for _ in 0..<entries {
            guard p + 46 <= b.count, u32(b, p) == 0x02014b50 else { throw bad }
            let flags = u16(b, p + 8), method = u16(b, p + 10)
            let csize = u32(b, p + 20), usize = u32(b, p + 24)
            let nlen = u16(b, p + 28), elen = u16(b, p + 30), clen = u16(b, p + 32)
            let local = u32(b, p + 42)
            guard p + 46 + nlen <= b.count, flags & 1 == 0, csize != 0xFFFFFFFF, usize != 0xFFFFFFFF else { throw bad }
            guard let name = String(bytes: b[(p + 46)..<(p + 46 + nlen)], encoding: .utf8) else { throw bad }
            p += 46 + nlen + elen + clen
            let parts = name.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            if name.hasPrefix("/") || name.contains("\\") || parts.contains("..") || name.contains("\0") { throw bad }
            let dest = target.appendingPathComponent(name)
            guard dest.standardizedFileURL.path.hasPrefix(root) else { throw bad }
            if name.hasSuffix("/") { try FileManager.default.createDirectory(at: dest, withIntermediateDirectories: true); continue }
            total += usize
            guard total <= limit else { throw bad }
            guard local + 30 <= b.count, u32(b, local) == 0x04034b50 else { throw bad }
            let start = local + 30 + u16(b, local + 26) + u16(b, local + 28)
            guard start + csize <= b.count else { throw bad }
            let raw = Array(b[start..<(start + csize)])
            let data: [UInt8]
            switch method {
            case 0: data = raw
            case 8: data = try Inflate.decode(raw, limit: usize)
            default: throw bad
            }
            guard data.count == usize else { throw bad }
            try FileManager.default.createDirectory(at: dest.deletingLastPathComponent(), withIntermediateDirectories: true)
            try Data(data).write(to: dest)
        }
    }
}
