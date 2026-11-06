import Foundation

/// A small DEFLATE decoder (RFC 1951) so unpacking needs no zip library and no platform framework.
enum Inflate {
    struct Failure: Error {}

    private static let lengthBase: [Int] = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258]
    private static let lengthExtra: [Int] = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0]
    private static let distBase: [Int] = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577]
    private static let distExtra: [Int] = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13]
    private static let clOrder: [Int] = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15]

    private struct Huffman {
        var counts = [Int](repeating: 0, count: 16)
        var symbols: [Int]
        init(lengths: [Int]) {
            symbols = [Int](repeating: 0, count: lengths.count)
            for l in lengths { counts[l] += 1 }
            counts[0] = 0
            var offs = [Int](repeating: 0, count: 16)
            for i in 1..<16 { offs[i] = offs[i - 1] + counts[i - 1] }
            for (sym, l) in lengths.enumerated() where l != 0 { symbols[offs[l]] = sym; offs[l] += 1 }
        }
    }

    private struct Reader {
        let data: [UInt8]
        var pos = 0
        var bitBuf = 0
        var bitCnt = 0
        init(_ d: [UInt8]) { data = d }
        mutating func bits(_ n: Int) throws -> Int {
            while bitCnt < n {
                guard pos < data.count else { throw Failure() }
                bitBuf |= Int(data[pos]) << bitCnt; pos += 1; bitCnt += 8
            }
            let v = bitBuf & ((1 << n) - 1)
            bitBuf >>= n; bitCnt -= n
            return v
        }
        mutating func decode(_ h: Huffman) throws -> Int {
            var code = 0, first = 0, index = 0
            for len in 1..<16 {
                code |= try bits(1)
                let count = h.counts[len]
                if code - count < first { return h.symbols[index + (code - first)] }
                index += count; first += count; first <<= 1; code <<= 1
            }
            throw Failure()
        }
    }

    private static let fixedLit: Huffman = {
        var l = [Int](repeating: 8, count: 288)
        for i in 144..<256 { l[i] = 9 }
        for i in 256..<280 { l[i] = 7 }
        return Huffman(lengths: l)
    }()
    private static let fixedDist = Huffman(lengths: [Int](repeating: 5, count: 30))

    /// Decodes raw deflate data. `limit` caps the output size (a zip bomb stops here).
    static func decode(_ input: [UInt8], limit: Int) throws -> [UInt8] {
        var r = Reader(input)
        var out = [UInt8]()
        var last = false
        while !last {
            last = try r.bits(1) == 1
            switch try r.bits(2) {
            case 0:
                r.bitBuf = 0; r.bitCnt = 0
                guard r.pos + 4 <= input.count else { throw Failure() }
                let len = Int(input[r.pos]) | Int(input[r.pos + 1]) << 8
                let inv = Int(input[r.pos + 2]) | Int(input[r.pos + 3]) << 8
                guard len == (~inv & 0xFFFF), r.pos + 4 + len <= input.count, out.count + len <= limit else { throw Failure() }
                out.append(contentsOf: input[(r.pos + 4)..<(r.pos + 4 + len)])
                r.pos += 4 + len
            case 1:
                try block(&r, &out, fixedLit, fixedDist, limit)
            case 2:
                let nlen = try r.bits(5) + 257, ndist = try r.bits(5) + 1, ncode = try r.bits(4) + 4
                guard nlen <= 286, ndist <= 30 else { throw Failure() }
                var cl = [Int](repeating: 0, count: 19)
                for i in 0..<ncode { cl[clOrder[i]] = try r.bits(3) }
                let clh = Huffman(lengths: cl)
                var lengths = [Int]()
                while lengths.count < nlen + ndist {
                    let sym = try r.decode(clh)
                    if sym < 16 { lengths.append(sym); continue }
                    var rep = 0, val = 0
                    switch sym {
                    case 16: guard let p = lengths.last else { throw Failure() }; val = p; rep = 3 + (try r.bits(2))
                    case 17: rep = 3 + (try r.bits(3))
                    default: rep = 11 + (try r.bits(7))
                    }
                    guard lengths.count + rep <= nlen + ndist else { throw Failure() }
                    lengths.append(contentsOf: [Int](repeating: val, count: rep))
                }
                try block(&r, &out, Huffman(lengths: Array(lengths[0..<nlen])), Huffman(lengths: Array(lengths[nlen...])), limit)
            default:
                throw Failure()
            }
        }
        return out
    }

    private static func block(_ r: inout Reader, _ out: inout [UInt8], _ lit: Huffman, _ dist: Huffman, _ limit: Int) throws {
        while true {
            let sym = try r.decode(lit)
            if sym < 256 {
                guard out.count < limit else { throw Failure() }
                out.append(UInt8(sym))
            } else if sym == 256 {
                return
            } else {
                let li = sym - 257
                guard li < 29 else { throw Failure() }
                let len = lengthBase[li] + (try r.bits(lengthExtra[li]))
                let ds = try r.decode(dist)
                guard ds < 30 else { throw Failure() }
                let d = distBase[ds] + (try r.bits(distExtra[ds]))
                guard d <= out.count, out.count + len <= limit else { throw Failure() }
                for _ in 0..<len { out.append(out[out.count - d]) }
            }
        }
    }
}
