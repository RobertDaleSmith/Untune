import Foundation
import AVFoundation
import Observation
import UIKit

enum RepeatMode: String, CaseIterable {
    case off, all, one

    var icon: String {
        switch self {
        case .off: return "repeat"
        case .all: return "repeat"
        case .one: return "repeat.1"
        }
    }

    var isActive: Bool {
        self != .off
    }
}

@Observable
class AudioPlayer {
    static let shared = AudioPlayer()

    private var player: AVPlayer?
    private var timeObserver: Any?
    private var itemObserver: NSKeyValueObservation?

    private(set) var isPlaying = false
    private(set) var currentTrack: Track?
    private(set) var position: Double = 0
    private(set) var duration: Double = 0
    private(set) var isBuffering = false

    var shuffle = false
    var repeatMode: RepeatMode = .off

    private(set) var artworkImage: UIImage?

    private(set) var queue: [Track] = []
    private(set) var queueIndex = 0
    private var shuffleOrder: [Int] = []
    private var shuffleHistory: [Int] = []

    // Play threshold tracking
    private var playRecorded = false
    private let playThresholdFraction = 0.5
    private let playThresholdMax: Double = 240

    private let nowPlayingManager = NowPlayingManager()
    private let defaults = UserDefaults.standard

    // Streaming connection info (set after pairing)
    var streamBaseURL: String?
    var streamAuthToken: String?

    private enum StorageKey {
        static let shuffle = "playback.shuffle"
        static let repeatMode = "playback.repeatMode"
        static let queueTrackIds = "playback.queueTrackIds"
        static let queueIndex = "playback.queueIndex"
        static let position = "playback.position"
    }

    // MARK: - Persistence

    init() {
        shuffle = defaults.bool(forKey: StorageKey.shuffle)
        if let raw = defaults.string(forKey: StorageKey.repeatMode) {
            repeatMode = RepeatMode(rawValue: raw) ?? .off
        }
    }

    func restoreLastSession() {
        guard let ids = defaults.array(forKey: StorageKey.queueTrackIds) as? [Int64],
              !ids.isEmpty else { return }

        let savedIndex = defaults.integer(forKey: StorageKey.queueIndex)
        let savedPosition = defaults.double(forKey: StorageKey.position)

        guard let allTracks = try? DatabaseManager.shared.fetchAllTracks() else { return }
        let trackMap = Dictionary(uniqueKeysWithValues: allTracks.map { ($0.id, $0) })
        let restored = ids.compactMap { trackMap[$0] }

        guard !restored.isEmpty else { return }

        queue = restored
        queueIndex = min(savedIndex, restored.count - 1)
        let track = restored[queueIndex]
        currentTrack = track
        duration = track.duration ?? 0
        position = savedPosition

        loadArtwork(for: track)
        nowPlayingManager.updateNowPlaying(track: track, position: savedPosition, duration: duration, artworkImage: artworkImage)
        nowPlayingManager.setupRemoteCommands(player: self)

        if shuffle {
            generateShuffleOrder(startingWith: queueIndex)
        }
    }

    private func saveState() {
        defaults.set(shuffle, forKey: StorageKey.shuffle)
        defaults.set(repeatMode.rawValue, forKey: StorageKey.repeatMode)
        defaults.set(queue.map(\.id), forKey: StorageKey.queueTrackIds)
        defaults.set(queueIndex, forKey: StorageKey.queueIndex)
        defaults.set(position, forKey: StorageKey.position)
    }

    var upNext: [Track] {
        guard !queue.isEmpty else { return [] }
        let indices: [Int]
        if shuffle {
            let currentShuffleIdx = shuffleOrder.firstIndex(of: queueIndex) ?? 0
            indices = Array(shuffleOrder.dropFirst(currentShuffleIdx + 1))
        } else {
            indices = Array((queueIndex + 1)..<queue.count)
        }
        return indices.compactMap { idx in
            idx < queue.count ? queue[idx] : nil
        }
    }

    var progress: Double {
        guard duration > 0 else { return 0 }
        return position / duration
    }

    // MARK: - Playback Controls

    func play(tracks: [Track], startIndex: Int = 0) {
        queue = tracks
        queueIndex = max(0, min(startIndex, tracks.count - 1))

        if shuffle {
            generateShuffleOrder(startingWith: queueIndex)
        }

        loadAndPlay(queue[queueIndex])
    }

    func pause() {
        player?.pause()
        isPlaying = false
        nowPlayingManager.updatePlaybackState(isPlaying: false, position: position, rate: 0)
    }

    func resume() {
        player?.play()
        isPlaying = true
        nowPlayingManager.updatePlaybackState(isPlaying: true, position: position, rate: 1)
    }

    func togglePlayPause() {
        if isPlaying {
            pause()
        } else {
            resume()
        }
    }

    func next() {
        guard !queue.isEmpty else { return }

        if !playRecorded, let track = currentTrack {
            try? DatabaseManager.shared.recordSkip(trackId: track.id)
        }

        advanceToNext()
    }

    func previous() {
        if position > 3 {
            seek(to: 0)
            return
        }

        guard !queue.isEmpty else { return }

        if shuffle {
            if let lastIdx = shuffleHistory.popLast() {
                queueIndex = lastIdx
            }
        } else {
            if queueIndex > 0 {
                queueIndex -= 1
            } else if repeatMode == .all {
                queueIndex = queue.count - 1
            }
        }

        loadAndPlay(queue[queueIndex])
    }

    func seek(to seconds: Double) {
        let time = CMTime(seconds: seconds, preferredTimescale: 600)
        player?.seek(to: time, toleranceBefore: .zero, toleranceAfter: .zero)
        position = seconds
        nowPlayingManager.updatePlaybackState(isPlaying: isPlaying, position: seconds, rate: isPlaying ? 1 : 0)
    }

    func seekToFraction(_ fraction: Double) {
        seek(to: fraction * duration)
    }

    func toggleShuffle() {
        shuffle.toggle()
        if shuffle {
            generateShuffleOrder(startingWith: queueIndex)
        }
        saveState()
    }

    func cycleRepeat() {
        switch repeatMode {
        case .off: repeatMode = .all
        case .all: repeatMode = .one
        case .one: repeatMode = .off
        }
        saveState()
    }

    func playTrackFromQueue(at index: Int) {
        guard index >= 0, index < queue.count else { return }
        queueIndex = index
        loadAndPlay(queue[index])
    }

    // MARK: - Private

    private func loadAndPlay(_ track: Track) {
        cleanup()

        currentTrack = track
        playRecorded = false
        position = 0
        duration = track.duration ?? 0

        loadArtwork(for: track)

        guard let url = streamingURL(for: track) else {
            isPlaying = false
            nowPlayingManager.updateNowPlaying(track: track, position: 0, duration: duration, artworkImage: artworkImage)
            return
        }

        let asset = AVURLAsset(url: url, options: streamingOptions())
        let item = AVPlayerItem(asset: asset)

        // Monitor buffering state
        itemObserver = item.observe(\.isPlaybackBufferEmpty, options: [.new]) { [weak self] item, _ in
            DispatchQueue.main.async {
                self?.isBuffering = item.isPlaybackBufferEmpty
            }
        }

        player = AVPlayer(playerItem: item)
        player?.play()
        isPlaying = true

        setupTimeObserver()
        setupItemEndObserver()
        nowPlayingManager.updateNowPlaying(track: track, position: 0, duration: duration, artworkImage: artworkImage)
        nowPlayingManager.updatePlaybackState(isPlaying: true, position: 0, rate: 1)
        nowPlayingManager.setupRemoteCommands(player: self)
        saveState()
    }

    private func streamingURL(for track: Track) -> URL? {
        guard let baseURL = streamBaseURL else { return nil }
        return URL(string: "\(baseURL)/api/tracks/\(track.id)/file")
    }

    private func streamingOptions() -> [String: Any] {
        guard let token = streamAuthToken else { return [:] }
        return ["AVURLAssetHTTPHeaderFieldsKey": ["Authorization": "Bearer \(token)"]]
    }

    private var lastPositionSave: TimeInterval = 0

    private func setupTimeObserver() {
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = player?.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard let self else { return }
            self.position = time.seconds

            if let itemDuration = self.player?.currentItem?.duration,
               itemDuration.isNumeric {
                self.duration = itemDuration.seconds
            }

            self.checkPlayThreshold()
            self.nowPlayingManager.updatePlaybackState(
                isPlaying: self.isPlaying,
                position: self.position,
                rate: self.isPlaying ? 1 : 0
            )

            let now = ProcessInfo.processInfo.systemUptime
            if now - self.lastPositionSave >= 5 {
                self.lastPositionSave = now
                self.defaults.set(self.position, forKey: StorageKey.position)
            }
        }
    }

    private func setupItemEndObserver() {
        NotificationCenter.default.addObserver(
            forName: .AVPlayerItemDidPlayToEndTime,
            object: player?.currentItem,
            queue: .main
        ) { [weak self] _ in
            self?.handleTrackEnd()
        }
    }

    private func checkPlayThreshold() {
        guard !playRecorded, let track = currentTrack else { return }
        let threshold = min(duration * playThresholdFraction, playThresholdMax)
        if position >= threshold && threshold > 0 {
            playRecorded = true
            try? DatabaseManager.shared.recordPlay(trackId: track.id)
        }
    }

    private func handleTrackEnd() {
        if repeatMode == .one {
            seek(to: 0)
            player?.play()
            return
        }

        advanceToNext()
    }

    private func advanceToNext() {
        guard !queue.isEmpty else { return }

        if shuffle {
            shuffleHistory.append(queueIndex)
            let currentShuffleIdx = shuffleOrder.firstIndex(of: queueIndex) ?? 0
            let nextShuffleIdx = currentShuffleIdx + 1

            if nextShuffleIdx >= shuffleOrder.count {
                if repeatMode == .all {
                    generateShuffleOrder(startingWith: nil)
                    queueIndex = shuffleOrder[0]
                } else {
                    pause()
                    return
                }
            } else {
                queueIndex = shuffleOrder[nextShuffleIdx]
            }
        } else {
            let nextIndex = queueIndex + 1
            if nextIndex >= queue.count {
                if repeatMode == .all {
                    queueIndex = 0
                } else {
                    pause()
                    return
                }
            } else {
                queueIndex = nextIndex
            }
        }

        loadAndPlay(queue[queueIndex])
    }

    private func generateShuffleOrder(startingWith first: Int?) {
        var indices = Array(0..<queue.count)
        indices.shuffle()

        if let first {
            indices.removeAll { $0 == first }
            indices.insert(first, at: 0)
        }

        shuffleOrder = indices
        shuffleHistory = []
    }

    private func loadArtwork(for track: Track) {
        guard let hash = track.artworkHash else {
            artworkImage = nil
            return
        }

        Task {
            let image = await ArtworkLoader.shared.image(
                forHash: hash,
                baseURL: streamBaseURL,
                authToken: streamAuthToken
            )
            await MainActor.run {
                self.artworkImage = image
            }
        }
    }

    private func cleanup() {
        if let timeObserver {
            player?.removeTimeObserver(timeObserver)
        }
        timeObserver = nil
        itemObserver?.invalidate()
        itemObserver = nil
        NotificationCenter.default.removeObserver(self, name: .AVPlayerItemDidPlayToEndTime, object: player?.currentItem)
    }

    deinit {
        cleanup()
    }
}
