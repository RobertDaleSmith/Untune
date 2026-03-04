import Foundation
import UIKit
import BackgroundTasks

enum SyncState: String {
    case idle
    case discovering
    case connecting
    case fetchingPlaylists
    case awaitingSelection
    case syncingMetadata
    case syncingArtwork
    case syncingFiles
    case uploadingPlayStats
    case done
    case error
}

@Observable
class SyncEngine {
    private(set) var state: SyncState = .idle
    private(set) var progress: SyncProgress = SyncProgress()
    private(set) var errorMessage: String?
    private(set) var availablePlaylists: [SyncClient.SyncPlaylistMeta] = []
    var selectedPlaylistIds: Set<Int64> {
        didSet { persistSelectedPlaylistIds() }
    }

    private let pairingManager: PairingManager
    private let db = DatabaseManager.shared
    private var pendingManifest: SyncClient.SyncManifest?
    private var pendingClient: SyncClient?
    private var backgroundTaskID: UIBackgroundTaskIdentifier = .invalid

    private static let selectedPlaylistIdsKey = "selectedSyncPlaylistIds"
    static let bgTaskIdentifier = "com.untune.ios.sync"

    struct SyncProgress {
        var totalTracks = 0
        var downloadedTracks = 0
        var totalArtwork = 0
        var downloadedArtwork = 0
        var phase: String = ""
    }

    init(pairingManager: PairingManager) {
        self.pairingManager = pairingManager
        // Restore persisted selection
        let saved = UserDefaults.standard.array(forKey: SyncEngine.selectedPlaylistIdsKey) as? [Int64] ?? []
        self.selectedPlaylistIds = Set(saved)
    }

    // MARK: - Playlist Selection Flow

    func fetchPlaylistsForSelection() async {
        guard pairingManager.isPaired,
              let baseURL = pairingManager.baseURL,
              let token = pairingManager.authToken() else {
            state = .error
            errorMessage = "Not paired with desktop"
            return
        }

        let client = SyncClient(baseURL: baseURL, authToken: token)
        state = .fetchingPlaylists
        progress = SyncProgress()
        progress.phase = "Fetching playlists..."
        errorMessage = nil

        do {
            let manifest = try await client.fetchManifest()
            pendingManifest = manifest
            pendingClient = client
            availablePlaylists = manifest.playlists.filter { !$0.isFolder }
            state = .awaitingSelection
        } catch {
            state = .error
            errorMessage = error.localizedDescription
            print("[Sync] Failed to fetch playlists: \(error)")
        }
    }

    func cancelSelection() {
        pendingManifest = nil
        pendingClient = nil
        availablePlaylists = []
        state = .idle
    }

    func startSync() async {
        guard let manifest = pendingManifest,
              let client = pendingClient else {
            // Fallback: if called without pending manifest, fetch fresh
            await startSyncLegacy()
            return
        }

        pendingManifest = nil
        pendingClient = nil

        // Filter manifest to only selected playlists and their tracks
        let filteredManifest = filterManifest(manifest)

        beginBackgroundTask()
        state = .syncingMetadata
        progress = SyncProgress()
        errorMessage = nil

        do {
            print("[Sync] Syncing \(filteredManifest.tracks.count) tracks from \(filteredManifest.playlists.count) playlists")

            // 2. Sync metadata to local DB
            progress.phase = "Updating metadata..."
            progress.totalTracks = filteredManifest.tracks.count
            try syncMetadata(filteredManifest)
            print("[Sync] Metadata synced")

            // 3. Download artwork
            state = .syncingArtwork
            let artworkHashes = Set(filteredManifest.tracks.compactMap { $0.artworkHash })
            progress.totalArtwork = artworkHashes.count
            progress.downloadedArtwork = 0
            progress.phase = "Downloading artwork..."
            print("[Sync] Downloading \(artworkHashes.count) artwork files...")

            let artworkToDownload = artworkHashes.filter { hash in
                !FileManager.default.fileExists(atPath: artworkFileURL(hash: hash).path)
            }
            progress.totalArtwork = artworkToDownload.count
            let artworkErrors = await downloadConcurrently(
                items: Array(artworkToDownload),
                concurrency: 8
            ) { hash in
                let artworkURL = self.artworkFileURL(hash: hash)
                try await client.downloadArtwork(hash: hash, to: artworkURL)
            } onProgress: {
                self.progress.downloadedArtwork += 1
            }
            print("[Sync] Artwork done (\(artworkErrors) errors)")

            // 4. Download audio files (only tracks that have files on desktop)
            state = .syncingFiles
            progress.downloadedTracks = 0
            progress.phase = "Downloading tracks..."

            let tracksToDownload = filteredManifest.tracks.filter { track in
                guard let ext = track.fileExtension else { return false }
                let fileURL = audioFileURL(trackId: track.id, ext: ext)
                return !FileManager.default.fileExists(atPath: fileURL.path)
            }
            progress.totalTracks = tracksToDownload.count
            print("[Sync] Downloading \(tracksToDownload.count) audio files (\(filteredManifest.tracks.count - tracksToDownload.count) skipped/already downloaded)...")

            let downloadErrors = await downloadConcurrently(
                items: tracksToDownload,
                concurrency: 6
            ) { track in
                let ext = track.fileExtension ?? "m4a"
                let fileURL = self.audioFileURL(trackId: track.id, ext: ext)
                try await client.downloadTrackFile(trackId: track.id, to: fileURL)
                try self.db.updateTrackFilePath(trackId: track.id, localPath: fileURL.path)
            } onProgress: {
                self.progress.downloadedTracks += 1
                if self.progress.downloadedTracks % 50 == 0 {
                    print("[Sync] Downloaded \(self.progress.downloadedTracks)/\(tracksToDownload.count) tracks")
                }
            }
            print("[Sync] Audio files done (\(downloadErrors) errors)")

            // 5. Upload play stats
            state = .uploadingPlayStats
            progress.phase = "Uploading play stats..."
            print("[Sync] Uploading play stats...")
            try await uploadPendingPlayStats(client: client)

            // 6. Mark complete
            print("[Sync] Marking sync complete...")
            let trackIds = filteredManifest.tracks.map { $0.id }
            let playlistIds = filteredManifest.playlists.map { $0.id }
            try await client.markSyncComplete(trackIds: trackIds, playlistIds: playlistIds)

            state = .done
            progress.phase = "Sync complete"
            print("[Sync] Complete!")
            endBackgroundTask()
            SyncEngine.scheduleBackgroundSync()

        } catch {
            state = .error
            errorMessage = error.localizedDescription
            print("[Sync] FAILED at phase '\(progress.phase)': \(error)")
            endBackgroundTask()
        }
    }

    // MARK: - Legacy Sync (no playlist selection)

    func startSyncLegacy() async {
        guard pairingManager.isPaired,
              let baseURL = pairingManager.baseURL,
              let token = pairingManager.authToken() else {
            state = .error
            errorMessage = "Not paired with desktop"
            return
        }

        let client = SyncClient(baseURL: baseURL, authToken: token)
        beginBackgroundTask()
        state = .syncingMetadata
        progress = SyncProgress()
        errorMessage = nil

        do {
            progress.phase = "Fetching library..."
            let manifest = try await client.fetchManifest()
            let filteredManifest = filterManifest(manifest)

            progress.phase = "Updating metadata..."
            progress.totalTracks = filteredManifest.tracks.count
            try syncMetadata(filteredManifest)

            state = .syncingArtwork
            let artworkHashes = Set(filteredManifest.tracks.compactMap { $0.artworkHash })
            let artworkToDownload = artworkHashes.filter { hash in
                !FileManager.default.fileExists(atPath: artworkFileURL(hash: hash).path)
            }
            progress.totalArtwork = artworkToDownload.count
            progress.phase = "Downloading artwork..."
            let _ = await downloadConcurrently(items: Array(artworkToDownload), concurrency: 8) { hash in
                try await client.downloadArtwork(hash: hash, to: self.artworkFileURL(hash: hash))
            } onProgress: { self.progress.downloadedArtwork += 1 }

            state = .syncingFiles
            progress.downloadedTracks = 0
            progress.phase = "Downloading tracks..."
            let tracksToDownload = filteredManifest.tracks.filter { track in
                guard let ext = track.fileExtension else { return false }
                return !FileManager.default.fileExists(atPath: audioFileURL(trackId: track.id, ext: ext).path)
            }
            progress.totalTracks = tracksToDownload.count
            let _ = await downloadConcurrently(items: tracksToDownload, concurrency: 6) { track in
                let ext = track.fileExtension ?? "m4a"
                let fileURL = self.audioFileURL(trackId: track.id, ext: ext)
                try await client.downloadTrackFile(trackId: track.id, to: fileURL)
                try self.db.updateTrackFilePath(trackId: track.id, localPath: fileURL.path)
            } onProgress: { self.progress.downloadedTracks += 1 }

            state = .uploadingPlayStats
            progress.phase = "Uploading play stats..."
            try await uploadPendingPlayStats(client: client)

            let trackIds = filteredManifest.tracks.map { $0.id }
            let playlistIds = filteredManifest.playlists.map { $0.id }
            try await client.markSyncComplete(trackIds: trackIds, playlistIds: playlistIds)

            state = .done
            progress.phase = "Sync complete"
            endBackgroundTask()
            SyncEngine.scheduleBackgroundSync()
        } catch {
            state = .error
            errorMessage = error.localizedDescription
            endBackgroundTask()
        }
    }

    // MARK: - Manifest Filtering

    private func filterManifest(_ manifest: SyncClient.SyncManifest) -> SyncClient.SyncManifest {
        guard !selectedPlaylistIds.isEmpty else { return manifest }

        let selectedPlaylists = manifest.playlists.filter { selectedPlaylistIds.contains($0.id) }
        let selectedTrackIds = Set(selectedPlaylists.flatMap { $0.trackIds })
        let selectedTracks = manifest.tracks.filter { selectedTrackIds.contains($0.id) }

        return SyncClient.SyncManifest(playlists: selectedPlaylists, tracks: selectedTracks)
    }

    // MARK: - Persistence

    private func persistSelectedPlaylistIds() {
        UserDefaults.standard.set(Array(selectedPlaylistIds), forKey: SyncEngine.selectedPlaylistIdsKey)
    }

    // MARK: - Unique Track Count

    func uniqueTrackCount(for playlistIds: Set<Int64>) -> Int {
        let trackIds = Set(availablePlaylists.filter { playlistIds.contains($0.id) }.flatMap { $0.trackIds })
        return trackIds.count
    }

    // MARK: - Background Execution

    private func beginBackgroundTask() {
        backgroundTaskID = UIApplication.shared.beginBackgroundTask(withName: "sync") { [weak self] in
            print("[Sync] Background time expiring")
            self?.endBackgroundTask()
        }
        print("[Sync] Background task started (remaining: \(UIApplication.shared.backgroundTimeRemaining)s)")
    }

    private func endBackgroundTask() {
        guard backgroundTaskID != .invalid else { return }
        UIApplication.shared.endBackgroundTask(backgroundTaskID)
        backgroundTaskID = .invalid
    }

    /// Register the BGProcessingTask with the system. Call once at app launch.
    static func registerBackgroundSync() {
        BGTaskScheduler.shared.register(forTaskWithIdentifier: bgTaskIdentifier, using: nil) { task in
            guard let processingTask = task as? BGProcessingTask else { return }
            handleBackgroundSync(task: processingTask)
        }
    }

    /// Schedule the next background sync.
    static func scheduleBackgroundSync() {
        let request = BGProcessingTaskRequest(identifier: bgTaskIdentifier)
        request.requiresNetworkConnectivity = true
        request.earliestBeginDate = Date(timeIntervalSinceNow: 15 * 60) // 15 min
        do {
            try BGTaskScheduler.shared.submit(request)
            print("[Sync] Background sync scheduled")
        } catch {
            print("[Sync] Failed to schedule background sync: \(error)")
        }
    }

    private static func handleBackgroundSync(task: BGProcessingTask) {
        // Schedule the next one
        scheduleBackgroundSync()

        let pairing = PairingManager()
        guard pairing.isPaired else {
            task.setTaskCompleted(success: true)
            return
        }

        let engine = SyncEngine(pairingManager: pairing)
        let syncTask = Task {
            await engine.startSyncLegacy()
            task.setTaskCompleted(success: engine.state == .done)
        }

        task.expirationHandler = {
            syncTask.cancel()
        }
    }

    // MARK: - Metadata Sync

    private func syncMetadata(_ manifest: SyncClient.SyncManifest) throws {
        try db.syncMetadataBatch(tracks: manifest.tracks, playlists: manifest.playlists)
    }

    // MARK: - Play Stats Upload

    private func uploadPendingPlayStats(client: SyncClient) async throws {
        let stats = try db.fetchAndClearPendingPlayStats()
        guard !stats.isEmpty else { return }

        let deltas = stats.map { stat in
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

    // MARK: - Concurrent Downloads

    /// Downloads items concurrently with a limit, returns error count.
    private func downloadConcurrently<T: Sendable>(
        items: [T],
        concurrency: Int,
        operation: @Sendable @escaping (T) async throws -> Void,
        onProgress: @escaping @MainActor () -> Void
    ) async -> Int {
        var errorCount = 0

        await withTaskGroup(of: Bool.self) { group in
            var iterator = items.makeIterator()

            // Seed initial batch
            for _ in 0..<concurrency {
                guard let item = iterator.next() else { break }
                group.addTask {
                    do {
                        try await operation(item)
                        return true
                    } catch {
                        print("[Sync] Download error: \(error)")
                        return false
                    }
                }
            }

            // As each completes, count result and add next item
            for await success in group {
                if !success { errorCount += 1 }
                await MainActor.run { onProgress() }

                if let item = iterator.next() {
                    group.addTask {
                        do {
                            try await operation(item)
                            return true
                        } catch {
                            print("[Sync] Download error: \(error)")
                            return false
                        }
                    }
                }
            }
        }

        return errorCount
    }

    // MARK: - File Paths

    private func audioFileURL(trackId: Int64, ext: String) -> URL {
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        return docs.appendingPathComponent("Music/\(trackId).\(ext)")
    }

    private func artworkFileURL(hash: String) -> URL {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("Artwork/\(hash).jpg")
    }
}
