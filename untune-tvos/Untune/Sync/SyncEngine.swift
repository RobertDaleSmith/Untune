import Foundation

enum SyncState: Equatable {
    case idle
    case discovering
    case connecting
    case syncingMetadata
    case syncingArtwork
    case uploadingPlayStats
    case done
    case error(String)
}

struct SyncProgress {
    var totalTracks = 0
    var syncedTracks = 0
    var totalArtwork = 0
    var downloadedArtwork = 0
    var phase: String = ""
}

@Observable
class SyncEngine {
    private let pairingManager: PairingManager
    private(set) var state: SyncState = .idle
    private(set) var progress = SyncProgress()

    init(pairingManager: PairingManager) {
        self.pairingManager = pairingManager
    }

    func sync() async {
        guard pairingManager.isPaired,
              let baseURL = pairingManager.baseURL,
              let token = pairingManager.authToken() else {
            state = .error("Not paired with desktop")
            return
        }

        let client = SyncClient(baseURL: baseURL, authToken: token)

        // Phase 1: Fetch metadata
        state = .syncingMetadata
        progress.phase = "Syncing metadata..."

        let manifest: SyncClient.SyncManifest
        do {
            manifest = try await client.fetchManifest()
        } catch {
            state = .error("Failed to fetch library: \(error.localizedDescription)")
            return
        }

        progress.totalTracks = manifest.tracks.count

        do {
            try DatabaseManager.shared.syncMetadataBatch(
                tracks: manifest.tracks,
                playlists: manifest.playlists
            )
            progress.syncedTracks = manifest.tracks.count
        } catch {
            state = .error("Failed to save metadata: \(error.localizedDescription)")
            return
        }

        // Phase 2: Download artwork to cache
        state = .syncingArtwork
        progress.phase = "Downloading artwork..."

        let artworkHashes = Set(manifest.tracks.compactMap { $0.artworkHash })
        progress.totalArtwork = artworkHashes.count

        await withTaskGroup(of: Void.self) { group in
            var active = 0
            for hash in artworkHashes {
                if active >= 8 {
                    await group.next()
                    active -= 1
                }
                active += 1
                group.addTask { [weak self] in
                    _ = await ArtworkLoader.shared.image(
                        forHash: hash,
                        baseURL: baseURL,
                        authToken: token
                    )
                    await MainActor.run {
                        self?.progress.downloadedArtwork += 1
                    }
                }
            }
        }

        // Phase 3: Upload pending play stats
        state = .uploadingPlayStats
        progress.phase = "Uploading play stats..."

        do {
            let pendingStats = try DatabaseManager.shared.fetchAndClearPendingPlayStats()
            if !pendingStats.isEmpty {
                let deltas = pendingStats.map { stat in
                    SyncClient.PlayStatsDelta(
                        trackId: stat.trackId,
                        playCountDelta: stat.playCountDelta,
                        skipCountDelta: stat.skipCountDelta,
                        lastPlayedAt: stat.lastPlayedAt,
                        lastSkippedAt: stat.lastSkippedAt
                    )
                }
                try await client.uploadPlayStats(deltas)
            }
        } catch {
            // Play stats upload failure is non-fatal
            print("Failed to upload play stats: \(error)")
        }

        // Mark sync complete
        do {
            try await client.markSyncComplete(
                trackIds: manifest.tracks.map(\.id),
                playlistIds: manifest.playlists.map(\.id)
            )
        } catch {
            print("Failed to mark sync complete: \(error)")
        }

        state = .done
        progress.phase = "Sync complete"
    }
}
