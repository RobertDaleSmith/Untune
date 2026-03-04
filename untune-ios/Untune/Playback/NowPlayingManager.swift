import Foundation
import MediaPlayer

class NowPlayingManager {
    private var commandsConfigured = false

    func updateNowPlaying(track: Track, position: Double, duration: Double) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: track.title,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
        ]

        if let artist = track.artist {
            info[MPMediaItemPropertyArtist] = artist
        }
        if let album = track.album {
            info[MPMediaItemPropertyAlbumTitle] = album
        }
        if let albumArtist = track.albumArtist {
            info[MPMediaItemPropertyAlbumArtist] = albumArtist
        }
        if let trackNumber = track.trackNumber {
            info[MPMediaItemPropertyAlbumTrackNumber] = trackNumber
        }
        if let genre = track.genre {
            info[MPMediaItemPropertyGenre] = genre
        }

        // Load artwork if available
        if let artworkHash = track.artworkHash {
            let artworkPath = artworkFilePath(hash: artworkHash)
            if let image = UIImage(contentsOfFile: artworkPath) {
                let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
                info[MPMediaItemPropertyArtwork] = artwork
            }
        }

        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    func updatePlaybackState(isPlaying: Bool, position: Double, rate: Float) {
        var info = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = position
        info[MPNowPlayingInfoPropertyPlaybackRate] = rate
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    func setupRemoteCommands(player: AudioPlayer) {
        guard !commandsConfigured else { return }
        commandsConfigured = true

        let center = MPRemoteCommandCenter.shared()

        center.playCommand.isEnabled = true
        center.playCommand.addTarget { [weak player] _ in
            player?.resume()
            return .success
        }

        center.pauseCommand.isEnabled = true
        center.pauseCommand.addTarget { [weak player] _ in
            player?.pause()
            return .success
        }

        center.togglePlayPauseCommand.isEnabled = true
        center.togglePlayPauseCommand.addTarget { [weak player] _ in
            player?.togglePlayPause()
            return .success
        }

        center.nextTrackCommand.isEnabled = true
        center.nextTrackCommand.addTarget { [weak player] _ in
            player?.next()
            return .success
        }

        center.previousTrackCommand.isEnabled = true
        center.previousTrackCommand.addTarget { [weak player] _ in
            player?.previous()
            return .success
        }

        center.changePlaybackPositionCommand.isEnabled = true
        center.changePlaybackPositionCommand.addTarget { [weak player] event in
            guard let event = event as? MPChangePlaybackPositionCommandEvent else {
                return .commandFailed
            }
            player?.seek(to: event.positionTime)
            return .success
        }
    }

    private func artworkFilePath(hash: String) -> String {
        let appSupport = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask).first!
        return appSupport.appendingPathComponent("Artwork/\(hash).jpg").path
    }
}
