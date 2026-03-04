import SwiftUI
import UIKit

enum AccentColorExtractor {
    /// Extract a vibrant accent color from an image using saturation-weighted hue bucketing.
    /// Port of the desktop app's `extractAccentColor.ts`.
    static func extractAccentColor(from image: UIImage) -> (r: UInt8, g: UInt8, b: UInt8)? {
        // Scale to 64×64
        let size = CGSize(width: 64, height: 64)
        let renderer = UIGraphicsImageRenderer(size: size)
        let scaled = renderer.image { ctx in
            image.draw(in: CGRect(origin: .zero, size: size))
        }

        guard let cgImage = scaled.cgImage else { return nil }

        let width = 64
        let height = 64
        let bytesPerPixel = 4
        let bytesPerRow = width * bytesPerPixel
        let totalBytes = height * bytesPerRow

        var pixelData = [UInt8](repeating: 0, count: totalBytes)
        guard let context = CGContext(
            data: &pixelData,
            width: width,
            height: height,
            bitsPerComponent: 8,
            bytesPerRow: bytesPerRow,
            space: CGColorSpaceCreateDeviceRGB(),
            bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue
        ) else { return nil }

        context.draw(cgImage, in: CGRect(x: 0, y: 0, width: width, height: height))

        // 12 hue buckets (30° each), score by saturation²
        let numBuckets = 12
        var buckets = Array(repeating: (rSum: 0.0, gSum: 0.0, bSum: 0.0, satScore: 0.0, count: Int(0)), count: numBuckets)

        for i in stride(from: 0, to: pixelData.count, by: 4) {
            let r = Double(pixelData[i])
            let g = Double(pixelData[i + 1])
            let b = Double(pixelData[i + 2])

            let rn = r / 255.0
            let gn = g / 255.0
            let bn = b / 255.0

            let maxC = max(rn, gn, bn)
            let minC = min(rn, gn, bn)
            let l = (maxC + minC) / 2.0
            let d = maxC - minC

            // Skip near-black, near-white, and very desaturated pixels
            if l < 0.1 || l > 0.9 || d < 0.08 { continue }

            let s = d / (1.0 - abs(2.0 * l - 1.0))
            var h = 0.0
            if d > 0 {
                if maxC == rn {
                    h = ((gn - bn) / d).truncatingRemainder(dividingBy: 6)
                    if h < 0 { h += 6 }
                } else if maxC == gn {
                    h = (bn - rn) / d + 2.0
                } else {
                    h = (rn - gn) / d + 4.0
                }
                h *= 60.0
            }

            let bucketIdx = min(numBuckets - 1, Int(h / 30.0))
            let weight = s * s

            buckets[bucketIdx].rSum += r * weight
            buckets[bucketIdx].gSum += g * weight
            buckets[bucketIdx].bSum += b * weight
            buckets[bucketIdx].satScore += weight
            buckets[bucketIdx].count += 1
        }

        // Pick bucket with highest total saturation score
        var best = -1
        var bestScore = 0.0
        for i in 0..<numBuckets {
            if buckets[i].satScore > bestScore {
                bestScore = buckets[i].satScore
                best = i
            }
        }

        guard best >= 0, bestScore > 0 else { return nil }

        let bk = buckets[best]
        return (
            r: UInt8(clamping: Int(round(bk.rSum / bk.satScore))),
            g: UInt8(clamping: Int(round(bk.gSum / bk.satScore))),
            b: UInt8(clamping: Int(round(bk.bSum / bk.satScore)))
        )
    }

    /// Adjust an RGB accent color for adequate contrast on a dark or light background.
    /// Dark mode: clamp lightness to 55–75%, ensure saturation >= 40%.
    /// Light mode: clamp lightness to 30–50%, ensure saturation >= 40%.
    static func adjustForTheme(r: UInt8, g: UInt8, b: UInt8, isDark: Bool) -> Color {
        let rn = Double(r) / 255.0
        let gn = Double(g) / 255.0
        let bn = Double(b) / 255.0

        let maxC = max(rn, gn, bn)
        let minC = min(rn, gn, bn)
        var h = 0.0
        var s = 0.0
        let l = (maxC + minC) / 2.0
        let d = maxC - minC

        if d > 0 {
            s = d / (1.0 - abs(2.0 * l - 1.0))
            if maxC == rn {
                h = ((gn - bn) / d).truncatingRemainder(dividingBy: 6)
                if h < 0 { h += 6 }
            } else if maxC == gn {
                h = (bn - rn) / d + 2.0
            } else {
                h = (rn - gn) / d + 4.0
            }
            h *= 60.0
        }

        // Clamp saturation and lightness
        let adjS = max(s, 0.4)
        let adjL: Double
        if isDark {
            adjL = max(0.55, min(0.75, l))
        } else {
            adjL = max(0.30, min(0.50, l))
        }

        // HSL → RGB
        let c = (1.0 - abs(2.0 * adjL - 1.0)) * adjS
        let x = c * (1.0 - abs((h / 60.0).truncatingRemainder(dividingBy: 2) - 1.0))
        let m = adjL - c / 2.0

        var r1 = 0.0, g1 = 0.0, b1 = 0.0
        if h < 60       { r1 = c; g1 = x }
        else if h < 120 { r1 = x; g1 = c }
        else if h < 180 { g1 = c; b1 = x }
        else if h < 240 { g1 = x; b1 = c }
        else if h < 300 { r1 = x; b1 = c }
        else             { r1 = c; b1 = x }

        return Color(
            red: min(1, max(0, r1 + m)),
            green: min(1, max(0, g1 + m)),
            blue: min(1, max(0, b1 + m))
        )
    }

    /// Full pipeline: extract accent color from image and adjust for current color scheme.
    static func accentColor(from image: UIImage, isDark: Bool) -> Color? {
        guard let rgb = extractAccentColor(from: image) else { return nil }
        return adjustForTheme(r: rgb.r, g: rgb.g, b: rgb.b, isDark: isDark)
    }
}
