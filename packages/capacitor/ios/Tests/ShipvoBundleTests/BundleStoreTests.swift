import XCTest
@testable import ShipvoBundle

/// A zip made by python's zipfile with deflate: index.html ("<p>release 2</p>" then 3000 x) and assets/app.js (200 lines).
let deflatedZip = Data(base64Encoded: "UEsDBBQAAAAIAAGkZl3ZlG22JwAAAMgLAAAKAAAAaW5kZXguaHRtbLMpsCtKzUlNLE5VMLLRL7CrGAWjYBSMglEwCkbBKBgFo2AUDHoAAFBLAwQUAAAACAABpGZdI2iWXSsAAACADAAADQAAAGFzc2V0cy9hcHAuanNLzs8rzs9J1cvJT9cw1LTmSh7lj/JH+aP8Uf4of5Q/yh/lj/JH+aN8GvEBUEsBAhQDFAAAAAgAAaRmXdmUbbYnAAAAyAsAAAoAAAAAAAAAAAAAAIABAAAAAGluZGV4Lmh0bWxQSwECFAMUAAAACAABpGZdI2iWXSsAAACADAAADQAAAAAAAAAAAAAAgAFPAAAAYXNzZXRzL2FwcC5qc1BLBQYAAAAAAgACAHMAAAClAAAAAAA=")!

/// Builds a zip with stored (uncompressed) entries. The checksum field is left at zero; the store checks the sha-256 of the whole file instead.
func storedZip(_ files: [(String, String)]) -> Data {
    func le(_ v: Int, _ n: Int) -> [UInt8] { (0..<n).map { UInt8((v >> (8 * $0)) & 0xff) } }
    var out = [UInt8](), central = [UInt8]()
    for (name, text) in files {
        let n = Array(name.utf8), d = Array(text.utf8)
        let offset = out.count
        out += le(0x04034b50, 4) + le(20, 2) + le(0, 2) + le(0, 2) + le(0, 4) + le(0, 4) + le(d.count, 4) + le(d.count, 4) + le(n.count, 2) + le(0, 2) + n + d
        central += le(0x02014b50, 4) + le(20, 2) + le(20, 2) + le(0, 2) + le(0, 2) + le(0, 4) + le(0, 4) + le(d.count, 4) + le(d.count, 4) + le(n.count, 2) + le(0, 2) + le(0, 2) + le(0, 2) + le(0, 2) + le(0, 4) + le(offset, 4) + n
    }
    let cdOffset = out.count
    out += central
    out += le(0x06054b50, 4) + le(0, 2) + le(0, 2) + le(files.count, 2) + le(files.count, 2) + le(central.count, 4) + le(cdOffset, 4) + le(0, 2)
    return Data(out)
}

struct Vectors: Decodable {
    let goodNames: [String]
    let badNames: [String]
    struct Hash: Decodable { let text: String; let hex: String }
    let sha256: [Hash]
}

final class BundleStoreTests: XCTestCase {
    var store: BundleStore!

    override func setUpWithError() throws {
        let root = FileManager.default.temporaryDirectory.appendingPathComponent("shipvo-\(UUID().uuidString)")
        store = BundleStore(root: root)
    }

    func vectors() throws -> Vectors {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
            .deletingLastPathComponent().appendingPathComponent("test/vectors/bundle-store.json")
        return try JSONDecoder().decode(Vectors.self, from: Data(contentsOf: url))
    }

    func testSharedVectorsForNamesAndHashes() throws {
        let v = try vectors()
        for n in v.goodNames { XCTAssertTrue(BundleStore.isValidName(n), n) }
        for n in v.badNames { XCTAssertFalse(BundleStore.isValidName(n), n) }
        XCTAssertFalse(BundleStore.isValidName(nil))
        for h in v.sha256 { XCTAssertEqual(sha256Hex(Data(h.text.utf8)), h.hex) }
        XCTAssertEqual(portableSha256(Data("abc".utf8)).map { String(format: "%02x", $0) }.joined(), v.sha256[1].hex)
    }

    func testWriteReadListRemoveClear() throws {
        try store.write("release-2.bundle", Data([1, 2, 3]))
        try store.write("release-1.bundle", Data([4]))
        XCTAssertEqual(try store.read("release-2.bundle"), Data([1, 2, 3]))
        XCTAssertEqual(store.list(), ["release-1.bundle", "release-2.bundle"])
        try store.remove("release-1.bundle")
        XCTAssertEqual(store.list(), ["release-2.bundle"])
        store.clear()
        XCTAssertTrue(store.list().isEmpty)
    }

    func testRefusesNamesThatEscape() {
        for n in ["../x", "a/b", "", "..", nil] as [String?] {
            XCTAssertThrowsError(try store.write(n, Data()), n ?? "nil")
        }
    }

    func testUnpacksOnlyWithTheVerifiedHash() throws {
        try store.write("release-2.bundle", deflatedZip)
        XCTAssertThrowsError(try store.unpack("release-2.bundle", expectedSha256: "00"))
        XCTAssertThrowsError(try store.unpack("release-2.bundle", expectedSha256: nil))
        let dir = try store.unpack("release-2.bundle", expectedSha256: sha256Hex(deflatedZip))
        let html = try String(contentsOf: dir.appendingPathComponent("index.html"), encoding: .utf8)
        XCTAssertEqual(html, "<p>release 2</p>" + String(repeating: "x", count: 3000))
        let js = try String(contentsOf: dir.appendingPathComponent("assets/app.js"), encoding: .utf8)
        XCTAssertEqual(js, String(repeating: "console.log(1);\n", count: 200))
    }

    func testRefusesAHashThatIsNotTheStoredFile() throws {
        try store.write("release-2.bundle", deflatedZip)
        try store.write("release-3.bundle", storedZip([("index.html", "x")]))
        // The hash of a different, valid bundle must not unlock this one.
        XCTAssertThrowsError(try store.unpack("release-3.bundle", expectedSha256: sha256Hex(deflatedZip))) { error in
            XCTAssertEqual((error as? BundleError)?.description, "bundle hash does not match")
        }
    }

    func testUnpacksStoredEntries() throws {
        let z = storedZip([("index.html", "<p>hi</p>"), ("css/a.css", "b{}")])
        try store.write("a.bundle", z)
        let dir = try store.unpack("a.bundle", expectedSha256: sha256Hex(z))
        XCTAssertTrue(FileManager.default.fileExists(atPath: dir.appendingPathComponent("css/a.css").path))
    }

    func testRefusesBundlesThatEscapeOrHaveNoIndex() throws {
        let evil = storedZip([("index.html", "x"), ("../evil.txt", "x")])
        try store.write("evil.bundle", evil)
        XCTAssertThrowsError(try store.unpack("evil.bundle", expectedSha256: sha256Hex(evil)))
        let none = storedZip([("a.txt", "x")])
        try store.write("none.bundle", none)
        XCTAssertThrowsError(try store.unpack("none.bundle", expectedSha256: sha256Hex(none)))
    }

    func testRefusesGarbageThatHasTheRightHash() throws {
        let junk = Data("not a zip at all, but long enough to try to read".utf8)
        try store.write("junk.bundle", junk)
        XCTAssertThrowsError(try store.unpack("junk.bundle", expectedSha256: sha256Hex(junk)))
    }

    func testSecondUnpackKeepsTheFirstUntilRetired() throws {
        let z = storedZip([("index.html", "<p>hi</p>")])
        try store.write("a.bundle", z)
        let first = try store.unpack("a.bundle", expectedSha256: sha256Hex(z))
        let second = try store.unpack("a.bundle", expectedSha256: sha256Hex(z))
        XCTAssertNotEqual(first, second)
        XCTAssertTrue(FileManager.default.fileExists(atPath: first.appendingPathComponent("index.html").path))
        store.retire(keeping: second)
        XCTAssertFalse(FileManager.default.fileExists(atPath: first.path))
        XCTAssertTrue(FileManager.default.fileExists(atPath: second.appendingPathComponent("index.html").path))
    }

    func testRefusesTruncatedZipAndTooManyEntries() throws {
        let z = [UInt8](storedZip([("index.html", "x")]))
        let truncated = Data(z.dropLast(10))
        try store.write("t.bundle", truncated)
        XCTAssertThrowsError(try store.unpack("t.bundle", expectedSha256: sha256Hex(truncated)))
        var many = z
        many[many.count - 22 + 10] = 5 // central directory claims 5 entries, only 1 exists
        let manyData = Data(many)
        try store.write("m.bundle", manyData)
        XCTAssertThrowsError(try store.unpack("m.bundle", expectedSha256: sha256Hex(manyData)))
    }
}
