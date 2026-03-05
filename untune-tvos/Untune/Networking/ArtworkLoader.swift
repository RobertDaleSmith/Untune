import Foundation
import SwiftUI

/// Loads and caches artwork images from the desktop sync server
@Observable
class ArtworkLoader {
    static let shared = ArtworkLoader()

    private let memoryCache = NSCache<NSString, PlatformImage>()
    private let cacheDir: URL
    private var inflightRequests: [String: [CheckedContinuation<PlatformImage?, Never>]] = [:]

    private init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask).first!
        cacheDir = caches.appendingPathComponent("Artwork")
        try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)
        memoryCache.countLimit = 200
    }

    /// Get artwork image by hash, checking memory cache → disk cache → network fetch
    func image(forHash hash: String, baseURL: String? = nil, authToken: String? = nil) async -> PlatformImage? {
        let key = hash as NSString

        // 1. Memory cache
        if let cached = memoryCache.object(forKey: key) {
            return cached
        }

        // 2. Disk cache
        let diskPath = cacheDir.appendingPathComponent("\(hash).jpg")
        if let data = try? Data(contentsOf: diskPath),
           let image = PlatformImage(data: data) {
            memoryCache.setObject(image, forKey: key)
            return image
        }

        // 3. Network fetch (if we have connection info)
        guard let baseURL, let authToken else { return nil }

        // Coalesce duplicate requests for the same hash
        if inflightRequests[hash] != nil {
            return await withCheckedContinuation { continuation in
                inflightRequests[hash]?.append(continuation)
            }
        }

        inflightRequests[hash] = []

        let image = await fetchFromNetwork(hash: hash, baseURL: baseURL, authToken: authToken)

        // Resume all waiting continuations
        let waiters = inflightRequests.removeValue(forKey: hash) ?? []
        for waiter in waiters {
            waiter.resume(returning: image)
        }

        return image
    }

    private func fetchFromNetwork(hash: String, baseURL: String, authToken: String) async -> PlatformImage? {
        let urlString = "\(baseURL)/api/artwork/\(hash)"
        guard let url = URL(string: urlString) else { return nil }

        var request = URLRequest(url: url)
        request.setValue("Bearer \(authToken)", forHTTPHeaderField: "Authorization")

        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            guard let httpResponse = response as? HTTPURLResponse,
                  (200...299).contains(httpResponse.statusCode),
                  let image = PlatformImage(data: data) else {
                return nil
            }

            // Save to disk cache
            let diskPath = cacheDir.appendingPathComponent("\(hash).jpg")
            try? data.write(to: diskPath)

            // Save to memory cache
            memoryCache.setObject(image, forKey: hash as NSString)

            return image
        } catch {
            print("Failed to fetch artwork \(hash): \(error)")
            return nil
        }
    }
}

// Use UIImage on tvOS
typealias PlatformImage = UIImage
