import Foundation
import AVFoundation
import Observation
import SwiftUI

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
    private var player: AVPlayer?
    private var timeObserver: Any?
    private var itemObserver: NSKeyValueObservation?

    private(set) var isPlaying = false
    private(set) var currentTrack: Track?
    private(set) var position: Double = 0
    private(set) var duration: Double = 0

    var shuffle = false
    var repeatMode: RepeatMode = .off

    private(set) var accentColor: Color?
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
        prewarmAVPlayer()
    }

    /// Create a short silent AVPlayer to force-load the AV framework and audio hardware,
    /// so the first real play doesn't have a multi-second delay.
    private func prewarmAVPlayer() {
        DispatchQueue.global(qos: .userInitiated).async {
            // Generate 0.1s of silence as a WAV in memory
            let sampleRate: UInt32 = 44100
            let numSamples: UInt32 = 4410 // 0.1s
            let dataSize = numSamples * 2 // 16-bit mono
            var wav = Data()
            // RIFF header
            wav.append(contentsOf: [0x52, 0x49, 0x46, 0x46]) // "RIFF"
            wav.append(contentsOf: withUnsafeBytes(of: (36 + dataSize).littleEndian) { Array($0) })
            wav.append(contentsOf: [0x57, 0x41, 0x56, 0x45]) // "WAVE"
            // fmt chunk
            wav.append(contentsOf: [0x66, 0x6D, 0x74, 0x20]) // "fmt "
            wav.append(contentsOf: withUnsafeBytes(of: UInt32(16).littleEndian) { Array($0) })
            wav.append(contentsOf: withUnsafeBytes(of: UInt16(1).littleEndian) { Array($0) }) // PCM
            wav.append(contentsOf: withUnsafeBytes(of: UInt16(1).littleEndian) { Array($0) }) // mono
            wav.append(contentsOf: withUnsafeBytes(of: sampleRate.littleEndian) { Array($0) })
            wav.append(contentsOf: withUnsafeBytes(of: (sampleRate * 2).littleEndian) { Array($0) }) // byte rate
            wav.append(contentsOf: withUnsafeBytes(of: UInt16(2).littleEndian) { Array($0) }) // block align
            wav.append(contentsOf: withUnsafeBytes(of: UInt16(16).littleEndian) { Array($0) }) // bits per sample
            // data chunk
            wav.append(contentsOf: [0x64, 0x61, 0x74, 0x61]) // "data"
            wav.append(contentsOf: withUnsafeBytes(of: dataSize.littleEndian) { Array($0) })
            wav.append(Data(count: Int(dataSize))) // silence

            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("silence.wav")
            try? wav.write(to: tmp)

            let item = AVPlayerItem(url: tmp)
            let warmup = AVPlayer(playerItem: item)
            warmup.volume = 0
            warmup.play()

            // Let it initialize, then discard
            Thread.sleep(forTimeInterval: 0.1)
            warmup.pause()
            try? FileManager.default.removeItem(at: tmp)
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

        updateAccentColor(for: track)
        nowPlayingManager.updateNowPlaying(track: track, position: savedPosition, duration: duration)
        nowPlayingManager.setupRemoteCommands(player: self)

        // Create AVPlayer in paused state so resume() works immediately
        if let url = audioURL(for: track) {
            let item = AVPlayerItem(url: url)
            player = AVPlayer(playerItem: item)
            player?.pause()
            setupTimeObserver()
            setupItemEndObserver()
            seek(to: savedPosition)
        }

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

        // Record skip if we haven't recorded a play yet
        if !playRecorded, let track = currentTrack {
            try? DatabaseManager.shared.recordSkip(trackId: track.id)
        }

        if repeatMode == .one {
            // In repeat-one mode, next should still advance
            advanceToNext()
        } else {
            advanceToNext()
        }
    }

    func previous() {
        // If more than 3 seconds in, restart current track
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

    func moveQueueItem(from source: IndexSet, to destination: Int) {
        queue.move(fromOffsets: source, toOffset: destination)
        // Adjust queueIndex if needed
        if let currentTrack, let newIdx = queue.firstIndex(where: { $0.id == currentTrack.id }) {
            queueIndex = newIdx
        }
        if shuffle {
            generateShuffleOrder(startingWith: queueIndex)
        }
    }

    // MARK: - Private

    private func loadAndPlay(_ track: Track) {
        cleanup()

        currentTrack = track
        playRecorded = false
        position = 0
        duration = track.duration ?? 0

        updateAccentColor(for: track)

        // Try to load audio file
        guard let url = audioURL(for: track) else {
            // No file available — still show track info
            isPlaying = false
            nowPlayingManager.updateNowPlaying(track: track, position: 0, duration: duration)
            return
        }

        let item = AVPlayerItem(url: url)
        player = AVPlayer(playerItem: item)
        player?.play()
        isPlaying = true

        setupTimeObserver()
        setupItemEndObserver()
        nowPlayingManager.updateNowPlaying(track: track, position: 0, duration: duration)
        nowPlayingManager.updatePlaybackState(isPlaying: true, position: 0, rate: 1)
        nowPlayingManager.setupRemoteCommands(player: self)
        saveState()
    }

    private func audioURL(for track: Track) -> URL? {
        // Check stored path first
        if let path = track.localFilePath, FileManager.default.fileExists(atPath: path) {
            return URL(fileURLWithPath: path)
        }

        // Try standard download location by trackId (handles stale/missing DB paths)
        let docs = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask).first!
        let musicDir = docs.appendingPathComponent("Music")
        for ext in ["m4a", "mp3", "flac", "wav", "aac", "ogg", "opus"] {
            let url = musicDir.appendingPathComponent("\(track.id).\(ext)")
            if FileManager.default.fileExists(atPath: url.path) {
                return url
            }
        }

        return nil
    }

    private var lastPositionSave: TimeInterval = 0

    private func setupTimeObserver() {
        let interval = CMTime(seconds: 0.5, preferredTimescale: 600)
        timeObserver = player?.addPeriodicTimeObserver(forInterval: interval, queue: .main) { [weak self] time in
            guard let self else { return }
            self.position = time.seconds

            // Update actual duration from player if available
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

            // Save position every ~5 seconds
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

    private func updateAccentColor(for track: Track) {
        if let hash = track.artworkHash, let image = ArtworkCache.shared.image(forHash: hash) {
            artworkImage = image
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                let isDark = UITraitCollection.current.userInterfaceStyle == .dark
                let color = AccentColorExtractor.accentColor(from: image, isDark: isDark)
                DispatchQueue.main.async {
                    self?.accentColor = color
                }
            }
        } else {
            artworkImage = nil
            accentColor = nil
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
