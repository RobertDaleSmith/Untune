import SwiftUI
import UIKit

final class ArtworkCache {
    static let shared = ArtworkCache()
    private let cache = NSCache<NSString, UIImage>()

    private init() {
        cache.countLimit = 500
    }

    func image(forHash hash: String) -> UIImage? {
        let key = hash as NSString
        if let cached = cache.object(forKey: key) {
            return cached
        }

        guard let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            return nil
        }

        let base = appSupport.appendingPathComponent("Artwork/\(hash)")

        // Try JPG first, then PNG
        for ext in ["jpg", "png"] {
            let path = base.appendingPathExtension(ext).path
            if let image = UIImage(contentsOfFile: path) {
                cache.setObject(image, forKey: key)
                return image
            }
        }

        return nil
    }
}

struct ArtworkView: View {
    let artworkHash: String?
    let size: CGFloat

    init(_ artworkHash: String?, size: CGFloat = 50) {
        self.artworkHash = artworkHash
        self.size = size
    }

    var body: some View {
        if let hash = artworkHash, let image = ArtworkCache.shared.image(forHash: hash) {
            Image(uiImage: image)
                .resizable()
                .aspectRatio(contentMode: .fill)
                .frame(width: size, height: size)
                .clipShape(RoundedRectangle(cornerRadius: size > 100 ? 12 : 6))
        } else {
            ZStack {
                RoundedRectangle(cornerRadius: size > 100 ? 12 : 6)
                    .fill(Color(.systemGray5))
                Image(systemName: "music.note")
                    .font(.system(size: size * 0.35))
                    .foregroundStyle(.secondary)
            }
            .frame(width: size, height: size)
        }
    }
}
