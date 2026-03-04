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
        if let artworkHash = track.artworkHash,
           let image = ArtworkCache.shared.image(forHash: artworkHash) {
            let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
            info[MPMediaItemPropertyArtwork] = artwork
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

        center.changeShuffleModeCommand.isEnabled = true
        center.changeShuffleModeCommand.addTarget { [weak player] event in
            guard let player,
                  let event = event as? MPChangeShuffleModeCommandEvent else {
                return .commandFailed
            }
            let wantsShuffle = event.shuffleType != .off
            if wantsShuffle {
                // Dice button behavior: load all tracks, enable shuffle, play from random index
                if let allTracks = try? DatabaseManager.shared.fetchAllTracks(), !allTracks.isEmpty {
                    if !player.shuffle { player.toggleShuffle() }
                    let randomIndex = Int.random(in: 0..<allTracks.count)
                    player.play(tracks: allTracks, startIndex: randomIndex)
                }
            } else {
                // "Turn off shuffle"
                if player.shuffle { player.toggleShuffle() }
            }
            return .success
        }

        center.changeRepeatModeCommand.isEnabled = true
        center.changeRepeatModeCommand.addTarget { [weak player] event in
            guard let player,
                  let event = event as? MPChangeRepeatModeCommandEvent else {
                return .commandFailed
            }
            switch event.repeatType {
            case .off:
                if player.repeatMode != .off { player.cycleRepeat(); if player.repeatMode != .off { player.cycleRepeat() } }
            case .one:
                while player.repeatMode != .one { player.cycleRepeat() }
            case .all:
                while player.repeatMode != .all { player.cycleRepeat() }
            @unknown default:
                break
            }
            return .success
        }
    }
}
